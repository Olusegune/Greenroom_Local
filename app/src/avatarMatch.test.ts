import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { filterAvatars, lookLabel, LOOKS, validateManifest, type AvatarManifest } from "./avatarLibrary";
import { matchFaces, pickFace } from "./avatarMatch";

const manifest = validateManifest(JSON.parse(readFileSync(join(__dirname, "..", "public", "avatars", "manifest.json"), "utf8"))).manifest as AvatarManifest;
const looks = (r: ReturnType<typeof matchFaces>) => r.faces.map((f) => LOOKS[f.entry.id]!);

describe("strict portrait matching", () => {
  it("chooses no face at all when no gender is stated", () => {
    const r = matchFaces(manifest, { age: "mid", heritage: "black" });
    expect(r.faces).toEqual([]);
    expect(r.reason).toMatch(/No gender is stated/);
  });
  it("never crosses a stated gender, for every gender, age and heritage that is asked for", () => {
    for (const gender of ["m", "f"] as const) for (const age of [undefined, "young", "mid", "old"] as const) for (const heritage of [undefined, "black", "white", "east_asian", "south_asian"] as const) {
      const r = matchFaces(manifest, { gender, ...(age ? { age } : {}), ...(heritage ? { heritage } : {}) });
      for (const l of looks(r)) {
        expect(l.g, `${gender}/${age}/${heritage}`).toBe(gender);
        if (heritage) expect(l.h, `${gender}/${age}/${heritage}`).toBe(heritage);
      }
    }
  });
  it("a stated heritage is never given up: when no portrait fits, there is none rather than a different one", () => {
    const r = matchFaces(manifest, { gender: "f", age: "child", heritage: "middle_eastern" });
    for (const l of looks(r)) expect(l.h).toBe("middle_eastern");
    if (!r.faces.length) expect(r.reason).toMatch(/No portrait in the library/);
  });
  it("a Black woman of middle age gets only Black women, and an older Black man only Black men", () => {
    const w = matchFaces(manifest, { gender: "f", age: "mid", heritage: "black" });
    expect(w.faces.length).toBeGreaterThan(0);
    for (const l of looks(w)) { expect(l.g).toBe("f"); expect(l.h).toBe("black"); }
    const m = matchFaces(manifest, { gender: "m", age: "old", heritage: "black" });
    for (const l of looks(m)) { expect(l.g).toBe("m"); expect(l.h).toBe("black"); }
  });
  it("a child or teen gets only child or teen portraits, and nobody else ever does", () => {
    const kid = matchFaces(manifest, { gender: "m", age: "child" });
    for (const f of kid.faces) expect(["child", "teen"]).toContain(f.entry.age_category);
    for (const age of ["young", "mid", "old", undefined] as const) {
      const r = matchFaces(manifest, { gender: "f", ...(age ? { age } : {}) });
      for (const f of r.faces) expect(["child", "teen"]).not.toContain(f.entry.age_category);
    }
  });
  it("is not given costume or creature portraits unless asked, and never a non-person", () => {
    for (const f of matchFaces(manifest, { gender: "m" }).faces) { expect(f.entry.id.startsWith("everyday_") || f.entry.id.startsWith("contemporary_") || f.entry.id.startsWith("global_") || f.entry.id.startsWith("custom:")).toBe(true); expect(LOOKS[f.entry.id]!.g).not.toBe("n"); }
  });
  it("is stable, and spreads over the least used faces", () => {
    const r = matchFaces(manifest, { gender: "f", age: "mid" });
    expect(pickFace(r, "a")!.id).toBe(pickFace(r, "a")!.id);
    const usage = new Map<string, number>();
    const seen = new Set<string>();
    for (let i = 0; i < r.faces.length; i++) { const a = pickFace(r, "seed" + i, usage)!; usage.set(a.id, (usage.get(a.id) ?? 0) + 1); seen.add(a.id); }
    expect(seen.size).toBeGreaterThan(1);
  });
  it("returns nothing when the library is not loaded", () => {
    expect(matchFaces(null, { gender: "f" }).faces).toEqual([]);
  });
});

describe("browsing the library by what a portrait shows", () => {
  it("filters by gender and heritage, and a portrait with no label never passes", () => {
    const blackWomen = filterAvatars(manifest.avatars, { gender: "f", heritage: "black" });
    expect(blackWomen.length).toBeGreaterThan(3);
    for (const a of blackWomen) { expect(LOOKS[a.id]!.g).toBe("f"); expect(LOOKS[a.id]!.h).toBe("black"); }
    for (const a of filterAvatars(manifest.avatars, { gender: "m" })) expect(LOOKS[a.id]!.g).toBe("m");
    const unlabelled = manifest.avatars.filter((a) => !LOOKS[a.id]);
    for (const a of unlabelled) expect(filterAvatars([a], { gender: "m" })).toEqual([]);
  });
  it("says in words what a portrait shows", () => {
    expect(lookLabel("everyday_afro_001")).toBe("Female, Black / African");
    expect(lookLabel("everyday_white_man_001")).toBe("Male, White / European");
    expect(lookLabel("stylized_bear_chef_001")).toBe("Not a person");
    expect(lookLabel("no_such_portrait")).toBe("");
  });
});
