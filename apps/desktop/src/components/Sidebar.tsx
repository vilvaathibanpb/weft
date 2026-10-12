import { Lib, Compass, Plug, Scroll, Gear, Check } from "../lib/icons";

export type View = "library" | "discover" | "clients" | "audit" | "settings";

const NAV: { id: View; label: string; Icon: typeof Lib }[] = [
  { id: "library", label: "Library", Icon: Lib },
  { id: "discover", label: "Discover", Icon: Compass },
  { id: "clients", label: "Clients", Icon: Plug },
  { id: "audit", label: "Audit log", Icon: Scroll },
  { id: "settings", label: "Settings", Icon: Gear },
];

export function Sidebar({
  view, setView, count, licensed, trialDaysLeft, onBuy,
}: {
  view: View; setView: (v: View) => void; count: number;
  licensed: boolean; trialDaysLeft: number; onBuy: () => void;
}) {
  return (
    <aside className="sidebar">
      <div className="nav-group" style={{ marginTop: 2 }}>
        {NAV.map(({ id, label, Icon }) => (
          <button key={id} className="nav-item" aria-current={view === id} onClick={() => setView(id)}>
            <Icon />
            <span>{label}</span>
            {id === "library" && <span className="count">{count}</span>}
          </button>
        ))}
      </div>

      {licensed ? (
        <div className="plan" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--ok)", display: "grid", placeItems: "center" }}><Check /></span>
          <div><b style={{ fontSize: 12.5 }}>Licensed</b><div className="muted" style={{ fontSize: 11.5 }}>Weft 1.x · thank you</div></div>
        </div>
      ) : (
        <div className="plan">
          <div className="row"><b>Free trial</b><span className="muted">{trialDaysLeft} days left</span></div>
          <div className="bar"><i style={{ width: `${Math.max(4, (trialDaysLeft / 14) * 100)}%` }} /></div>
          <a className="up" href="#" onClick={(e) => { e.preventDefault(); onBuy(); }}>Buy Weft — $39</a>
        </div>
      )}
    </aside>
  );
}
