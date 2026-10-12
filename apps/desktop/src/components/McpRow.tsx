import type { Mcp } from "../lib/types";
import { StatusPill } from "./StatusPill";
import { Refresh, Play, ExternalLink, Dots } from "../lib/icons";
import { store } from "../lib/store";
import { toast } from "../lib/toast";

/** Contextual primary action per status — the one thing this MCP needs next. */
function primaryAction(m: Mcp) {
  switch (m.status) {
    case "ready": return { label: "Open in client", Icon: ExternalLink, run: () => toast(`${m.name} opened in Claude Code`) };
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
  if (m.status === "capturing") return `${hostOf(m.origin)} · sampling traffic… ${m.endpointCount} seen`;
  if (m.status === "refreshing") return `${hostOf(m.origin)} · re-syncing session…`;
  const when = m.lastRefreshed ? ` · refreshed ${ago(m.lastRefreshed)}` : "";
  return `${hostOf(m.origin)} · ${m.endpointCount} endpoints${when}`;
}

export function McpRow({ m, selected, onOpen }: { m: Mcp; selected: boolean; onOpen: () => void }) {
  const action = primaryAction(m);
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
