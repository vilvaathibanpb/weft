/**
 * Weft background service worker.
 *
 * Responsibilities (deliberately thin — the desktop app is the brain):
 *   1. Maintain an authed WebSocket to the local Weft core (ws://127.0.0.1:8787).
 *   2. On "Convert this site to MCP": request host permission, snapshot cookies + storage,
 *      attach the debugger to the tab, and stream live network traffic to the core.
 *   3. Execute replays/probes the core asks for, in the page context (cookies auto-attach).
 *
 * MV3 note: this worker can be evicted at any time. We treat the core as source of truth,
 * reconnect on wake, and keep per-origin capture state in chrome.storage.session.
 */

const CORE_URL = "ws://127.0.0.1:8787";
const RECONNECT_MS = 2000;

let ws = null;
const attached = new Map(); // tabId -> { origin }

/* ----------------------------- core link ----------------------------- */

async function getToken() {
  const { weftToken } = await chrome.storage.local.get("weftToken");
  return weftToken || "";
}

function wsConnected() {
  return !!ws && ws.readyState === WebSocket.OPEN;
}

function connect() {
  // Never stack sockets. Loading the extension fires onInstalled *and* the bottom connect(),
  // and onStartup/SW-wake can pile on too. A second socket would leave `ws` pointing at a
  // CONNECTING one while an older socket's onopen tries to send → "Still in CONNECTING state".
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) return;

  let sock;
  try {
    sock = new WebSocket(CORE_URL);
  } catch {
    scheduleReconnect();
    return;
  }
  ws = sock;

  sock.onopen = async () => {
    const token = await getToken();
    // The socket may have been replaced or closed during the await.
    if (ws !== sock || sock.readyState !== WebSocket.OPEN) return;
    rawSend(sock, { t: "hello", token, browser: "chrome", profile: "default" });
    setBadge("", "#1f9d6b");
  };
  sock.onmessage = (e) => handleCommand(JSON.parse(e.data));
  sock.onclose = () => { if (ws === sock) ws = null; setBadge("•", "#8a93a6"); scheduleReconnect(); };
  sock.onerror = () => { try { sock.close(); } catch { /* ignore */ } };
}

let reconnectTimer = null;
function scheduleReconnect() {
  clearTimeout(reconnectTimer);
  reconnectTimer = setTimeout(connect, RECONNECT_MS);
}

// Only ever writes to an OPEN socket — the readyState check is the real guard, not a flag.
function rawSend(sock, msg) {
  if (sock && sock.readyState === WebSocket.OPEN) sock.send(JSON.stringify(msg));
}

function send(msg) {
  rawSend(ws, msg);
}

function setBadge(text, color) {
  chrome.action.setBadgeText({ text });
  if (color) chrome.action.setBadgeBackgroundColor({ color });
}

/* --------------------------- convert flow ---------------------------- */

// The popup already requested host permission (needs the user gesture) and passes origin + tabId.
async function startCapture(origin, tabId) {
  if (!wsConnected()) return { ok: false, error: "Weft app isn't running." };
  send({ t: "convert", origin });
  await snapshotSession(tabId, origin);
  const err = await attachDebugger(tabId, origin);
  if (err) return { ok: false, error: err };
  return { ok: true, origin };
}

async function snapshotSession(tabId, origin) {
  // Cookie metadata only (names/flags), never values over the wire by default.
  const cookies = await chrome.cookies.getAll({ url: origin });
  send({
    t: "cookies",
    origin,
    cookies: cookies.map((c) => ({ name: c.name, domain: c.domain, secure: c.secure, httpOnly: c.httpOnly })),
  });

  // localStorage/sessionStorage live in the page — read via the content script.
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const dump = (s) => Object.keys(s).map((k) => ({ k, v: "" /* redacted */ }));
        return { local: dump(localStorage), session: dump(sessionStorage) };
      },
    });
    send({ t: "storage", origin, local: result.local, session: result.session });
  } catch { /* page may block injection; ignore */ }
}

/* --------------------- network capture via CDP ----------------------- */

