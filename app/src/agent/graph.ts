// The production job graph behind the Agent Studio. Pure functions over plain data: every function returns a new run and
// never touches the project, the network or the clock (time comes in as an argument). Side effects live in executors the
// caller supplies, so the same rules are tested with fakes and run for real in the app.
//
// What the rules guarantee (each has a test):
//   - Nothing runs before its dependencies are done, and a finished node is never run again unless its inputs changed.
//   - Local-only projects never run a cloud node. A cloud node never runs past the cloud spending limit.
//   - A cloud node is never retried automatically, so a failure cannot charge twice. Local nodes get one retry.
//   - A voice-rights decision and the final delivery always wait for a person, in every mode.
//   - A run can be cancelled and resumed; interrupted work goes back to "ready", finished work is kept.
//   - Every state change is written to an audit log.

export type Mode = "manual" | "guided" | "autonomous";
export const MODES: { id: Mode; label: string; blurb: string }[] = [
  { id: "manual", label: "Manual Studio", blurb: "You control every operation. The agent only plans and explains." },
  { id: "guided", label: "Guided Agent", blurb: "The agent works through the plan and stops for your approval at creative, spending, rights and delivery steps." },
  { id: "autonomous", label: "Autonomous Draft", blurb: "The agent makes a first draft inside the limits you set. Voice rights and final delivery still wait for you." },
];

export type NodeKind = "analyze" | "cast" | "audition" | "direct" | "take" | "qc" | "sound" | "timeline" | "export";
export type Status = "planned" | "ready" | "running" | "awaiting_approval" | "completed" | "failed" | "cancelled" | "skipped";
/** What has to be approved before a node runs. "final" is delivery. It is never skipped. */
export type Gate = "none" | "creative" | "spend" | "rights" | "final";

export interface JobNode {
  id: string;
  kind: NodeKind;
  title: string;
  detail: string;
  deps: string[];
  status: Status;
  gate: Gate;
  approved: boolean;
  enabled: boolean;
  attempts: number;
  maxAttempts: number;
  lineId?: string;
  /** Sends text or audio to a company. */
  cloud: boolean;
  /** Estimated cost in the project's currency, 0 for free or local work. */
  estimate: number;
  /** Changes when the node's inputs change. A finished node with the same key is not run again. */
  key: string;
  output?: unknown;
  error?: string;
}

export interface AuditEntry { at: string; nodeId: string; event: string; by: "agent" | "user" | "system"; note: string }

export interface AgentRun {
  version: 1;
  id: string;
  mode: Mode;
  brief: string;
  /** No script or recording leaves this computer. */
  localOnly: boolean;
  /** The most the agent may spend on cloud work in this run. */
  cloudLimit: number;
  spent: number;
  nodes: JobNode[];
  audit: AuditEntry[];
  createdAt: string;
  updatedAt: string;
}

const MAX_AUDIT = 500;

export const isDone = (n: JobNode) => n.status === "completed" || n.status === "skipped";
const byId = (run: AgentRun, id: string) => run.nodes.find((n) => n.id === id);

function log(run: AgentRun, at: string, nodeId: string, event: string, by: AuditEntry["by"], note = ""): AgentRun {
  return { ...run, updatedAt: at, audit: [...run.audit, { at, nodeId, event, by, note: note.slice(0, 240) }].slice(-MAX_AUDIT) };
}
const setNode = (run: AgentRun, id: string, patch: Partial<JobNode>): AgentRun => ({ ...run, nodes: run.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) });

// ---- what must be approved --------------------------------------------------------------------------------------

/** Whether a node still needs a person's yes before it runs, in this mode. */
export function needsApproval(run: AgentRun, n: JobNode): boolean {
  if (n.approved || n.gate === "none") return false;
  if (n.gate === "rights" || n.gate === "final") return true; // never automatic
  if (run.mode === "autonomous") return false; // creative and spend are covered by the limits the person set up front
  return true;
}

export type Block = { blocked: true; reason: string } | { blocked: false };

