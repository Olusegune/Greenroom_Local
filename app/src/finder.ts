// Finding voices across engines for one language tile. The matching rules are pure so they can be tested; the network
// calls live in the Voices screen.

import type { PiperVoice } from "./api";
import { ENGINES, KIE_VOICES, type Engine } from "./engines";
import { localeMatches, type Tile } from "./languages";

export interface Found {
  engine: Engine;
  id: string;
  name: string;
  /** Language or locale as the engine states it. */
  language: string;
  accent: string;
  gender: string;
  description: string;
  previewUrl?: string | null;
  /** ElevenLabs shared-library owner id, needed to add the voice. */
  owner?: string | null;
  /** Piper: size to download. */
  sizeMb?: number;
  quality?: string;
}

/** Languages ElevenLabs Turbo 2.5 (the model Kie runs) speaks. Its preset voices are multilingual. */
const KIE_LANGS = new Set(["en", "ja", "zh", "de", "hi", "fr", "ko", "pt", "it", "es", "id", "nl", "tr", "fil", "pl", "sv", "bg", "ro", "ar", "cs", "el", "fi", "hr", "ms", "sk", "da", "ta", "uk", "ru", "hu", "no", "vi"]);

export function kieFor(t: Tile): Found[] {
  if (!KIE_LANGS.has(t.lang) || t.mixed) return [];
  return KIE_VOICES.map((v) => ({ engine: "kie" as const, id: v.id, name: v.name, language: t.lang, accent: "", gender: "", description: v.style || "Preset voice", previewUrl: `https://static.aiquickdraw.com/elevenlabs/voice/${v.id}.mp3` }));
}

export function voicekillerFor(t: Tile, all: { name: string; language: string }[]): Found[] {
  return all.filter((v) => localeMatches(t, v.language)).map((v) => ({ engine: "voicekiller" as const, id: v.name, name: v.name, language: v.language, accent: "", gender: "", description: "" }));
}

export function piperFor(t: Tile, all: PiperVoice[]): Found[] {
  if (t.mixed) return [];
  return all.filter((v) => localeMatches(t, v.code)).map((v) => ({ engine: "piper" as const, id: v.key, name: v.name, language: v.code, accent: v.country, gender: "", description: `${v.quality} quality`, sizeMb: v.sizeMb, quality: v.quality }));
}

export const isFree = (engine: Engine) => ENGINES[engine].local;
