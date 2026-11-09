import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fitOf, rankVoices, voiceAge, voiceGender } from "./match";
import { STARTER_PRESETS } from "./index";
import type { VoiceEntry } from "../types";

const mine = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "voices.sample.json"), "utf8")) as VoiceEntry[];
const v = (id: string, over: Partial<VoiceEntry>): VoiceEntry => ({ id, name: id, provider: "elevenlabs", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "", ...over });
const woman = { gender: "female" as const, ageRange: ["young_adult", "adult"] as never, language: "English", accent: { label: "General American", quality: "supported" as never } };
const man = { ...woman, gender: "male" as const };

describe("which voices fit a preset", () => {
  it("a male voice does not fit a female preset, and the reverse", () => {
    expect(fitOf(woman, v("m", { gender: "male" })).fit).toBe("poor");
    expect(fitOf(man, v("f", { gender: "female" })).fit).toBe("poor");
    expect(fitOf(woman, v("f", { gender: "female" })).fit).toBe("good");
    expect(fitOf(woman, v("m", { gender: "male" })).notes.join(" ")).toMatch(/male voice; this preset is a woman/);
  });
  it("a voice that states nothing is unknown, never a mismatch", () => {
    const f = fitOf(woman, v("x", {}));
    expect(f.fit).toBe("partial");
    expect(f.notes.join(" ")).toMatch(/does not say/);
  });
  it("age: a child preset does not fit an adult voice, and an adult preset does not fit a child voice", () => {
    const kid = { ...woman, ageRange: ["child"] as never };
    expect(fitOf(kid, v("a", { gender: "female", age: "mid" })).fit).toBe("poor");
    expect(fitOf(woman, v("c", { gender: "female", age: "child" })).fit).toBe("poor");
    expect(fitOf(kid, v("c", { gender: "female", age: "child" })).fit).toBe("good");
    expect(fitOf({ ...woman, ageRange: ["older_adult"] as never }, v("y", { gender: "female", age: "young" })).fit).not.toBe("good");
  });
  it("a language code and its name are the same language", () => {
    expect(fitOf(woman, v("c", { gender: "female", language: "en" })).fit).toBe("good");
    expect(fitOf({ ...woman, language: "Yoruba" }, v("c", { gender: "female", language: "yo" })).notes.join(" ")).not.toMatch(/speaks/);
  });
  it("another language does not fit", () => {
    expect(fitOf(woman, v("es", { gender: "female", language: "Spanish" })).fit).not.toBe("good");
  });
  it("local voices have a gender from the known list, and a description can state age", () => {
    expect(voiceGender(v("en_GB-alan-low", { provider: "piper" }))).toBe("m");
    expect(voiceGender(v("en_GB-alba-medium", { provider: "piper" }))).toBe("f");
    expect(voiceGender(v("x", { gender: "neutral" }))).toBeUndefined();
    expect(voiceAge(v("x", { notes: "A middle-aged man with a resonant tone" }))).toBe("mid");
  });
  it("the best fit comes first and ties keep the library order", () => {
    const r = rankVoices(woman, [v("m", { gender: "male" }), v("u", {}), v("f", { gender: "female" })]);
    expect(r.map((x) => x.voice.id)).toEqual(["f", "u", "m"]);
    expect(rankVoices(woman, [v("a", {}), v("b", {})]).map((x) => x.voice.id)).toEqual(["a", "b"]);
  });
});

describe("with the owner's real voices, every starter preset gets a sensible default", () => {
  const voices = mine.filter((x) => x.provider === "elevenlabs");
  it("never defaults a male preset to a female voice or a female preset to a male voice, when a voice of the right gender exists", () => {
    let checked = 0;
    for (const p of STARTER_PRESETS) {
      if (p.gender !== "male" && p.gender !== "female") continue;
      const best = rankVoices(p, voices)[0]!;
      const want = p.gender === "male" ? "m" : "f";
      const rightGender = voices.some((x) => voiceGender(x) === want);
      if (rightGender) {
        expect(voiceGender(best.voice), `${p.name} -> ${best.voice.name}`).not.toBe(want === "m" ? "f" : "m");
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(15);
  });
  it("says so when no voice fits, instead of quietly picking one", () => {
    const onlyMen = voices.filter((x) => voiceGender(x) === "m");
    const p = STARTER_PRESETS.find((x) => x.gender === "female")!;
    expect(rankVoices(p, onlyMen)[0]!.fit).toBe("poor");
  });
});
