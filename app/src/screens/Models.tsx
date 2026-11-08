import { modelStatus } from "../modelStatus";
import { useEffect, useMemo, useState } from "react";
import { api, inApp, type ChatterboxRuntimeStatus, type LocalRuntimeStatus } from "../api";
import { useApp } from "../ctx";
import WazobiaSetup from "./WazobiaSetup";
import AcestepSetup from "./AcestepSetup";
import SfxSetup from "./SfxSetup";
import DirectorSetup from "./DirectorSetup";
import { CardArt } from "../cardArt";
import { MODEL_CATALOG, modelArt, recommendedModels, shortDescription, type HardwareProfile, type InstallState, type ModelKind } from "../models";

const GROUPS: { id: ModelKind; label: string }[] = [
  { id: "runtime", label: "Runtime" }, { id: "speech", label: "Voices & acting" }, { id: "audio", label: "Music" }, { id: "director", label: "AI Director" },
];

export default function Models() {
  const { confirmSpend, toast, go } = useApp();
  const [profile, setProfile] = useState<HardwareProfile>(() => browserProfile());
  const suggested = useMemo(() => recommendedModels(profile), [profile]);
  const [states, setStates] = useState<Record<string, InstallState>>({});
  const [progress, setProgress] = useState<Record<string, number>>({});
  const [piperInstalled, setPiperInstalled] = useState(false);
  const [piperBusy, setPiperBusy] = useState(false);
  const [chatterboxRuntime, setChatterboxRuntime] = useState<ChatterboxRuntimeStatus | null>(null);
  const [chatterboxBusy, setChatterboxBusy] = useState(false);
  const [kokoroRuntime, setKokoroRuntime] = useState<LocalRuntimeStatus | null>(null);
  const [qwenRuntime, setQwenRuntime] = useState<LocalRuntimeStatus | null>(null);
  const openSource = (url: string) => { void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => window.open(url, "_blank", "noopener")); };

  useEffect(() => {
    void api.modelHardware().then(setProfile).catch(() => undefined);
    void api.piperStatus().then((s) => setPiperInstalled(s.installed)).catch(() => undefined);
    void api.chatterboxRuntimeStatus().then(setChatterboxRuntime).catch(() => undefined);
    void api.kokoroRuntimeStatus().then(setKokoroRuntime).catch(() => undefined);
    void api.qwenRuntimeStatus().then(setQwenRuntime).catch(() => undefined);
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
  const downloadChatterbox = async () => {
    const ok = await confirmSpend({ title: "Download Chatterbox model files?", lines: ["Downloads approximately 3.2 GB from Resemble AI’s Hugging Face repository.", "The model files are checked against pinned SHA-256 hashes.", "The separate Chatterbox runtime must also be installed from this page before the voice can run."], download: true });
    if (!ok) return;
    const id = "chatterbox-multilingual-v3";
    setStates((s) => ({ ...s, [id]: "downloading" }));
    try { const result = await api.modelInstall(id); setStates((s) => ({ ...s, [id]: result.state })); toast("Chatterbox model files downloaded and verified. A compatible runtime is also required."); }
    catch (e) { setStates((s) => ({ ...s, [id]: "error" })); toast((e as Error).message, true); }
  };
  const importChatterbox = async () => {
    const id = "chatterbox-multilingual-v3";
    setStates((s) => ({ ...s, [id]: "downloading" }));
    try { const result = await api.chatterboxImportDownloads(); setStates((s) => ({ ...s, [id]: result.state })); toast("Existing Chatterbox model files verified and added. A compatible runtime is also required."); }
    catch (e) { setStates((s) => ({ ...s, [id]: "error" })); toast((e as Error).message, true); }
  };
  const installChatterboxRuntime = async () => {
    const ok = await confirmSpend({ title: "Install Chatterbox runtime?", lines: ["Creates a private Python environment inside Greenroom’s Documents folder.", "Downloads Chatterbox and its open-source dependencies. This can take several GB and several minutes.", "The default setup uses the reliable CPU runtime. Model files are downloaded separately."], download: true });
    if (!ok) return;
    setChatterboxBusy(true);
    try { const status = await api.chatterboxRuntimeInstall(); setChatterboxRuntime(status); toast(status.detail); }
    catch (e) { toast((e as Error).message, true); }
    finally { setChatterboxBusy(false); }
  };

  return (
    <section className="models-screen">
      <header className="models-hero">
        <div>
          <span className="eyebrow">LOCAL AI / PRIVATE BY DEFAULT</span>
          <h1>Model Center</h1>
          <p className="lede">Choose a model, read its official card, then install it in Greenroom when it is supported. Your models stay on your computer.</p>
        </div>
        <div className="hardware-orb" aria-label={`Hardware profile ${profile.tier}`}>
          <span>{profile.tier}</span><strong>{profile.accelerator}</strong><small>{profile.memoryGb} GB memory</small>
        </div>
      </header>

      <div className="setup-strip" aria-label="Local voice setup">
        <div><span className="eyebrow">START HERE</span><strong>Install a working local voice in two steps</strong><span>{piperInstalled ? "Piper is ready. Pick any voice from the library." : "Install Piper, then download a voice from the library. No terminal required."}</span></div>
        <div className="row wrap">{piperInstalled ? <button className="primary" onClick={() => go("voices")}>Browse local voices</button> : <button className="primary" disabled={piperBusy} onClick={() => void installPiper()}>{piperBusy ? "Installing Piper…" : "Install Piper"}</button>}<button onClick={() => go("voices")}>Voice library</button></div>
      </div>
      <p className="muted small">{suggested.length} packages suit this computer. Model cards open in your browser so you can review licences, hardware requirements and provider-specific download terms before downloading.</p>

      {GROUPS.map((group) => {
        const rows = MODEL_CATALOG.filter((m) => m.kind === group.id && m.id !== "whisper-large-v3-turbo");
        if (!rows.length) return null;
        if (group.id === "runtime") return <div className="model-group runtime-group" key={group.id}><h2>Local foundation</h2><article className="runtime-overview"><div><span className="eyebrow">LOCAL RUNTIME</span><h3>Everything stays on your computer</h3><p className="muted">Greenroom sets up a verified runtime only when an engine has an in-app installer. No separate “runtime” download is needed.</p></div><div className="runtime-points"><span>Private model folders</span><span>Background jobs</span><span>CPU, CUDA & Apple Silicon</span></div></article></div>;
        return <div className="model-group" key={group.id}>
          <h2>{group.label}</h2>
          <div className="model-grid">
            {rows.map((m) => {
              const state = states[m.id] ?? "available";
              const fits = tierRank(m.tier) <= tierRank(profile.tier);
              const setup = modelSetupLabel(m.id, state, m.id === "kokoro-82m" ? (kokoroRuntime?.installed ?? false) : m.id === "qwen3-tts-17b" ? (qwenRuntime?.installed ?? false) : (chatterboxRuntime?.installed ?? false));
              const art = modelArt(m);
              const st = modelStatus(m, state === "installed" ? "installed" : state, m.id === "kokoro-82m" ? (kokoroRuntime?.installed ?? false) : m.id === "qwen3-tts-17b" ? (qwenRuntime?.installed ?? false) : (chatterboxRuntime?.installed ?? false), profile);
              return <article className={`model-card ${m.experimental ? "experimental" : ""}`} key={m.id}>
                <div className="mc-art">
                  <CardArt seed={m.id} kind={art.kind} label={art.label} />
                  <span className={`tier tier-${m.tier}`}>{m.tier}</span>
                  {m.experimental && <span className="mc-flag">Experimental</span>}
                </div>
                <div className="mc-body">
                  <div className="mc-title"><h3>{m.name}</h3><p className="muted small">{m.maker}</p></div>
                  <p className="mc-desc">{shortDescription(m.description)}</p>
                  <p className="mc-meta"><span>~{m.sizeGb} GB</span><i aria-hidden="true" /><span>~{m.memoryGb} GB memory</span><i aria-hidden="true" /><span>{fits ? "Should fit this PC" : "May need more memory"}</span></p>
                  <p className={`integration-state ${st.status === "ready" ? "ready" : setup.kind}`}><strong>{st.label}{st.experimental ? " · Experimental" : ""}.</strong> {st.status === "installed" || st.status === "unsupported" || st.status === "ready" ? st.detail : setup.label}</p>
                  <details className="mc-more">
                    <summary>Details</summary>
                    <div className="stack">
                      {m.description !== shortDescription(m.description) && <p className="small">{m.description}</p>}
                      <div className="chips">{m.capabilities.slice(0, 6).map((c) => <span className="chip static" key={c}>{c}</span>)}</div>
                      {!!m.languages.length && <p className="muted small"><strong>Languages:</strong> {m.languages.join(", ")}</p>}
                      {!!m.accents.length && <p className="muted small"><strong>Accent status:</strong> {m.accents.join(", ")}</p>}
                      <p className="muted small"><strong>Licence:</strong> {m.licence}</p>
                    </div>
                  </details>
                  <div className="model-bottom">
                  {state === "downloading" ? <div className="download-progress" title="Progress for the current file"><span style={{ width: `${progress[m.id] ?? 0}%` }} /><small>{progress[m.id] ?? 0}% file</small></div> :
                    m.id === "chatterbox-multilingual-v3" ? <div className="row wrap">{!chatterboxRuntime?.installed && <button className="primary" disabled={chatterboxBusy} onClick={() => void installChatterboxRuntime()}>{chatterboxBusy ? "Installing runtime…" : "Install local runtime"}</button>}{state !== "installed" && <button title="Import files from Documents/Greenroom Local/Model Downloads/Chatterbox" onClick={() => void importChatterbox()}>Use existing files</button>}<button disabled={state === "installed"} onClick={() => void downloadChatterbox()}>{state === "installed" ? "Model files ready" : state === "error" ? "Retry download" : "Download files"}</button><button className="sm" onClick={() => openSource(m.sourceUrl)}>Model page ↗</button></div> : m.id === "kokoro-82m" || m.id === "qwen3-tts-17b" ? <div className="row wrap"><button className="sm" onClick={() => openSource(m.sourceUrl)}>Model page ↗</button></div> : m.id === "wazobia-voice" ? <WazobiaSetup installed={state === "installed"} percent={progress[m.id] ?? 0} onState={(next) => setStates((x) => ({ ...x, [m.id]: next }))} /> : m.id === "director-qwen3-4b" ? <DirectorSetup percent={progress[m.id] ?? 0} onState={(next) => setStates((x) => ({ ...x, [m.id]: next }))} /> : m.id === "stable-audio-open-small" ? <SfxSetup percent={progress[m.id] ?? 0} onState={(next) => setStates((x) => ({ ...x, [m.id]: next }))} /> : m.id === "ace-step-v1" ? <AcestepSetup state={state} percent={progress[m.id] ?? 0} onState={(next) => setStates((x) => ({ ...x, [m.id]: next }))} /> : m.id === "director-8b" ? <div className="row wrap"><button className="primary" onClick={() => go("settings")}>Set up AI Director</button><button className="sm" onClick={() => openSource(m.sourceUrl)}>Browse local models ↗</button></div> : <button className="sm" onClick={() => openSource(m.sourceUrl)}>{m.sourceLabel} ↗</button>}
                  </div>
                {m.id === "chatterbox-multilingual-v3" && chatterboxRuntime && <p className={chatterboxRuntime.installed ? "runtime-status ready" : "runtime-status"}>{chatterboxRuntime.installed ? "● " : "○ "}{chatterboxRuntime.detail}</p>}
                {(m.id === "kokoro-82m" || m.id === "qwen3-tts-17b") && <p className="runtime-status">Not connected yet. Greenroom cannot speak with this model: its route into Perform has not been built, so installing it would not let you make anything. The install button is hidden until it does.</p>}
                </div>
              </article>;
            })}
          </div>
        </div>;
      })}
      <div className="model-group model-next"><div className="engine-quick card"><div><span className="eyebrow">SOUND DESIGN</span><strong>Create effects in your project</strong><p className="muted small">SFX Studio generates and places effects directly on your timeline. No model-card research required.</p></div><button className="primary" onClick={() => go("sfx")}>Open SFX Studio</button></div></div>
    </section>
  );
}

function tierRank(t: "compact" | "standard" | "studio") { return t === "compact" ? 0 : t === "standard" ? 1 : 2; }

function modelSetupLabel(id: string, state: InstallState, runtimeInstalled: boolean) {
  if (id === "chatterbox-multilingual-v3") return state === "installed" && runtimeInstalled ? { kind: "ready", label: "Ready in Greenroom · default local voice" } : { kind: "setup", label: "In-app setup available · model files and runtime required" };
  if (id === "wazobia-voice") return state === "installed" && runtimeInstalled ? { kind: "ready", label: "Ready · add its voices to your library" } : { kind: "setup", label: "One-click setup · needs a free Hugging Face account" };
  if (id === "director-qwen3-4b") return state === "installed" ? { kind: "ready", label: "Installed · selected as your Director in Engines" } : { kind: "setup", label: "One-click setup · no account needed" };
  if (id === "stable-audio-open-small") return state === "installed" ? { kind: "ready", label: "Installed · pick it as the Sound engine in Engines" } : { kind: "setup", label: "One-click setup · needs a free Hugging Face account" };
  if (id === "ace-step-v1") return state === "installed" ? { kind: "ready", label: "Installed · make music in Timeline, Make music on this PC" } : { kind: "setup", label: "One-click setup · needs an NVIDIA graphics card" };
  if (id === "director-8b") return { kind: "setup", label: "Use the AI Director now with Kie · local GGUF support is a separate engine" };
  if (id === "kokoro-82m" || id === "qwen3-tts-17b") return runtimeInstalled ? { kind: "ready", label: "Runtime installed. Greenroom cannot speak with this model yet" } : { kind: "setup", label: "Managed local runtime available · install once to use offline" };
  if (id === "greenroom-runtime") return { kind: "info", label: "Shared requirements · not a separate install" };
  return { kind: "link", label: "Official source link · not yet integrated" };
}

function browserProfile(): HardwareProfile {
  const platform = navigator.userAgent.includes("Mac") ? "macos" : navigator.userAgent.includes("Windows") ? "windows" : "unknown";
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 16;
  return { platform, memoryGb, accelerator: platform === "macos" ? "Apple Metal" : "Auto-detect GPU", vramGb: 0, tier: memoryGb >= 24 ? "studio" : memoryGb >= 12 ? "standard" : "compact" };
}
