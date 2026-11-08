// The Cinematic Performance Manifest: one versioned JSON file that says who spoke each line, with which voice and model,
// how it was directed, and which take was chosen. It is built only from what the project already records. Anything
// Greenroom does not know (word timing, phoneme timing) is written as null, never guessed.
// Designed to be read by other tools later; nothing in this file is sent anywhere.

import { chosenTake } from "./direct";
import { migratePerformance, type PerformancePlan } from "./performance";
import type { Consent, Project, Take, VoiceEntry } from "./types";

export const MANIFEST_SCHEMA = "greenroom.cinematic-performance";
export const MANIFEST_VERSION = 1;

export interface ManifestVoice {
  id: string;
  name: string;
  engine: string;
  source: string;
  language: string;
  accent: string;
  /** Inworld: system, cloned or designed, as the provider states it. */
  consent: Consent | null;
  licence: string | null;
}

export interface ManifestTake {
  id: string;
  /** The file name inside the project's takes folder. */
  file: string;
  seconds: number;
  sha256: string | null;
  madeAt: string;
  engine: string;
  /** The cloud model that spoke the line, when the engine has more than one. */
  modelId: string | null;
  /** Exactly what was sent to the voice, so the take can always be explained. */
  sent: string;
  /** Delivery instructions that were sent (Inworld steering) and sounds that were sent as tags. */
  steering: string[];
  nonverbalTags: string[];
  /** Things the line asked for that this voice could not be given. Disclosed, never hidden. */
  notSent: string[];
  characters: number;
}

export interface ManifestLine {
  lineId: string;
  scene: number;
  order: number;
  characterId: string;
  characterName: string;
  /** The line exactly as written in the script. */
  text: string;
  direction: { emotion: string; note: string; sounds: string[]; speed: number; pauseAfterSeconds: number; gainDb: number };
  /** The director's performance plan for the line, as saved, or null. */
  performance: PerformancePlan | null;
  cueSeconds: number | null;
  voice: ManifestVoice | null;
  take: ManifestTake | null;
  takeCount: number;
  /** Not measured by Greenroom, so null. */
  wordTiming: null;
  phonemeTiming: null;
}

export interface Manifest {
  schema: typeof MANIFEST_SCHEMA;
  version: typeof MANIFEST_VERSION;
  generatedBy: string;
  generatedAt: string;
  project: { id: string; name: string; scenes: string[] };
  characters: { id: string; name: string; voiceId: string | null }[];
  lines: ManifestLine[];
  notes: string[];
}

const voiceOf = (v: VoiceEntry | undefined): ManifestVoice | null =>
  v ? { id: v.id, name: v.name, engine: v.provider, source: v.source, language: v.language, accent: v.accent, consent: v.consent ?? null, licence: v.licence && v.licence !== "unknown" ? v.licence : null } : null;

const takeOf = (t: Take | undefined): ManifestTake | null =>
  t
    ? {
        id: t.id,
        file: `${t.id}.${t.ext}`,
        seconds: t.seconds,
        sha256: t.provenance?.sha256 ?? null,
        madeAt: t.at,
        engine: t.provenance?.engine ?? t.model,
        modelId: t.provenance?.modelId ?? null,
        sent: t.sent,
        steering: t.provenance?.steering ?? [],
        nonverbalTags: t.provenance?.nonverbal ?? [],
        notSent: t.provenance?.notSent ?? [],
        characters: t.provenance?.chars ?? t.sent.length,
      }
    : null;

export function buildManifest(project: Project, library: VoiceEntry[], appVersion: string, now: string): Manifest {
  const lib = new Map(library.map((v) => [v.id, v]));
  const chars = new Map(project.characters.map((c) => [c.id, c]));
  return {
    schema: MANIFEST_SCHEMA,
    version: MANIFEST_VERSION,
    generatedBy: `Greenroom Local ${appVersion}`,
    generatedAt: now,
    project: { id: project.id, name: project.name, scenes: project.scenes },
    characters: project.characters.map((c) => ({ id: c.id, name: c.name, voiceId: c.voiceId ?? null })),
    lines: project.lines.map((l, i) => {
      const c = chars.get(l.characterId);
      return {
        lineId: l.id,
        scene: l.scene,
        order: i + 1,
        characterId: l.characterId,
        characterName: c?.name ?? "",
        text: l.text,
        direction: { emotion: l.direction.emotion, note: l.direction.note ?? "", sounds: l.direction.sounds, speed: l.direction.speed, pauseAfterSeconds: l.direction.pauseAfter, gainDb: l.direction.gain ?? 0 },
        performance: migratePerformance(l.performance) ?? null,
        cueSeconds: l.cue ?? null,
        voice: voiceOf(c?.voiceId ? lib.get(c.voiceId) : undefined),
        take: takeOf(chosenTake(l)),
        takeCount: l.takes.length,
        wordTiming: null,
        phonemeTiming: null,
      };
    }),
    notes: [
      "Word and phoneme timing are null: Greenroom does not measure them yet.",
      "A take's `sent` text is what the voice actually received. `notSent` lists direction the voice could not act on.",
      "Audio files are the project's takes; their SHA-256 values let a reader check a file has not changed.",
    ],
  };
}
