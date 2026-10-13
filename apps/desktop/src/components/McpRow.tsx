import { useState } from "react";
import type { Mcp } from "../lib/types";
import { StatusPill } from "./StatusPill";
import { ClientPicker } from "./ClientPicker";
import { Refresh, Play, ExternalLink, Dots } from "../lib/icons";
import { store } from "../lib/store";
import { toast } from "../lib/toast";

/** Contextual primary action per status — the one thing this MCP needs next. `openPicker` is
 *  passed for the "ready" case so the row can show the client chooser. */
function primaryAction(m: Mcp, openPicker: () => void) {
  switch (m.status) {
    case "ready": return { label: "Open in client", Icon: ExternalLink, run: openPicker };
    case "outdated": return { label: "Re-capture", Icon: Refresh, run: () => { store.recapture(m.id); toast(`Re-capturing ${m.name}`); } };
    case "needs_login": return { label: "Refresh", Icon: Refresh, run: () => { store.refresh(m.id); toast(`Opening ${new URL(m.origin).host} to log in`); } };
    case "paused": return { label: "Resume", Icon: Play, run: () => { store.resume(m.id); toast(`${m.name} resumed`); } };
    case "not_possible": return { label: "Why?", Icon: undefined, run: undefined as unknown as () => void };
    default: return null;
  }
}

function subline(m: Mcp): string {
  if (m.status === "not_possible") return hostOf(m.origin) + " · can't be replayed";
  if (m.status === "outdated" && m.drift) return `${hostOf(m.origin)} · drift: ${m.drift.newEndpoints} new, ${m.drift.changed} changed`;
  if (m.status === "needs_login") return `${hostOf(m.origin)} · session expired`;
  if (m.status === "capturing") return m.endpointCount > 0
    ? `${hostOf(m.origin)} · capturing… ${m.endpointCount} seen · keep browsing the site`
    : `${hostOf(m.origin)} · capturing… use the site to map it`;
  if (m.status === "refreshing") return `${hostOf(m.origin)} · re-syncing session…`;
  const when = m.lastRefreshed ? ` · refreshed ${ago(m.lastRefreshed)}` : "";
  return `${hostOf(m.origin)} · ${m.endpointCount} endpoint${m.endpointCount === 1 ? "" : "s"}${when}`;
}

export function McpRow({ m, selected, onOpen }: { m: Mcp; selected: boolean; onOpen: () => void }) {
  const [picking, setPicking] = useState(false);
  const action = primaryAction(m, () => setPicking(true));
  return (
    <div className="mcp" data-selected={selected} onClick={onOpen}>
      <div className="avatar" style={{ background: m.color }}>{m.initials}</div>
      <div className="meta">
        <div className="name">{m.name}<StatusPill status={m.status} />{m.partial && <span className="pill paused" style={{ textTransform: "none" }}>light mode</span>}</div>
        <div className="origin">{subline(m)}</div>
      </div>
      <div className="actions" onClick={(e) => e.stopPropagation()}>
        {action && (
          <button
            className={`btn sm ${m.status === "ready" || m.status === "not_possible" ? "" : "primary"}`}
            onClick={action.run ?? onOpen}
          >
            {action.Icon && <action.Icon />}{action.label}
          </button>
        )}
        <button className="btn sm ghost" aria-label="More" onClick={onOpen}><Dots /></button>
      </div>
      {picking && (
        <span onClick={(e) => e.stopPropagation()}>
          <ClientPicker onClose={() => setPicking(false)} />
        </span>
      )}
    </div>
  );
}

function hostOf(o: string) { try { return new URL(o).host.replace(/^www\./, ""); } catch { return o; } }
function ago(isoStr: string) {
  const ms = Date.now() - new Date(isoStr).getTime();
  const m = Math.round(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
