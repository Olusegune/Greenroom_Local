import { useEffect, useMemo, useState } from "react";
import { api, inApp, type ChatterboxRuntimeStatus } from "../api";
import { useApp } from "../ctx";
import { MODEL_CATALOG, recommendedModels, type HardwareProfile, type InstallState, type ModelKind } from "../models";

const GROUPS: { id: ModelKind; label: string }[] = [
  { id: "runtime", label: "Runtime" }, { id: "speech", label: "Voices & acting" }, { id: "director", label: "AI Director" },
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
  const openSource = (url: string) => { void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => window.open(url, "_blank", "noopener")); };

  useEffect(() => {
    void api.modelHardware().then(setProfile).catch(() => undefined);
    void api.piperStatus().then((s) => setPiperInstalled(s.installed)).catch(() => undefined);
    void api.chatterboxRuntimeStatus().then(setChatterboxRuntime).catch(() => undefined);
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
  const installWazobia = async () => {
    const ok = await confirmSpend({ title: "Find a Wazobia model file?", lines: ["Greenroom will look on your Desktop and in Downloads for t3_mtl23ls_v2.safetensors.", "This does not download Wazobia: the model has no pinned, Greenroom-tested release artifact yet.", "The file is only stored locally; a compatible Wazobia runtime is still required for speech."], download: true });
    if (!ok) return;
    const id = "wazobia-voice";
    setStates((s) => ({ ...s, [id]: "downloading" }));
    try { const result = await api.wazobiaInstallAutomatic(); setStates((s) => ({ ...s, [id]: result.state })); toast("Wazobia model file added to Greenroom."); }
    catch (e) { setStates((s) => ({ ...s, [id]: "error" })); toast((e as Error).message, true); }
  };
  const chooseWazobia = async () => {
    const path = await api.pickModelFile();
    if (!path) return;
    const id = "wazobia-voice";
    setStates((s) => ({ ...s, [id]: "downloading" }));
    try { const result = await api.wazobiaImportFile(path); setStates((s) => ({ ...s, [id]: result.state })); toast("Wazobia model file added to Greenroom."); }
    catch (e) { setStates((s) => ({ ...s, [id]: "error" })); toast((e as Error).message, true); }
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
              const setup = modelSetupLabel(m.id, state, chatterboxRuntime?.installed ?? false);
              return <article className={`model-card ${m.experimental ? "experimental" : ""}`} key={m.id}>
                <div className="model-top">
                  <span className="model-marker" aria-hidden="true" />
                  <div><h3>{m.name}</h3><p className="muted small">{m.maker}</p></div>
                  <span className={`tier tier-${m.tier}`}>{m.tier}</span>
                </div>
                <div className={`model-visual ${m.id}`} aria-hidden="true"><i /><i /><i /><i /><i /><span>{m.kind === "speech" ? "VOICE" : m.kind === "director" ? "DIRECTION" : "LISTEN"}</span></div>
                <p className={`integration-state ${setup.kind}`}>{setup.label}</p>
                <p>{m.description}</p>
                <div className="model-facts"><span>~{m.sizeGb} GB download</span><span>~{m.memoryGb} GB memory</span><span>{fits ? "Memory may be sufficient" : "May need more memory"}</span></div>
                <div className="chips">{m.capabilities.slice(0, 6).map((c) => <span className="chip static" key={c}>{c}</span>)}</div>
                {!!m.languages.length && <p className="muted small"><strong>Languages:</strong> {m.languages.join(", ")}</p>}
                {!!m.accents.length && <p className="muted small"><strong>Accent status:</strong> {m.accents.join(", ")}</p>}
                <div className="model-bottom">
                  <span className="muted small">{m.experimental ? `Experimental · ${m.licence}` : m.licence}</span>
                  {state === "downloading" ? <div className="download-progress" title="Progress for the current file"><span style={{ width: `${progress[m.id] ?? 0}%` }} /><small>{progress[m.id] ?? 0}% file</small></div> :
                    m.id === "chatterbox-multilingual-v3" ? <div className="row wrap">{!chatterboxRuntime?.installed && <button className="primary" disabled={chatterboxBusy} onClick={() => void installChatterboxRuntime()}>{chatterboxBusy ? "Installing runtime…" : "Install local runtime"}</button>}{state !== "installed" && <button title="Import files from Documents/Greenroom Local/Model Downloads/Chatterbox" onClick={() => void importChatterbox()}>Use existing files</button>}<button disabled={state === "installed"} onClick={() => void downloadChatterbox()}>{state === "installed" ? "Model files ready" : state === "error" ? "Retry download" : "Download files"}</button><button className="sm" onClick={() => openSource(m.sourceUrl)}>Model page ↗</button></div> : m.id === "wazobia-voice" ? <div className="row wrap">{state === "installed" ? <button disabled>Model file added</button> : <button className="primary" onClick={() => void installWazobia()}>{state === "error" ? "Try automatic install" : "Install automatically"}</button>}<button onClick={() => void chooseWazobia()}>Choose model file</button><button className="sm" onClick={() => openSource(m.sourceUrl)}>Model page ↗</button></div> : m.id === "director-8b" ? <div className="row wrap"><button className="primary" onClick={() => go("settings")}>Set up AI Director</button><button className="sm" onClick={() => openSource(m.sourceUrl)}>Browse local models ↗</button></div> : <button className="sm" onClick={() => openSource(m.sourceUrl)}>{m.sourceLabel} ↗</button>}
                </div>
                {m.id === "chatterbox-multilingual-v3" && chatterboxRuntime && <p className={chatterboxRuntime.installed ? "runtime-status ready" : "runtime-status"}>{chatterboxRuntime.installed ? "● " : "○ "}{chatterboxRuntime.detail}</p>}
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
  if (id === "wazobia-voice") return state === "installed" ? { kind: "ready", label: "Model file stored locally · a compatible runtime is required to speak" } : { kind: "setup", label: "Import only · download and runtime are not integrated yet" };
  if (id === "director-8b") return { kind: "setup", label: "Use the AI Director now with Kie · local GGUF support is a separate engine" };
  if (id === "greenroom-runtime") return { kind: "info", label: "Shared requirements · not a separate install" };
  return { kind: "link", label: "Official source link · not yet integrated" };
}

function browserProfile(): HardwareProfile {
  const platform = navigator.userAgent.includes("Mac") ? "macos" : navigator.userAgent.includes("Windows") ? "windows" : "unknown";
  const memoryGb = (navigator as Navigator & { deviceMemory?: number }).deviceMemory ?? 16;
  return { platform, memoryGb, accelerator: platform === "macos" ? "Apple Metal" : "Auto-detect GPU", vramGb: 0, tier: memoryGb >= 24 ? "studio" : memoryGb >= 12 ? "standard" : "compact" };
}
