import { useMemo, useRef, useState } from "react";
import { agentEnv } from "./agentEnv";
import { useApp } from "../ctx";
import { DEFAULT_PRICES, soundEngineOf } from "../engines";
import { useSample } from "../useSample";
import { Empty, Note, PlayButton } from "../ui";
import { approve, estimateRemaining, MODES, progress, regenerate, reject, resume, retry, setEnabled, step, merge, type AgentRun, type JobNode, type Mode } from "../agent/graph";
import { interpret, settingsFrom } from "../agent/brief";
import { migrateRun } from "../agent/persist";
import { planProblems, planProduction } from "../agent/plan";
import { executors } from "../agent/services";
import { estimateCost } from "../trust";

const COLUMNS: { id: string; label: string; of: (n: JobNode) => boolean }[] = [
  { id: "planned", label: "Planned", of: (n) => n.status === "planned" || n.status === "ready" },
  { id: "running", label: "Running", of: (n) => n.status === "running" },
  { id: "awaiting", label: "Awaiting your approval", of: (n) => n.status === "awaiting_approval" },
  { id: "done", label: "Completed", of: (n) => n.status === "completed" || n.status === "skipped" },
  { id: "failed", label: "Failed or stopped", of: (n) => n.status === "failed" || n.status === "cancelled" },
];

const GATE_WORD: Record<string, string> = { creative: "creative check", spend: "spends money", rights: "voice rights", final: "delivery" };

type Candidates = { candidates?: { character: string; preset: string | null; line: string; voices: { id: string; name: string; engine: string; cloud: boolean }[] }[] };

/** The auditions the agent lined up. Nothing is generated until you press Play; cloud voices ask before they spend. */
function AuditionList({ output, hear, library }: { output: unknown; hear: (v: import("../types").VoiceEntry, text: string) => Promise<string>; library: import("../types").VoiceEntry[] }) {
  const rows = (output as Candidates)?.candidates ?? [];
  if (!rows.length) return null;
  return (
    <div className="small">
      {rows.map((r) => (
        <div key={r.character}>
          <strong>{r.character}</strong>{r.preset ? <span className="muted"> · {r.preset}</span> : null}
          {r.voices.length === 0 ? <div className="muted">No suitable voice in your library.</div> : r.voices.map((v) => {
            const entry = library.find((x) => x.id === v.id);
            return <div key={v.id} className="row">{entry ? <PlayButton label={`Hear ${v.name}`} get={() => hear(entry, r.line)} /> : null}<span className="grow">{v.name}</span>{v.cloud ? <span className="badge warn">cloud</span> : <span className="badge">local</span>}</div>;
          })}
        </div>
      ))}
    </div>
  );
}

