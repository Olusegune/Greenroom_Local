import { cueText, hasBeats, isAssembled } from "./beats";
import { cleanNote, EMOTIONS } from "./direct";
import type { Direction, Line } from "./types";

export type PerformanceEventKind = "breath" | "chuckle" | "laugh" | "sigh" | "gasp" | "grunt" | "groan" | "cry" | "cough" | "effort" | "pause";

export interface PerformanceEvent {
  id: string;
  kind: PerformanceEventKind;
  afterWord: number;
  intensity: number;
  durationMs?: number;
}

export interface PerformancePoint {
  position: number;
  emotion: string;
  intensity: number;
}

export const ACTIVITIES = ["still", "walking", "running", "lifting", "pushing", "fighting", "injured", "cold", "custom"] as const;

export interface PhysicalState {
  activity: (typeof ACTIVITIES)[number];
  effort: number;
  fatigue: number;
  pain: number;
  breathlessness: number;
  note: string;
}

export interface PerformancePlan {
  objective: string;
  subtext: string;
  direction: string;
  arc: PerformancePoint[];
  physical: PhysicalState;
  events: PerformanceEvent[];
  pace: number;
  projection: number;
  tension: number;
  breathiness: number;
  accentStrength: number;
}

/** Saved on a line as `performance`. Lines with none (every project made before this) are unchanged. */
export const PERFORMANCE_VERSION = 1;

export const DEFAULT_PERFORMANCE: PerformancePlan = {
  objective: "",
  subtext: "",
  direction: "",
  arc: [{ position: 0, emotion: "neutral", intensity: 0.35 }],
  physical: { activity: "still", effort: 0, fatigue: 0, pain: 0, breathlessness: 0, note: "" },
  events: [], pace: 1, projection: 0.5, tension: 0.2, breathiness: 0.15, accentStrength: 1,
};

export function physicalDirection(p: PhysicalState): string {
  if (p.activity === "still" && Math.max(p.effort, p.fatigue, p.pain, p.breathlessness) === 0) return "";
  const effects: string[] = [];
  if (p.effort > 0.25) effects.push(`${level(p.effort)} sustained muscular effort affecting the whole voice`);
  if (p.breathlessness > 0.2) effects.push(`${level(p.breathlessness)} breathlessness with shorter phrases and recovery breaths`);
  if (p.fatigue > 0.25) effects.push(`${level(p.fatigue)} fatigue with reduced projection`);
  if (p.pain > 0.2) effects.push(`${level(p.pain)} pain and guarded articulation`);
  return `The speaker is ${p.activity}. ${effects.join("; ")}${p.note ? `. ${p.note}` : ""}. Do not reduce this to a single sound effect.`;
}

function level(n: number) { return n >= 0.75 ? "extreme" : n >= 0.5 ? "strong" : "noticeable"; }

// ---- Reading a saved plan safely ----

const num = (v: unknown, lo: number, hi: number, d: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const str = (v: unknown, max: number): string => (typeof v === "string" ? cleanNote(v, max) : "");
const word = (v: unknown): string => (typeof v === "string" ? v.replace(/[^\p{L} -]/gu, "").trim().toLowerCase().slice(0, 30) : "");

/** A plan read from a saved project, with every value checked and limited. Anything missing or wrong falls back to the default. */
export function migratePerformance(raw: unknown): PerformancePlan | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const ph = (r.physical && typeof r.physical === "object" ? r.physical : {}) as Record<string, unknown>;
  const arc = (Array.isArray(r.arc) ? r.arc : [])
    .map((p) => p as Record<string, unknown>)
    .filter((p) => p && word(p.emotion))
    .slice(0, 8)
    .map((p) => ({ position: num(p.position, 0, 1, 0), emotion: word(p.emotion), intensity: num(p.intensity, 0, 1, 0.35) }))
    .sort((a, b) => a.position - b.position);
  return {
    objective: str(r.objective, 160),
    subtext: str(r.subtext, 160),
    direction: str(r.direction, 200),
    arc: arc.length ? arc : DEFAULT_PERFORMANCE.arc,
    physical: {
      activity: ACTIVITIES.includes(ph.activity as never) ? (ph.activity as PhysicalState["activity"]) : "still",
      effort: num(ph.effort, 0, 1, 0),
      fatigue: num(ph.fatigue, 0, 1, 0),
      pain: num(ph.pain, 0, 1, 0),
      breathlessness: num(ph.breathlessness, 0, 1, 0),
      note: str(ph.note, 120),
    },
    events: [],
    pace: num(r.pace, 0.7, 1.2, 1),
    projection: num(r.projection, 0, 1, 0.5),
    tension: num(r.tension, 0, 1, 0.2),
    breathiness: num(r.breathiness, 0, 1, 0.15),
    accentStrength: num(r.accentStrength, 0, 1, 1),
  };
}

export function isDefaultPerformance(p: PerformancePlan): boolean {
  const d = DEFAULT_PERFORMANCE;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return !p.objective && !p.subtext && !p.direction && same(p.arc, d.arc) && same(p.physical, d.physical) && p.events.length === 0 && p.pace === d.pace && p.projection === d.projection && p.tension === d.tension && p.breathiness === d.breathiness && p.accentStrength === d.accentStrength;
}

