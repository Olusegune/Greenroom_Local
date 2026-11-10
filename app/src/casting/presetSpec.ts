// A preset's stated gender, age, language and accent, expressed as the same requirements the engine matches. Presets are archetypes:
// they say who a character is meant to be, not which voice to use, and they never claim a voice exists for them.

import type { VoicePreset } from "../presets/schema";
import { langKey } from "./lang";
import type { CastingSpec, Requirements, VocalAge } from "./types";

const BAND: Record<string, VocalAge> = { child: "child", teen: "teen", young_adult: "young", adult: "mid", middle_aged: "mid", older_adult: "old", elderly: "old" };

type PresetLike = Pick<VoicePreset, "gender" | "ageRange" | "language" | "accent"> & Partial<Pick<VoicePreset, "pitch" | "texture">>;

const bandsOf = (ageRange: readonly string[]): VocalAge[] => [...new Set(ageRange.map((a) => BAND[a]).filter((b): b is VocalAge => !!b))];

/** The casting spec a preset implies. Written onto a character only where the character has none. Accent is a preference; language is a rule unless it is plain English. */
export function specFromPreset(p: PresetLike): CastingSpec {
  const bands = bandsOf(p.ageRange);
  const spec: CastingSpec = { version: 1 };
  if (p.gender === "male") spec.vocalGender = "masculine";
  else if (p.gender === "female") spec.vocalGender = "feminine";
  if (bands.length) spec.vocalAge = bands;
  if (p.language) { spec.language = p.language; if (langKey(p.language) === "english") spec.languageStrictness = "preferred"; }
  if (p.accent.label && !["neutral", "general american"].includes(p.accent.label.toLowerCase())) { spec.accent = p.accent.label; spec.accentStrictness = "preferred"; }
  if (p.pitch) spec.pitch = p.pitch;
  return spec;
}

/** Requirements of a preset, for ranking voices for it before any character exists. */
export function requirementsFromPreset(p: PresetLike): Requirements {
  const s = specFromPreset(p);
  const r: Requirements = { empty: true };
  if (s.vocalGender === "masculine" || s.vocalGender === "feminine") r.gender = { value: s.vocalGender, strictness: "required", origin: "the preset" };
  if (s.vocalAge?.length) r.age = { value: s.vocalAge, strictness: "required", origin: "the preset" };
  if (s.language) r.language = { value: s.language, strictness: s.languageStrictness === "preferred" ? "preferred" : "required", origin: "the preset" };
  if (s.accent) r.accent = { value: s.accent, strictness: "preferred", origin: "the preset" };
  if (s.pitch) r.pitch = { value: s.pitch, strictness: "preferred", origin: "the preset" };
  r.empty = ![r.gender, r.age, r.language, r.accent].some((x) => x?.strictness === "required");
  return r;
}
