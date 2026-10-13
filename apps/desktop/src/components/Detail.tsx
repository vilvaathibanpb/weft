import { useEffect, useState } from "react";
import type { Endpoint, Mcp } from "../lib/types";
import { REASON_TEXT } from "../lib/types";
import { StatusPill } from "./StatusPill";
import { Alert, Refresh, ExternalLink, Compass } from "../lib/icons";
import { store, CLIENT_LABEL } from "../lib/store";
import { toast } from "../lib/toast";
import { ClientPicker } from "./ClientPicker";

export function Detail({ m, onClose }: { m: Mcp; onClose: () => void }) {
  const [eps, setEps] = useState<Endpoint[] | null>(null);
  const [picking, setPicking] = useState(false);

  useEffect(() => {
    let live = true;
    store.endpoints(m.id).then((e) => live && setEps(e));
    return () => { live = false; };
  }, [m.id, m.status, m.endpointCount]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <div className="drawer" role="dialog" aria-label={`${m.name} details`}>
        <header>
          <div className="avatar" style={{ background: m.color }}>{m.initials}</div>
          <div style={{ minWidth: 0 }}>
            <h3>{m.name}</h3>
            <div className="origin" style={{ color: "var(--ink-3)", fontFamily: "var(--mono)", fontSize: 11.5 }}>{m.origin}</div>
          </div>
          <div style={{ marginLeft: "auto" }}><StatusPill status={m.status} /></div>
        </header>

        <div className="dbody">
          {m.status === "not_possible" && m.reason && (
            <div className="reason"><Alert style={{ color: "var(--bad)", flex: "none" }} /><div>{REASON_TEXT[m.reason]}</div></div>
          )}
          {m.status === "capturing" && (
            <div className="reason note" style={{ borderColor: "var(--accent)", background: "var(--accent-wash)" }}>
              <Compass style={{ color: "var(--accent)", flex: "none" }} />
              <div>
                <b>Use the site once.</b> Weft only maps what it sees — so in your browser, open the
                pages and run the actions you want your AI to reach (your feed, a story, search, settings).
                Each one becomes a tool. Do this once and the site is set — you won't need to repeat it.
                <div style={{ color: "var(--ink-3)", marginTop: 4 }}>
                  {m.endpointCount > 0
                    ? `${m.endpointCount} endpoint${m.endpointCount === 1 ? "" : "s"} captured so far — keep browsing to find more.`
                    : "Nothing captured yet. A page reload is the quickest first sample."}
                </div>
              </div>
            </div>
          )}
          {m.status === "needs_login" && (
            <div className="reason note"><Alert style={{ color: "var(--warn)", flex: "none" }} /><div>The browser session expired. Refresh to open the site and log in again — Weft re-syncs automatically.</div></div>
          )}
          {m.status === "outdated" && m.drift && (
            <div className="reason note"><Alert style={{ color: "var(--warn)", flex: "none" }} /><div>The site changed: {m.drift.newEndpoints} new endpoints and {m.drift.changed} changed since last capture. Re-capture to update the map.</div></div>
          )}

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
            {(m.status === "needs_login" || m.status === "refreshing") && (
              <button className="btn primary sm" onClick={() => { store.refresh(m.id); toast("Opening browser to log in"); }}><Refresh /> Refresh &amp; log in</button>
            )}
            {m.status !== "not_possible" && m.status !== "capturing" && (
              <button className="btn sm" onClick={() => { store.recapture(m.id); toast(`Re-capturing ${m.name}`); }}><Refresh /> Re-capture</button>
            )}
            {m.status === "ready" && (
              <>
                <button className="btn primary sm" onClick={() => setPicking(true)}><ExternalLink /> Open in client</button>
                <button className="btn sm" onClick={async () => {
                  try {
                    const spec = await store.openapi(m.id);
                    if (!spec) throw new Error("no spec");
                    await navigator.clipboard.writeText(spec);
                    toast("OpenAPI spec copied to clipboard");
                  } catch {
                    toast("Couldn't copy the OpenAPI spec");
                  }
                }}>Copy OpenAPI</button>
              </>
            )}
            {m.status === "paused"
              ? <button className="btn sm" onClick={() => store.resume(m.id)}>Resume</button>
              : m.status !== "capturing" && <button className="btn sm ghost" onClick={() => store.pause(m.id)}>Pause</button>}
            <button className="btn sm ghost" style={{ color: "var(--bad)" }} onClick={() => { store.remove(m.id); onClose(); }}>Delete</button>
          </div>

          {m.pinnedClients && m.pinnedClients.length > 0 && (
            <>
              <div className="section-title">Installed in</div>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {m.pinnedClients.map((c) => <span key={c} className="pill ready" style={{ textTransform: "none" }}>{CLIENT_LABEL[c]}</span>)}
              </div>
            </>
          )}

          {m.status !== "not_possible" && (
            <>
              <div className="section-title">Endpoints {eps && `(${eps.length})`}</div>
              {!eps && <div style={{ color: "var(--ink-3)", fontSize: 12 }}>Loading…</div>}
              {eps && eps.map((e) => (
                <div className="ep" key={e.id}>
                  <span className="method">{e.method}</span>
                  <span className="path">{e.pathTemplate}</span>
                  <span className="samples">{e.sampleCount}× {e.confidence === "low" ? "· low" : ""}</span>
                </div>
              ))}
              {eps && eps.length === 0 && m.status === "capturing" && (
                <div style={{ color: "var(--ink-3)", fontSize: 12 }}>No endpoints yet — browse the site (reload the tab to capture the first one).</div>
              )}
              {eps && eps.length > 0 && m.status === "capturing" && <div style={{ color: "var(--ink-3)", fontSize: 12, marginTop: 8 }}>Still sampling… keep browsing and more endpoints will appear.</div>}
            </>
          )}
        </div>
      </div>
      {picking && <ClientPicker onClose={() => setPicking(false)} />}
    </>
  );
}