// Returns an error message for the popup, or null once the tab is being captured.
async function attachDebugger(tabId, origin) {
  if (attached.has(tabId)) return null; // already capturing this tab
  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    await chrome.debugger.sendCommand({ tabId }, "Network.enable");
    attached.set(tabId, { origin });
    await chrome.storage.session.set({ [`cap_${tabId}`]: origin });
    return null;
  } catch (e) {
    // Another debugger (e.g. DevTools) holds the tab, or Chrome refused the attach. Say so
    // rather than pretending: without the debugger Weft can't see the site's API calls.
    return "Couldn't start capturing this tab. Close DevTools on it (if open) and try again.";
  }
}

const pending = new Map(); // requestId -> partial

chrome.debugger.onEvent.addListener(async (source, method, params) => {
  const cap = attached.get(source.tabId);
  if (!cap) return;

  if (method === "Network.requestWillBeSent") {
    const { request, requestId } = params;
    pending.set(requestId, { request });
  }

  if (method === "Network.responseReceived") {
    const p = pending.get(params.requestId);
    if (p) p.response = params.response;
  }

  if (method === "Network.loadingFinished") {
    const p = pending.get(params.requestId);
    pending.delete(params.requestId);
    if (!p || !p.response) return;
    const url = p.request.url;
    // Only forward same-origin API-ish calls (xhr/fetch); skip assets.
    if (!url.startsWith(cap.origin)) return;

    // Data minimisation: the core builds its endpoint model from method + URL + status alone,
    // so headers (which can carry Authorization tokens) and bodies are never forwarded.
    send({
      t: "request",
      origin: cap.origin,
      req: { method: p.request.method, url },
      res: { status: p.response.status, contentType: p.response.mimeType },
    });
  }
});


chrome.tabs.onRemoved.addListener((tabId) => {
  if (attached.has(tabId)) {
    attached.delete(tabId);
    chrome.storage.session.remove(`cap_${tabId}`);
  }
});

/* ------------------ replays & probes from the core ------------------- */

async function handleCommand(cmd) {
  switch (cmd.t) {
    case "replay":
    case "probe": {
      const tab = await findTabForOrigin(cmd.origin);
      if (!tab) {
        if (cmd.t === "probe") send({ t: "probe_result", id: cmd.id, ok: false, status: 0 });
        else send({ t: "replay_result", id: cmd.id, status: 0, headers: [] });
        return;
      }
      // Run fetch inside the page so the live session cookies attach automatically.
      const [{ result }] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        args: [cmd],
        func: async (c) => {
          try {
            const url = c.origin + (c.path || "/");
            const res = await fetch(url, {
              method: c.t === "probe" ? "GET" : c.method,
              credentials: "include",
              headers: Object.fromEntries((c.headers || []).map((h) => [h.k, h.v])),
              body: c.body,
            });
            const text = await res.text().catch(() => "");
            return { status: res.status, body: text.slice(0, 64 * 1024) };
          } catch (e) {
            return { status: 0, body: String(e) };
          }
        },
      });
      if (cmd.t === "probe") {
        send({ t: "probe_result", id: cmd.id, ok: result.status >= 200 && result.status < 400, status: result.status });
      } else {
        send({ t: "replay_result", id: cmd.id, status: result.status, headers: [], body: result.body });
      }
      return;
    }
    case "open": {
      // "Refresh" — bring the site forward so the user can re-login.
      const tab = await findTabForOrigin(cmd.origin);
      if (tab) chrome.tabs.update(tab.id, { active: true });
      else chrome.tabs.create({ url: cmd.origin });
      return;
    }
  }
}

async function findTabForOrigin(origin) {
  const tabs = await chrome.tabs.query({ url: origin + "/*" });
  return tabs[0] || null;
}

/* ------------------------------ wiring ------------------------------- */

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.t === "convert") { startCapture(msg.origin, msg.tabId).then(reply); return true; }
  if (msg?.t === "status") { reply({ connected: wsConnected() }); return true; }
});

chrome.runtime.onStartup.addListener(connect);
chrome.runtime.onInstalled.addListener(connect);
connect();
