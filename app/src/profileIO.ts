// Sharing a character's profile as a file, and copying a character. A file carries the description of the character, never
// rights: it holds no voice id, no consent record and no acting-reference takes. Importing one can never create a consent
// record or a cloned voice, and whatever the file says about consent is kept only as a note marked unverified.

import { emptyProfile, readProfile, touch } from "./characterProfile";
import { ENGINES } from "./engines";
import type { Character, VoiceEntry } from "./types";
import { emptyDna, migrateDna, type VoiceDna } from "./voiceDna";

export const PROFILE_FILE = "greenroom.character-profile";
export const PROFILE_FILE_VERSION = 1;
export const MAX_PROFILE_FILE = 200_000;

export function exportProfile(c: Pick<Character, "name" | "language" | "dna" | "about" | "look">, voice: Pick<VoiceEntry, "provider" | "name" | "source" | "licence" | "consent"> | undefined, now: string): string {
  const dna = migrateDna(c.dna) ?? emptyDna();
  return JSON.stringify({
    format: PROFILE_FILE, schema: PROFILE_FILE_VERSION, exportedAt: now,
    name: c.name, language: c.language, about: c.about ?? "", look: c.look ?? {},
    // Acting references are takes on this computer and identity holds a voice id: neither is shared.
    dna: { timbre: dna.timbre, accent: dna.accent, tendencies: dna.tendencies, range: dna.range, presets: dna.presets, pronunciations: dna.pronunciations, ...(dna.profile ? { profile: dna.profile } : {}) },
    voice: voice ? { engine: voice.provider, name: voice.name, source: voice.source, licence: voice.licence ?? "unknown", hadConsentRecord: !!voice.consent } : null,
  }, null, 2);
}

export type ImportedProfile = { ok: true; name: string; language: string; about: string; look: Character["look"]; dna: VoiceDna; warnings: string[] } | { ok: false; error: string };

export function importProfile(json: string, now: string, appVersion: string): ImportedProfile {
  if (json.length > MAX_PROFILE_FILE) return { ok: false, error: "That file is too large to be a character profile." };
  let data: unknown;
  try { data = JSON.parse(json); } catch { return { ok: false, error: "That is not a valid profile file." }; }
  const o = (data ?? {}) as Record<string, unknown>;
  if (o.format !== PROFILE_FILE) return { ok: false, error: "That is not a Greenroom character profile." };
  if (typeof o.schema === "number" && o.schema > PROFILE_FILE_VERSION) return { ok: false, error: "That profile was made by a newer Greenroom. Update to open it." };
  const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
  const name = clean(o.name, 60);
  if (!name) return { ok: false, error: "The profile has no character name." };
  const raw = (o.dna ?? {}) as Record<string, unknown>;
  // identity and references are never taken from a file
  const dna = migrateDna({ ...raw, identity: null, references: [] }) ?? emptyDna();
  const warnings: string[] = [];
  const v = (o.voice ?? null) as Record<string, unknown> | null;
  if (v && typeof v === "object") {
    const eng = clean(v.engine, 30);
    warnings.push(`The file's character used ${clean(v.name, 80) || "a voice"}${eng in ENGINES ? ` on ${ENGINES[eng as keyof typeof ENGINES].label}` : ""}. No voice came with it: choose one for ${name}.`);
    if (v.source === "cloned") warnings.push("That voice was cloned. Consent does not travel in a file. Record consent for any voice you clone yourself before using it.");
  }
  const p = readProfile(raw.profile) ?? emptyProfile(now, appVersion);
  const claimed = p.consentNote ? `Imported, unverified: ${p.consentNote}` : "";
  const profile = touch({ ...p, consentNote: claimed.slice(0, 400), provenance: { ...p.provenance, source: "import", createdAt: now, revision: 0 } }, now, appVersion);
  if (p.consentNote) warnings.push("The file's consent note was kept as a note only. It is not a consent record.");
  const look = (o.look ?? {}) as Record<string, unknown>;
  const age = ["child", "teen", "young", "mid", "old"].includes(String(look.age)) ? (look.age as NonNullable<Character["look"]>["age"]) : undefined;
  const gender = look.gender === "m" || look.gender === "f" ? look.gender : undefined;
  return { ok: true, name, language: clean(o.language, 40) || "English", about: clean(o.about, 400), look: { ...(gender ? { gender } : {}), ...(age ? { age } : {}) }, dna: { ...dna, profile }, warnings };
}

/** A copy to try changes on. It has a new id and keeps the profile, but starts a fresh revision history and shares no take. */
export function duplicateCharacter(c: Character, id: string, now: string, appVersion: string): Character {
  const dna = migrateDna(c.dna);
  const profile = dna?.profile ? touch({ ...dna.profile, provenance: { ...dna.profile.provenance, revision: 0, createdAt: now } }, now, appVersion) : undefined;
  return { ...c, id, name: `${c.name} (copy)`, ...(dna ? { dna: { ...dna, references: [], ...(profile ? { profile } : {}) } } : {}), reactions: undefined };
}