/** The hard rules, checked just before a node would run. A blocked node is not retried and never charges. */
export function check(run: AgentRun, n: JobNode): Block {
  if (run.mode === "manual") return { blocked: true, reason: "Manual Studio: the agent does not run steps. Do this step yourself." };
  if (n.cloud && run.localOnly) return { blocked: true, reason: "This project is local-only, so nothing is sent to a cloud engine." };
  if (n.cloud && run.spent + n.estimate > run.cloudLimit + 1e-9) return { blocked: true, reason: `This would take cloud spending to ${(run.spent + n.estimate).toFixed(2)}, past the limit of ${run.cloudLimit.toFixed(2)}.` };
  return { blocked: false };
}

// ---- reading the graph ------------------------------------------------------------------------------------------

/** Nodes that could run now: enabled, not started, every dependency finished. */
export function runnable(run: AgentRun): JobNode[] {
  return run.nodes.filter((n) => n.enabled && (n.status === "planned" || n.status === "ready") && n.deps.every((d) => { const x = byId(run, d); return !x || !x.enabled || isDone(x); }));
}

export function progress(run: AgentRun): { total: number; done: number; failed: number; waiting: number; running: number } {
  const on = run.nodes.filter((n) => n.enabled);
  return { total: on.length, done: on.filter(isDone).length, failed: on.filter((n) => n.status === "failed").length, waiting: on.filter((n) => n.status === "awaiting_approval").length, running: on.filter((n) => n.status === "running").length };
}

export const estimateRemaining = (run: AgentRun): number => run.nodes.filter((n) => n.enabled && n.cloud && !isDone(n)).reduce((s, n) => s + n.estimate, 0);

// ---- people acting on the run -----------------------------------------------------------------------------------

export function approve(run: AgentRun, id: string, at: string): AgentRun {
  const n = byId(run, id);
  if (!n || n.status !== "awaiting_approval") return run;
  return log(setNode(run, id, { approved: true, status: "ready" }), at, id, "approved", "user", n.title);
}

export function reject(run: AgentRun, id: string, at: string, note = ""): AgentRun {
  const n = byId(run, id);
  if (!n || isDone(n)) return run;
  return log(setNode(run, id, { status: "cancelled", approved: false }), at, id, "rejected", "user", note || n.title);
}

export function setEnabled(run: AgentRun, id: string, enabled: boolean, at: string): AgentRun {
  const n = byId(run, id);
  if (!n || n.status === "running") return run;
  return log(setNode(run, id, { enabled, ...(enabled ? { status: "planned" as const } : { status: "skipped" as const }) }), at, id, enabled ? "enabled" : "disabled", "user", n.title);
}

/** Puts a failed or cancelled node back in line. This is the only way a failed node runs again. */
export function retry(run: AgentRun, id: string, at: string): AgentRun {
  const n = byId(run, id);
  if (!n || (n.status !== "failed" && n.status !== "cancelled")) return run;
  return log(setNode(run, id, { status: "ready", attempts: 0, error: undefined }), at, id, "retry requested", "user", n.title);
}

/** After an interruption: work that was running goes back to ready, finished work is kept as it is. */
export function resume(run: AgentRun, at: string): AgentRun {
  let r = run;
  for (const n of run.nodes) if (n.status === "running") r = log(setNode(r, n.id, { status: "ready" }), at, n.id, "interrupted, back to ready", "system", n.title);
  return r;
}

/**
 * Remakes only the chosen lines. Their take nodes (and everything that depends on them) go back to planned; every other
 * finished node, and every approved take, is kept.
 */
export function regenerate(run: AgentRun, lineIds: string[], at: string): AgentRun {
  const want = new Set(run.nodes.filter((n) => n.kind === "take" && n.lineId && lineIds.includes(n.lineId)).map((n) => n.id));
  if (!want.size) return run;
  const reset = new Set(want);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of run.nodes) if (!reset.has(n.id) && n.deps.some((d) => reset.has(d))) { reset.add(n.id); grew = true; }
  }
  let r = run;
  for (const n of run.nodes) if (reset.has(n.id)) r = log(setNode(r, n.id, { status: "planned", approved: false, attempts: 0, error: undefined, output: want.has(n.id) ? undefined : n.output }), at, n.id, want.has(n.id) ? "regenerate" : "redo because an input changed", "user", n.title);
  return r;
}

