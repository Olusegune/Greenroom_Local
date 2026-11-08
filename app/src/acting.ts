// Acting presets and interpretations. Both are only ever settings on a line's performance plan (see performance.ts), so
// they reach a voice the same way a hand-made plan does and are told honestly when a voice cannot act on words.
// None of the wording below has been judged by ear yet.

import { DEFAULT_PERFORMANCE, effectiveLine, migratePerformance, type PerformancePlan, type PerformancePoint } from "./performance";
import type { Line } from "./types";

export interface ActingPreset {
  id: string;
  label: string;
  blurb: string;
  /** What the preset sets. Objective and subtext are never touched: they belong to the scene. */
  set: Partial<Pick<PerformancePlan, "direction" | "pace" | "projection" | "tension" | "breathiness">> & { arc?: [PerformancePoint, PerformancePoint]; physical?: Partial<PerformancePlan["physical"]> };
}

const arc = (a: string, ai: number, b: string, bi: number): [PerformancePoint, PerformancePoint] => [{ position: 0, emotion: a, intensity: ai }, { position: 1, emotion: b, intensity: bi }];

export const ACTING_PRESETS: ActingPreset[] = [
  { id: "bureaucratic-sarcasm", label: "British bureaucratic sarcasm", blurb: "Dry, clipped and politely contemptuous.", set: { direction: "Educated British bureaucrat, dry and clipped, politely contemptuous", arc: arc("sarcastic", 0.5, "sarcastic", 0.6), pace: 0.95, projection: 0.4, tension: 0.3 } },
  { id: "suppressed-grief", label: "Suppressed grief", blurb: "Holding back tears; the voice catches.", set: { direction: "Holding back tears, the voice catching, restraint", arc: arc("sad", 0.6, "sad", 0.8), pace: 0.85, projection: 0.25, tension: 0.5, breathiness: 0.5 } },
  { id: "controlled-anger", label: "Controlled anger", blurb: "Low and deliberate, barely contained.", set: { direction: "Low and deliberate, barely contained", arc: arc("angry", 0.6, "angry", 0.8), pace: 0.95, projection: 0.45, tension: 0.8 } },
  { id: "cold-menace", label: "Cold menace", blurb: "Quiet, slow and chilling, with no warmth.", set: { direction: "Quiet, slow and unhurried, flat and chilling, no warmth", arc: arc("neutral", 0.4, "angry", 0.4), pace: 0.85, projection: 0.25, tension: 0.6, breathiness: 0.1 } },
  { id: "quiet-tenderness", label: "Quiet tenderness", blurb: "Soft and warm, close to the microphone.", set: { direction: "Soft and warm, close and intimate", arc: arc("tender", 0.6, "tender", 0.7), pace: 0.9, projection: 0.2, breathiness: 0.55 } },
  { id: "frightened-whisper", label: "Frightened whisper", blurb: "Barely audible, the breath shaking.", set: { direction: "A frightened whisper, barely audible, the breath shaking", arc: arc("scared", 0.7, "scared", 0.85), pace: 1, projection: 0.1, tension: 0.6, breathiness: 0.8 } },
  { id: "emotional-confession", label: "Emotional confession", blurb: "Halting and truthful, gathering courage.", set: { direction: "Halting and truthful, stopping to gather courage", arc: arc("nervous", 0.5, "sad", 0.7), pace: 0.85, projection: 0.3, tension: 0.5, breathiness: 0.4 } },
  { id: "physical-exhaustion", label: "Physical exhaustion", blurb: "Drained, breathing hard, nothing left.", set: { direction: "Utterly exhausted, nothing left", arc: arc("tired", 0.8, "tired", 0.9), physical: { activity: "custom", note: "utterly exhausted", fatigue: 0.9, breathlessness: 0.5, effort: 0.4 }, pace: 0.8, projection: 0.25 } },
  { id: "comedic-deadpan", label: "Comedic deadpan", blurb: "Flat and perfectly serious.", set: { direction: "Flat deadpan, perfectly serious, no sign of a joke", arc: arc("neutral", 0.3, "neutral", 0.3), pace: 1, projection: 0.5, tension: 0.1, breathiness: 0.1 } },
  { id: "inspirational-narration", label: "Inspirational narration", blurb: "Warm and rising, building to the last phrase.", set: { direction: "Warm, confident narrator, rising and building to the last phrase", arc: arc("happy", 0.5, "excited", 0.6), pace: 0.95, projection: 0.75 } },
  { id: "cinematic-documentary", label: "Cinematic documentary", blurb: "Measured, authoritative, calm gravity.", set: { direction: "Measured authoritative documentary narrator, calm gravity", arc: arc("neutral", 0.4, "neutral", 0.4), pace: 0.9, projection: 0.65, tension: 0.2 } },
  { id: "childlike-wonder", label: "Childlike wonder", blurb: "Wide-eyed, light, quick and breathless.", set: { direction: "Wide-eyed wonder, light and quick, a little breathless", arc: arc("excited", 0.6, "happy", 0.7), pace: 1.1, projection: 0.6, breathiness: 0.3 } },
];

