// Voice presets: engine-independent descriptions of a kind of character voice (who, how they act, what an engine must
// be able to do). A preset is NOT a voice and carries no audio. It becomes playable only when the owner (or the cast
// recommender) pairs it with a real voice from an engine that is ready. Nothing here claims an accent is authentic:
// every accent carries a review label, and all starter presets are shipped as unverified.

import { CAPS } from "../engineCaps";
import { ENGINE_ORDER, type Engine } from "../engines";
import type { Age } from "../avatarLibrary";

export const PRESET_SCHEMA_VERSION = 1;

export const GENRES = ["film_tv", "games", "animation", "education", "audiobooks", "podcasts_radio", "advertising", "faith", "fantasy_horror_scifi", "corporate", "international", "family"] as const;
export type Genre = (typeof GENRES)[number];

export const GENRE_LABEL: Record<Genre, string> = {
  film_tv: "Film and television",
  games: "Video games",
  animation: "Animation and cartoons",
  education: "Education and instruction",
  audiobooks: "Audiobooks and storytelling",
  podcasts_radio: "Podcasts and radio",
  advertising: "Advertising and marketing",
  faith: "Faith and inspirational",
  fantasy_horror_scifi: "Fantasy, horror and science fiction",
  corporate: "Corporate and training",
  international: "International and multilingual",
  family: "Family and everyday life",
};

/** How far an accent label has been checked. Greenroom never raises this by itself; only a recorded human review can. */
export const ACCENT_QUALITY = ["native_reviewed", "community_reviewed", "model_supported_unverified", "experimental", "unsupported"] as const;
export type AccentQuality = (typeof ACCENT_QUALITY)[number];
export const ACCENT_QUALITY_LABEL: Record<AccentQuality, string> = {
  native_reviewed: "Native-speaker reviewed",
  community_reviewed: "Community reviewed",
  model_supported_unverified: "Model supported, unverified",
  experimental: "Experimental",
  unsupported: "Unsupported",
};

export type Gender = "male" | "female" | "nonbinary";
export type Pitch = "low" | "mid" | "high";
export type Availability = "starter" | "custom" | "imported";

/** What an engine must be able to do for the preset to be performed as written. */
export interface PresetNeeds {
  /** Acts on written delivery direction. */
  words?: boolean;
  /** Plays laughs, sighs, breaths from tags. */
  nonverbal?: boolean;
  /** Needs a cloned voice (a reference recording). Never implied by a starter preset. */
  cloning?: boolean;
  /** Only these engines declare support for the preset's language or accent in this code base. Absent means any engine that meets the other needs. */
  onlyEngines?: Engine[];
}

export interface PresetActing {
  /** Names from the Director's emotion list, in order of how often the character visits them. */
  emotionalRange: string[];
  /** The default written direction, in plain words. */
  direction: string;
  pace: number;
  projection: number;
  tension: number;
  breathiness: number;
}

export interface PresetLicense {
  /** What the preset itself is. Starter presets are Greenroom-authored text and numbers; no audio or model weights ship with them. */
  kind: "authored_text";
  author: string;
  /** Rights to a voice made from this preset belong to that voice's own engine and licence, never to the preset. */
  voiceRights: "defined_by_voice";
  note: string;
}

export interface VoicePreset {
  schema: typeof PRESET_SCHEMA_VERSION;
  id: string;
  version: number;
  name: string;
  genre: Genre;
  subgenres: string[];
  archetype: string;
  description: string;
  tags: string[];
  ageRange: Age[];
  /** Presentation of the voice, optional. Never inferred from anything else. */
  gender?: Gender;
  /** Language, accent, culture and appearance are separate fields. An accent never implies an appearance, or the reverse. */
  language: string;
  accent: { label: string; quality: AccentQuality };
  /** Cultural background of the character, when it matters to the story. Free text, optional, independent of the accent. */
  culture?: string;
  /** A voice-design prompt for engines that can design a voice from words. */
  designPrompt: string;
  acting: PresetActing;
  pitch: Pitch;
  texture: string;
  audition: string;
  needs: PresetNeeds;
  license: PresetLicense;
  /** An id from the avatar library when a suitable portrait already exists. Absent means a clean fallback is shown. Never an invented path. */
  portraitId?: string;
  availability: Availability;
  /** Marks a preset as a signature character that needs its own profile and assets to be complete. */
  signature?: string;
}