/** Folds a freshly planned graph into a saved one: finished nodes whose inputs did not change keep their result. */
export function merge(saved: AgentRun, fresh: AgentRun, at: string): AgentRun {
  const old = new Map(saved.nodes.map((n) => [n.id, n]));
  const stale = new Set<string>();
  const nodes = fresh.nodes.map((n) => {
    const o = old.get(n.id);
    if (o && isDone(o) && o.key === n.key && o.deps.every((d) => !stale.has(d))) return { ...n, status: o.status, approved: o.approved, output: o.output, attempts: o.attempts, enabled: o.enabled };
    if (o) stale.add(n.id);
    return o && o.key !== n.key ? { ...n, enabled: o.enabled } : n;
  });
  return log({ ...saved, nodes, updatedAt: at }, at, "-", "plan updated; unchanged finished steps kept", "system", `${nodes.filter((n) => isDone(n)).length} kept`);
}

// ---- running ----------------------------------------------------------------------------------------------------

export interface Outcome { output?: unknown; /** Money actually spent by this node. */ spent?: number }
export type Executor = (node: JobNode, run: AgentRun, signal: AbortSignal) => Promise<Outcome>;
export type Executors = Partial<Record<NodeKind, Executor>>;

export interface Step { run: AgentRun; /** What happened, for the caller to show. */ event: "ran" | "waiting" | "blocked" | "failed" | "idle" | "cancelled" }

/** Does one thing: runs the next runnable node, or stops it for approval, or reports it blocked. Call again to continue. */
export async function step(run: AgentRun, ex: Executors, now: () => string, signal: AbortSignal = new AbortController().signal): Promise<Step> {
  if (signal.aborted) return { run: log(run, now(), "-", "cancelled", "user"), event: "cancelled" };
  const n = runnable(run)[0];
  if (!n) return { run, event: "idle" };
  const blocked = check(run, n);
  if (blocked.blocked) return { run: log(setNode(run, n.id, { status: "failed", error: blocked.reason }), now(), n.id, "blocked", "system", blocked.reason), event: "blocked" };
  if (needsApproval(run, n)) {
    if (n.status === "awaiting_approval") return { run, event: "waiting" };
    return { run: log(setNode(run, n.id, { status: "awaiting_approval" }), now(), n.id, `waiting for approval (${n.gate})`, "agent", n.title), event: "waiting" };
  }
  const exec = ex[n.kind];
  if (!exec) return { run: log(setNode(run, n.id, { status: "failed", error: `No executor for ${n.kind}.` }), now(), n.id, "failed", "system", "no executor"), event: "failed" };
  let r = log(setNode(run, n.id, { status: "running", attempts: n.attempts + 1 }), now(), n.id, "started", "agent", n.title);
  try {
    const out = await exec({ ...n, attempts: n.attempts + 1 }, r, signal);
    if (signal.aborted) return { run: log(setNode(r, n.id, { status: "cancelled" }), now(), n.id, "cancelled while running", "user"), event: "cancelled" };
    r = setNode({ ...r, spent: Number((r.spent + (out.spent ?? 0)).toFixed(4)) }, n.id, { status: "completed", output: out.output, error: undefined });
    return { run: log(r, now(), n.id, "completed", "agent", out.spent ? `spent ${out.spent.toFixed(2)}` : ""), event: "ran" };
  } catch (e) {
    const msg = (e as Error).message ?? String(e);
    // A cloud step may already have been charged, so it is never retried by itself. A local step gets one more go.
    const again = !n.cloud && n.attempts + 1 < n.maxAttempts;
    return { run: log(setNode(r, n.id, { status: again ? "ready" : "failed", error: msg }), now(), n.id, again ? "failed, will retry once" : "failed", "agent", msg), event: "failed" };
  }
}

/** Runs until something needs a person, nothing is left, or the run is cancelled. Bounded, so it cannot loop forever. */
export async function runAll(run: AgentRun, ex: Executors, now: () => string, signal?: AbortSignal, onStep?: (s: Step) => void): Promise<AgentRun> {
  let r = run;
  for (let i = 0; i < run.nodes.length * 3 + 5; i++) {
    const s = await step(r, ex, now, signal);
    r = s.run;
    onStep?.(s);
    if (s.event === "idle" || s.event === "cancelled") break;
  }
  return r;
}