/** A line's plan with a preset laid over it. The line's own objective and subtext are kept. */
export function applyPreset(current: PerformancePlan | undefined, preset: ActingPreset): PerformancePlan {
  const base = migratePerformance(current) ?? DEFAULT_PERFORMANCE;
  const s = preset.set;
  return {
    ...base,
    direction: s.direction ?? base.direction,
    arc: s.arc ? [...s.arc] : base.arc,
    physical: { ...base.physical, ...(s.physical ?? {}) },
    pace: s.pace ?? base.pace,
    projection: s.projection ?? base.projection,
    tension: s.tension ?? base.tension,
    breathiness: s.breathiness ?? base.breathiness,
  };
}

// ---- Four interpretations of the same line ----

export type VariationId = "natural" | "restrained" | "expressive" | "intense";

export const VARIATIONS: { id: VariationId; label: string; blurb: string }[] = [
  { id: "natural", label: "Natural", blurb: "Exactly as planned." },
  { id: "restrained", label: "Restrained", blurb: "Understated: the feeling held back." },
  { id: "expressive", label: "Expressive", blurb: "Open: a wider range of feeling." },
  { id: "intense", label: "Intense", blurb: "Pushed close to the limit of control." },
];

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const round = (n: number) => Number(n.toFixed(2));

/** The same line with its plan turned down or up. The saved line is never changed. Natural returns it untouched. */
export function applyVariation(line: Line, v: VariationId): Line {
  if (v === "natural") return line;
  const base = migratePerformance(line.performance) ?? DEFAULT_PERFORMANCE;
  const k = v === "restrained" ? 0.6 : v === "expressive" ? 1.3 : 1.6;
  const extra = v === "restrained" ? "Understated and held back" : v === "expressive" ? "Open and expressive, a wide range" : "Intense, pushed close to the limit of control";
  const plan: PerformancePlan = {
    ...base,
    direction: [base.direction.replace(/[.!?]+$/, ""), extra].filter(Boolean).join(". "),
    arc: base.arc.map((p) => ({ ...p, intensity: round(clamp01(p.intensity * k)) })),
    projection: round(clamp01(base.projection + (v === "restrained" ? -0.15 : v === "expressive" ? 0.1 : 0.2))),
    tension: round(clamp01(base.tension + (v === "restrained" ? -0.1 : v === "intense" ? 0.25 : 0))),
    pace: round(Math.min(1.2, Math.max(0.7, base.pace * (v === "restrained" ? 0.95 : v === "intense" ? 1.05 : 1)))),
  };
  return { ...line, performance: plan };
}

/** What the line will be sent as, for a given interpretation. */
export const variationLine = (line: Line, v: VariationId): Line => effectiveLine(applyVariation(line, v));
