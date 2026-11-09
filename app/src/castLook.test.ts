import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { planCast } from "./autocast";
import { autoAvatar, validateManifest, LOOKS, type AvatarManifest } from "./avatarLibrary";
import { convertScript } from "./scriptImport";
import type { Character, VoiceEntry } from "./types";

const voice = (id: string, over: Partial<VoiceEntry>): VoiceEntry => ({ id, name: id, provider: "elevenlabs", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "", ...over });
const ch = (id: string, name: string, over: Partial<Character> = {}): Character => ({ id, name, language: "English", ...over });
const lib = [voice("m1", { gender: "male", accent: "american" }), voice("f1", { gender: "female", accent: "american" }), voice("f2", { gender: "female", accent: "nigerian", age: "old" }), voice("k1", { gender: "female", age: "child" })];

describe("a stated gender, age or heritage steers the voice; a name never does", () => {
  it("a female character is not given a male voice while a female voice exists", () => {
    const p = planCast([ch("a", "Ada", { look: { gender: "f" } })], lib, { roles: [] });
    expect(["f1", "f2", "k1"]).toContain(p.assign.a);
  });
  it("a male character is given the male voice", () => {
    expect(planCast([ch("t", "Tunde", { look: { gender: "m" } })], lib, { roles: [] }).assign.t).toBe("m1");
  });
  it("an older Nigerian woman gets the older Nigerian female voice", () => {
    const p = planCast([ch("a", "Ada", { look: { gender: "f", age: "old", heritage: "black" } })], lib, { roles: [] });
    expect(p.assign.a).toBe("f2");
  });
  it("an adult character is not given a child's voice, and a child is given one", () => {
    expect(planCast([ch("a", "Ada", { look: { gender: "f", age: "mid" } })], lib, { roles: [] }).assign.a).not.toBe("k1");
    expect(planCast([ch("b", "Bisi", { look: { gender: "f", age: "child" } })], lib, { roles: [] }).assign.b).toBe("k1");
  });
  it("what the script says about a character counts when no look was set, but a name alone does not", () => {
    expect(planCast([ch("a", "Ada", { about: "ADA (60s, Nigerian) sits. She taps her watch." })], lib, { roles: [] }).assign.a).toBe("f2");
    // the name Ada or Tunde says nothing: with no stated gender the choice is not steered by it
    const p = planCast([ch("t", "Tunde"), ch("a", "Ada")], [voice("only-m", { gender: "male" }), voice("only-f", { gender: "female" })], { roles: [] });
    expect(Object.keys(p.assign).sort()).toEqual(["a", "t"]);
  });
  it("every character still gets a voice, and distinct ones when there are enough", () => {
    const cs = [ch("a", "Ada", { look: { gender: "f" } }), ch("b", "Bisi", { look: { gender: "f" } }), ch("t", "Tunde", { look: { gender: "m" } })];
    const p = planCast(cs, lib, { roles: [] });
    expect(new Set(Object.values(p.assign)).size).toBe(3);
    expect(p.assign.t).toBe("m1");
  });
});

describe("an imported screenplay flows into faces", () => {
  const manifest = validateManifest(JSON.parse(readFileSync(join(__dirname, "..", "public", "avatars", "manifest.json"), "utf8"))).manifest as AvatarManifest;
  it("the description found in the script picks a fitting face", () => {
    const c = convertScript("INT. KITCHEN - DAY\n\nADA (60s, Nigerian) sits at the table. She taps her watch.\n\nADA\nHello.\n\nTUNDE\nHi.\n\nADA\nBye.\n");
    const ada = c.characters.find((x) => x.name === "Ada")!;
    for (let i = 0; i < 30; i++) {
      const a = autoAvatar(manifest, "s" + i, ada.gender === "f" ? "female" : "", ada.about, { age: ada.age, heritage: ada.heritage })!;
      expect(LOOKS[a.id]!.g).toBe("f");
      expect(LOOKS[a.id]!.h).toBe("black");
      expect(["older_adult", "elderly"]).toContain(a.age_category);
    }
  });
});
