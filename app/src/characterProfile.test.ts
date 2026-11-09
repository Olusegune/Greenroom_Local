import { describe, expect, it } from "vitest";
import { emptyProfile, profileCompatibility, readProfile, touch } from "./characterProfile";
import { duplicateCharacter, exportProfile, importProfile, MAX_PROFILE_FILE } from "./profileIO";
import { applyPreset } from "./presets/cast";
import { STARTER_PRESETS } from "./presets";
import type { Character, VoiceEntry } from "./types";
import { emptyDna, migrateDna, setIdentity } from "./voiceDna";

const NOW = "2026-11-09T00:00:00Z";
const voice = (over: Partial<VoiceEntry> = {}): VoiceEntry => ({ id: "secret-voice-id-123", name: "Fiona", provider: "elevenlabs", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "", ...over });
function character(): Character {
  let dna = emptyDna();
  dna = { ...dna, timbre: "gravelly", accent: "Educated British", tendencies: "never rushes", range: "guarded", pronunciations: [{ from: "Venomspur", to: "VEN-om-spur" }], references: [{ id: "r", takeId: "t1" } as never] };
  dna = setIdentity(dna, voice(), null);
  const profile = touch({ ...emptyProfile(NOW, "0.11.0"), background: "A demon who files paperwork.", audition: "Good evening.", signature: ["a dry cough before bad news"], consentNote: "Voice designed from text, no real person." }, NOW, "0.11.0");
  return { id: "c1", name: "Venomspur", language: "English", dna: { ...dna, profile } };
}

describe("profile extras", () => {
  it("are optional: a character from before them reads as it always did", () => {
    expect(migrateDna({ ...emptyDna() })!.profile).toBeUndefined();
  });
  it("round-trip through the strict reader and keep their provenance", () => {
    const c = character();
    const back = migrateDna(JSON.parse(JSON.stringify(c.dna)))!;
    expect(back.profile).toEqual(c.dna!.profile);
    expect(back.profile!.provenance.revision).toBe(1);
  });
  it("limit and clean hostile values", () => {
    const p = readProfile({ background: "x".repeat(5000) + "\u0000", ageRange: "ancient", presentation: "robot", pitch: "squeaky", signature: Array.from({ length: 50 }, () => "s".repeat(500)), provenance: { revision: -5, source: "admin" } })!;
    expect(p.background.length).toBe(600);
    expect(p.ageRange).toBeUndefined(); expect(p.presentation).toBeUndefined(); expect(p.pitch).toBeUndefined();
    expect(p.signature).toHaveLength(8); expect(p.signature[0]!.length).toBe(80);
    expect(p.provenance.revision).toBe(0); expect(p.provenance.source).toBe("manual");
    expect(readProfile("x")).toBeUndefined();
  });
  it("name the engines whose declared abilities meet the profile", () => {
    const sounds = profileCompatibility({ signature: ["a dry cough before bad news"] }, { tendencies: "", range: "" });
    expect(sounds.needs).toEqual({ words: true, nonverbal: true });
    expect(sounds.engines).toContain("elevenlabs");
    expect(sounds.engines).not.toContain("piper");
    const nothing = profileCompatibility({ signature: [] }, { tendencies: "", range: "" });
    expect(nothing.engines).toContain("piper");
  });
  it("begin from a preset and record which preset and version", () => {
    const p = STARTER_PRESETS.find((x) => x.id === "film_tv.noir-detective")!;
    const r = applyPreset({ id: "c", name: "Sam", language: "English" }, p, { now: NOW, appVersion: "0.11.0" });
    const prof = r.character.dna!.profile!;
    expect(prof.provenance).toMatchObject({ source: "preset", presetId: p.id, presetVersion: p.version });
    expect(prof.audition).toBe(p.audition);
    expect(prof.pitch).toBe(p.pitch);
    expect(prof.ageRange).toBeDefined();
  });
});

describe("sharing a profile", () => {
  const c = character();
  const file = exportProfile(c, voice({ source: "cloned", consent: { speaker: "A Real Person", basis: "permission", reference: "email 2026", date: "2026-01-01" } }), NOW);
  it("carries the description but never a voice id, a consent record, a reference take or a person's name", () => {
    expect(file).not.toContain("secret-voice-id-123");
    expect(file).not.toContain("A Real Person");
    expect(file).not.toContain("email 2026");
    expect(file).not.toContain('"references"');
    expect(JSON.parse(file).voice).toMatchObject({ engine: "elevenlabs", source: "cloned", hadConsentRecord: true });
  });
  it("imports the description and starts a new profile history marked as imported", () => {
    const r = importProfile(file, "2026-12-01T00:00:00Z", "0.11.0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.name).toBe("Venomspur");
    expect(r.dna.timbre).toBe("gravelly");
    expect(r.dna.pronunciations).toHaveLength(1);
    expect(r.dna.profile!.background).toMatch(/paperwork/);
    expect(r.dna.profile!.provenance).toMatchObject({ source: "import", revision: 1 });
  });
  it("never brings in a voice, an approved identity or references, and warns that consent does not travel", () => {
    const r = importProfile(file, NOW, "0.11.0");
    if (!r.ok) throw new Error("should import");
    expect(r.dna.identity).toBeNull();
    expect(r.dna.references).toEqual([]);
    expect(r.warnings.join(" ")).toMatch(/choose one/);
    expect(r.warnings.join(" ")).toMatch(/Consent does not travel/);
  });
  it("keeps a consent note from a file only as an unverified note, never as a record", () => {
    const r = importProfile(file, NOW, "0.11.0");
    if (!r.ok) throw new Error("should import");
    expect(r.dna.profile!.consentNote).toMatch(/^Imported, unverified:/);
    expect(r.warnings.join(" ")).toMatch(/not a consent record/);
    expect(JSON.stringify(r)).not.toMatch(/"basis"/);
  });
  it("refuses foreign, newer, oversized, nameless and broken files without throwing", () => {
    expect(importProfile("nope", NOW, "x").ok).toBe(false);
    expect(importProfile('{"format":"other"}', NOW, "x").ok).toBe(false);
    expect(importProfile('{"format":"greenroom.character-profile","schema":99,"name":"A"}', NOW, "x").ok).toBe(false);
    expect(importProfile('{"format":"greenroom.character-profile","schema":1}', NOW, "x").ok).toBe(false);
    expect(importProfile("x".repeat(MAX_PROFILE_FILE + 1), NOW, "x").ok).toBe(false);
  });
  it("keeps markup as plain text", () => {
    const evil = JSON.stringify({ format: "greenroom.character-profile", schema: 1, name: "<img src=x onerror=alert(1)>", dna: { profile: { background: "<script>alert(1)</script>" } } });
    const r = importProfile(evil, NOW, "x");
    expect(r.ok && r.name).toBe("<img src=x onerror=alert(1)>");
  });
});

describe("duplicating a character", () => {
  it("gives a new id and name, keeps the profile with a fresh history and shares no take", () => {
    const c = character();
    const d = duplicateCharacter(c, "c2", NOW, "0.11.0");
    expect(d.id).toBe("c2");
    expect(d.name).toBe("Venomspur (copy)");
    expect(d.dna!.references).toEqual([]);
    expect(d.dna!.profile!.provenance.revision).toBe(1);
    expect(c.dna!.references).toHaveLength(1);
  });
});
