import { useEffect, useMemo, useRef, useState } from "react";
import type { Mcp } from "../lib/types";
import { store } from "../lib/store";
import { toast } from "../lib/toast";
import { Plus, Refresh, Weave, Gear, Search, ExternalLink } from "../lib/icons";

interface Cmd { id: string; label: string; hint?: string; Icon: typeof Plus; run: () => void }

export function CommandPalette({
  mcps, onClose, onConvert, onSelect, onToggleTheme,
}: {
  mcps: Mcp[]; onClose: () => void; onConvert: () => void;
  onSelect: (id: string) => void; onToggleTheme: () => void;
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const cmds = useMemo<Cmd[]>(() => {
    const base: Cmd[] = [
      { id: "convert", label: "Convert a site to MCP", hint: "⌘N", Icon: Plus, run: () => { onConvert(); onClose(); } },
      { id: "refresh-all", label: "Refresh all that need login", Icon: Refresh, run: () => { mcps.filter((m) => m.status === "needs_login").forEach((m) => store.refresh(m.id)); toast("Refreshing sessions"); onClose(); } },
      { id: "theme", label: "Toggle light / dark", Icon: Gear, run: () => { onToggleTheme(); onClose(); } },
      { id: "export", label: "Export all OpenAPI specs", Icon: ExternalLink, run: () => { toast("Exported OpenAPI specs"); onClose(); } },
    ];
    const sites: Cmd[] = mcps.map((m) => ({
      id: "go-" + m.id, label: `Open ${m.name}`, hint: new URL(m.origin).host, Icon: Weave,
      run: () => { onSelect(m.id); onClose(); },
    }));
    const all = [...base, ...sites];
    if (!q.trim()) return all;
    const n = q.toLowerCase();
    return all.filter((c) => c.label.toLowerCase().includes(n) || c.hint?.toLowerCase().includes(n));
  }, [q, mcps, onClose, onConvert, onSelect, onToggleTheme]);

  useEffect(() => { inputRef.current?.focus(); }, []);
  useEffect(() => { setActive(0); }, [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, cmds.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); cmds[active]?.run(); }
    else if (e.key === "Escape") { e.preventDefault(); onClose(); }
  };

  return (
    <div className="cmdk-scrim" onClick={onClose}>
      <div className="cmdk" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div style={{ display: "flex", alignItems: "center" }}>
          <span style={{ paddingLeft: 16, color: "var(--ink-3)" }}><Search /></span>
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a command or site…" style={{ paddingLeft: 10 }} />
        </div>
        <ul>
          {cmds.map((c, i) => (
            <li key={c.id} data-active={i === active} onMouseEnter={() => setActive(i)} onClick={c.run}>
              <span className="ic"><c.Icon /></span>
              <span>{c.label}</span>
              {c.hint && <span className="hint">{c.hint}</span>}
            </li>
          ))}
          {cmds.length === 0 && <li style={{ color: "var(--ink-3)" }}>No matches</li>}
        </ul>
      </div>
    </div>
  );
}