export const STARTER_LICENSE: PresetLicense = {
  kind: "authored_text",
  author: "Greenroom",
  voiceRights: "defined_by_voice",
  note: "A preset is a written description, not audio. Check the licence of the voice you pair it with.",
};

// ---- validation -------------------------------------------------------------------------------------------------

const ID = /^[a-z0-9][a-z0-9_.-]{1,62}$/;
const AGE_SET = new Set<string>(["child", "teen", "young_adult", "adult", "middle_aged", "older_adult", "elderly", "ageless"]);
const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const num = (v: unknown, d: number, lo = 0, hi = 2) => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
const strs = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.map((x) => clean(x, max)).filter(Boolean).slice(0, n) : []);

/** Checks a preset from outside (an import, a saved file) and returns a clean copy, or the reasons it was refused. Never throws. */
export function validatePreset(raw: unknown): { ok: true; preset: VoicePreset } | { ok: false; errors: string[] } {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object") return { ok: false, errors: ["not an object"] };
  const o = raw as Record<string, unknown>;
  const id = clean(o.id, 64);
  if (!ID.test(id)) errors.push("id must be 2-63 characters of a-z, 0-9, _ . -");
  const name = clean(o.name, 80);
  if (!name) errors.push("name is missing");
  const genre = o.genre as Genre;
  if (!GENRES.includes(genre)) errors.push("unknown genre");
  const language = clean(o.language, 60);
  if (!language) errors.push("language is missing");
  const accentRaw = (o.accent ?? {}) as Record<string, unknown>;
  const aq = accentRaw.quality as AccentQuality;
  if (!ACCENT_QUALITY.includes(aq)) errors.push("accent quality must be one of the five review labels");
  const ageRange = strs(o.ageRange, 8, 20).filter((a) => AGE_SET.has(a)) as Age[];
  if (!ageRange.length) errors.push("at least one age range is needed");
  const designPrompt = clean(o.designPrompt, 600);
  if (!designPrompt) errors.push("designPrompt is missing");
  const audition = clean(o.audition, 400);
  if (!audition) errors.push("audition script is missing");
  const a = (o.acting ?? {}) as Record<string, unknown>;
  const emotionalRange = strs(a.emotionalRange, 8, 40);
  if (!emotionalRange.length) errors.push("an emotional range is needed");
  const pitch = o.pitch as Pitch;
  if (!["low", "mid", "high"].includes(pitch)) errors.push("pitch must be low, mid or high");
  const needsRaw = (o.needs ?? {}) as Record<string, unknown>;
  const lic = (o.license ?? {}) as Record<string, unknown>;
  if (lic.kind !== "authored_text" || lic.voiceRights !== "defined_by_voice") errors.push("licence information is missing or claims rights this preset cannot grant");
  if (errors.length) return { ok: false, errors };
  const gender = o.gender === "male" || o.gender === "female" || o.gender === "nonbinary" ? o.gender : undefined;
  const availability: Availability = o.availability === "custom" || o.availability === "imported" ? o.availability : "starter";
  const preset: VoicePreset = {
    schema: PRESET_SCHEMA_VERSION,
    id,
    version: Math.max(1, Math.floor(num(o.version, 1, 1, 9999))),
    name,
    genre,
    subgenres: strs(o.subgenres, 6, 40),
    archetype: clean(o.archetype, 80),
    description: clean(o.description, 400),
    tags: strs(o.tags, 16, 30).map((t) => t.toLowerCase()),
    ageRange,
    ...(gender ? { gender } : {}),
    language,
    accent: { label: clean(accentRaw.label, 80), quality: aq },
    ...(clean(o.culture, 120) ? { culture: clean(o.culture, 120) } : {}),
    designPrompt,
    acting: { emotionalRange, direction: clean(a.direction, 300), pace: num(a.pace, 1, 0.5, 1.5), projection: num(a.projection, 0.5, 0, 1), tension: num(a.tension, 0.2, 0, 1), breathiness: num(a.breathiness, 0.15, 0, 1) },
    pitch,
    texture: clean(o.texture, 120),
    audition,
    needs: {
      ...(needsRaw.words === true ? { words: true } : {}),
      ...(needsRaw.nonverbal === true ? { nonverbal: true } : {}),
      ...(needsRaw.cloning === true ? { cloning: true } : {}),
      ...(Array.isArray(needsRaw.onlyEngines) ? { onlyEngines: needsRaw.onlyEngines.filter((e): e is Engine => ENGINE_ORDER.includes(e as Engine)) } : {}),
    },
    license: { kind: "authored_text", author: clean(lic.author, 80) || "unknown", voiceRights: "defined_by_voice", note: clean(lic.note, 300) },
    ...(clean(o.portraitId, 80) ? { portraitId: clean(o.portraitId, 80) } : {}),
    availability: availability,
    ...(clean(o.signature, 80) ? { signature: clean(o.signature, 80) } : {}),
  };
  return { ok: true, preset };
}