export default function AgentStudio() {
  const app = useApp();
  const sample = useSample();
  const { project, library, engines, edit, confirmSpend, toast, go } = app;
  const [brief, setBrief] = useState("");
  const [mode, setMode] = useState<Mode>("guided");
  const [localOnly, setLocalOnly] = useState(true);
  const [limit, setLimit] = useState("0");
  const [running, setRunning] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const live = useRef(project);
  live.current = project;
  const currency = engines.prices?.currency ?? "USD";
  const run = useMemo(() => migrateRun(project?.agent), [project?.agent]);
  const reading = useMemo(() => interpret(brief), [brief]);

  if (!project) return <section><h1>Agent Studio</h1><Empty title="Open a project first" action={<button className="primary" onClick={() => go("home")}>Open Projects</button>}>The agent works on a project's script, cast and takes.</Empty></section>;

  const prices = engines.prices ?? DEFAULT_PRICES;
  const price = (engine: Parameters<typeof estimateCost>[1][number] extends { engine?: infer E } ? E : never, chars: number) => estimateCost(prices, [{ kind: "speech", engine: engine as never, chars }]).cost;
  const now = () => new Date().toISOString();
  const save = (r: AgentRun) => { live.current = { ...live.current!, agent: r }; edit((p) => ({ ...p, agent: r }), "agent-run"); };

  const applyProposals = () => {
    const s = settingsFrom(reading.proposals);
    if (s.localOnly !== undefined) setLocalOnly(s.localOnly);
    if (s.cloudLimit !== undefined) setLimit(String(s.cloudLimit));
    toast(s.localOnly || s.cloudLimit !== undefined ? "Limits updated from your brief." : "Nothing in your brief changes the limits.");
  };

  const makePlan = () => {
    const cloudLimit = localOnly ? 0 : Math.max(0, Number(limit) || 0);
    const fresh = planProduction(live.current!, library, { id: run?.id ?? "run-" + Date.now().toString(36), brief, mode, localOnly, cloudLimit, now: now(), price: price as never, sound: { cloud: !soundEngineOf(engines).free, price: (n) => estimateCost(prices, [{ kind: "sound", count: n }]).cost } });
    const next = run ? { ...merge(run, fresh, now()), mode, localOnly, cloudLimit, brief } : fresh;
    save(next);
    toast(run ? "Plan updated. Finished steps whose inputs did not change were kept." : "Plan ready. Review it, then press Start.");
  };

  const env = () => agentEnv({ app, live });

  const go1 = async (from?: AgentRun) => {
    const run = from ?? migrateRun(live.current?.agent);
    if (!run) return;
    if (running) return;
    if (run.mode === "manual") return toast("Manual Studio: the agent does not run steps. Switch to Guided Agent to let it work.", true);
    const need = estimateRemaining(run);
    if (run.mode === "autonomous" && need > 0 && !run.localOnly) {
      const ok = await confirmSpend({ title: "Let the agent spend up to your limit?", lines: [`Estimated cloud work: ${need.toFixed(2)} ${currency}`, `Hard limit: ${run.cloudLimit.toFixed(2)} ${currency}. The agent stops before passing it and never retries a paid step by itself.`, "Voice rights and final delivery still wait for you."] });
      if (!ok) return;
    }
    const ac = new AbortController();
    abort.current = ac;
    setRunning(true);
    let r = resume(run, now());
    const ex = executors(env());
    try {
      for (let i = 0; i < 400; i++) {
        const s = await step(r, ex, now, ac.signal);
        r = s.run; save(r);
        if (s.event === "idle" || s.event === "cancelled") break;
      }
    } finally { setRunning(false); abort.current = null; }
  };

  const approveNode = async (n: JobNode) => {
    if (!run) return;
    if (n.gate === "spend" && n.estimate > 0) {
      const ok = await confirmSpend({ title: "Approve this paid step?", lines: [n.title, n.detail, `Estimated: ${n.estimate.toFixed(2)} ${currency}`, `Spent so far: ${run.spent.toFixed(2)} of ${run.cloudLimit.toFixed(2)} ${currency}`] });
      if (!ok) return;
    }
    const next = approve(run, n.id, now());
    save(next);
    void go1(next); // carry on straight after a yes: the person should not have to press Continue as well
  };

  const problems = run ? planProblems(run, project, library) : [];
  const prog = run ? progress(run) : null;
  const qc = run?.nodes.find((n) => n.kind === "qc" && n.status === "completed")?.output as { problems: number; listen: number; notes: number; findings: { severity: string; text: string }[]; remake: string[] } | undefined;

  return (
    <section className="agent">
      <div>
        <h1>Agent Studio</h1>
        <p className="lede">You are the director. Describe what you want; Greenroom plans the production, and works through it with you. Everything the agent changes can be undone, and nothing is delivered without your approval.</p>
      </div>

      <div className="card agent-brief">
        <label>Production brief
          <textarea rows={3} maxLength={1500} value={brief} onChange={(e) => setBrief(e.target.value)} placeholder="For example: Make this a children's animated scene. Keep total cloud spending below $5. Use local models unless cloud generation is necessary." />
        </label>
        {brief.trim() && (
          <div className="small" aria-live="polite">
            {reading.proposals.length > 0 && <><strong>What I understood (nothing changes until you decide):</strong>
              <ul>{reading.proposals.map((p, i) => <li key={i}>{p.text}</li>)}</ul>
              {settingsFrom(reading.proposals).cloudLimit !== undefined || settingsFrom(reading.proposals).localOnly ? <button className="sm" onClick={applyProposals}>Use these limits</button> : null}</>}
            {reading.unmatched.length > 0 && <p className="muted">Not understood, so not used: {reading.unmatched.map((u) => `“${u}”`).join(", ")}.</p>}
          </div>
        )}
        <fieldset className="modes">
          <legend>How much should the agent do?</legend>
          {MODES.map((m) => (
            <label key={m.id} className={mode === m.id ? "mode on" : "mode"}>
              <input type="radio" name="mode" checked={mode === m.id} onChange={() => setMode(m.id)} />
              <span><strong>{m.label}</strong>{m.id === "guided" ? " (recommended)" : ""}<br /><span className="muted small">{m.blurb}</span></span>
            </label>
          ))}
        </fieldset>
        <div className="row wrap">
          <label className="check"><input type="checkbox" checked={localOnly} onChange={(e) => setLocalOnly(e.target.checked)} /> Local only: nothing leaves this computer</label>
          <label>Cloud spending limit ({currency})<input type="number" min="0" step="0.5" value={localOnly ? "0" : limit} disabled={localOnly} onChange={(e) => setLimit(e.target.value)} /></label>
          <button className="primary" onClick={makePlan}>{run ? "Update the plan" : "Plan the production"}</button>
        </div>
        {localOnly ? <p className="muted small">Cloud voices are never used and no script or recording is sent to a company. Turn this off to allow cloud voices inside the limit.</p> : <p className="muted small">The agent only uses cloud voices inside this limit, asks before paid steps (in Guided mode), and never retries a paid step by itself.</p>}
      </div>

      {run && (
        <>
          {problems.map((p) => <Note key={p} kind="warn">{p}</Note>)}
          <div className="row wrap between">
            <div className="small" aria-live="polite">{prog && `${prog.done} of ${prog.total} steps done${prog.waiting ? ` · ${prog.waiting} waiting for you` : ""}${prog.failed ? ` · ${prog.failed} failed` : ""} · spent ${run.spent.toFixed(2)} of ${run.cloudLimit.toFixed(2)} ${currency}`}</div>
            <div className="row">
              {running ? <button onClick={() => abort.current?.abort()}>Stop</button> : <button className="primary" onClick={() => void go1()} disabled={run.mode === "manual"}>{prog && prog.done > 0 ? "Continue" : "Start"}</button>}
              <button className="sm ghost" onClick={() => go("export")}>Open Export</button>
            </div>
          </div>

          <div className="board" role="list" aria-label="Production board">
            {COLUMNS.map((c) => (
              <div key={c.id} className="board-col" role="listitem" aria-label={c.label}>
                <h3>{c.label} <span className="muted">{run.nodes.filter((n) => n.enabled || n.status === "skipped").filter(c.of).length}</span></h3>
                {run.nodes.filter(c.of).map((n) => (
                  <article key={n.id} className={`card board-card ${n.cloud ? "cloud" : ""}`} aria-label={n.title}>
                    <strong>{n.title}</strong>
                    <div className="muted small">{n.detail}</div>
                    <div className="row wrap">
                      {n.cloud && <span className="badge warn">cloud{n.estimate ? ` · ~${n.estimate.toFixed(2)}` : ""}</span>}
                      {n.gate !== "none" && <span className="badge">{GATE_WORD[n.gate]}</span>}
                      {!n.enabled && <span className="badge">off</span>}
                    </div>
                    {n.error && <div className="small err-text">{n.error}</div>}
                    {n.kind === "audition" && n.status === "completed" && <AuditionList output={n.output} hear={(v, text) => sample(v, text)} library={library} />}
                    {n.kind === "export" && n.status === "completed" && !!(n.output as { path?: string })?.path && <p className="small ok-text">Written: {(n.output as { path: string }).path}</p>}
                    {n.output !== undefined && n.status === "completed" && <details className="small"><summary>Result</summary><pre>{JSON.stringify(n.output, null, 1).slice(0, 700)}</pre></details>}
                    <div className="row wrap">
                      {n.status === "awaiting_approval" && <><button className="sm primary" onClick={() => void approveNode(n)}>Approve</button><button className="sm" onClick={() => save(reject(run, n.id, now()))}>Reject</button></>}
                      {(n.status === "failed" || n.status === "cancelled") && <button className="sm" onClick={() => { const next = retry(run, n.id, now()); save(next); void go1(next); }}>Try again</button>}
                      {n.kind === "take" && n.status === "completed" && n.lineId && <button className="sm" onClick={() => save(regenerate(run, [n.lineId!], now()))}>Remake this line</button>}
                      {n.kind === "sound" && <button className="sm" onClick={() => save(setEnabled(run, n.id, !n.enabled, now()))}>{n.enabled ? "Turn off" : "Turn on"}</button>}
                    </div>
                  </article>
                ))}
              </div>
            ))}
          </div>

          {qc && (
            <div className="card">
              <h2>Audio check</h2>
              <p className="small">{qc.problems} problem{qc.problems === 1 ? "" : "s"}, {qc.listen} to listen to, {qc.notes} note{qc.notes === 1 ? "" : "s"}. The check measures; whether a performance sounds natural is your call.</p>
              <ul className="small">{qc.findings.slice(0, 8).map((f, i) => <li key={i}><span className={f.severity === "problem" ? "badge warn" : "badge"}>{f.severity === "listen" ? "listen" : f.severity}</span> {f.text}</li>)}</ul>
              {qc.remake.length > 0 && <button className="sm" onClick={() => save(regenerate(run, qc.remake, now()))}>Remake only the {qc.remake.length} flagged line{qc.remake.length === 1 ? "" : "s"}</button>}
            </div>
          )}

          <details className="card"><summary>Audit log ({run.audit.length})</summary>
            <ol className="small audit">{run.audit.slice(-60).reverse().map((a, i) => <li key={i}><span className="muted">{a.at.slice(11, 19)}</span> {a.by} · {a.nodeId} · {a.event}{a.note ? `: ${a.note}` : ""}</li>)}</ol>
            <p className="muted small">Every change the agent makes to the project is one Undo step. Takes keep their usual provenance.</p>
          </details>
        </>
      )}
    </section>
  );
}
