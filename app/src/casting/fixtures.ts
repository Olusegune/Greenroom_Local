// Fixture voices and characters with KNOWN metadata, for the casting tests. Never imported by the app.

import type { Character, Line, Project, Take, VoiceEntry } from "../types";
import { applyMetaChange } from "./voiceProfile";
import type { VocalAge, VocalGender } from "./types";

export const NOW = "2026-11-10T09:00:00.000Z";

export const voice = (id: string, over: Partial<VoiceEntry> = {}): VoiceEntry => ({ id, name: id, provider: "elevenlabs", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: NOW, ...over });

/** A voice whose facts a person has confirmed by listening. */
export const listened = (v: VoiceEntry, facts: { gender?: VocalGender; age?: VocalAge; languages?: string[]; accent?: string; pitch?: "low" | "mid" | "high"; texture?: string }): VoiceEntry => applyMetaChange(v, { ...facts, listened: true, evidence: "fixture" }, NOW);

export const char = (id: string, name: string, over: Partial<Character> = {}): Character => ({ id, name, language: "English", ...over });

export const take = (id: string, voiceId: string, over: Partial<Take> = {}): Take => ({ id, at: NOW, model: "piper", ext: "wav", voiceId, sent: "x", seconds: 1, ...over });

export const line = (id: string, characterId: string, over: Partial<Line> = {}): Line => ({ id, characterId, scene: 0, text: "Hello there.", direction: { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0 }, takes: [], events: [], ...over });

export const project = (characters: Character[], lines: Line[] = []): Project => ({ id: "p-1", name: "Fixture", script: "", scenes: ["Scene 1"], characters, lines } as unknown as Project);

// A small library with known, listened-to facts.
export const ELDER_MAN = listened(voice("elder-man", { name: "Elder man", accent: "Nigerian" }), { gender: "masculine", age: "old", languages: ["english"], accent: "Nigerian" });
export const YORUBA_ELDER = listened(voice("elder_deji@yo", { name: "Deji (Yoruba)", provider: "wazobia", language: "yo", accent: "Nigerian" }), { gender: "masculine", age: "old", languages: ["yoruba"], accent: "Nigerian" });
export const WOMAN_MID_UK = listened(voice("woman-uk", { name: "Detective voice", accent: "British" }), { gender: "feminine", age: "mid", languages: ["english"], accent: "British" });
export const BOY_US = listened(voice("boy-us", { name: "Boy", accent: "American" }), { gender: "masculine", age: "child", languages: ["english"], accent: "American" });
export const TEEN_NG = listened(voice("teen-ng", { name: "Teen girl", accent: "Nigerian" }), { gender: "feminine", age: "teen", languages: ["english"], accent: "Nigerian" });
export const MAN_UK = listened(voice("man-uk", { name: "Aristocrat", accent: "British" }), { gender: "masculine", age: "mid", languages: ["english"], accent: "British" });
export const DEEP_WOMAN = listened(voice("deep-woman", { name: "Deep woman" }), { gender: "feminine", age: "mid", languages: ["english"], pitch: "low" });
export const HIGH_MAN = listened(voice("high-man", { name: "High man" }), { gender: "masculine", age: "young", languages: ["english"], pitch: "high" });
/** Gender and age stated by the provider but never listened to. */
export const CLAIMED_MAN = voice("claimed-man", { name: "Claimed man", gender: "male", age: "old", accent: "Nigerian" });
/** A Piper voice: its first name is NOT evidence of anything. */
export const PIPER_ALAN = voice("en_GB-alan-medium", { name: "Alan (British)", provider: "piper", accent: "British", gender: "male" });
export const KOKORO_F = voice("af_heart", { name: "Heart", provider: "kokoro", gender: "female", accent: "American" });
