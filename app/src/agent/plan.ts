// Turns a project and a brief into a production plan: the job graph the Agent Studio shows and runs. Planning reads the
// project and writes nothing to it. Lines that already have an approved (chosen) take come back already finished, so a
// revision never throws approved work away.

import { ENGINES } from "../engines";
import { foleyPlan } from "../foley";
import type { Line, Project, VoiceEntry } from "../types";
import type { AgentRun, JobNode, Mode } from "./graph";

export interface PlanOptions {
  id: string;
  brief: string;
  mode: Mode;
  localOnly: boolean;
  cloudLimit: number;
  now: string;
  /** Estimated cost of speaking `chars` characters on an engine. Free and local engines are 0. */
  price: (engine: VoiceEntry["provider"], chars: number) => number;
  /** Cost of making `count` sound clips with the chosen sound engine, and whether that engine is a cloud one. */
  sound?: { price: (count: number) => number; cloud: boolean };
}

/** The most sound clips the agent makes in one run, so a long script cannot run up a bill. */
export const MAX_SOUNDS = 6;

/** A small stable hash, so a node's key changes exactly when its inputs change. */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}

const node = (n: Omit<JobNode, "status" | "approved" | "enabled" | "attempts" | "maxAttempts" | "estimate" | "cloud"> & Partial<Pick<JobNode, "enabled" | "estimate" | "cloud">>): JobNode => ({ status: "planned", approved: false, enabled: true, attempts: 0, maxAttempts: n.cloud ? 1 : 2, estimate: 0, cloud: false, ...n });

