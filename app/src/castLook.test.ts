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

describe("a stated gender or age steers the voice, never a name, a heritage or a description", () => {
  const need = (g: "m" | "f", age?: "child" | "teen" | "young" | "mid" | "old") => ({ look: { gender: g, ...(age ? { age } : {}) } });
  it("a female character is never given a male voice, and a voice with no recorded gender is left for the owner to audition", () => {
    const p = planCast([ch("a", "Ada", need("f"))], [lib[0]!], { roles: [] });
    expect(p.assign).toEqual({});
    expect(p.proposals).toEqual([]);
    expect(p.none[0]!.why).toMatch(/masculine voice; the character's stated gender calls for a feminine voice/);
  });
  it("a claimed (provider-labelled) gender is a candidate to audition, not an assignment", () => {
    const p = planCast([ch("t", "Tunde", need("m"))], lib, { roles: [] });
    expect(p.assign).toEqual({});
    expect(p.proposals[0]!.candidates[0]!.voiceId).toBe("m1");
    expect(p.proposals[0]!.candidates[0]!.status).toBe("NEEDS_AUDITION");
  });
  it("an adult character does not get a child's voice, and a child is offered one", () => {
    const adult = planCast([ch("a", "Ada", need("f", "mid"))], lib, { roles: [] });
    expect(adult.proposals[0]!.candidates.map((c) => c.voiceId)).not.toContain("k1");
    const kid = planCast([ch("b", "Bisi", need("f", "child"))], lib, { roles: [] });
    expect(kid.proposals[0]!.candidates[0]!.voiceId).toBe("k1");
  });
  it("a heritage or a description in the script is NOT a requirement: it neither steers nor excludes a voice", () => {
    const p = planCast([ch("a", "Ada", { about: "ADA (60s, Nigerian) sits. She taps her watch.", look: { heritage: "black" } })], lib, { roles: [] });
    expect(p.assign).toEqual({});
    // all four voices stay offered: nothing was stated that could rule one out
    expect(p.proposals[0]!.candidates).toHaveLength(4);
    expect(p.proposals[0]!.ruledOut).toEqual([]);
  });
  it("a name says nothing: with no stated gender no voice is ruled out", () => {
    const p = planCast([ch("t", "Tunde"), ch("a", "Ada")], [voice("only-m", { gender: "male" }), voice("only-f", { gender: "female" })], { roles: [] });
    expect(p.proposals.every((x) => x.ruledOut.length === 0)).toBe(true);
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
