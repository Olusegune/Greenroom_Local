import { describe, expect, it } from "vitest";
import { applyCast, castFrom } from "./cast";
import { addReference, dictFor, emptyDna, identityWarning, makeReference, MAX_REFERENCES, migrateDna, removeReference, setIdentity } from "./voiceDna";
import { newProject, type VoiceEntry } from "./types";

const v = (provider: VoiceEntry["provider"], id: string, name = id): VoiceEntry => ({ id, name, provider, source: "library", language: "en", accent: "", gender: "", notes: "", createdAt: "" });
const ref = (n: number) => makeReference({ takeId: `t${n}`, lineId: "l", at: "now", text: "Hello there", seconds: 1, sha256: "ab", voice: v("inworld", "Alex"), modelId: "inworld-tts-2", samples: new Float32Array(16000).fill(0.2), rate: 16000, words: 2 });

describe("voice DNA", () => {
  it("reads damaged or old data safely", () => {
    expect(migrateDna(undefined)).toBeUndefined();
    expect(migrateDna("x")).toBeUndefined();
    const d = migrateDna({ timbre: "  warm\n\tvoice ", presets: ["cold-menace", "cold-menace", "<bad>", 5], pronunciations: [{ from: "Nguyen", to: "Win" }, { from: "", to: "x" }, null], references: [{ nope: 1 }, null], identity: { engine: "madeup", voiceId: "x" } })!;
    expect(d.timbre).toBe("warm voice");
    expect(d.presets).toEqual(["cold-menace"]);
    expect(d.pronunciations).toEqual([{ from: "Nguyen", to: "Win" }]);
    expect(d.references).toEqual([]);
    expect(d.identity).toBeNull();
  });

  it("round trips a profile with a reference and keeps only the newest references", () => {
    let dna = setIdentity(emptyDna(), v("inworld", "Alex"), "inworld-tts-2");
    for (let i = 0; i < MAX_REFERENCES + 3; i++) dna = addReference(dna, ref(i));
    expect(dna.references).toHaveLength(MAX_REFERENCES);
    expect(dna.references[0]!.takeId).toBe(`t${MAX_REFERENCES + 2}`);
    expect(addReference(dna, ref(MAX_REFERENCES + 2)).references).toHaveLength(MAX_REFERENCES);
    expect(migrateDna(JSON.parse(JSON.stringify(dna)))).toEqual(dna);
    expect(removeReference(dna, "t8").references.some((r) => r.takeId === "t8")).toBe(false);
  });

  it("measures the reference from the audio", () => {
    const r = ref(1);
    expect(r.stats.words).toBe(2);
    expect(r.stats.speechSeconds).toBeGreaterThan(0.9);
    expect(r.engine).toBe("inworld");
    expect(r.modelId).toBe("inworld-tts-2");
  });

  it("warns when the engine, the voice or the model changes, and not otherwise", () => {
    const dna = setIdentity(emptyDna(), v("inworld", "Alex", "Alex"), "inworld-tts-2");
    expect(identityWarning(dna, v("inworld", "Alex"), "inworld-tts-2")).toBeNull();
    expect(identityWarning(dna, v("elevenlabs", "x", "Rachel"))).toMatch(/different engine/);
    expect(identityWarning(dna, v("inworld", "Olivia"), "inworld-tts-2")).toMatch(/different voice/);
    expect(identityWarning(dna, v("inworld", "Alex"), "inworld-tts-2-flash")).toMatch(/inworld-tts-2-flash/);
    expect(identityWarning(emptyDna(), v("piper", "p"))).toBeNull();
    expect(identityWarning(undefined, undefined)).toBeNull();
  });

  it("lets a character's own pronunciation win over the project's", () => {
    const d = dictFor([{ from: "Nguyen", to: "Nwin" }, { from: "Tunde", to: "Toon-day" }], { ...emptyDna(), pronunciations: [{ from: "nguyen", to: "Win" }] });
    expect(d).toEqual([{ from: "Tunde", to: "Toon-day" }, { from: "nguyen", to: "Win" }]);
    expect(dictFor([{ from: "a", to: "b" }], undefined)).toEqual([{ from: "a", to: "b" }]);
  });

  it("travels with a saved cast from one project to the next", () => {
    const lib = [v("inworld", "Alex", "Alex")];
    const p1 = newProject("p1", "Ep 1", "now");
    p1.characters = [{ id: "c1", name: "VENOM", voiceId: "Alex", language: "English", dna: { ...setIdentity(emptyDna(), lib[0]!, "inworld-tts-2"), tendencies: "never rushes" } }];
    p1.lines = [{ id: "l1", characterId: "c1", scene: 0, text: "Hi", direction: { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 }, takes: [], events: [] }];
    const cast = castFrom(p1, lib, "Series", "cast1", "now");
    const p2 = newProject("p2", "Ep 2", "now");
    p2.characters = [{ id: "x9", name: "venom", language: "English" }];
    p2.lines = [{ ...p1.lines[0]!, characterId: "x9" }];
    const out = applyCast(p2, JSON.parse(JSON.stringify(cast)), lib);
    expect(out.characters[0]!.voiceId).toBe("Alex");
    expect(out.characters[0]!.dna?.tendencies).toBe("never rushes");
    expect(out.characters[0]!.dna?.identity?.voiceName).toBe("Alex");
  });
});
