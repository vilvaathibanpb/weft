import { useEffect, useState } from "react";
import type { ClientId } from "../lib/types";
import { CLIENT_LABEL, store } from "../lib/store";
import { Plug, Check, Refresh } from "../lib/icons";

const CLIENTS: ClientId[] = ["claude-code", "claude-desktop", "codex", "cursor"];

type Row = { state: "idle" | "working" | "added" | "error"; note?: string };

/** Install Weft's MCP server into `client`, then launch/notify. Returns the note to show. */
export async function installAndOpen(client: ClientId): Promise<string> {
  await store.installClient(client); // writes the weft entry into the client's config
  return store.openClient(client);
}

/** Small modal menu: pick an AI client, add Weft to it, and launch it — with inline status. */
export function ClientPicker({ onClose }: { onClose: () => void }) {
  const [rows, setRows] = useState<Record<string, Row>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const pick = async (c: ClientId) => {
    if (rows[c]?.state === "working") return;
    setRows((r) => ({ ...r, [c]: { state: "working" } }));
    try {
      const note = await installAndOpen(c);
      setRows((r) => ({ ...r, [c]: { state: "added", note } }));
    } catch (e) {
      setRows((r) => ({ ...r, [c]: { state: "error", note: String(e) } }));
    }
  };

  return (
    <>
      <div className="picker-scrim" onClick={onClose} />
      <div className="picker" role="dialog" aria-label="Open in client">
        <div className="picker-head">Open in client</div>
        <div className="picker-sub">Adds Weft to the client's MCP config, then opens it.</div>
        {CLIENTS.map((c) => {
          const row = rows[c] ?? { state: "idle" };
          const added = row.state === "added";
          return (
            <button
              key={c}
              className="picker-row"
              data-added={added}
              onClick={() => pick(c)}
              disabled={row.state === "working"}
            >
              <span
                className="avatar sm"
                style={{
                  background: added ? "var(--ok-wash)" : "var(--surface-3)",
                  color: added ? "var(--ok)" : "var(--ink-2)",
                }}
              >
                {added ? <Check /> : row.state === "working" ? <Refresh className="spin" /> : <Plug />}
              </span>
              <span className="picker-label">
                <span className="picker-name">{CLIENT_LABEL[c]}</span>
                {row.state === "working" && <span className="picker-note">Adding…</span>}
                {added && <span className="picker-note ok">Added ✓ — restart {CLIENT_LABEL[c]} to load it</span>}
                {row.state === "error" && <span className="picker-note err">{row.note}</span>}
              </span>
              {added && <span className="picker-redo">Re-add</span>}
            </button>
          );
        })}
        <div className="picker-foot">
          <button className="btn sm ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </>
  );
}
