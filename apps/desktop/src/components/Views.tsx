import { useState, useEffect } from "react";
import type { ClientId, RecentRequest } from "../lib/types";
import { CLIENT_LABEL, store, useMcps } from "../lib/store";
import { toast } from "../lib/toast";
import { Plug, Scroll, Check } from "../lib/icons";

/* ---- Clients: register Weft's MCP server per AI client, from inside the app ---- */
export function Clients() {
  const clients: ClientId[] = ["claude-code", "claude-desktop", "codex", "cursor"];
  const [done, setDone] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const register = async (c: ClientId) => {
    setBusy(c);
    try {
      const where = await store.installClient(c);
      setDone((d) => ({ ...d, [c]: where }));
      toast(`${CLIENT_LABEL[c]}: added to ${where}`);
    } catch (e) {
      toast(`Couldn't set up ${CLIENT_LABEL[c]}: ${String(e)}`);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="main-inner">
      <div className="page-head"><h1>Clients</h1><span className="sub">register the Weft MCP server</span></div>
      <div className="list">
        {clients.map((c) => (
          <div className="mcp" key={c} style={{ gridTemplateColumns: "34px 1fr auto" }}>
            <div className="avatar" style={{ background: "var(--surface-3)", color: "var(--ink-2)" }}><Plug /></div>
            <div className="meta">
              <div className="name">{CLIENT_LABEL[c]}</div>
              <div className="origin" style={{ fontFamily: "var(--mono)", fontSize: 11.5 }}>
                {done[c] ? done[c] : "writes one weft entry into this client's MCP config"}
              </div>
            </div>
            <div className="actions">
              <button className="btn sm" onClick={() => register(c)} disabled={busy === c}>
                {done[c] ? <><Check /> Installed · re-run</> : busy === c ? "Installing…" : "Install"}
              </button>
            </div>
          </div>
        ))}
      </div>
      <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 16 }}>
        Install writes a single <code>weft</code> entry into the client's own config — nothing else is
        touched. Restart the client afterwards. Every client spawns the same shim, so they share one
        endpoint model and one live session. You can also use <b>Open in client</b> on any ready site.
      </p>
    </div>
  );
}

/* ---- Audit log: the real feed of recently captured requests, local only ---- */
export function Audit() {
  const mcps = useMcps(); // re-render trigger: capture changes bump this
  const [rows, setRows] = useState<RecentRequest[]>([]);
  useEffect(() => {
    let on = true;
    store.recent().then((r) => { if (on) setRows(r); });
    return () => { on = false; };
  }, [mcps]);

  return (
    <div className="main-inner">
      <div className="page-head"><h1>Audit log</h1><span className="sub">recently captured requests · local only</span></div>
      {rows.length === 0 ? (
        <div className="empty">
          <div className="glyph"><Scroll style={{ width: 22, height: 22 }} /></div>
          <h2>Nothing captured yet</h2>
          <p>Convert a site and browse it — every request Weft observes shows up here, on this device only.</p>
        </div>
      ) : (
        <div className="list">
          {rows.map((r, i) => (
            <div className="mcp" key={i} style={{ gridTemplateColumns: "58px 1fr auto" }}>
              <span className="pill" style={{ fontFamily: "var(--mono)", fontSize: 11 }}>{r.method}</span>
              <div className="meta">
                <div className="name" style={{ fontSize: 13, fontFamily: "var(--mono)" }}>{r.path}</div>
                <div className="origin">{host(r.origin)}</div>
              </div>
              <span className="origin" style={{ color: r.status >= 400 ? "var(--bad)" : "var(--ink-3)" }}>{r.status || "—"}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/* ---- Settings ---- */
export function Settings({ theme, setTheme }: { theme: Theme; setTheme: (t: Theme) => void }) {
  return (
    <div className="main-inner">
      <div className="page-head"><h1>Settings</h1></div>

      <div className="section-title">Appearance</div>
      <div style={{ display: "flex", gap: 7 }}>
        {(["system", "light", "dark"] as Theme[]).map((t) => (
          <button key={t} className={`btn sm ${theme === t ? "primary" : ""}`} onClick={() => setTheme(t)} style={{ textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>Privacy &amp; safety</div>
      <div className="list">
        {[
          "Credential values never leave the browser — Weft only ever sees cookie names and storage keys.",
          "Write calls (POST / PUT / PATCH / DELETE) require explicit confirmation before they replay.",
          "Loopback only — no account, no servers, no telemetry. Nothing phones home.",
        ].map((t) => (
          <div key={t} style={{ display: "flex", gap: 10, alignItems: "flex-start", padding: "6px 0", fontSize: 13 }}>
            <Check style={{ color: "var(--ok)", flex: "none", marginTop: 1 }} />
            <span>{t}</span>
          </div>
        ))}
      </div>

      <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 20 }}>
        Everything stays on this device. Weft is free and open source (MIT) — see the repository
        for the threat model and source.
      </p>
    </div>
  );
}

export type Theme = "system" | "light" | "dark";

function host(origin: string): string {
  try { return new URL(origin).host; } catch { return origin; }
}