/** Brings an older saved preset forward. Version 1 is current, so this only validates; later versions add steps here. */
export function migratePreset(raw: unknown): VoicePreset | null {
  const r = validatePreset(raw);
  return r.ok ? r.preset : null;
}

// ---- compatibility and readiness --------------------------------------------------------------------------------

/** Engines whose declared capabilities meet what the preset needs. This says what an engine ACCEPTS, not how it sounds. */
export function compatibleEngines(p: Pick<VoicePreset, "needs">): Engine[] {
  return ENGINE_ORDER.filter((e) => {
    const c = CAPS[e];
    if (p.needs.words && !c.words) return false;
    if (p.needs.nonverbal && !c.nonverbal) return false;
    if (p.needs.cloning && !c.cloning) return false;
    if (p.needs.onlyEngines && !p.needs.onlyEngines.includes(e)) return false;
    return true;
  });
}

export type Readiness =
  | { state: "ready"; engines: Engine[] }
  | { state: "needs_voice"; engines: Engine[]; reason: string }
  | { state: "needs_engine"; engines: Engine[]; reason: string };

/**
 * Whether the preset can be auditioned now. `readyEngines` are engines that are installed or connected;
 * `voiceEngines` are the engines of voices already in the library. A preset with no compatible ready engine is never
 * playable, and the reason says what to set up.
 */
export function readiness(p: Pick<VoicePreset, "needs">, readyEngines: Engine[], voiceEngines: Engine[]): Readiness {
  const compat = compatibleEngines(p);
  const ready = compat.filter((e) => readyEngines.includes(e));
  if (!ready.length) return { state: "needs_engine", engines: compat, reason: "No installed or connected engine can perform this preset yet." };
  const withVoice = ready.filter((e) => voiceEngines.includes(e));
  if (!withVoice.length) return { state: "needs_voice", engines: ready, reason: "Requires voice selection: pick or design a voice on a compatible engine." };
  return { state: "ready", engines: withVoice };
}

// ---- search, filter, recommend ----------------------------------------------------------------------------------

export interface PresetFilter {
  query?: string;
  genre?: Genre;
  age?: Age;
  gender?: Gender;
  language?: string;
  accentQuality?: AccentQuality;
  /** Only presets an engine in this list can perform. */
  engines?: Engine[];
  favoritesOnly?: boolean;
}

const hay = (p: VoicePreset) => [p.name, p.archetype, p.description, p.language, p.accent.label, p.culture ?? "", p.genre, GENRE_LABEL[p.genre], ...p.tags, ...p.subgenres].join(" ").toLowerCase();

