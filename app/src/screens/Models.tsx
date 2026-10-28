import { useMemo, useState } from "react";
import { MODEL_CATALOG, recommendedModels, totalDownload, type HardwareProfile, type InstallState, type ModelKind } from "../models";

const GROUPS: { id: ModelKind; label: string }[] = [
  { id: "runtime", label: "Runtime" }, { id: "speech", label: "Voices & acting" }, { id: "director", label: "AI Director" },
  { id: "transcription", label: "Listening" }, { id: "audio", label: "Audio tools" },
];

export default function Models() {
  const [profile] = useState<HardwareProfile>(() => browserProfile());
  const suggested = useMemo(() => recommendedModels(profile), [profile]);
  const [selected, setSelected] = useState<string[]>(suggested);
  const [states, setStates] = useState<Record<string, InstallState>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});

  const install = (id: string) => {
    if (states[id] === "installed" || states[id] === "downloading") return;
    setStates((s) => ({ ...s, [id]: "downloading" }));
    let n = 0;
    const timer = window.setInterval(() => {
      n += 4;
      setProgress((p) => ({ ...p, [id]: Math.min(n, 100) }));
      if (n >= 100) {
        window.clearInterval(timer);
        setStates((s) => ({ ...s, [id]: "installed" }));
      }
    }, 80);
  };
  const installSelected = () => selected.forEach(install);

  return (
    <section className="models-screen">
      <header className="models-hero">
        <div>
          <span className="eyebrow">LOCAL AI / PRIVATE BY DEFAULT</span>
          <h1>Model Center</h1>
          <p className="lede">Greenroom downloads, verifies and configures its AI tools. No Python, terminal or model folders to manage.</p>
        </div>
        <div className="hardware-orb" aria-label={`Hardware profile ${profile.tier}`}>
          <span>{profile.tier}</span><strong>{profile.accelerator}</strong><small>{profile.memoryGb} GB memory</small>
        </div>
      </header>

      <div className="setup-strip">
        <div><strong>Recommended setup</strong><span>{selected.length} components · {totalDownload(selected).toFixed(1)} GB</span></div>
        <button className="primary" onClick={installSelected}>Install selected</button>
      </div>

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
                  <label className="model-select"><input type="checkbox" checked={selected.includes(m.id)} onChange={() => setSelected((s) => s.includes(m.id) ? s.filter((x) => x !== m.id) : [...s, m.id])}/><span /></label>
                  <div><h3>{m.name}</h3><p className="muted small">{m.maker}</p></div>
                  <span className={`tier tier-${m.tier}`}>{m.tier}</span>
                </div>
                <p>{m.description}</p>
                <div className="model-facts"><span>{m.sizeGb} GB download</span><span>{m.memoryGb} GB memory</span><span>{fits ? "Fits this computer" : "May run slowly"}</span></div>
                <div className="chips">{m.capabilities.slice(0, 6).map((c) => <span className="chip static" key={c}>{c}</span>)}</div>
                {!!m.languages.length && <p className="muted small"><strong>Languages:</strong> {m.languages.join(", ")}</p>}
                {!!m.accents.length && <p className="muted small"><strong>Accent status:</strong> {m.accents.join(", ")}</p>}
                <div className="model-bottom">
                  <span className="muted small">{m.experimental ? "Experimental · native review required" : m.licence}</span>
                  {state === "downloading" ? <div className="download-progress"><span style={{ width: `${progress[m.id] ?? 0}%` }} /><small>{progress[m.id] ?? 0}%</small></div> :
                    <button className={state === "installed" ? "ok" : ""} onClick={() => install(m.id)}>{state === "installed" ? "Installed" : "Download"}</button>}
                </div>
              </article>;
            })}
          </div>
        </div>;
      })}
      <p className="muted small legal-note">Before a real model download begins, Greenroom will show its source, exact version, checksum, licence and disk use. Experimental accent support is never presented as native-verified.</p>
    </section>
  );
}

function tierRank(t: "compact" | "standard" | "studio") { return t === "compact" ? 0 : t === "standard" ? 1 : 2; }

function browserProfile(): HardwareProfile {
  const platform = navigator.userAgent.includes("Mac") ? "macos" : navigator.userAgent.includes("Windows") ? "windows" : "unknown";
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 16;
  return { platform, memoryGb, accelerator: platform === "macos" ? "Apple Metal" : "Auto-detect GPU", vramGb: 0, tier: memoryGb >= 24 ? "studio" : memoryGb >= 12 ? "standard" : "compact" };
}
