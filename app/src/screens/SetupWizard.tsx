import { useEffect, useMemo, useRef, useState } from "react";
import { api, inApp, type PiperVoice } from "../api";
import { genderWord } from "../avatarLibrary";
import { useApp } from "../ctx";
import { CHATTERBOX_MODEL_ID, planSetup, runSetup, summarize, type SetupStep, type StepResult } from "../setupPlan";
import type { HardwareProfile, InstallState } from "../models";
import { Note } from "../ui";

const mark: Record<StepResult["status"], string> = { waiting: "○", running: "…", done: "✓", failed: "✗", skipped: "–" };
const fmt = (mb: number) => (mb >= 1000 ? `${(mb / 1000).toFixed(1)} GB` : `${mb} MB`);

/** "Set up my PC": one confirmation, then Piper, two free voices and (optionally) Chatterbox are installed in order with visible progress. */
export default function SetupWizard({ profile, onChanged }: { profile: HardwareProfile; onChanged: () => void }) {
  const { confirmSpend, toast, library, saveLibrary } = useApp();
  const [open, setOpen] = useState(false);
  const [withChatterbox, setWithChatterbox] = useState(false);
  const [piperInstalled, setPiperInstalled] = useState(false);
  const [piperVoices, setPiperVoices] = useState<string[]>([]);
  const [catalog, setCatalog] = useState<PiperVoice[]>([]);
  const [cbRuntime, setCbRuntime] = useState(false);
  const [cbModel, setCbModel] = useState<InstallState>("available");
  const [results, setResults] = useState<StepResult[]>([]);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [running, setRunning] = useState(false);
  const [percent, setPercent] = useState(0);
  const stopRef = useRef(false);

  const refresh = async () => {
    const [p, c, r, m] = await Promise.all([api.piperStatus().catch(() => null), api.piperCatalog().catch(() => [] as PiperVoice[]), api.chatterboxRuntimeStatus().catch(() => null), api.modelStates([CHATTERBOX_MODEL_ID]).catch(() => [])]);
    if (p) { setPiperInstalled(p.installed); setPiperVoices(p.voices); }
    setCatalog(c);
    setCbRuntime(r?.installed ?? false);
    setCbModel(m[0]?.state ?? "available");
  };
  useEffect(() => { if (open && !running) void refresh(); }, [open, running]);
  useEffect(() => {
    if (!inApp()) return;
    let stop: (() => void) | undefined;
    void import("@tauri-apps/api/event").then(({ listen }) => listen<{ id: string; percent: number }>("model-download-progress", (e) => { if (e.payload.id === CHATTERBOX_MODEL_ID) setPercent(e.payload.percent); })).then((fn) => { stop = fn; });
    return () => stop?.();
  }, []);

  const libraryKeys = useMemo(() => library.filter((v) => v.provider === "piper").map((v) => v.id), [library]);
  const plan = useMemo(() => planSetup({ hardware: profile, piperInstalled, piperVoices, libraryVoices: libraryKeys, chatterboxRuntime: cbRuntime, chatterboxModel: cbModel, withChatterbox, catalog }), [profile, piperInstalled, piperVoices, libraryKeys, cbRuntime, cbModel, withChatterbox, catalog]);

  const exec = async (s: SetupStep) => {
    if (s.kind === "piper") {
      await api.piperInstall();
      const st = await api.piperStatus();
      if (!st.installed) throw new Error("Piper could not be verified after downloading.");
    } else if (s.kind === "voice" && s.key) {
      const st = await api.piperStatus();
      if (!st.voices.includes(s.key)) await api.piperInstallVoice(s.key);
      const meta = catalog.find((c) => c.key === s.key);
      saveLibrary((l) => (l.some((x) => x.id === s.key && x.provider === "piper") ? l : [...l, { id: s.key!, name: meta?.name ?? s.label, provider: "piper", source: "library", language: meta?.language ?? "English", accent: meta?.country ?? "", gender: genderWord(s.key!), notes: "Added by Set up my PC", createdAt: new Date().toISOString() }]));
    } else if (s.kind === "chatterbox-runtime") {
      const st = await api.chatterboxRuntimeInstall();
      if (!st.installed) throw new Error(st.detail || "The Chatterbox runtime did not install.");
    } else if (s.kind === "chatterbox-model") {
      setPercent(0);
      const r = await api.modelInstall(CHATTERBOX_MODEL_ID);
      if (r.state !== "installed") throw new Error(r.error || "The Chatterbox model files did not finish downloading.");
    }
  };

  const start = async () => {
    if (!plan.steps.length) return;
    const lines = [
      ...plan.steps.map((s) => `${s.label}: ${s.sizeMb === undefined ? "several GB" : s.sizeMb === 0 ? "already downloaded" : fmt(s.sizeMb)}`),
      plan.sizeUnknown ? `At least ${fmt(plan.knownMb)} in total, plus the runtime.` : `About ${fmt(plan.knownMb)} in total.`,
      "Downloads are checked against fixed checksums. Nothing is sent about you, and no credits are used.",
    ];
    const ok = await confirmSpend({ title: "Set up this PC?", lines, download: true });
    if (!ok) return;
    stopRef.current = false;
    setSteps(plan.steps);
    setRunning(true);
    const r = await runSetup(plan.steps, exec, setResults, () => stopRef.current);
    setRunning(false);
    toast(summarize(r), r.some((x) => x.status === "failed"));
    onChanged();
    void refresh();
  };

  if (!open) return <button className="primary" onClick={() => setOpen(true)}>Set up my PC</button>;
  const finished = !running && results.length > 0;
  return (
    <div className="card stack setup-wizard" role="region" aria-label="Set up my PC">
      <div className="row wrap"><strong>Set up my PC</strong><span className="muted small">{profile.tier} PC · {profile.memoryGb} GB memory</span><button className="sm ghost" disabled={running} onClick={() => { setOpen(false); setResults([]); }}>Close</button></div>
      {!finished && !running && (
        <>
          <p className="small">Installs the free local voices so previews, drafts and the Agent Studio work without internet or credits. No terminal needed.</p>
          {plan.alreadyDone.length > 0 && <p className="muted small">Already set up: {plan.alreadyDone.join(", ")}.</p>}
          <label className="row small"><input type="checkbox" checked={withChatterbox} onChange={(e) => setWithChatterbox(e.target.checked)} /> Also set up Chatterbox (adds Re-voice; several GB and several minutes)</label>
          <p className="muted small">{plan.chatterboxNote}</p>
          {plan.steps.length === 0 ? <Note>Everything you chose is already set up.</Note> : (
            <ul className="stack small">{plan.steps.map((s) => <li key={s.id}><strong>{s.label}</strong> <span className="muted">{s.sizeMb === undefined ? "several GB" : s.sizeMb === 0 ? "no download" : fmt(s.sizeMb)}</span><br /><span className="muted">{s.why}</span></li>)}</ul>
          )}
          <div className="row wrap"><button className="primary" disabled={plan.steps.length === 0} onClick={() => void start()}>Set up</button></div>
        </>
      )}
      {(running || finished) && (
        <>
          <ul className="stack small" aria-live="polite">{steps.map((s) => { const r = results.find((x) => x.id === s.id); const st = r?.status ?? "waiting"; return <li key={s.id}><span aria-hidden="true">{mark[st]}</span> <strong>{s.label}</strong> <span className="muted">{st === "running" ? (s.kind === "chatterbox-model" ? `downloading ${percent}% of the current file` : "working…") : st}</span>{r?.error && <><br /><span className="muted">{r.error}</span></>}</li>; })}</ul>
          {running && <div className="row wrap"><button className="sm" onClick={() => { stopRef.current = true; toast("Stopping after the current download finishes."); }}>Stop after this step</button></div>}
          {finished && <p className="small">{summarize(results)}</p>}
        </>
      )}
    </div>
  );
}