export function filterPresets(all: VoicePreset[], f: PresetFilter, favorites: ReadonlySet<string> = new Set()): VoicePreset[] {
  const words = (f.query ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  return all.filter((p) => {
    if (f.genre && p.genre !== f.genre) return false;
    if (f.age && !p.ageRange.includes(f.age)) return false;
    if (f.gender && p.gender !== f.gender) return false;
    if (f.language && p.language.toLowerCase() !== f.language.toLowerCase()) return false;
    if (f.accentQuality && p.accent.quality !== f.accentQuality) return false;
    if (f.favoritesOnly && !favorites.has(p.id)) return false;
    if (f.engines && !compatibleEngines(p).some((e) => f.engines!.includes(e))) return false;
    if (words.length) {
      const h = hay(p);
      if (!words.every((w) => h.includes(w))) return false;
    }
    return true;
  });
}

export interface Recommendation {
  preset: VoicePreset;
  score: number;
  why: string[];
}

/** Ranks presets for a character from what the script says about them. Never reads appearance into an accent. */
export function recommend(all: VoicePreset[], want: { genre?: Genre; age?: Age; gender?: Gender; language?: string; keywords?: string[]; private?: boolean }, readyEngines: Engine[] = []): Recommendation[] {
  const kw = (want.keywords ?? []).map((k) => k.toLowerCase()).filter(Boolean);
  const out: Recommendation[] = [];
  for (const p of all) {
    let score = 0;
    const why: string[] = [];
    if (want.genre) { if (p.genre === want.genre) { score += 3; why.push("same genre"); } else score -= 1; }
    if (want.age) { if (p.ageRange.includes(want.age)) { score += 3; why.push("fits the age"); } else score -= 3; }
    if (want.gender && p.gender) { if (p.gender === want.gender) { score += 2; why.push("matches the stated presentation"); } else score -= 3; }
    if (want.language) { if (p.language.toLowerCase() === want.language.toLowerCase()) { score += 2; why.push("same language"); } else score -= 1; }
    const h = hay(p);
    const hits = kw.filter((k) => h.includes(k));
    if (hits.length) { score += hits.length * 2; why.push(`matches ${hits.slice(0, 3).join(", ")}`); }
    const compat = compatibleEngines(p);
    const local = compat.filter((e) => !CAPS[e].cloud);
    if (want.private && !local.length) { score -= 100; why.push("needs a cloud engine, ruled out for private text"); }
    if (readyEngines.length && !compat.some((e) => readyEngines.includes(e))) { score -= 1; why.push("no ready engine yet"); }
    out.push({ preset: p, score, why });
  }
  return out.filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.preset.name.localeCompare(b.preset.name));
}

// ---- export, import, duplicate ----------------------------------------------------------------------------------

export const PRESET_FILE = "greenroom.voice-presets";

export function exportPresets(presets: VoicePreset[]): string {
  return JSON.stringify({ format: PRESET_FILE, schema: PRESET_SCHEMA_VERSION, presets }, null, 2);
}

/** Reads an exported file. Imported presets are marked as imported and may never overwrite a starter preset's id. */
export function importPresets(json: string, takenIds: ReadonlySet<string>): { presets: VoicePreset[]; skipped: { id: string; reason: string }[] } {
  const skipped: { id: string; reason: string }[] = [];
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { presets: [], skipped: [{ id: "", reason: "not valid JSON" }] }; }
  const d = data as { format?: unknown; presets?: unknown };
  if (!d || d.format !== PRESET_FILE || !Array.isArray(d.presets)) return { presets: [], skipped: [{ id: "", reason: "not a Greenroom preset file" }] };
  const taken = new Set(takenIds);
  const presets: VoicePreset[] = [];
  for (const raw of d.presets.slice(0, 500)) {
    const r = validatePreset(raw);
    if (!r.ok) { skipped.push({ id: clean((raw as { id?: unknown })?.id, 64), reason: r.errors.join("; ") }); continue; }
    let id = r.preset.id;
    if (taken.has(id)) id = uniqueId(id + "-imported", taken);
    taken.add(id);
    presets.push({ ...r.preset, id, availability: "imported", signature: undefined });
  }
  return { presets, skipped };
}

export function uniqueId(base: string, taken: ReadonlySet<string>): string {
  const b = base.slice(0, 56);
  if (!taken.has(b)) return b;
  for (let i = 2; i < 1000; i++) if (!taken.has(`${b}-${i}`)) return `${b}-${i}`;
  return `${b}-${Date.now()}`;
}

/** A copy the owner can edit. Starter presets are never changed in place. */
export function duplicatePreset(p: VoicePreset, taken: ReadonlySet<string>, name?: string): VoicePreset {
  return { ...p, id: uniqueId(`custom-${p.id}`, taken), name: name?.trim() || `${p.name} (copy)`, version: 1, availability: "custom", signature: undefined, license: { ...p.license } };
}
