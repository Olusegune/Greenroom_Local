// Character Voice DNA: what stays true about a recurring character across lines, episodes and projects. It lives on the
// character and travels with a saved cast, so a series keeps its voices. It is a record and a set of reminders and
// starting points (preferred presets, pronunciations, approved reference takes). It does not promise that another
// engine will sound like the same person, and it says so when the engine changes.

import { analyzeSamples, type TakeStats } from "./analysis";
import { ENGINES, type Engine } from "./engines";
import type { Pronunciation, VoiceEntry } from "./types";

export const DNA_VERSION = 1;
export const MAX_REFERENCES = 6;

export interface ActingReference {
  id: string;
  takeId: string;
  lineId: string;
  at: string;
  /** The words of the approved line, for the owner's reference. */
  text: string;
  seconds: number;
  sha256: string | null;
  engine: Engine;
  voiceId: string;
  voiceName: string;
  modelId: string | null;
  stats: TakeStats;
}

export interface VoiceIdentity {
  engine: Engine;
  voiceId: string;
  voiceName: string;
  modelId: string | null;
}

export interface VoiceDna {
  version: typeof DNA_VERSION;
  timbre: string;
  accent: string;
  tendencies: string;
  /** The feelings this character has and hides, in the owner's words. */
  range: string;
  /** Acting preset ids this character usually suits. */
  presets: string[];
  /** Spoken forms for this character only (a name only they say, an accent habit). */
  pronunciations: Pronunciation[];
  references: ActingReference[];
  /** The voice the owner approved for this character. Changing engine or voice later raises a warning. */
  identity: VoiceIdentity | null;
}

export const emptyDna = (): VoiceDna => ({ version: DNA_VERSION, timbre: "", accent: "", tendencies: "", range: "", presets: [], pronunciations: [], references: [], identity: null });

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const finite = (v: unknown, d = 0) => (typeof v === "number" && Number.isFinite(v) ? v : d);

function stats(v: unknown): TakeStats | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const contour = Array.isArray(o.pitchContour) ? o.pitchContour.slice(0, 8).map((x) => (typeof x === "number" && Number.isFinite(x) ? x : null)) : [];
  return {
    seconds: finite(o.seconds),
    speechSeconds: finite(o.speechSeconds),
    words: finite(o.words),
    wordsPerSecond: finite(o.wordsPerSecond),
    leadSilence: finite(o.leadSilence),
    trailSilence: finite(o.trailSilence),
    pausesMs: Array.isArray(o.pausesMs) ? o.pausesMs.filter((x): x is number => typeof x === "number" && Number.isFinite(x)).slice(0, 40) : [],
    levelDb: finite(o.levelDb, -120),
    liveliness: finite(o.liveliness),
    pitchHz: typeof o.pitchHz === "number" && Number.isFinite(o.pitchHz) ? o.pitchHz : null,
    pitchContour: [...contour, ...Array(8)].slice(0, 8).map((x) => (typeof x === "number" ? x : null)),
    pitchRangeSemitones: typeof o.pitchRangeSemitones === "number" && Number.isFinite(o.pitchRangeSemitones) ? o.pitchRangeSemitones : null,
  };
}

const isEngine = (e: unknown): e is Engine => typeof e === "string" && e in ENGINES;

