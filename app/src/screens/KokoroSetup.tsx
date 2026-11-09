import { useMemo, useState } from "react";
import type { LocalRuntimeStatus } from "../api";
import { useApp } from "../ctx";
import { execStep } from "../setupExec";
import { planKokoro, runSetup, summarize, type SetupStep, type StepResult } from "../setupPlan";

const mark: Record<StepResult["status"], string> = { waiting: "○", running: "…", done: "✓", failed: "✗", skipped: "–" };

/** The Kokoro card's automatic setup: runtime, model download with a proof line, then its voices in the library. */
export default function KokoroSetup({ runtime, onChanged }: { runtime: LocalRuntimeStatus | null; onChanged: () => void }) {
  const { confirmSpend, toast, library, saveLibrary } = useApp();
  const [running, setRunning] = useState(false);
  const [steps, setSteps] = useState<SetupStep[]>([]);
  const [results, setResults] = useState<StepResult[]>([]);
  const libraryKokoro = useMemo(() => library.filter((v) => v.provider === "kokoro").map((v) => v.id), [library]);
  const plan = useMemo(() => planKokoro({ kokoroRuntime: runtime?.installed ?? false, kokoroModel: runtime?.modelReady ?? false, libraryKokoro }), [runtime, libraryKokoro]);

  const start = async () => {
    if (!plan.steps.length) return;
    const ok = await confirmSpend({ title: "Set up Kokoro on this PC?", lines: [
      ...plan.steps.map((s) => `${s.label}: ${s.why}`),
      "Downloads Python packages and the Kokoro model (Hugging Face). Nothing is sent about you, and no credits are used.",
      "It needs internet this once. After that Kokoro runs offline.",
    ], download: true });
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
        ? <p className="small">Kokoro is set up and its voices are in your library.</p>
        : <div className="row wrap"><button className="primary" disabled={running} onClick={() => void start()}>{running ? "Setting up…" : "Set up Kokoro automatically"}</button></div>}
      {(running || finished) && (
        <ul className="stack small" aria-live="polite">{steps.map((s) => { const r = results.find((x) => x.id === s.id); const st = r?.status ?? "waiting"; return <li key={s.id}><span aria-hidden="true">{mark[st]}</span> <strong>{s.label}</strong> <span className="muted">{st}</span>{r?.error && <><br /><span className="muted">{r.error}</span></>}</li>; })}</ul>
      )}
    </div>
  );
}
