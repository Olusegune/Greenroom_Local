import { useEffect, useState } from "react";
import { api, type ChatterboxRuntimeStatus } from "../api";
import { useApp } from "../ctx";
import SetupCheck from "./SetupCheck";
import { installHint, nextStep, STEP_LABEL, TOKEN_PAGE, WAZOBIA_DOWNLOAD_GB, WAZOBIA_LANGUAGES, WAZOBIA_PAGE, wazobiaVoiceEntry, type WazobiaLanguage } from "../wazobia";

const open = (url: string) => { void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl(url)).catch(() => window.open(url, "_blank", "noopener")); };
const STEPS = ["token", "terms", "engine", "model"] as const;

/** One card, one next button. The checklist shows where the person is; the primary button always does the next step. */
export default function WazobiaSetup({ installed, percent, onState }: { installed: boolean; percent: number; onState: (s: "downloading" | "installed" | "error" | "available") => void }) {
  const { keys, refreshKeys, confirmSpend, toast, library, saveLibrary } = useApp();
  const [termsOpened, setTermsOpened] = useState(false);
  const [engine, setEngine] = useState<ChatterboxRuntimeStatus | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [voices, setVoices] = useState<string[]>([]);
  const [lang, setLang] = useState<WazobiaLanguage>("en");
  useEffect(() => { void api.chatterboxRuntimeStatus().then(setEngine).catch(() => undefined); }, []);
  useEffect(() => { if (installed) void api.wazobiaVoices().then(setVoices).catch(() => undefined); }, [installed]);

  const step = nextStep({ hasToken: keys.huggingface, termsOpened, engineReady: engine?.installed ?? false, modelReady: installed });
  const fail = (e: unknown) => { const m = (e as Error).message; setError(`${m} ${installHint(m)}`); toast(m, true); };

  const saveToken = async () => {
    setError("");
    try { await api.setKey("huggingface", token); setToken(""); refreshKeys(); toast("Hugging Face token saved in your system credential store."); } catch (e) { fail(e); }
  };
  const installEngine = async (): Promise<boolean> => {
    setBusy("engine");
    try { const s = await api.chatterboxRuntimeInstall(); setEngine(s); return s.installed; } catch (e) { fail(e); return false; } finally { setBusy(null); }
  };
  const download = async () => {
    setError(""); setBusy("model"); onState("downloading");
    try { const r = await api.wazobiaInstallDownload(); onState(r.state === "installed" ? "installed" : "available"); toast("WazobiaVoice installed and verified."); }
    catch (e) { onState("error"); fail(e); } finally { setBusy(null); }
  };
  /** The primary button: confirm once, then run every remaining step that needs no typing. */
  const go = async () => {
    setError("");
    if (step === "terms") { open(WAZOBIA_PAGE); setTermsOpened(true); return; }
    const ok = await confirmSpend({ title: "Install WazobiaVoice?", lines: [`Downloads about ${WAZOBIA_DOWNLOAD_GB} GB from Hugging Face using your token. Every file is checked before use.`, ...(engine?.installed ? [] : ["First installs the local voice engine (several GB, a few minutes)."]), "Runs on this PC. Nothing you write is sent anywhere.", "Licence: Axiveri Research License. Not for commercial use without a licence from Axiveri."], download: true });
    if (!ok) return;
    if (!engine?.installed && !(await installEngine())) return;
    await download();
  };
  const addVoice = (v: string) => {
    const entry = wazobiaVoiceEntry(v, lang);
    if (library.some((x) => x.id === entry.id && x.provider === "wazobia")) { toast(`${entry.name} is already in your library.`); return; }
    saveLibrary((l) => [...l, { ...entry, createdAt: new Date().toISOString() }]);
    toast(`${entry.name} added to your library.`);
  };

  if (installed && (engine?.installed ?? false)) return (
    <div className="stack wazobia">
      <div className="row wrap"><label className="small muted" htmlFor="wz-lang">Language</label>
        <select id="wz-lang" value={lang} onChange={(e) => setLang(e.target.value as WazobiaLanguage)}>{WAZOBIA_LANGUAGES.map((l) => <option key={l.code} value={l.code}>{l.label}</option>)}</select></div>
      <div className="chips">{voices.map((v) => <button className="chip" key={v} onClick={() => addVoice(v)} title="Add to My library">+ {v.replace("_", " ")}</button>)}</div>
      <p className="muted small">Pick a language, then add voices to your library. Try them in Voices, My library.</p>
    </div>
  );
  const rows = STEPS.map((id) => ({ id, done: id === "token" ? keys.huggingface : id === "terms" ? termsOpened || installed : id === "engine" ? (engine?.installed ?? false) : installed }));
  return (
    <div className="stack wazobia">
      <div className="wz-steps" role="list" aria-label="WazobiaVoice setup steps">
        {rows.map((r, i) => <div role="listitem" key={r.id} className={"wz-step " + (r.done ? "done" : r.id === step ? "now" : "")} aria-current={r.id === step ? "step" : undefined}><b aria-hidden="true">{r.done ? "✓" : i + 1}</b>{STEP_LABEL[r.id].title}</div>)}
      </div>
      {step === "token" && <div className="row wrap"><input type="password" aria-label="Hugging Face read token" placeholder="Paste a read token (hf_…)" value={token} onChange={(e) => setToken(e.target.value)} autoComplete="off" /><button className="primary" disabled={!token.trim()} onClick={() => void saveToken()}>Save token</button><button className="sm" onClick={() => open(TOKEN_PAGE)}>Create a token ↗</button></div>}
      {step !== "token" && <div className="row wrap">
        {busy === "model" ? <div className="download-progress" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${percent}%` }} /><small>{percent}% file</small></div> :
          <button className="primary" disabled={busy !== null} onClick={() => void go()}>{busy === "engine" ? "Installing engine…" : step === "terms" ? "Open model page" : "Install WazobiaVoice"}</button>}
        {step === "terms" && <button onClick={() => setTermsOpened(true)}>I already accepted</button>}
        <button className="sm" onClick={() => open(WAZOBIA_PAGE)}>Model page ↗</button>
      </div>}
      {error && <p role="alert" className="error small">{error}</p>}
      {error && <SetupCheck engine="wazobia" label="Find out why it failed" />}
    </div>
  );
}
