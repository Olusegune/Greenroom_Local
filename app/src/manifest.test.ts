import { describe, expect, it } from "vitest";
import { buildManifest, MANIFEST_SCHEMA, MANIFEST_VERSION } from "./manifest";
import { DEFAULT_DIRECTION, newProject, type Line, type Take, type VoiceEntry } from "./types";

const take = (id: string, extra: Partial<Take> = {}): Take => ({
  id, at: "2026-11-08T10:00:00Z", model: "inworld", ext: "wav", voiceId: "Alex", sent: "[say wearily] Hello.", seconds: 1.4,
  provenance: { engine: "inworld", voiceName: "Alex", speed: 1, chars: 20, sha256: "abc", appVersion: "0.5.0", emotion: "tired", sounds: [], note: "", pronunciations: 0, modelId: "inworld-tts-2", steering: ["say wearily"], nonverbal: ["sigh"], notSent: ["gasps (Inworld has no gasps sound; use a sound clip)"] },
  ...extra,
});

function fixture() {
  const p = newProject("p1", "Test", "2026-11-08");
  p.characters = [{ id: "c1", name: "VENOMSPUR", voiceId: "Alex", language: "English" }, { id: "c2", name: "MIA", language: "English" }];
  const l1: Line = { id: "l1", characterId: "c1", scene: 0, text: "Good morning.", direction: { ...DEFAULT_DIRECTION, emotion: "tired", note: "Dry.", sounds: ["sighs"] }, takes: [take("t1"), take("t2")], chosen: "t2", events: [], cue: 3.5 };
  const l2: Line = { id: "l2", characterId: "c2", scene: 0, text: "Hi.", direction: { ...DEFAULT_DIRECTION }, takes: [], events: [] };
  p.lines = [l1, l2];
  const lib: VoiceEntry[] = [{ id: "Alex", name: "Alex", provider: "inworld", source: "cloned", language: "en-US", accent: "", gender: "", notes: "", createdAt: "", consent: { speaker: "A. Person", basis: "self", reference: "", date: "2026-11-01" } }];
  return { p, lib };
}

describe("Cinematic Performance Manifest", () => {
  it("is versioned and records the chosen take, voice, model and disclosures", () => {
    const { p, lib } = fixture();
    const m = buildManifest(p, lib, "0.5.0", "2026-11-08T12:00:00Z");
    expect(m.schema).toBe(MANIFEST_SCHEMA);
    expect(m.version).toBe(MANIFEST_VERSION);
    const a = m.lines[0]!;
    expect(a.characterName).toBe("VENOMSPUR");
    expect(a.text).toBe("Good morning.");
    expect(a.takeCount).toBe(2);
    expect(a.take?.id).toBe("t2");
    expect(a.take?.modelId).toBe("inworld-tts-2");
    expect(a.take?.steering).toEqual(["say wearily"]);
    expect(a.take?.nonverbalTags).toEqual(["sigh"]);
    expect(a.take?.notSent[0]).toMatch(/gasps/);
    expect(a.take?.sha256).toBe("abc");
    expect(a.voice?.consent?.speaker).toBe("A. Person");
    expect(a.voice?.engine).toBe("inworld");
    expect(a.cueSeconds).toBe(3.5);
  });

  it("never invents timing or a voice", () => {
    const { p, lib } = fixture();
    const b = buildManifest(p, lib, "0.5.0", "now").lines[1]!;
    expect(b.wordTiming).toBeNull();
    expect(b.phonemeTiming).toBeNull();
    expect(b.voice).toBeNull();
    expect(b.take).toBeNull();
    expect(b.cueSeconds).toBeNull();
  });

  it("leaves the project untouched and serialises cleanly", () => {
    const { p, lib } = fixture();
    const before = JSON.stringify(p);
    const json = JSON.stringify(buildManifest(p, lib, "0.5.0", "now"));
    expect(JSON.stringify(p)).toBe(before);
    expect(JSON.parse(json).lines).toHaveLength(2);
    expect(json).not.toMatch(/api[-_ ]?key|authorization|basic /i);
  });
});
