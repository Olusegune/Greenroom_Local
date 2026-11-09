import { useMemo, useState } from "react";
import type { LocalRuntimeStatus } from "../api";
import { useApp } from "../ctx";
import { execStep } from "../setupExec";
import { planKokoro, planQwen, runSetup, summarize, type SetupStep, type StepResult } from "../setupPlan";

const mark: Record<StepResult["status"], string> = { waiting: "○", running: "…", done: "✓", failed: "✗", skipped: "–" };

const TEXT = {
  kokoro: { name: "Kokoro", button: "Set up Kokoro automatically", ready: "Kokoro is set up and its voices are in your library.", warn: "Downloads Python packages and the Kokoro model (Hugging Face). It needs internet this once. After that Kokoro runs offline." },
  qwen: { name: "Qwen3-TTS", button: "Set up Qwen3-TTS automatically", ready: "Qwen3-TTS is set up and its voices are in your library.", warn: "Downloads Python packages and the Qwen3-TTS model, several GB in all (Hugging Face). It needs internet this once, and it is slow on a CPU: a short line can take a minute or more." },
} as const;

/** The automatic setup on a local engine's card: runtime, model download with a proof line, then its voices in the library. */
export default function LocalEngineSetup({ engine, runtime, onChanged }: { engine: "kokoro" | "qwen"; runtime: LocalRuntimeStatus | null; onChanged: () => void }) {
  const { confirmSpend, toast, library, saveLibrary } = useApp();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [results, setResults] = useState<StepResult[]>([]);
  const t = TEXT[engine];
  const inLibrary = useMemo(() => library.filter((v) => v.provider === engine).map((v) => v.id), [library, engine]);
  const plan = useMemo(() => {
    const base = { runtimeReady: runtime?.installed ?? false, modelReady: runtime?.modelReady ?? false };
    return engine === "kokoro" ? planKokoro({ kokoroRuntime: base.runtimeReady, kokoroModel: base.modelReady, libraryKokoro: inLibrary }) : planQwen({ qwenRuntime: base.runtimeReady, qwenModel: base.modelReady, libraryQwen: inLibrary });
  }, [engine, runtime, inLibrary]);

  const start = async () => {
    if (!plan.steps.length) return;
    const ok = await confirmSpend({ title: `Set up ${t.name} on this PC?`, lines: [...plan.steps.map((s) => `${s.label}: ${s.why}`), t.warn, "Nothing is sent about you, and no credits are used."], download: true });
    if (!ok) return;
    setSteps(plan.steps); setRunning(true);
    const r = await runSetup(plan.steps, (s) => execStep(s, { catalog: [], saveLibrary }), setResults);
    setRunning(false);
    toast(summarize(r), r.some((x) => x.status === "failed"));
    onChanged();
  };

  const finished = !running && results.length > 0;
  return (
    <div className="stack">
      {plan.steps.length === 0
        ? <p className="small">{t.ready}</p>
        : <div className="row wrap"><button className="primary" disabled={running} onClick={() => void start()}>{running ? "Setting up…" : t.button}</button></div>}
      {(running || finished) && (
        <ul className="stack small" aria-live="polite">{steps.map((s) => { const r = results.find((x) => x.id === s.id); const st = r?.status ?? "waiting"; return <li key={s.id}><span aria-hidden="true">{mark[st]}</span> <strong>{s.label}</strong> <span className="muted">{st}</span>{r?.error && <><br /><span className="muted">{r.error}</span></>}</li>; })}</ul>
      )}
    </div>
  );
}
