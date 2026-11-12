import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LOOKS, readVoice, validateManifest, type AvatarEntry, type AvatarManifest } from "../avatarLibrary";
import { STARTER_PRESETS } from "./index";
import { assignPresetFaces, PRESET_APPEARANCE, presetAge, presetHint } from "./portraits";

// Runs against the real library on disk, like the avatar tests, so a wrong match is caught here.
const manifest = validateManifest(JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "avatars", "manifest.json"), "utf8"))).manifest as AvatarManifest;
const byId = new Map(manifest.avatars.map((a) => [a.id, a]));
const faces = assignPresetFaces(manifest, STARTER_PRESETS);
const childish = (a: AvatarEntry) => a.age_category === "child" || a.age_category === "teen";

describe("a face for every preset, from the existing library", () => {
  it("every face id exists in the library (no invented paths)", () => {
    expect(faces.size).toBeGreaterThan(15);
    for (const [pid, aid] of faces) expect(byId.has(aid), `${pid} -> ${aid}`).toBe(true);
  });
  it("a preset that states no gender, and is no named role, gets NO face: a neutral mark, never a guess", () => {
    for (const p of STARTER_PRESETS) {
      if (p.gender === "male" || p.gender === "female") continue;
      if (readVoice("", presetHint(p)).story) continue;
      expect(faces.has(p.id), `${p.id} states no gender but was given ${faces.get(p.id)}`).toBe(false);
    }
  });
  it("a preset that states a culture but not how the character looks gets no face", () => {
    for (const p of STARTER_PRESETS.filter((x) => x.culture && !PRESET_APPEARANCE[x.id])) expect(faces.has(p.id), p.id).toBe(false);
  });
  it("a stated appearance is never crossed: Yoruba, Igbo, Hausa, Pidgin, Filipino and Indian presets get the look their author wrote", () => {
    for (const [id, h] of Object.entries(PRESET_APPEARANCE)) {
      const aid = faces.get(id);
      if (aid) expect(LOOKS[aid]?.h, `${id} -> ${aid}`).toBe(h);
    }
    // the ones that also state a gender must have a face (the library has portraits for each look)
    for (const id of ["international.yoruba-english", "international.igbo-english", "international.hausa-english", "international.filipino-english", "international.indian-english"]) expect(faces.has(id), id).toBe(true);
  });
  it("is stable, and adding a preset at the end does not change the earlier faces", () => {
    expect([...assignPresetFaces(manifest, STARTER_PRESETS)]).toEqual([...faces]);
    const extra = assignPresetFaces(manifest, [...STARTER_PRESETS, { ...STARTER_PRESETS[0]!, id: "custom.extra" }]);
    for (const [pid, aid] of faces) expect(extra.get(pid)).toBe(aid);
  });
  it("spreads the faces: no portrait is given to more than three presets", () => {
    const n = new Map<string, number>();
    for (const aid of faces.values()) n.set(aid, (n.get(aid) ?? 0) + 1);
    expect(Math.max(...n.values())).toBeLessThanOrEqual(3);
    expect(n.size).toBeGreaterThan(faces.size * 0.8);
  });
  it("never crosses a stated gender", () => {
    for (const p of STARTER_PRESETS) {
      const g = p.gender === "male" ? "m" : p.gender === "female" ? "f" : null;
      const look = LOOKS[faces.get(p.id)!];
      if (g && look && look.g !== "n") expect(look.g, p.id).toBe(g);
    }
  });
  it("gives child and teen portraits only to child and teen presets, and never to the rest", () => {
    for (const p of STARTER_PRESETS) {
      if (!faces.has(p.id)) continue;
      const a = byId.get(faces.get(p.id)!)!;
      const age = presetAge(p);
      if (age === "child") expect(childish(a), `${p.id} should get a child or teen face`).toBe(true);
      else if (age !== "teen") expect(a.age_category === "child", `${p.id} must not get a child's face`).toBe(false);
    }
  });
  it("an adult presenter whose name says children's still gets an adult face", () => {
    const host = STARTER_PRESETS.find((p) => p.id === "education.kids-host")!;
    expect(presetAge(host)).toBe("young");
    if (faces.has(host.id)) expect(byId.get(faces.get(host.id)!)!.age_category).not.toBe("child");
  });
  it("elderly presets get older faces and children get children", () => {
    // these two state no gender, so they get no face; the ones that state one and are old or young must match their age
    for (const p of STARTER_PRESETS) {
      if (!faces.has(p.id)) continue;
      const a = byId.get(faces.get(p.id)!)!;
      if (presetAge(p) === "old" && !LOOKS[a.id]?.g.includes("n")) expect(["older_adult", "elderly", "middle_aged"], p.id).toContain(a.age_category);
    }
  });
});

describe("appearance is kept apart from accent, language and culture", () => {
  it("the matcher never sees a heritage word, so an accent can never pick a face", () => {
    for (const p of STARTER_PRESETS) expect(readVoice("", presetHint(p)).h, `${p.id}: ${presetHint(p)}`).toBeUndefined();
  });
  it("international presets are matched on age and presentation only", () => {
    for (const p of STARTER_PRESETS.filter((x) => x.genre === "international")) expect(presetHint(p)).toBe("");
  });
  it("the text matcher still never reads an accent: only the written appearance table sets a heritage", () => {
    const yo = STARTER_PRESETS.find((p) => p.id === "international.yoruba-english")!;
    const ig = STARTER_PRESETS.find((p) => p.id === "international.igbo-english")!;
    expect(presetHint(yo)).toBe(presetHint(ig));
    expect(PRESET_APPEARANCE[yo.id]).toBe("black");
  });
  it("story roles still work: the android and the dragon are not given an ordinary person's face when a role face exists", () => {
    for (const id of ["fantasy_horror_scifi.android", "fantasy_horror_scifi.dragon-creature"]) expect(faces.has(id)).toBe(true);
  });
});

describe("a preset's own portrait wins", () => {
  it("keeps a valid portraitId and ignores one that is not in the library", () => {
    const some = manifest.avatars[0]!.id;
    const m = assignPresetFaces(manifest, [{ ...STARTER_PRESETS[0]!, portraitId: some }, { ...STARTER_PRESETS[1]!, portraitId: "nope_999" }]);
    expect(m.get(STARTER_PRESETS[0]!.id)).toBe(some);
    expect(m.get(STARTER_PRESETS[1]!.id)).not.toBe("nope_999");
  });
  it("returns nothing, rather than a guess, when the library is not loaded", () => {
    expect(assignPresetFaces(null, STARTER_PRESETS).size).toBe(0);
  });
});