export function planProduction(project: Project, library: VoiceEntry[], o: PlanOptions): AgentRun {
  const speaking = project.lines.filter((l) => l.text.trim());
  const voiceOf = (l: Line) => { const c = project.characters.find((x) => x.id === l.characterId); return c?.voiceId ? library.find((v) => v.id === c.voiceId) : undefined; };
  const cast = project.characters.filter((c) => speaking.some((l) => l.characterId === c.id));
  const cloned = cast.map((c) => library.find((v) => v.id === c.voiceId)).filter((v): v is VoiceEntry => !!v && v.source === "cloned");
  const castKey = hash(JSON.stringify(cast.map((c) => [c.id, c.voiceId ?? "", c.dna?.timbre ?? ""])));
  const nodes: JobNode[] = [];

  nodes.push(node({ id: "analyze", kind: "analyze", title: "Analyze the script", detail: `${project.characters.length} characters, ${speaking.length} lines, ${project.scenes.length || 1} scene(s)`, deps: [], gate: "none", key: hash(project.script || JSON.stringify(speaking.map((l) => l.text))) }));
  nodes.push(node({ id: "cast", kind: "cast", title: "Recommend the cast", detail: "Looks for a voice for each character that has none, using only what is stated about them (vocal gender, age, language, accent). A voice is assigned only when it is proven to fit; otherwise the candidates are listed for you. An approved voice is never touched.", deps: ["analyze"], gate: "none", key: castKey }));
  const allApproved = cast.length > 0 && cast.every((c) => !!c.casting?.approval);
  const approve = node({ id: "approve_cast", kind: "approve_cast", title: "Approve and lock the cast", detail: cloned.length ? `Locks each character's voice. Includes ${cloned.length} cloned voice(s): you confirm the voice rights. This step is always yours: the agent cannot approve a voice.` : "Locks each character's voice so nothing can change it later without you. This step is always yours: the agent cannot approve a voice.", deps: ["cast"], gate: "rights", key: castKey });
  nodes.push(allApproved ? { ...approve, status: "completed", approved: true, output: { kept: true, locked: cast.map((c) => c.name) } } : approve);
  nodes.push(node({ id: "audition", kind: "audition", title: "Line up voice auditions", detail: "For each character, the voices in your library that suit their preset, ready for you to hear. Playing one is your choice; local voices are free, cloud voices ask first.", deps: ["approve_cast"], gate: "none", key: castKey }));
  nodes.push(node({ id: "direct", kind: "direct", title: "Compile acting direction", detail: "Turn your notes and the brief into line-level direction for each voice.", deps: ["approve_cast"], gate: "creative", key: hash(o.brief + JSON.stringify(speaking.map((l) => [l.id, l.acting ?? "", l.direction.note ?? ""]))) }));

  const takeIds: string[] = [];
  for (const l of speaking) {
    const v = voiceOf(l);
    const cloud = !!v && !ENGINES[v.provider].local;
    const have = l.chosen ? l.takes.find((t) => t.id === l.chosen) : undefined;
    const n = node({
      id: `take:${l.id}`, kind: "take", lineId: l.id, title: `Make take: ${project.characters.find((c) => c.id === l.characterId)?.name ?? "?"}`, detail: l.text.slice(0, 70),
      deps: ["direct"], gate: cloud ? "spend" : "none", cloud, estimate: cloud && v ? o.price(v.provider, l.text.length) : 0,
      key: hash(JSON.stringify([l.text, l.acting ?? "", l.direction, l.characterId, v?.id ?? "", v?.provider ?? ""])),
    });
    // Approved work is kept: a line that already has a chosen take is finished.
    takeIds.push(n.id);
    nodes.push(have ? { ...n, status: "completed", approved: true, output: { takeId: have.id, kept: true } } : n);
  }
  nodes.push(node({ id: "qc", kind: "qc", title: "Check the audio", detail: "Clipping, silence, missing lines, unsupported sounds. Subjective problems are flagged for you to listen to.", deps: takeIds.length ? takeIds : ["direct"], gate: "none", key: hash(takeIds.join(",")) }));
  const ideas = foleyPlan(project.script, project.lines).slice(0, MAX_SOUNDS);
  const soundCloud = !!o.sound?.cloud && ideas.length > 0;
  nodes.push(node({ id: "sound", kind: "sound", title: "Make ambience and sound effects", detail: ideas.length ? `${ideas.length} sound${ideas.length === 1 ? "" : "s"} read from your stage directions (at most ${MAX_SOUNDS}). Off until you turn it on.` : "No sounds were found in the stage directions.", deps: ["direct"], gate: soundCloud ? "spend" : "none", cloud: soundCloud, estimate: soundCloud ? (o.sound?.price(ideas.length) ?? 0) : 0, enabled: false, key: hash(ideas.map((i) => i.prompt + i.lineId).join("|")) }));
  nodes.push(node({ id: "timeline", kind: "timeline", title: "Assemble the timeline", detail: "Put the approved takes in order on the timeline.", deps: ["qc"], gate: "creative", key: hash(takeIds.join(",")) }));
  nodes.push(node({ id: "export", kind: "export", title: "Export the full scene", detail: "After your approval: mixes the approved takes, applies your loudness target and writes the full scene. If the brief names a destination (podcast, audiobook, game, training...) it uses that format, and writes stems, scenes or single lines when asked. OTIO, EDL and the report are on the Export screen.", deps: ["timeline"], gate: "final", key: hash(o.brief) }));

  return { version: 1, id: o.id, mode: o.mode, brief: o.brief.slice(0, 2000), localOnly: o.localOnly, cloudLimit: Math.max(0, o.cloudLimit), spent: 0, nodes, audit: [{ at: o.now, nodeId: "-", event: "planned", by: "agent", note: `${nodes.length} steps` }], createdAt: o.now, updatedAt: o.now };
}

/** Plain-words problems with a plan before it starts, so the person sees them up front. */
export function planProblems(run: AgentRun, project: Project, library: VoiceEntry[]): string[] {
  const out: string[] = [];
  for (const n of run.nodes) {
    if (!n.enabled || n.kind !== "take" || !n.lineId) continue;
    const l = project.lines.find((x) => x.id === n.lineId);
    const c = project.characters.find((x) => x.id === l?.characterId);
    const v = c?.voiceId ? library.find((x) => x.id === c.voiceId) : undefined;
    if (!v) out.push(`${c?.name ?? "A character"} has no voice yet, so their lines cannot be made.`);
    else if (run.localOnly && !ENGINES[v.provider].local) out.push(`${c?.name} uses ${v.name}, a cloud voice, but this run is local-only.`);
    else if (v.source === "cloned" && !v.consent) out.push(`${v.name} is a cloned voice with no consent record. It cannot be used until consent is recorded.`);
  }
  const need = run.nodes.filter((n) => n.enabled && n.cloud && n.status !== "completed").reduce((s, n) => s + n.estimate, 0);
  if (need > run.cloudLimit + 1e-9) out.push(`The cloud work in this plan is estimated at ${need.toFixed(2)}, over your limit of ${run.cloudLimit.toFixed(2)}.`);
  return [...new Set(out)];
}
