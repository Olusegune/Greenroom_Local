// The extra, lasting facts about a character that Voice DNA did not hold: who they are, how their voice is described, an
// audition line, a consent note, and where the profile came from. It lives inside the character's Voice DNA, so it travels
// with a saved cast. Everything read from saved or imported data is checked and limited.

import { CAPS } from "./engineCaps";
import { ENGINE_ORDER, type Engine } from "./engines";

export const PROFILE_VERSION = 1;

export type ProfileAge = "child" | "teen" | "young_adult" | "adult" | "middle_aged" | "older_adult" | "elderly" | "ageless";
const AGES: ProfileAge[] = ["child", "teen", "young_adult", "adult", "middle_aged", "older_adult", "elderly", "ageless"];
export type Presentation = "male" | "female" | "nonbinary";
export type Pitch = "low" | "mid" | "high";

export interface ProfileProvenance {
  /** Counts up each time the profile is saved, so an exported file says which edit it is. */
  revision: number;
  createdAt: string;
  updatedAt: string;
  source: "manual" | "preset" | "import";
  /** The preset this began from, and its version, when it began from one. */
  presetId?: string;
  presetVersion?: number;
  appVersion: string;
}

export interface ProfileExtra {
  background: string;
  ageRange?: ProfileAge;
  /** How the character presents, only when stated. Never guessed from a name, a voice or a picture. */
  presentation?: Presentation;
  /** How old the voice sounds, in the owner's words. */
  vocalAge: string;
  pitch?: Pitch;
  texture: string;
  /** Things this character's voice does again and again: a hum, a dry cough, a pause before a name. */
  signature: string[];
  audition: string;
  /** What the owner knows about rights to the voice or the person it is based on. A note only: it never counts as a consent record. */
  consentNote: string;
  provenance: ProfileProvenance;
}

const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");

export const emptyProfile = (now: string, appVersion: string): ProfileExtra => ({ background: "", vocalAge: "", texture: "", signature: [], audition: "", consentNote: "", provenance: { revision: 0, createdAt: now, updatedAt: now, source: "manual", appVersion } });

/** A profile read from saved or imported data, every value checked. Anything not recognised is dropped. */
export function readProfile(raw: unknown): ProfileExtra | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const p = (r.provenance && typeof r.provenance === "object" ? r.provenance : {}) as Record<string, unknown>;
  const source = p.source === "preset" || p.source === "import" ? p.source : "manual";
  return {
    background: text(r.background, 600),
    ...(AGES.includes(r.ageRange as ProfileAge) ? { ageRange: r.ageRange as ProfileAge } : {}),
    ...(r.presentation === "male" || r.presentation === "female" || r.presentation === "nonbinary" ? { presentation: r.presentation } : {}),
    vocalAge: text(r.vocalAge, 60),
    ...(r.pitch === "low" || r.pitch === "mid" || r.pitch === "high" ? { pitch: r.pitch } : {}),
    texture: text(r.texture, 160),
    signature: Array.isArray(r.signature) ? r.signature.map((s) => text(s, 80)).filter(Boolean).slice(0, 8) : [],
    audition: text(r.audition, 300),
    consentNote: text(r.consentNote, 400),
    provenance: {
      revision: typeof p.revision === "number" && Number.isFinite(p.revision) ? Math.min(100000, Math.max(0, Math.floor(p.revision))) : 0,
      createdAt: text(p.createdAt, 40), updatedAt: text(p.updatedAt, 40), source,
      ...(text(p.presetId, 80) ? { presetId: text(p.presetId, 80) } : {}),
      ...(typeof p.presetVersion === "number" && Number.isFinite(p.presetVersion) ? { presetVersion: Math.floor(p.presetVersion) } : {}),
      appVersion: text(p.appVersion, 20),
    },
  };
}

/** Saving an edit: the revision goes up and the time is stamped. */
export const touch = (p: ProfileExtra, now: string, appVersion: string): ProfileExtra => ({ ...p, provenance: { ...p.provenance, revision: p.provenance.revision + 1, updatedAt: now, appVersion } });

const SOUND_WORDS = /\b(laugh\w*|chuckl\w*|giggl\w*|sigh\w*|cough\w*|clears? (his|her|their)? ?throat|breath\w*|gasp\w*|groan\w*|sob\w*|cry\w*|hum\w*|whistl\w*|sniff\w*)\b/i;

/**
 * Engines whose declared abilities meet what this profile asks of a voice: written direction when there is anything to act on,
 * sounds from tags when a signature behaviour is a sound. This says what an engine ACCEPTS, not how it sounds.
 */
export function profileCompatibility(p: Pick<ProfileExtra, "signature">, dna: { tendencies: string; range: string }): { engines: Engine[]; needs: { words: boolean; nonverbal: boolean } } {
  const nonverbal = p.signature.some((s) => SOUND_WORDS.test(s));
  const words = nonverbal || !!dna.tendencies.trim() || !!dna.range.trim() || p.signature.length > 0;
  const engines = ENGINE_ORDER.filter((e) => (!words || CAPS[e].words) && (!nonverbal || CAPS[e].nonverbal));
  return { engines, needs: { words, nonverbal } };
}
