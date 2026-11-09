// Auditioning a preset with its own acting direction. It goes through the same planning code as a real take (`plan` in
// generate.ts), so what is sent follows the same rules, and anything the engine cannot carry is listed, never hidden.
// Only engines that read direction written into the text (ElevenLabs) get it in an audition: the audition preview route
// for the other engines sends plain words, and says so.

import { ENGINES, type InworldModel } from "../engines";
import { plan } from "../generate";
import { DEFAULT_PERFORMANCE, type PerformancePlan } from "../performance";
import type { Line, VoiceEntry } from "../types";
import type { VoicePreset } from "./schema";

export interface AuditionPlan {
  /** Exactly what the preview request will carry. */
  text: string;
  /** Whether the preset's direction is in it. */
  directed: boolean;
  /** What the preset asks for that this audition does not send, in plain words. */
  notSent: string[];
}

/** The preset's structured delivery as a performance plan: first feeling, pace, projection, tension and breathiness. */
export function presetPerformance(p: Pick<VoicePreset, "acting">): PerformancePlan {
  const first = p.acting.emotionalRange[0] ?? "neutral";
  const last = p.acting.emotionalRange[p.acting.emotionalRange.length - 1] ?? first;
  return {
    ...DEFAULT_PERFORMANCE,
    direction: p.acting.direction,
    arc: p.acting.emotionalRange.length > 1 ? [{ position: 0, emotion: first.toLowerCase(), intensity: 0.55 }, { position: 1, emotion: last.toLowerCase(), intensity: 0.55 }] : [{ position: 0, emotion: first.toLowerCase(), intensity: 0.55 }],
    pace: p.acting.pace, projection: p.acting.projection, tension: p.acting.tension, breathiness: p.acting.breathiness,
  };
}

export function auditionLine(p: Pick<VoicePreset, "audition" | "acting" | "id">): Line {
  return { id: `audition-${p.id}`, characterId: "audition", scene: 1, text: p.audition, direction: { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 }, takes: [], events: [], performance: presetPerformance(p) };
}

export function auditionPlan(p: VoicePreset, voice: Pick<VoiceEntry, "provider" | "id" | "name"> & Partial<VoiceEntry>, inworldModel?: InworldModel): AuditionPlan {
  const e = ENGINES[voice.provider];
  const line = auditionLine(p);
  // Only a voice that reads written direction in the text gets the direction in an audition.
  if (!e.tags || voice.provider === "inworld") {
    return { text: p.audition, directed: false, notSent: [`the preset's acting direction (${e.label} auditions are a plain read; the direction is used when you make a real take)`] };
  }
  const planned = plan(line, voice as VoiceEntry, "eleven_v4", [], { ...(inworldModel ? { inworldModel } : {}) });
  const notSent = [...(planned.notSent ?? [])];
  if (Math.abs(p.acting.pace - 1) > 0.02) notSent.push(`pace ×${p.acting.pace} (a preview has no speed setting)`);
  return { text: planned.text, directed: planned.text !== p.audition, notSent };
}