/** A profile read from saved data with every value checked. Missing or damaged parts fall back to empty. */
export function migrateDna(raw: unknown): VoiceDna | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const id = r.identity as Record<string, unknown> | null | undefined;
  return {
    version: DNA_VERSION,
    timbre: text(r.timbre, 200),
    accent: text(r.accent, 80),
    tendencies: text(r.tendencies, 400),
    range: text(r.range, 300),
    presets: Array.isArray(r.presets) ? [...new Set(r.presets.filter((p): p is string => typeof p === "string" && /^[a-z-]{1,40}$/.test(p)))].slice(0, 12) : [],
    pronunciations: Array.isArray(r.pronunciations)
      ? r.pronunciations.map((p) => ({ from: text((p as Record<string, unknown>)?.from, 60), to: text((p as Record<string, unknown>)?.to, 60) })).filter((p) => p.from && p.to).slice(0, 100)
      : [],
    references: (Array.isArray(r.references) ? r.references : [])
      .map((x): ActingReference | null => {
        const o = (x ?? {}) as Record<string, unknown>;
        const s = stats(o.stats);
        if (!s || !isEngine(o.engine) || typeof o.takeId !== "string") return null;
        return { id: text(o.id, 40) || text(o.takeId, 40), takeId: text(o.takeId, 60), lineId: text(o.lineId, 60), at: text(o.at, 40), text: text(o.text, 300), seconds: finite(o.seconds), sha256: typeof o.sha256 === "string" ? o.sha256.slice(0, 64) : null, engine: o.engine, voiceId: text(o.voiceId, 160), voiceName: text(o.voiceName, 80), modelId: typeof o.modelId === "string" ? text(o.modelId, 60) : null, stats: s };
      })
      .filter((x): x is ActingReference => x !== null)
      .slice(0, MAX_REFERENCES),
    identity: id && isEngine(id.engine) && typeof id.voiceId === "string" ? { engine: id.engine, voiceId: text(id.voiceId, 160), voiceName: text(id.voiceName, 80), modelId: typeof id.modelId === "string" ? text(id.modelId, 60) : null } : null,
  };
}

export const setIdentity = (dna: VoiceDna | undefined, v: Pick<VoiceEntry, "provider" | "id" | "name">, modelId: string | null): VoiceDna => ({ ...(dna ?? emptyDna()), identity: { engine: v.provider, voiceId: v.id, voiceName: v.name, modelId } });

/** Adds an approved take as a reference. The newest are kept when there are too many. */
export function addReference(dna: VoiceDna | undefined, ref: ActingReference): VoiceDna {
  const d = dna ?? emptyDna();
  return { ...d, references: [ref, ...d.references.filter((r) => r.takeId !== ref.takeId)].slice(0, MAX_REFERENCES) };
}

export const removeReference = (dna: VoiceDna, takeId: string): VoiceDna => ({ ...dna, references: dna.references.filter((r) => r.takeId !== takeId) });

export function makeReference(a: { takeId: string; lineId: string; at: string; text: string; seconds: number; sha256: string | null; voice: Pick<VoiceEntry, "provider" | "id" | "name">; modelId: string | null; samples: Float32Array; rate: number; words: number }): ActingReference {
  return { id: a.takeId, takeId: a.takeId, lineId: a.lineId, at: a.at, text: a.text.slice(0, 300), seconds: a.seconds, sha256: a.sha256, engine: a.voice.provider, voiceId: a.voice.id, voiceName: a.voice.name, modelId: a.modelId, stats: analyzeSamples(a.samples, a.rate, a.words) };
}

/**
 * A warning when the voice now on a character is not the one the owner approved. Identity depends on the voice and the
 * engine, and different engines do not reproduce one another, so nothing here claims the sound will match.
 */
export function identityWarning(dna: VoiceDna | undefined, now: Pick<VoiceEntry, "provider" | "id" | "name"> | undefined, nowModelId: string | null = null): string | null {
  const id = dna?.identity;
  if (!id || !now) return null;
  if (id.engine !== now.provider) return `This character was approved with ${ENGINES[id.engine].label} (${id.voiceName}). ${ENGINES[now.provider].label} is a different engine, so they can sound like a different person even with the same direction. Listen again and re-approve.`;
  if (id.voiceId !== now.id) return `This character was approved with the voice ${id.voiceName}. ${now.name} is a different voice, so their identity will change.`;
  if (id.modelId && nowModelId && id.modelId !== nowModelId) return `This character was approved on ${id.modelId}. ${nowModelId} can change how the voice sounds and what direction it follows.`;
  return null;
}

/** The pronunciations to use for one character: the project's own, then theirs. A character's rule wins over a project rule for the same word. */
export function dictFor(project: Pronunciation[], dna: VoiceDna | undefined): Pronunciation[] {
  const own = dna?.pronunciations ?? [];
  const mine = new Set(own.map((p) => p.from.toLowerCase()));
  return [...project.filter((p) => !mine.has(p.from.toLowerCase())), ...own];
}
