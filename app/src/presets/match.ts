// How well a library voice fits a preset's character. The preset says who the character is (gender, age, language, accent);
// the voice library says who each voice is. Only what each side STATES is compared: nothing is guessed from a name, and a voice
// that states nothing is "unknown", not a mismatch. This is what orders the "Hear with" list and picks the default voice.

import { pipergender, readVoice } from "../avatarLibrary";
import type { VoiceEntry } from "../types";
import type { VoicePreset } from "./schema";

export type Fit = "good" | "partial" | "poor";

export interface VoiceFit {
  voice: VoiceEntry;
  fit: Fit;
  score: number;
  /** Plain-words reasons, for the screen. */
  notes: string[];
}

type Band = NonNullable<VoiceEntry["age"]>;
const BAND: Record<string, Band> = { child: "child", teen: "teen", young_adult: "young", adult: "mid", middle_aged: "mid", older_adult: "old", elderly: "old" };
const BAND_WORD: Record<Band, string> = { child: "a child", teen: "a teenager", young: "a young adult", mid: "an adult", old: "an older person" };
const ORDER: Band[] = ["child", "teen", "young", "mid", "old"];

const CODE: Record<string, string> = { en: "english", es: "spanish", fr: "french", de: "german", pt: "portuguese", it: "italian", nl: "dutch", pl: "polish", ru: "russian", tr: "turkish", ar: "arabic", hi: "hindi", zh: "chinese", ja: "japanese", ko: "korean", yo: "yoruba", ha: "hausa", ig: "igbo", sw: "swahili", pcm: "pidgin" };
/** The first word of a language, with two-letter codes (en, es, yo) read as their names, so "en" and "English" are the same language. */
const first = (s: string | undefined) => {
  const w = (s ?? "").trim().toLowerCase().split(/[\s,(/_-]+/)[0] ?? "";
  return CODE[w] ?? w;
};

/** The gender a voice states: its own field, else (for local voices) the table of known voices. Never from the name. */
export function voiceGender(v: Pick<VoiceEntry, "gender" | "id" | "provider" | "notes" | "accent">): "m" | "f" | undefined {
  const t = v.gender.trim().toLowerCase();
  if (/^f/.test(t)) return "f";
  if (/^m(?!i)/.test(t) || t === "male") return "m";
  if (t) return undefined; // "neutral", "nonbinary": stated, but not one of the two
  const piper = v.provider === "piper" ? pipergender(v.id) : undefined;
  return piper ?? readVoice("", v.notes).g;
}

/** The age band a voice states (its field, else its own description). */
export function voiceAge(v: Pick<VoiceEntry, "age" | "notes">): Band | undefined {
  if (v.age) return v.age;
  const a = readVoice("", v.notes).age;
  return a === "child" || a === "teen" || a === "young" || a === "mid" || a === "old" ? a : undefined;
}

export function presetBands(ageRange: readonly string[]): Band[] {
  return [...new Set(ageRange.map((a) => BAND[a]).filter((b): b is Band => !!b))];
}

/** Compares one voice with a preset. */
export function fitOf(preset: Pick<VoicePreset, "gender" | "ageRange" | "language" | "accent">, voice: VoiceEntry): VoiceFit {
  let score = 0;
  let hard = false;
  const notes: string[] = [];
  const wantG = preset.gender === "male" ? "m" : preset.gender === "female" ? "f" : undefined;
  const haveG = voiceGender(voice);
  if (wantG && haveG) {
    if (wantG === haveG) {
      score += 50;
    } else {
      score -= 100;
      hard = true;
      notes.push(`${voice.name} is a ${haveG === "m" ? "male" : "female"} voice; this preset is ${wantG === "m" ? "a man" : "a woman"}.`);
    }
  } else if (wantG) notes.push(`${voice.name} does not say whether it is a male or female voice.`);
  const want = presetBands(preset.ageRange);
  const haveA = voiceAge(voice);
  if (want.length && haveA) {
    if (want.includes(haveA)) score += 25;
    else {
      const gap = Math.min(...want.map((w) => Math.abs(ORDER.indexOf(w) - ORDER.indexOf(haveA))));
      score -= gap >= 3 || haveA === "child" || want.every((w) => w === "child") ? 100 : 25 * gap;
      if (gap >= 3 || haveA === "child" || want.every((w) => w === "child")) hard = true;
      notes.push(`${voice.name} sounds like ${BAND_WORD[haveA]}; this preset is ${want.map((w) => BAND_WORD[w]).join(" or ")}.`);
    }
  }
  const lang = first(preset.language);
  if (lang && first(voice.language)) {
    if (first(voice.language) === lang) score += 10;
    else {
      score -= 30;
      notes.push(`${voice.name} speaks ${voice.language}; this preset is ${preset.language}.`);
    }
  }
  const accentWords = preset.accent.label.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 3 && !["general", "neutral", "standard", "english"].includes(w));
  const hay = `${voice.accent} ${voice.notes}`.toLowerCase();
  if (accentWords.length && accentWords.some((w) => hay.includes(w))) score += 15;
  const fit: Fit = hard || score < 0 ? "poor" : score >= 40 ? "good" : "partial";
  return { voice, fit, score, notes };
}

/** Every voice compared and ordered best first (ties keep the library's order). */
export function rankVoices(preset: Pick<VoicePreset, "gender" | "ageRange" | "language" | "accent">, voices: VoiceEntry[]): VoiceFit[] {
  return voices.map((v, i) => ({ f: fitOf(preset, v), i })).sort((a, b) => b.f.score - a.f.score || a.i - b.i).map((x) => x.f);
}

export const FIT_LABEL: Record<Fit, string> = { good: "Fits", partial: "Could fit", poor: "Does not fit" };
