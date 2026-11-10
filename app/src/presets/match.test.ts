import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { fitOf, rankVoices, voiceAge, voiceGender } from "./match";
import { STARTER_PRESETS } from "./index";
import { listened } from "../casting/fixtures";
import type { VoiceEntry } from "../types";

const mine = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "voices.sample.json"), "utf8")) as VoiceEntry[];
const v = (id: string, over: Partial<VoiceEntry>): VoiceEntry => ({ id, name: id, provider: "elevenlabs", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "", ...over });
const woman = { gender: "female" as const, ageRange: ["young_adult", "adult"] as never, language: "English", accent: { label: "General American", quality: "supported" as never } };
const man = { ...woman, gender: "male" as const };

describe("which voices fit a preset", () => {
  const heard = (id: string, facts: Parameters<typeof listened>[1], over: Partial<VoiceEntry> = {}) => listened(v(id, over), { languages: ["english"], ...facts });
  it("a voice recorded as the other gender does not fit, and a confirmed one fits", () => {
    expect(fitOf(woman, v("m", { gender: "male" })).fit).toBe("poor");
    expect(fitOf(man, v("f", { gender: "female" })).fit).toBe("poor");
    expect(fitOf(woman, heard("f", { gender: "feminine", age: "young" })).fit).toBe("good");
    expect(fitOf(woman, v("m", { gender: "male" })).notes.join(" ")).toMatch(/masculine voice; the preset calls for a feminine voice/);
  });
  it("a provider label that agrees is only a claim: listen first", () => {
    const f = fitOf(woman, v("f", { gender: "female", age: "young" }));
    expect(f.status).toBe("NEEDS_AUDITION");
    expect(f.fit).toBe("partial");
  });
  it("a voice that states nothing is unknown, never a mismatch", () => {
    const f = fitOf(woman, v("x", {}));
    expect(f.fit).toBe("partial");
    expect(f.status).toBe("UNKNOWN_METADATA");
    expect(f.notes.join(" ")).toMatch(/no recorded vocal presentation/);
  });
  it("age: a child preset does not fit an adult voice, and an adult preset does not fit a child voice", () => {
    const kid = { ...woman, ageRange: ["child"] as never };
    expect(fitOf(kid, heard("a", { gender: "feminine", age: "mid" })).fit).toBe("poor");
    expect(fitOf(woman, heard("c", { gender: "feminine", age: "child" })).fit).toBe("poor");
    expect(fitOf(kid, heard("c", { gender: "feminine", age: "child" })).fit).toBe("good");
    expect(fitOf({ ...woman, ageRange: ["older_adult"] as never }, heard("y", { gender: "feminine", age: "young" })).fit).not.toBe("good");
  });
  it("a language code and its name are the same language", () => {
    expect(fitOf(woman, heard("c", { gender: "feminine", age: "young" }, { language: "en" })).fit).toBe("good");
  });
  it("another language does not fit a preset in a language other than English", () => {
    expect(fitOf({ ...woman, language: "Yoruba" }, heard("es", { gender: "feminine", age: "young", languages: ["spanish"] }, { language: "Spanish" })).fit).toBe("poor");
  });
  it("a name is not evidence: a Piper voice has no gender until someone records one, and a description does not state an age", () => {
    expect(voiceGender(v("en_GB-alan-low", { provider: "piper" }))).toBeUndefined();
    expect(voiceGender(v("en_GB-alba-medium", { provider: "piper" }))).toBeUndefined();
    expect(voiceGender(v("x", { gender: "neutral" }))).toBeUndefined();
    expect(voiceAge(v("x", { notes: "A middle-aged man with a resonant tone" }))).toBeUndefined();
    expect(voiceGender(heard("h", { gender: "masculine" }, { provider: "piper" }))).toBe("m");
  });
  it("the best fit comes first and ties keep the library order", () => {
    const r = rankVoices(woman, [v("m", { gender: "male" }), v("u", {}), heard("f", { gender: "feminine", age: "young" })]);
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
