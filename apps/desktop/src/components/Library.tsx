import { useState } from "react";
import type { Mcp } from "../lib/types";
import { McpRow } from "./McpRow";
import { Plus, Weave } from "../lib/icons";
import { store } from "../lib/store";
import { toast } from "../lib/toast";

export function Library({
  mcps, selectedId, onSelect,
}: { mcps: Mcp[]; selectedId: string | null; onSelect: (id: string) => void }) {
  const [adding, setAdding] = useState(false);
  const [url, setUrl] = useState("");

  const submit = () => {
    const origin = normalize(url);
    if (!origin) { toast("Enter a valid site URL"); return; }
    store.convert(origin);
    toast(`Weaving ${new URL(origin).host}`);
    setUrl(""); setAdding(false);
  };

  return (
    <div className="main-inner">
      <div className="page-head">
        <h1>Library</h1>
        <span className="sub">{mcps.length} {mcps.length === 1 ? "site" : "sites"}</span>
        <span className="spacer" />
        <button className="btn primary" onClick={() => setAdding((v) => !v)}><Plus /> Convert site</button>
      </div>

      {adding && (
        <div className="mcp" style={{ gridTemplateColumns: "1fr auto", marginBottom: 14 }}>
          <input
            autoFocus value={url} placeholder="https://app.example.com  — or click the Weft button in your browser"
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") submit(); if (e.key === "Escape") setAdding(false); }}
            style={{ border: 0, background: "transparent", color: "var(--ink)", fontFamily: "var(--mono)", fontSize: 13, outline: "none", width: "100%" }}
          />
          <div style={{ display: "flex", gap: 7 }}>
            <button className="btn sm ghost" onClick={() => setAdding(false)}>Cancel</button>
            <button className="btn sm primary" onClick={submit}>Convert</button>
          </div>
        </div>
      )}

      {mcps.length === 0 ? (
        <div className="empty">
          <div className="glyph"><Weave style={{ width: 24, height: 24 }} /></div>
          <h2>No MCPs yet</h2>
          <p>Open a site you're logged into and click the <b>Weft</b> button in your browser — <code>Convert this site to MCP</code>. It'll show up here as it's woven.</p>
          <button className="btn primary" onClick={() => setAdding(true)}><Plus /> Convert a site</button>
        </div>
      ) : (
        <div className="list">
          {mcps.map((m) => (
            <McpRow key={m.id} m={m} selected={m.id === selectedId} onOpen={() => onSelect(m.id)} />
          ))}
        </div>
      )}
    </div>
  );
}

function normalize(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^https?:\/\//.test(s)) s = "https://" + s;
  try { return new URL(s).origin; } catch { return null; }
}
