/**
 * Store + data layer.
 * Talks to the Tauri backend via invoke() when running inside the app; otherwise drives a
 * realistic in-memory mock (with simulated state transitions) so the UI is fully explorable
 * in a browser. Components never know which is which.
 */
import { useSyncExternalStore } from "react";
import type { ClientId, Endpoint, Mcp, RecentRequest } from "./types";

const inTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function invoke<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  // @ts-expect-error — global provided by Tauri's withGlobalTauri
  return window.__TAURI__.core.invoke(cmd, args) as Promise<T>;
}

/* ----------------------------- mock seed ------------------------------ */

const seed: Mcp[] = [
  { id: "linear", name: "Linear", origin: "https://app.linear.app", color: "#5e6ad2", initials: "Li", status: "ready", endpointCount: 41, lastRefreshed: iso(-2), pinnedClients: ["claude-code"] },
  { id: "github", name: "GitHub", origin: "https://github.com", color: "#24292f", initials: "Gh", status: "outdated", endpointCount: 63, drift: { newEndpoints: 5, changed: 2 }, lastRefreshed: iso(-220) },
  { id: "gmail", name: "Gmail", origin: "https://mail.google.com", color: "#ea4335", initials: "Gm", status: "needs_login", endpointCount: 29, lastRefreshed: iso(-1440) },
  { id: "notion", name: "Notion", origin: "https://www.notion.so", color: "#0f0f0f", initials: "No", status: "capturing", endpointCount: 18 },
  { id: "stripe", name: "Stripe Dashboard", origin: "https://dashboard.stripe.com", color: "#635bff", initials: "St", status: "not_possible", endpointCount: 0, reason: "signed_requests" },
  { id: "figma", name: "Figma", origin: "https://www.figma.com", color: "#a259ff", initials: "Fi", status: "paused", endpointCount: 27, lastRefreshed: iso(-5000) },
];

function iso(minsAgo: number) { return new Date(Date.now() + minsAgo * 60_000).toISOString(); }

const sampleEndpoints: Endpoint[] = [
  { id: "e1", method: "GET", pathTemplate: "/api/issues", sampleCount: 14, confidence: "high" },
  { id: "e2", method: "POST", pathTemplate: "/api/issues", sampleCount: 3, confidence: "high" },
  { id: "e3", method: "GET", pathTemplate: "/api/issues/{id}", sampleCount: 9, confidence: "high" },
  { id: "e4", method: "GET", pathTemplate: "/api/teams/{id}", sampleCount: 4, confidence: "high" },
  { id: "e5", method: "PATCH", pathTemplate: "/api/issues/{id}", sampleCount: 2, confidence: "low" },
  { id: "e6", method: "GET", pathTemplate: "/api/projects", sampleCount: 6, confidence: "high" },
];

/* ----------------------------- store core ----------------------------- */

let state: Mcp[] = inTauri ? [] : [...seed];
let loaded = false; // guards against double load() mounting two pollers
const subs = new Set<() => void>();
function emit() { state = [...state]; subs.forEach((f) => f()); }
function patch(id: string, p: Partial<Mcp>) {
  const i = state.findIndex((m) => m.id === id);
  if (i >= 0) { state[i] = { ...state[i], ...p }; emit(); }
}

