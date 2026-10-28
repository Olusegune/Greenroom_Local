import { useEffect, useMemo, useState } from "react";
import { api, inApp } from "../api";
import { useApp } from "../ctx";
import { MODEL_CATALOG, recommendedModels, type HardwareProfile, type InstallState, type ModelKind } from "../models";

const GROUPS: { id: ModelKind; label: string }[] = [
  { id: "runtime", label: "Runtime" }, { id: "speech", label: "Voices & acting" }, { id: "director", label: "AI Director" },
  { id: "transcription", label: "Listening" }, { id: "audio", label: "Audio tools" },
];

export default function Models() {
  const { confirmSpend, toast, go } = useApp();
  const [profile, setProfile] = useState<HardwareProfile>(() => browserProfile());
  const suggested = useMemo(() => recommendedModels(profile), [profile]);
  const [states, setStates] = useState<Record<string, InstallState>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [piperInstalled, setPiperInstalled] = useState(false);
  const [piperBusy, setPiperBusy] = useState(false);

  useEffect(() => {
    void api.modelHardware().then(setProfile).catch(() => undefined);
    void api.piperStatus().then((s) => setPiperInstalled(s.installed)).catch(() => undefined);
    void api.modelStates(MODEL_CATALOG.map((m) => m.id)).then((rows) => setStates(Object.fromEntries(rows.map((r) => [r.id, r.state])))).catch(() => undefined);
    if (!inApp()) return;
    let stop: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen<{ id: string; percent: number }>("model-download-progress", (e) => setProgress((p) => ({ ...p, [e.payload.id]: e.payload.percent })))).then((fn) => { stop = fn; });
    return () => stop?.();
  }, []);

  const installPiper = async () => {
    const ok = await confirmSpend({ title: "Install local speech engine?", lines: ["Downloads the Piper speech engine (about 22 MB).", "Voice files are downloaded separately when you add them to your library.", "Piper runs locally and reads plain text; it does not support expressive acting or cloning."], download: true });
    if (!ok) return;
    setPiperBusy(true);
    try { await api.piperInstall(); const status = await api.piperStatus(); setPiperInstalled(status.installed); toast(status.installed ? "Piper installed. Choose a voice to download." : "Piper could not be verified.", !status.installed); }
    catch (e) { toast((e as Error).message, true); }
    finally { setPiperBusy(false); }
  };

  return (
    <section className="models-screen">
      <header className="models-hero">
        <div>
          <span className="eyebrow">LOCAL AI / PRIVATE BY DEFAULT</span>
          <h1>Model Center</h1>
          <p className="lede">Explore the local AI tools planned for Greenroom. The Piper engine and its voices can already be installed from Voices.</p>
        </div>
        <div className="hardware-orb" aria-label={`Hardware profile ${profile.tier}`}>
          <span>{profile.tier}</span><strong>{profile.accelerator}</strong><small>{profile.memoryGb} GB memory</small>
        </div>
      </header>

      <div className="setup-strip">
        <div><strong>Get started with local speech</strong><span>{piperInstalled ? "Piper is installed. Choose a voice in the library." : "Install the lightweight Piper engine, then choose voices."}</span></div>
        {piperInstalled ? <button onClick={() => go("voices")}>Browse voices</button> : <button className="primary" disabled={piperBusy} onClick={() => void installPiper()}>{piperBusy ? "Installing…" : "Install local speech"}</button>}
      </div>
      <p className="muted small">The advanced acting, cloning, voice design, music and effects engines below still need integration. {suggested.length} model packages are suggested for this machine, but they cannot be installed yet.</p>

      {GROUPS.map((group) => {
        const rows = MODEL_CATALOG.filter((m) => m.kind === group.id);
        if (!rows.length) return null;
        return <div className="model-group" key={group.id}>
          <h2>{group.label}</h2>
          <div className="model-grid">
            {rows.map((m) => {
              const state = states[m.id] ?? "available";
              const fits = tierRank(m.tier) <= tierRank(profile.tier);
              return <article className={`model-card ${m.experimental ? "experimental" : ""}`} key={m.id}>
                <div className="model-top">
                  <span className="model-marker" aria-hidden="true" />
                  <div><h3>{m.name}</h3><p className="muted small">{m.maker}</p></div>
                  <span className={`tier tier-${m.tier}`}>{m.tier}</span>
                </div>
                <p>{m.description}</p>
                <div className="model-facts"><span>~{m.sizeGb} GB download</span><span>~{m.memoryGb} GB memory</span><span>{fits ? "Memory may be sufficient" : "May need more memory"}</span></div>
                <div className="chips">{m.capabilities.slice(0, 6).map((c) => <span className="chip static" key={c}>{c}</span>)}</div>
                {!!m.languages.length && <p className="muted small"><strong>Languages:</strong> {m.languages.join(", ")}</p>}
                {!!m.accents.length && <p className="muted small"><strong>Accent status:</strong> {m.accents.join(", ")}</p>}
                <div className="model-bottom">
                  <span className="muted small">{m.experimental ? "Experimental · native review required" : m.licence}</span>
                  {state === "downloading" ? <div className="download-progress"><span style={{ width: `${progress[m.id] ?? 0}%` }} /><small>{progress[m.id] ?? 0}%</small></div> :
                    <button disabled>{state === "installed" ? "Installed" : "App integration pending"}</button>}
                </div>
              </article>;
            })}
          </div>
        </div>;
      })}
      <div className="model-group"><h2>Music & sound effects</h2><div className="model-grid"><article className="model-card"><div className="model-top"><span className="model-marker" aria-hidden="true" /><div><h3>Local music & sound design</h3><p className="muted small">In development</p></div></div><p>Create music, atmosphere and sound effects on this computer. For now, import your own audio on the Timeline.</p><div className="chips"><span className="chip static">Music</span><span className="chip static">Atmosphere</span><span className="chip static">Sound effects</span></div><div className="model-bottom"><span className="muted small">No local generator is installed yet.</span><button disabled>Coming soon</button></div></article></div></div>
      <p className="muted small legal-note">The listed models exist, but Greenroom does not yet install or run them. Hardware guidance is based on system memory; GPU detection and accent listening reviews are still in development.</p>
    </section>
  );
}

function tierRank(t: "compact" | "standard" | "studio") { return t === "compact" ? 0 : t === "standard" ? 1 : 2; }

function browserProfile(): HardwareProfile {
  const platform = navigator.userAgent.includes("Mac") ? "macos" : navigator.userAgent.includes("Windows") ? "windows" : "unknown";
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 16;
  return { platform, memoryGb, accelerator: platform === "macos" ? "Apple Metal" : "Auto-detect GPU", vramGb: 0, tier: memoryGb >= 24 ? "studio" : memoryGb >= 12 ? "standard" : "compact" };
}
