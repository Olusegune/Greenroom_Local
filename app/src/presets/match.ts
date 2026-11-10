// How well a library voice fits a preset's character. The preset says who the character is (gender, age, language, accent); the
// casting integrity engine (casting/engine.ts) decides whether a voice fits. This file only translates a preset into requirements
// and the engine's status into the three words the preset card shows. There are no separate matching rules here: nothing is
// guessed from a voice's name or from words in its description, and an unknown fact is never proof of a fit.

import { requirementsFromPreset } from "../casting/presetSpec";
import { evaluate, summaryOf } from "../casting/engine";
import { profileOf } from "../casting/voiceProfile";
import { STATUS_ORDER, type MatchContext, type MatchResult, type MatchStatus, type VocalAge } from "../casting/types";
import type { VoiceEntry } from "../types";
import type { VoicePreset } from "./schema";

export type Fit = "good" | "partial" | "poor";

export interface VoiceFit {
  voice: VoiceEntry;
  fit: Fit;
  score: number;
  status: MatchStatus;
  result: MatchResult;
  /** Plain-words reasons, for the screen. */
  notes: string[];
}

type Band = VocalAge;
const BAND: Record<string, Band> = { child: "child", teen: "teen", young_adult: "young", adult: "mid", middle_aged: "mid", older_adult: "old", elderly: "old" };

/** The gender a voice RECORDS (the owner's or a provider's statement, never its name). */
export function voiceGender(v: VoiceEntry): "m" | "f" | undefined {
  const g = profileOf(v).gender.value;
  return g === "masculine" ? "m" : g === "feminine" ? "f" : undefined;
}

/** The age band a voice RECORDS. Never read from its description. */
export function voiceAge(v: VoiceEntry): Band | undefined {
  return profileOf(v).age.value ?? undefined;
}

export function presetBands(ageRange: readonly string[]): Band[] {
  return [...new Set(ageRange.map((a) => BAND[a]).filter((b): b is Band => !!b))];
}

const FIT_OF: Record<MatchStatus, Fit> = { VERIFIED_MATCH: "good", COMPATIBLE_WITH_LIMITATIONS: "partial", NEEDS_AUDITION: "partial", UNKNOWN_METADATA: "partial", INCOMPATIBLE: "poor", UNAVAILABLE: "poor" };

/** Compares one voice with a preset, using the casting engine. */
export function fitOf(preset: Pick<VoicePreset, "gender" | "ageRange" | "language" | "accent"> & Partial<Pick<VoicePreset, "pitch" | "texture">>, voice: VoiceEntry, ctx: MatchContext = {}): VoiceFit {
  const result = evaluate(requirementsFromPreset(preset), profileOf(voice), ctx);
  const notes = result.reasons.filter((r) => r.outcome !== "match" && r.outcome !== "info" || r.attribute === "requirements").map((r) => r.text);
  return { voice, fit: FIT_OF[result.status], score: result.score, status: result.status, result, notes: notes.length ? notes : [summaryOf(result)] };
}

/** Every voice compared and ordered best first (ties keep the library's order). */
export function rankVoices(preset: Pick<VoicePreset, "gender" | "ageRange" | "language" | "accent"> & Partial<Pick<VoicePreset, "pitch" | "texture">>, voices: VoiceEntry[], ctx: MatchContext = {}): VoiceFit[] {
  return voices.map((v, i) => ({ f: fitOf(preset, v, ctx), i })).sort((a, b) => STATUS_ORDER.indexOf(a.f.status) - STATUS_ORDER.indexOf(b.f.status) || b.f.score - a.f.score || a.i - b.i).map((x) => x.f);
}

export const FIT_LABEL: Record<Fit, string> = { good: "Fits", partial: "Could fit", poor: "Does not fit" };
