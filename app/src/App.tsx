import { useEffect, useRef, useState } from "react";
import { inApp } from "./api";
import { Provider, useApp, type Tab } from "./ctx";
import { Book, Cast as CastIcon, Clock, Export as ExportIcon, Eye, Gear, Home as HomeIcon, Wave, Layers, Shield, Mark, Render, Script, Speaker, Voices as VoicesIcon } from "./icons";
import Cast from "./screens/Cast";
import Engines from "./screens/Engines";
import Export from "./screens/Export";
import Home from "./screens/Home";
import Studio from "./screens/Studio";
import Lab from "./screens/Lab";
import Perform from "./screens/Perform";
import PictureScreen from "./screens/Picture";
import Timeline from "./screens/Timeline";
import History from "./screens/History";
import { checkForUpdates, useUpdates } from "./updates";
import Settings from "./screens/Settings";
import Voices from "./screens/Voices";
import Models from "./screens/Models";
import Help from "./screens/Help";
import Write from "./screens/Write";

export default function App() {
  const [splash, setSplash] = useState<"show" | "fade" | "gone">("show");
  useEffect(() => {
    const a = setTimeout(() => setSplash("fade"), 1400);
    const b = setTimeout(() => setSplash("gone"), 1900);
    return () => (clearTimeout(a), clearTimeout(b));
  }, []);
  return (
    <Provider>
      {splash !== "gone" && (
        <div className={splash === "fade" ? "splash out" : "splash"} onClick={() => setSplash("gone")} role="presentation">
          <img src="/splash.webp" alt="Greenroom. Sound without limits." />
        </div>
      )}
      <Shell />
    </Provider>
  );
}

function Shell() {
  const { tab, go, project, closeProject, saving, undo, redo, canUndo, canRedo, engines } = useApp();
  const upd = useUpdates();
  // Look once shortly after start (not at the instant of launch, so saved settings are loaded first). Quiet on failure.
  const updateCheck = useRef(engines.updateCheck);
  updateCheck.current = engines.updateCheck;
  useEffect(() => {
    if (!inApp()) return;
    const t = setTimeout(() => updateCheck.current !== false && void checkForUpdates(true), 4000);
    return () => clearTimeout(t);
  }, []);
  const Item = ({ id, label, icon, count, off }: { id: Tab; label: string; icon: React.ReactNode; count?: string; off?: boolean }) => (
    <button className={tab === id ? "nav on" : "nav"} onClick={() => go(id)} disabled={off} aria-current={tab === id ? "page" : undefined}>
      {icon}
      <span className="label">{label}</span>
      {count && <span className="count">{count}</span>}
    </button>
  );
  const takes = project ? project.lines.filter((l) => l.takes.length > 0).length : 0;
  const screens: Record<Tab, React.ReactNode> = { home: <Home />, write: <Write />, cast: <Cast />, perform: <Perform />, timeline: <Timeline />, picture: <PictureScreen />, export: <Export />, studio: <Studio />, history: <History />, voices: <Voices />, models: <Models />, engines: <Engines />, lab: <Lab />, settings: <Settings />, help: <Help /> };

  return (
    <div className="shell">
      <nav className="rail" aria-label="Main">
        <div className="brand">
          <Mark size={30} />
          <span className="brand-name">Greenroom <em>Local</em></span>
        </div>
        <Item id="home" label="Projects" icon={<HomeIcon size={18} />} />
        {project && (
          <>
            <h3>{project.name.slice(0, 22)}</h3>
            <Item id="write" label="Script" icon={<Script size={18} />} count={project.lines.length ? String(project.lines.length) : undefined} />
            <Item id="cast" label="Cast" icon={<CastIcon size={18} />} />
            <Item id="perform" label="Perform" icon={<Render size={18} />} count={project.lines.length ? `${takes}/${project.lines.length}` : undefined} />
            <Item id="timeline" label="Timeline" icon={<Wave size={18} />} />
            <Item id="picture" label="Picture" icon={<Eye size={18} />} count={project.picture ? "on" : undefined} />
            <Item id="export" label="Export" icon={<ExportIcon size={18} />} />
            <Item id="studio" label="Studio" icon={<Shield size={18} />} />
            <Item id="history" label="History" icon={<Clock size={18} />} />
          </>
        )}
        <h3>Library</h3>
        <Item id="voices" label="Voices" icon={<VoicesIcon size={18} />} />
        <Item id="models" label="Model Center" icon={<Layers size={18} />} />
        <Item id="engines" label="Engines" icon={<Layers size={18} />} />
        <Item id="lab" label="Voice lab" icon={<Speaker size={18} />} />
        <Item id="settings" label="Settings" icon={<Gear size={18} />} count={upd.phase === "available" ? "update" : undefined} />
        <Item id="help" label="Help & guide" icon={<Book size={18} />} />
        <div className="rail-foot">
          {project && (
            <>
              <div className="row undo-bar">
                <button className="sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
                  Undo
                </button>
                <button className="sm" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
                  Redo
                </button>
              </div>
              <div aria-live="polite">{saving === "saving" ? "Saving…" : saving === "saved" ? "Saved" : saving === "error" ? "Not saved" : ""}</div>
              <button className="sm ghost" onClick={closeProject}>
                Close project
              </button>
            </>
          )}
        </div>
      </nav>
      <div className="workspace"><div className="app-menu" aria-label="Application menu">
        <details><summary>File</summary><div className="menu-popup"><button onClick={() => go("home")}>New or open project</button><button disabled={!project} onClick={closeProject}>Close project</button><button disabled={!project} onClick={() => go("export")}>Export…</button></div></details>
        <details><summary>Edit</summary><div className="menu-popup"><button disabled={!canUndo} onClick={undo}>Undo <span>Ctrl+Z</span></button><button disabled={!canRedo} onClick={redo}>Redo <span>Ctrl+Shift+Z</span></button></div></details>
        <details><summary>View</summary><div className="menu-popup"><button onClick={() => go("voices")}>Voice library</button><button onClick={() => go("models")}>Model Center</button><button onClick={() => go("settings")}>Settings</button></div></details>
        <details><summary>Help</summary><div className="menu-popup"><button onClick={() => go("help")}>Help & guide</button></div></details>
      </div><main className="stage">{screens[tab]}</main></div>
    </div>
  );
}