// ---- Compiling a plan into what a voice can be given ----

export interface CompiledPerformance {
  /** Short plain-English sentences added after the director's own note. At most four, each short enough to send as one instruction. */
  sentences: string[];
  /** Sound tags the plan calls for. Only ones Greenroom already treats as verified. */
  sounds: string[];
  /** A multiplier on the line's speed. */
  pace: number;
  /** An emotion for the line when its chip is empty and the plan's first point names one. */
  emotion: string;
}

const EMOTION_TAGS = EMOTIONS.map((e) => e.tag);
const strength = (n: number) => (n >= 0.7 ? "strongly" : n >= 0.4 ? "moderately" : "slightly");
const feeling = (e: string, n: number) => (e === "neutral" ? "neutral" : `${strength(n)} ${e}`);
const sentence = (s: string) => cleanNote(s.replace(/[.!?]+$/, ""), 150) + ".";

export function compilePerformance(p: PerformancePlan): CompiledPerformance {
  const out: string[] = [];
  if (p.direction) out.push(sentence(p.direction));
  const intent = [p.objective && `The character is trying to ${p.objective.replace(/[.!?]+$/, "")}`, p.subtext && `underneath, ${p.subtext.replace(/[.!?]+$/, "")}`].filter(Boolean).join(", but ");
  if (intent) out.push(sentence(intent));

  const first = p.arc[0];
  const last = p.arc[p.arc.length - 1];
  if (first && last && p.arc.length > 1 && (first.emotion !== last.emotion || Math.abs(first.intensity - last.intensity) > 0.2)) {
    out.push(sentence(`Starts ${feeling(first.emotion, first.intensity)} and ends ${feeling(last.emotion, last.intensity)}`));
  } else if (first && first.emotion !== "neutral" && !EMOTION_TAGS.includes(first.emotion)) {
    out.push(sentence(feeling(first.emotion, first.intensity)));
  }

  const ph = p.physical;
  const effects: string[] = [];
  if (ph.effort > 0.25) effects.push(ph.effort >= 0.7 ? "straining hard, labouring" : ph.effort >= 0.4 ? "straining" : "slightly strained");
  if (ph.breathlessness > 0.2) effects.push(`${strength(ph.breathlessness)} breathless, in short phrases with recovery breaths`);
  if (ph.fatigue > 0.25) effects.push(`${strength(ph.fatigue)} tired, with less energy`);
  if (ph.pain > 0.2) effects.push(`${strength(ph.pain)} pained and guarded`);
  if (ph.activity !== "still" || effects.length) {
    const act = ph.activity === "custom" ? ph.note || "doing something physical" : ph.activity;
    out.push(sentence(`Speaking while ${act === "still" ? "still" : act}${effects.length ? `: ${effects.join(", ")}` : ""}`));
  }

  const voice: string[] = [];
  if (p.projection >= 0.7) voice.push("projected");
  else if (p.projection <= 0.3) voice.push("quiet and held back");
  if (p.tension >= 0.5) voice.push("tense");
  if (p.breathiness >= 0.4) voice.push("breathy");
  if (voice.length) out.push(sentence(`Voice: ${voice.join(", ")}`));

  const emotion = first && EMOTION_TAGS.includes(first.emotion) ? first.emotion : "";
  return { sentences: out.slice(0, 4), sounds: ph.breathlessness >= 0.7 ? ["out of breath"] : [], pace: p.pace, emotion };
}

const endSentence = (s: string) => (/[.!?;]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);

/**
 * The line as it should be sent: the director's own chips and note first, then what the performance plan adds.
 * A line with no plan (or an untouched one) is returned as it is, and the saved line is never changed.
 */
export function effectiveLine<T extends Pick<Line, "text" | "direction"> & { performance?: unknown; beats?: unknown; beatMode?: unknown }>(line: T, opts: { emphasis?: boolean } = {}): T {
  // Beats in "cues" mode are written into the text as tags in front of each phrase. In "assemble" mode the text is left alone: each phrase is spoken separately.
  const withBeats: T = hasBeats(line) && !isAssembled(line) ? { ...line, text: cueText(line, !!opts.emphasis).text } : line;
  const plan = migratePerformance(line.performance);
  if (!plan || isDefaultPerformance(plan)) return withBeats;
  line = withBeats;
  const c = compilePerformance(plan);
  const d: Direction = line.direction;
  const note = [d.note?.trim() ? endSentence(d.note) : "", ...c.sentences].filter(Boolean).join(" ");
  const speed = Number(Math.min(1.2, Math.max(0.7, d.speed * c.pace)).toFixed(2));
  return { ...line, direction: { ...d, emotion: d.emotion || c.emotion, note, sounds: [...new Set([...d.sounds, ...c.sounds])], speed } };
}

/** Whether a voice can act on the words of a plan, or only on its pace. Said to the owner so a plan is never silently ignored. */
export function planReach(canActOnWords: boolean, hasPlan: boolean): "words" | "pace" | null {
  return !hasPlan ? null : canActOnWords ? "words" : "pace";
}
