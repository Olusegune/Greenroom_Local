import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { LOOKS, voiceFace, type AvatarManifest } from "./avatarLibrary";

const manifest = JSON.parse(readFileSync(new URL("../public/avatars/manifest.json", import.meta.url), "utf8")) as AvatarManifest;
const voices = JSON.parse(readFileSync(new URL("./fixtures/voices.sample.json", import.meta.url), "utf8")) as { id: string; name: string; gender: string; accent: string; language: string }[];
const look = (id: string) => LOOKS[id]!;

describe("every voice in a list gets a face that does not contradict what it states", () => {
  it("gives every voice of the sample library a face", () => {
    expect(voices.length).toBeGreaterThan(30);
    for (const v of voices) expect(voiceFace(manifest, v), v.name).not.toBeNull();
  });
  it("never crosses a stated gender", () => {
    for (const v of voices) {
      const f = voiceFace(manifest, v)!;
      if (v.gender === "male") expect(look(f.id).g, v.name).toBe("m");
      if (v.gender === "female") expect(look(f.id).g, v.name).toBe("f");
    }
  });
  it("a voice that states no gender gets a neutral portrait (a robot, alien or creature), not a guessed person", () => {
    const f = voiceFace(manifest, { id: "mystery", gender: "", accent: "", language: "en" })!;
    expect(look(f.id).g).toBe("n");
    const g = voiceFace(manifest, { id: "mystery2", gender: "neutral", accent: "", language: "en" })!;
    expect(look(g.id).g).toBe("n");
  });
  it("a Nigerian, Indian or Korean accent chooses a matching heritage when portraits fit; a British or American one chooses none", () => {
    for (const [accent, h] of [["Nigerian", "black"], ["Indian", "south_asian"], ["Korean", "east_asian"]] as const) {
      for (const gender of ["male", "female"]) {
        const f = voiceFace(manifest, { id: accent + gender, gender, accent, language: "en" })!;
        expect(look(f.id).h, accent + gender).toBe(h);
      }
    }
    const heritages = new Set<string | undefined>();
    for (let i = 0; i < 60; i++) heritages.add(look(voiceFace(manifest, { id: "uk" + i, gender: "female", accent: "British", language: "en" })!.id).h);
    expect(heritages.size).toBeGreaterThan(2);
  });
  it("a Piper voice with no gender field gets the gender of its named speaker, for the picture only", () => {
    const amy = voiceFace(manifest, { id: "en_US-amy-medium", provider: "piper", gender: "", accent: "American", language: "en" })!;
    expect(look(amy.id).g).toBe("f");
    const alan = voiceFace(manifest, { id: "en_GB-alan-medium", provider: "piper", gender: "", accent: "British", language: "en" })!;
    expect(look(alan.id).g).toBe("m");
    const unknown = voiceFace(manifest, { id: "xx_YY-nobody-low", provider: "piper", gender: "", accent: "", language: "en" })!;
    expect(look(unknown.id).g).toBe("n");
  });
  it("the same voice always gets the same face", () => {
    const v = { id: "abc", gender: "female", accent: "Nigerian", language: "en" };
    expect(voiceFace(manifest, v)!.id).toBe(voiceFace(manifest, v)!.id);
  });
  it("the owner's stated heritage and age outrank the accent", () => {
    const f = voiceFace(manifest, { id: "q", gender: "male", accent: "Nigerian", language: "en", heritage: "white" })!;
    expect(look(f.id).h).toBe("white");
  });
});
