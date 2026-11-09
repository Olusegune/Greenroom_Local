// Compact authoring helper for the starter library. It only builds structured data; nothing here is shown as UI text.

import type { Age } from "../avatarLibrary";
import { STARTER_LICENSE, type AccentQuality, type Gender, type Genre, type Pitch, type PresetNeeds, type VoicePreset } from "./schema";

const AGE: Record<string, Age> = { c: "child", t: "teen", y: "young_adult", a: "adult", m: "middle_aged", o: "older_adult", e: "elderly", x: "ageless" };
const GENDER: Record<string, Gender | undefined> = { m: "male", f: "female", n: "nonbinary", "": undefined };

export interface Extra {
  /** Subgenres. */
  sub?: string[];
  /** Accent review label. Defaults to "model supported, unverified"; nothing here may claim review. */
  aq?: AccentQuality;
  needs?: PresetNeeds;
  culture?: string;
  /** projection, tension, breathiness (0-1). */
  feel?: [number, number, number];
}

/**
 * genre, slug, name, archetype, description, ages (letters: c t y a m o e x), gender (m f n or ""), language,
 * accent label, design prompt, emotional range (comma list), pitch, pace, texture, audition, tags (comma list).
 */
export function P(genre: Genre, slug: string, name: string, archetype: string, description: string, ages: string, gender: string, language: string, accent: string, designPrompt: string, range: string, pitch: Pitch, pace: number, texture: string, audition: string, tags: string, x: Extra = {}): VoicePreset {
  const emotions = range.split(",").map((s) => s.trim());
  const [projection, tension, breathiness] = x.feel ?? [0.5, 0.25, 0.15];
  return {
    schema: 1,
    id: `${genre}.${slug}`,
    version: 1,
    name,
    genre,
    subgenres: x.sub ?? [],
    archetype,
    description,
    tags: tags.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    ageRange: ages.split("").map((c) => AGE[c]).filter((a): a is Age => !!a),
    ...(GENDER[gender] ? { gender: GENDER[gender] } : {}),
    language,
    accent: { label: accent, quality: x.aq ?? "model_supported_unverified" },
    ...(x.culture ? { culture: x.culture } : {}),
    designPrompt,
    acting: { emotionalRange: emotions, direction: `Begin ${emotions[0]}; let ${emotions[1] ?? emotions[0]} show through; keep ${emotions[emotions.length - 1]} in reserve.`, pace, projection, tension, breathiness },
    pitch,
    texture,
    audition,
    needs: x.needs ?? { words: true },
    license: { ...STARTER_LICENSE },
    availability: "starter",
  };
}