export const store = {
  subscribe(f: () => void) { subs.add(f); return () => subs.delete(f); },
  get() { return state; },

  async load() {
    if (!inTauri || loaded) return;
    loaded = true;
    const refetch = async () => { state = await invoke<Mcp[]>("list_mcps"); emit(); };
    await refetch();
    // Live refresh: the Rust core emits "mcps-changed" as the extension streams capture in.
    try {
      // @ts-expect-error — global provided by Tauri (withGlobalTauri)
      await window.__TAURI__.event.listen("mcps-changed", refetch);
    } catch { /* events unavailable outside Tauri */ }
    // Belt-and-suspenders: poll every 5s so capture progress is always visible, even if an
    // event is dropped or the core is mutated by a path that doesn't notify.
    setInterval(() => { refetch().catch(() => { /* app closing / transient */ }); }, 5000);
  },

  async convert(origin: string) {
    if (inTauri) { const m = await invoke<Mcp>("convert_site", { origin }); state = [m, ...state]; emit(); return; }
    const host = safeHost(origin);
    const m: Mcp = { id: "x" + Date.now(), name: titleCase(host), origin, color: pickColor(host), initials: host.slice(0, 2).toUpperCase(), status: "capturing", endpointCount: 0 };
    state = [m, ...state]; emit();
    // simulate capture → ready
    let n = 0;
    const t = setInterval(() => { n += 7; patch(m.id, { endpointCount: n }); }, 400);
    setTimeout(() => { clearInterval(t); patch(m.id, { status: "ready", endpointCount: n, lastRefreshed: new Date().toISOString() }); }, 2600);
  },

  async refresh(id: string) {
    if (inTauri) { const m = await invoke<Mcp>("refresh_mcp", { id }); patch(id, m); return; }
    patch(id, { status: "refreshing" });
    setTimeout(() => patch(id, { status: "ready", lastRefreshed: new Date().toISOString() }), 2000);
  },

  async recapture(id: string) {
    if (inTauri) { const m = await invoke<Mcp>("recapture_mcp", { id }); patch(id, m); return; }
    patch(id, { status: "capturing", drift: undefined });
    setTimeout(() => patch(id, { status: "ready", lastRefreshed: new Date().toISOString() }), 2400);
  },

  async pause(id: string) { if (inTauri) { await invoke("pause_mcp", { id }); } patch(id, { status: "paused" }); },
  async resume(id: string) { if (inTauri) { await invoke("resume_mcp", { id }); } patch(id, { status: "ready" }); },
  async remove(id: string) { if (inTauri) { await invoke("delete_mcp", { id }); } state = state.filter((m) => m.id !== id); emit(); },

  async endpoints(id: string): Promise<Endpoint[]> {
    if (inTauri) return invoke<Endpoint[]>("get_endpoints", { id });
    const m = state.find((x) => x.id === id);
    if (!m || m.status === "not_possible") return [];
    return sampleEndpoints.slice(0, Math.max(1, Math.min(sampleEndpoints.length, Math.ceil(m.endpointCount / 8))));
  },

  async recent(): Promise<RecentRequest[]> {
    if (inTauri) return invoke<RecentRequest[]>("recent_activity");
    return [];
  },

  /** Register Weft's MCP server in a client's config file. Returns the file path touched. */
  async installClient(client: ClientId): Promise<string> {
    if (inTauri) return invoke<string>("install_client", { client });
    return `~/.config/${client}`; // mock
  },

  /** Launch the client (GUI apps) / tell the user to restart it (CLIs). Returns a message. */
  async openClient(client: ClientId): Promise<string> {
    if (inTauri) return invoke<string>("open_client", { client });
    return `Opening ${CLIENT_LABEL[client]}…`; // mock
  },
};

export function useMcps(): Mcp[] {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

/* ------------------------------ helpers ------------------------------- */
function safeHost(origin: string) { try { return new URL(origin).host.replace(/^www\./, ""); } catch { return origin; } }
function titleCase(host: string) { const base = host.split(".")[0] || host; return base.charAt(0).toUpperCase() + base.slice(1); }
const palette = ["#5e6ad2", "#2d7ff9", "#1f9d6b", "#d1495b", "#c7841a", "#a259ff", "#0ea5e9"];
function pickColor(seedStr: string) { let h = 0; for (const c of seedStr) h = (h * 31 + c.charCodeAt(0)) >>> 0; return palette[h % palette.length]; }

export const CLIENT_LABEL: Record<ClientId, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  "codex": "Codex",
  "cursor": "Cursor",
};
