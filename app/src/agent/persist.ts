// Reading a saved production run back from a project file. Everything is checked and limited: a project file is outside
// input, so a wrong or hostile run never crashes the screen, never grants approval it was not given, and never grows
// without bound. Anything that does not look right is dropped or reset to its safe value.

import type { AgentRun, AuditEntry, Gate, JobNode, Mode, NodeKind, Status } from "./graph";

const MODES: Mode[] = ["manual", "guided", "autonomous"];
const KINDS: NodeKind[] = ["analyze", "cast", "audition", "direct", "take", "qc", "sound", "timeline", "export"];
const STATUSES: Status[] = ["planned", "ready", "running", "awaiting_approval", "completed", "failed", "cancelled", "skipped"];
const GATES: Gate[] = ["none", "creative", "spend", "rights", "final"];
export const MAX_NODES = 600;
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const id = (v: unknown) => { const s = text(v, 80); return /^[A-Za-z0-9:_.-]+$/.test(s) ? s : ""; };

function node(raw: unknown): JobNode | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const nid = id(o.id);
  if (!nid || !KINDS.includes(o.kind as NodeKind)) return null;
  const kind = o.kind as NodeKind;
  const gate = GATES.includes(o.gate as Gate) ? (o.gate as Gate) : "final";
  // A run that was running when the app closed comes back ready. A saved "approved" is kept only for a node that also has a gate to have approved.
  const status = STATUSES.includes(o.status as Status) ? (o.status as Status) : "planned";
  const cloud = o.cloud === true;
  return {
    id: nid, kind, title: text(o.title, 120), detail: text(o.detail, 200),
    deps: Array.isArray(o.deps) ? o.deps.map(id).filter(Boolean).slice(0, 700) : [],
    status: status === "running" ? "ready" : status,
    gate, approved: o.approved === true && gate !== "none",
    enabled: o.enabled !== false,
    attempts: Math.floor(num(o.attempts, 0, 20, 0)), maxAttempts: Math.floor(num(o.maxAttempts, 1, 3, cloud ? 1 : 2)),
    ...(id(o.lineId) ? { lineId: id(o.lineId) } : {}),
    cloud, estimate: num(o.estimate, 0, 1e6, 0), key: text(o.key, 40),
    ...(o.output !== undefined ? { output: safeOutput(o.output) } : {}),
    ...(text(o.error, 300) ? { error: text(o.error, 300) } : {}),
  };
}

/** Outputs are shown, never run. Keep them small and plain. */
function safeOutput(v: unknown): unknown {
  try { const s = JSON.stringify(v); return s && s.length <= 20_000 ? JSON.parse(s) : undefined; } catch { return undefined; }
}

export function migrateRun(raw: unknown): AgentRun | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const o = raw as Record<string, unknown>;
  if (!Array.isArray(o.nodes)) return undefined;
  const nodes = o.nodes.slice(0, MAX_NODES).map(node).filter((n): n is JobNode => !!n);
  if (!nodes.length) return undefined;
  const seen = new Set<string>();
  const unique = nodes.filter((n) => (seen.has(n.id) ? false : (seen.add(n.id), true)));
  const audit: AuditEntry[] = (Array.isArray(o.audit) ? o.audit : []).slice(-500).map((a) => {
    const x = (a ?? {}) as Record<string, unknown>;
    return { at: text(x.at, 40), nodeId: text(x.nodeId, 80), event: text(x.event, 80), by: x.by === "user" || x.by === "system" ? x.by : "agent", note: text(x.note, 240) } as AuditEntry;
  });
  return {
    version: 1,
    id: id(o.id) || "run",
    mode: MODES.includes(o.mode as Mode) ? (o.mode as Mode) : "guided",
    brief: text(o.brief, 2000),
    // Missing or odd means local-only: the safe reading of a file that does not say.
    localOnly: o.localOnly !== false,
    cloudLimit: num(o.cloudLimit, 0, 1e6, 0),
    spent: num(o.spent, 0, 1e9, 0),
    nodes: unique, audit,
    createdAt: text(o.createdAt, 40), updatedAt: text(o.updatedAt, 40),
  };
}
