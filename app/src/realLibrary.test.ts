import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoAvatar, isPlainFace, LOOKS, validateManifest, type AvatarManifest, type Heritage } from "./avatarLibrary";
import { assignedFace, syncPortraits, voiceHint } from "./portrait";
import type { VoiceEntry } from "./types";

// The owner's real ElevenLabs voice library (names, labels and descriptions only: no ids, keys or audio), with what each voice
// plainly is, judged by reading its description. Each is run through exactly the code the screens use.
const voices = JSON.parse(readFileSync(join(__dirname, "fixtures", "voices.sample.json"), "utf8")) as VoiceEntry[];
const manifest = validateManifest(JSON.parse(readFileSync(join(__dirname, "..", "public", "avatars", "manifest.json"), "utf8"))).manifest as AvatarManifest;
syncPortraits(voices);
const face = (v: VoiceEntry) => assignedFace(manifest, v.id + v.name)!;

type Age = "young" | "adult" | "mid";
// age groups a face may have for each stated age
const AGES: Record<Age, string[]> = { young: ["teen", "young_adult", "adult"], adult: ["young_adult", "adult", "middle_aged"], mid: ["adult", "middle_aged", "older_adult"] };

/** voice index in the fixture -> [gender, heritage or null (not stated), age] */
const TRUTH: [number, "m" | "f" | null, Heritage | null, Age][] = [
  [0, "m", "black", "adult"],
  [1, null, null, "adult"],
  [2, "m", "black", "adult"],
  [3, "m", "black", "mid"],
  [4, "m", "black", "adult"],
  [5, "m", "black", "mid"],
  [6, "m", "black", "adult"],
  [7, "m", "black", "adult"],
  [8, "m", "black", "adult"],
  [9, "f", "white", "adult"],
  [10, "f", "white", "adult"],
  [11, "f", "white", "adult"],
  [12, "m", "white", "young"],
  [13, "m", "east_asian", "young"],
  [14, "m", "middle_eastern", "mid"],
  [15, "m", "white", "mid"],
  [16, "m", "white", "mid"],
  [17, "m", "white", "adult"],
  [18, "f", "white", "adult"],
  [19, "f", null, "adult"],
  [20, "m", "white", "adult"],
  [21, "f", "white", "young"],
  [22, "f", "white", "young"],
  [23, "m", "white", "young"],
  [24, "m", "white", "adult"],
  [25, "m", "white", "adult"],
  [26, null, "white", "adult"],
  [27, "m", "white", "adult"],
  [28, "m", "white", "young"],
  [29, "f", "white", "adult"],
  [30, "f", "white", "adult"],
  [31, "m", "white", "adult"],
  [32, "f", "white", "young"],
  [33, "m", "white", "mid"],
  [34, "m", "white", "adult"],
  [35, "m", "white", "mid"],
  [36, "m", "white", "adult"],
  [37, "f", "white", "adult"],
  [38, "m", "white", "adult"],
  [39, "m", "white", "mid"],
  [40, "m", "black", "adult"],
];

describe("the owner's real voice library", () => {
  it("is the library the truth table describes", () => {
    expect(voices.length).toBe(41);
    expect(TRUTH.length).toBe(voices.length);
  });
  for (const [idx, g, h, age] of TRUTH) {
    const v = voices[idx]!;
    it(`${v.name.slice(0, 40)} gets a face that fits`, () => {
      const a = face(v);
      const look = LOOKS[a.id]!;
      expect(isPlainFace(a), `${a.id} is a costume or creature`).toBe(true);
      if (g) expect(look.g, `${v.name} -> ${a.id}`).toBe(g);
      if (h) expect(look.h, `${v.name} -> ${a.id}`).toBe(h);
      expect(AGES[age], `${v.name} -> ${a.id} (${a.age_category})`).toContain(a.age_category);
      expect(["child", "teen"].includes(a.age_category) && age !== "young", `${v.name} was given a child`).toBe(false);
    });
  }
  it("no two of the same gender and heritage are given the same face when the library has several faces for them", () => {
    const seen = new Map<string, number>();
    for (const v of voices) {
      const a = face(v);
      seen.set(a.id, (seen.get(a.id) ?? 0) + 1);
    }
    // a spread, not one face for everybody
    expect(seen.size).toBeGreaterThanOrEqual(16);
    expect(Math.max(...seen.values())).toBeLessThanOrEqual(4);
  });
});

describe("a description says who a voice IS, not who it is FOR", () => {
  const v = (notes: string, gender = "", name = "X"): VoiceEntry => ({ id: "t", name, provider: "elevenlabs", source: "account", language: "en", accent: "american", gender, notes, createdAt: "" });
  const kid = ["for kids", "great for children's stories", "perfect for kids' content", "kid-friendly", "narrating bedtime stories for toddlers", "ideal for young adult fiction", "a voice for women's health podcasts", "designed for teens and seniors"];
  for (const n of kid) {
    it(`"${n}" does not make a narrator a child, an elder or the wrong gender`, () => {
      for (let i = 0; i < 20; i++) {
        const a = autoAvatar(manifest, "s" + i, "Male", voiceHint(v(n, "Male")))!;
        expect(["child", "teen", "elderly", "older_adult"], n).not.toContain(a.age_category);
        expect(LOOKS[a.id]!.g, n).toBe("m");
      }
    });
  }
  it("a decade in a range is the first one named: late 40s to early 60s is a man in his forties", () => {
    for (let i = 0; i < 20; i++) {
      const a = autoAvatar(manifest, "d" + i, "", voiceHint(v("A deep British male voice, late 40s to early 60s")))!;
      expect(["adult", "middle_aged", "older_adult"]).toContain(a.age_category);
    }
  });
  it("the tags in a voice name count: 'Sarah - Mature, Reassuring'", () => {
    for (let i = 0; i < 20; i++) {
      const a = autoAvatar(manifest, "n" + i, "Female", voiceHint(v("", "Female", "Sarah - Mature, Reassuring")))!;
      expect(["adult", "middle_aged", "older_adult"]).toContain(a.age_category);
    }
  });
});
