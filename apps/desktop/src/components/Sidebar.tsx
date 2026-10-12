import { Lib, Plug, Scroll, Gear } from "../lib/icons";

export type View = "library" | "clients" | "audit" | "settings";

const NAV: { id: View; label: string; Icon: typeof Lib }[] = [
  { id: "library", label: "Library", Icon: Lib },
  { id: "clients", label: "Clients", Icon: Plug },
  { id: "audit", label: "Audit log", Icon: Scroll },
  { id: "settings", label: "Settings", Icon: Gear },
];

export function Sidebar({
  view, setView, count,
}: {
  view: View; setView: (v: View) => void; count: number;
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

      <div className="plan" style={{ fontSize: 11.5 }}>
        <div className="muted">Weft v0.1.0</div>
        <div className="muted">Free &amp; open source · MIT</div>
      </div>
    </aside>
  );
}
