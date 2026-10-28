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

export interface PhysicalState {
  activity: "still" | "walking" | "running" | "lifting" | "pushing" | "fighting" | "injured" | "cold" | "custom";
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
