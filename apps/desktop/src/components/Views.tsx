import { useState } from "react";
import type { ClientId } from "../lib/types";
import { CLIENT_LABEL } from "../lib/store";
import { toast } from "../lib/toast";
import { Check, Plug, Compass, Scroll } from "../lib/icons";

/* ---- Clients: one-click MCP install per AI client ---- */
export function Clients() {
  const clients: ClientId[] = ["claude-code", "claude-desktop", "codex", "cursor"];
  return (
    <div className="main-inner">
      <div className="page-head"><h1>Clients</h1><span className="sub">register the Weft MCP server</span></div>
      <div className="list">
        {clients.map((c) => (
          <div className="mcp" key={c} style={{ gridTemplateColumns: "34px 1fr auto" }}>
            <div className="avatar" style={{ background: "var(--surface-3)", color: "var(--ink-2)" }}><Plug /></div>
            <div className="meta">
              <div className="name">{CLIENT_LABEL[c]}</div>
              <div className="origin">spawns <span style={{ color: "var(--ink-2)" }}>weft-mcp-shim</span> · shares one core</div>
            </div>
            <div className="actions">
              <button className="btn sm primary" onClick={() => toast(`Installed into ${CLIENT_LABEL[c]}`)}><Check /> Install</button>
            </div>
          </div>
        ))}
      </div>
      <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 16 }}>
        Each client spawns the same tiny shim, so they all read one endpoint model and one live session.
      </p>
    </div>
  );
}

/* ---- Discover: community endpoint-map recipes (maps only, never credentials) ---- */
export function Discover() {
  const recipes = [
    { n: "Linear", d: "41 endpoints · verified", c: "#5e6ad2" },
    { n: "Notion", d: "33 endpoints · community", c: "#0f0f0f" },
    { n: "Jira", d: "58 endpoints · verified", c: "#2d7ff9" },
    { n: "Todoist", d: "22 endpoints · community", c: "#e44232" },
  ];
  return (
    <div className="main-inner">
      <div className="page-head"><h1>Discover</h1><span className="sub">prebuilt endpoint maps — install, then log in</span></div>
      <div className="list">
        {recipes.map((r) => (
          <div className="mcp" key={r.n}>
            <div className="avatar" style={{ background: r.c }}>{r.n.slice(0, 2)}</div>
            <div className="meta"><div className="name">{r.n}</div><div className="origin">{r.d}</div></div>
            <div className="actions"><button className="btn sm" onClick={() => toast(`Added ${r.n} map — log in to activate`)}>Add</button></div>
          </div>
        ))}
      </div>
      <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 16, display: "flex", gap: 8 }}>
        <Compass style={{ flex: "none", color: "var(--ink-3)" }} />
        Recipes ship endpoint maps only — never credentials. You log in with your own session.
      </p>
    </div>
  );
}

/* ---- Audit log ---- */
export function Audit() {
  const rows = [
    { t: "call_endpoint", d: "GET app.linear.app/api/issues → 200", when: "2m ago" },
    { t: "refresh", d: "mail.google.com — opened browser to log in", when: "11m ago" },
    { t: "consent", d: "Stripe write blocked — not on allowlist", when: "1h ago" },
    { t: "convert", d: "notion.so — capture started", when: "1h ago" },
  ];
  return (
    <div className="main-inner">
      <div className="page-head"><h1>Audit log</h1><span className="sub">every tool call &amp; replay, local</span></div>
      <div className="list">
        {rows.map((r, i) => (
          <div className="mcp" key={i} style={{ gridTemplateColumns: "20px 1fr auto" }}>
            <Scroll style={{ color: "var(--ink-3)" }} />
            <div className="meta"><div className="name" style={{ fontSize: 13 }}>{r.t}</div><div className="origin">{r.d}</div></div>
            <span className="origin">{r.when}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- Settings ---- */
export function Settings({
  theme, setTheme, licensed, onActivate, onBuy,
}: {
  theme: Theme; setTheme: (t: Theme) => void;
  licensed: boolean; onActivate: (key: string) => boolean; onBuy: () => void;
}) {
  const [key, setKey] = useState("");
  const [bad, setBad] = useState(false);
  const tryActivate = () => { const ok = onActivate(key.trim()); setBad(!ok); if (ok) setKey(""); };
  return (
    <div className="main-inner">
      <div className="page-head"><h1>Settings</h1></div>

      <div className="section-title">Appearance</div>
      <div style={{ display: "flex", gap: 7 }}>
        {(["system", "light", "dark"] as Theme[]).map((t) => (
          <button key={t} className={`btn sm ${theme === t ? "primary" : ""}`} onClick={() => setTheme(t)} style={{ textTransform: "capitalize" }}>{t}</button>
        ))}
      </div>

      <div className="section-title" style={{ marginTop: 22 }}>License</div>
      {licensed ? (
        <div className="reason note" style={{ background: "var(--ok-wash)", borderColor: "color-mix(in srgb, var(--ok) 30%, transparent)" }}>
          <Check style={{ color: "var(--ok)", flex: "none" }} /><div>Licensed — Weft 1.x. One-time purchase, yours forever. Thank you.</div>
        </div>
      ) : (
        <div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <input
              value={key}
              onChange={(e) => { setKey(e.target.value); setBad(false); }}
              onKeyDown={(e) => { if (e.key === "Enter") tryActivate(); }}
              placeholder="Paste your license key"
              spellCheck={false}
              style={{ border: `1px solid ${bad ? "var(--bad)" : "var(--line-2)"}`, background: "var(--surface)", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 12.5, borderRadius: "var(--r-sm)", padding: "7px 10px", width: 300, maxWidth: "100%", outline: "none" }}
            />
            <button className="btn sm" onClick={tryActivate} disabled={!key.trim()}>Activate</button>
            <button className="btn sm primary" onClick={onBuy}>Buy Weft — $39</button>
          </div>
          {bad && <div style={{ color: "var(--bad)", fontSize: 12, marginTop: 7 }}>That key didn't verify. Check you pasted the whole thing.</div>}
          <div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 7 }}>One-time purchase. No subscription, no account — verified offline.</div>
        </div>
      )}

      <div className="section-title" style={{ marginTop: 22 }}>Privacy</div>
      <Toggle label="Redact credential values in AI tools" defaultOn />
      <Toggle label="Require confirmation for write calls (POST/PUT/DELETE)" defaultOn />
      <Toggle label="Auto-probe sessions in the background" defaultOn />

      <p style={{ color: "var(--ink-3)", fontSize: 12.5, marginTop: 20 }}>
        Everything stays on this device — captured data, credentials (OS keychain), and even the
        license check (verified offline). Weft has no servers and never phones home.
      </p>
    </div>
  );
}

export type Theme = "system" | "light" | "dark";

function Toggle({ label, defaultOn, note }: { label: string; defaultOn: boolean; note?: string }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0", fontSize: 13 }}>
      <input type="checkbox" defaultChecked={defaultOn} style={{ accentColor: "var(--accent)", width: 15, height: 15 }} />
      <span>{label}</span>
      {note && <span className="pill paused" style={{ marginLeft: "auto" }}>{note}</span>}
    </label>
  );
}
