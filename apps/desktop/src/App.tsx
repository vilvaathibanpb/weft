import { useEffect, useState, useCallback } from "react";
import { Sidebar, type View } from "./components/Sidebar";
import { Library } from "./components/Library";
import { Detail } from "./components/Detail";
import { CommandPalette } from "./components/CommandPalette";
import { Clients, Discover, Audit, Settings, type Theme } from "./components/Views";
import { useMcps, store } from "./lib/store";
import { useToasts, toast } from "./lib/toast";
import { verifyLicense } from "./lib/license";
import { Search } from "./lib/icons";

export default function App() {
  const mcps = useMcps();
  const toasts = useToasts();
  const [view, setView] = useState<View>("library");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [palette, setPalette] = useState(false);
  const [theme, setThemeState] = useState<Theme>(() => (localStorage.getItem("weft-theme") as Theme) || "system");
  const [licensed, setLicensed] = useState<boolean>(() => {
    try { const k = localStorage.getItem("weft-license"); return !!(k && verifyLicense(k)); } catch { return false; }
  });
  const trialDaysLeft = 12; // demo value; real build reads first-run timestamp

  // Offline verification — a valid Ed25519-signed key unlocks; invalid is rejected locally.
  const activate = useCallback((key: string): boolean => {
    const lic = verifyLicense(key);
    if (lic) {
      setLicensed(true);
      try { localStorage.setItem("weft-license", key); } catch { /* ignore */ }
      toast(`Licensed to ${lic.name} — thank you!`);
      return true;
    }
    toast("That license key isn't valid.");
    return false;
  }, []);
  const buy = useCallback(() => toast("Opening checkout…"), []);

  const selected = mcps.find((m) => m.id === selectedId) ?? null;

  // theme resolution (system → follows OS; otherwise explicit)
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const resolved = theme === "system" ? (mq.matches ? "dark" : "light") : theme;
      document.documentElement.dataset.theme = resolved;
    };
    apply();
    try { localStorage.setItem("weft-theme", theme); } catch { /* ignore */ }
    if (theme === "system") { mq.addEventListener("change", apply); return () => mq.removeEventListener("change", apply); }
  }, [theme]);

  const setTheme = useCallback((t: Theme) => setThemeState(t), []);
  const toggleTheme = useCallback(() => {
    setThemeState((t) => {
      const isDark = (document.documentElement.dataset.theme ?? "light") === "dark";
      return (t === "system") ? (isDark ? "light" : "dark") : (t === "dark" ? "light" : "dark");
    });
  }, []);

  // load real data when in Tauri
  useEffect(() => { store.load(); }, []);

  // global shortcuts
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "n") { e.preventDefault(); setView("library"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand"><span className="mk" /> Weft</div>
        <span className="spacer" />
        <button className="searchbtn kbtn" onClick={() => setPalette(true)} aria-label="Command palette">
          <Search /> <span>Search &amp; commands</span> <kbd>⌘K</kbd>
        </button>
      </div>

      <div className="body">
        <Sidebar view={view} setView={setView} count={mcps.length} licensed={licensed} trialDaysLeft={trialDaysLeft} onBuy={buy} />

        <main className="main">
          {view === "library" && <Library mcps={mcps} selectedId={selectedId} onSelect={setSelectedId} />}
          {view === "clients" && <Clients />}
          {view === "discover" && <Discover />}
          {view === "audit" && <Audit />}
          {view === "settings" && <Settings theme={theme} setTheme={setTheme} licensed={licensed} onActivate={activate} onBuy={buy} />}
        </main>
      </div>

      {selected && <Detail m={selected} onClose={() => setSelectedId(null)} />}

      {palette && (
        <CommandPalette
          mcps={mcps}
          onClose={() => setPalette(false)}
          onConvert={() => { setView("library"); }}
          onSelect={(id) => { setView("library"); setSelectedId(id); }}
          onToggleTheme={toggleTheme}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => <div className="toast" key={t.id}><span className="led" />{t.text}</div>)}
      </div>
    </div>
  );
}
