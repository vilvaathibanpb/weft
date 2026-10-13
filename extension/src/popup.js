const $ = (id) => document.getElementById(id);
let currentTab = null;
let origin = null;

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;
  try {
    origin = tab?.url ? new URL(tab.url).origin : null;
    $("site").textContent = origin ? new URL(tab.url).host : "no site";
  } catch { $("site").textContent = "no site"; }

  const normalSite = origin && /^https?:/.test(tab.url);

  chrome.runtime.sendMessage({ t: "status" }, (res) => {
    const connected = !!res?.connected;
    $("dot").classList.toggle("on", connected);
    $("conn").textContent = connected ? "connected to Weft app" : "Weft app not running";
    $("convert").disabled = !connected || !normalSite;
    if (!connected) setMsg("Start the Weft app (or dev core), then reopen this.", "err");
    else if (!normalSite) setMsg("Open a normal website to convert it.", "");
  });
}

function setMsg(text, kind = "") {
  const el = $("msg");
  el.textContent = text;
  el.className = "msg" + (kind ? " " + kind : "");
}

$("convert").addEventListener("click", async () => {
  if (!origin || !currentTab) return;
  const btn = $("convert");
  btn.disabled = true;
  setMsg("");

  // Permission must be requested here, inside the user gesture — not in the service worker.
  let granted = false;
  try { granted = await chrome.permissions.request({ origins: [origin + "/*"] }); } catch { /* */ }
  if (!granted) { btn.disabled = false; setMsg("Permission needed to read this site.", "err"); return; }

  btn.textContent = "Converting…";
  chrome.runtime.sendMessage({ t: "convert", origin, tabId: currentTab.id }, (res) => {
    btn.textContent = "Convert this site to MCP";
    if (res?.ok) {
      setMsg("Capturing " + new URL(res.origin).host + " — use the site once now (reload the tab to capture the first request).", "ok");
    } else {
      btn.disabled = false;
      setMsg(res?.error || "Something went wrong.", "err");
    }
  });
});

init();
