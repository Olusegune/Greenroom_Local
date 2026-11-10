import { useCallback, useEffect, useState } from "react";
import { api, type QwenLockStatus } from "../api";
import { useApp } from "../ctx";

const NAMES: Record<string, string> = { "qwen-warm-narrator": "Warm narrator", "qwen-gravel-man": "Gravel man", "qwen-bright-young-woman": "Bright young woman", "qwen-gentle-older-man": "Gentle older man" };

/** Steadiness controls for Qwen3-TTS: the graphics card, the Base model, and locking a voice to a reference clip so every line sounds like the same person. */
export default function QwenControls({ ready }: { ready: boolean }) {
  const { confirmSpend, toast } = useApp();
  const [st, setSt] = useState<QwenLockStatus | null>(null);
  const [busy, setBusy] = useState("");
  const refresh = useCallback(() => { void api.qwenLockStatus().then(setSt).catch(() => setSt(null)); }, []);
  useEffect(() => { if (ready) refresh(); }, [ready, refresh]);
  if (!ready || !st) return null;

  const run = async (what: string, job: () => Promise<QwenLockStatus>) => {
    setBusy(what);
    try { setSt(await job()); } catch (e) { toast(e instanceof Error ? e.message : String(e), true); } finally { setBusy(""); }
  };
  const gpu = async () => {
    if (await confirmSpend({ title: "Use your graphics card for Qwen3-TTS?", lines: ["Installs the graphics-card build of PyTorch (about 2.5 GB, from pytorch.org). Lines then take about 10 seconds instead of 25.", "No credits are used."], download: true })) await run("gpu", api.qwenGpuInstall);
  };
  const base = async () => {
    if (await confirmSpend({ title: "Download the Qwen3-TTS Base model?", lines: ["About 4 GB from Hugging Face. It copies a voice from a short reference clip, which keeps one character sounding like one person.", "No credits are used."], download: true })) await run("base", api.qwenBaseDownload);
  };

  return (
    <div className="stack small qwen-controls">
      <p><strong>Steadiness.</strong> Without a lock, Qwen redesigns the voice for every line, so a character can drift. A locked voice copies one reference clip every time.</p>
      <div className="row wrap">
        <span>{st.gpu ? `Graphics card in use: ${st.gpuName}` : "Running on the processor"}</span>
        {!st.gpu && <button className="sm" disabled={!!busy} onClick={() => void gpu()}>{busy === "gpu" ? "Installing…" : "Use my graphics card"}</button>}
      </div>
      {!st.baseReady && <div className="row wrap"><span>Voice locking needs the Base model.</span><button className="sm" disabled={!!busy} onClick={() => void base()}>{busy === "base" ? "Downloading…" : "Download the Base model"}</button></div>}
      {st.baseReady && (
        <ul className="stack">{st.voices.map((v) => (
          <li key={v.id} className="row wrap">
            <span>{NAMES[v.id] ?? v.id}: <strong>{v.locked ? "locked" : "not locked"}</strong></span>
            {v.locked
              ? <button className="sm ghost" disabled={!!busy} onClick={() => void run(v.id, () => api.qwenUnlockVoice(v.id))}>Unlock</button>
              : <button className="sm" disabled={!!busy} onClick={() => void run(v.id, () => api.qwenLockVoice(v.id))}>{busy === v.id ? "Making the reference…" : "Lock this voice"}</button>}
          </li>))}
        </ul>
      )}
      <div className="row wrap"><button className="sm ghost" disabled={!!busy} onClick={() => void api.qwenUnload().then(() => toast("Qwen released its memory."))}>Free Qwen's memory</button></div>
    </div>
  );
}
