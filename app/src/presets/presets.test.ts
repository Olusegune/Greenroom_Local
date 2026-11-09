import { describe, expect, it } from "vitest";
import { compatibleEngines, duplicatePreset, EXPECTED_COUNTS, exportPresets, filterPresets, GENRES, importPresets, readiness, recommend, STARTER_PRESETS, validatePreset, type VoicePreset } from "./index";

describe("starter library", () => {
  it("has exactly 120 unique ids", () => {
    expect(STARTER_PRESETS).toHaveLength(120);
    expect(new Set(STARTER_PRESETS.map((p) => p.id)).size).toBe(120);
  });
  it("covers all 12 genres with the required counts", () => {
    expect(GENRES).toHaveLength(12);
    for (const g of GENRES) expect(STARTER_PRESETS.filter((p) => p.genre === g)).toHaveLength(EXPECTED_COUNTS[g]);
  });
  it("every preset passes the validator unchanged", () => {
    for (const p of STARTER_PRESETS) {
      const r = validatePreset(p);
      expect(r.ok, p.id).toBe(true);
      if (r.ok) expect(r.preset, p.id).toEqual(p);
    }
  });
  it("makes no unverifiable claims", () => {
    for (const p of STARTER_PRESETS) {
      expect(["native_reviewed", "community_reviewed"], p.id).not.toContain(p.accent.quality);
      expect(p.license.voiceRights).toBe("defined_by_voice");
      expect(p.portraitId, "no invented portrait paths").toBeUndefined();
      expect(p.needs.cloning, "starter presets never imply cloning").toBeUndefined();
    }
  });
  it("has an engine that can perform every preset on paper", () => {
    for (const p of STARTER_PRESETS) expect(compatibleEngines(p).length, p.id).toBeGreaterThan(0);
  });
  it("covers children, elders, and every presentation", () => {
    const ages = new Set(STARTER_PRESETS.flatMap((p) => p.ageRange));
    for (const a of ["child", "teen", "young_adult", "adult", "middle_aged", "older_adult", "elderly"] as const) expect(ages.has(a), a).toBe(true);
    for (const g of ["male", "female"] as const) expect(STARTER_PRESETS.some((p) => p.gender === g)).toBe(true);
  });
  it("lists the Nigerian starters as experimental and engine-limited", () => {
    const ng = STARTER_PRESETS.filter((p) => /nigerian/i.test(p.name));
    expect(ng.length).toBe(4);
    for (const p of ng) {
      expect(p.accent.quality).toBe("experimental");
      expect(compatibleEngines(p).sort()).toEqual(["elevenlabs", "wazobia"]);
    }
  });
});

describe("validation", () => {
  const base = STARTER_PRESETS[0]!;
  it("refuses a hostile or incomplete preset without throwing", () => {
    expect(validatePreset(null).ok).toBe(false);
    expect(validatePreset({ ...base, id: "../etc/passwd" }).ok).toBe(false);
    expect(validatePreset({ ...base, genre: "nope" }).ok).toBe(false);
    expect(validatePreset({ ...base, accent: { label: "x", quality: "perfect" } }).ok).toBe(false);
    expect(validatePreset({ ...base, license: { kind: "commercial", voiceRights: "granted" } }).ok).toBe(false);
  });
  it("cleans control characters and clamps numbers", () => {
    const r = validatePreset({ ...base, name: "A\u0000B\n C", acting: { ...base.acting, pace: 99, projection: -4 } });
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.preset.name).toBe("A B C"); expect(r.preset.acting.pace).toBe(1.5); expect(r.preset.acting.projection).toBe(0); }
  });
});

describe("search and filter", () => {
  it("finds by word, genre, age and engine", () => {
    expect(filterPresets(STARTER_PRESETS, { query: "noir" }).map((p) => p.id)).toContain("film_tv.noir-detective");
    expect(filterPresets(STARTER_PRESETS, { genre: "games" })).toHaveLength(14);
    expect(filterPresets(STARTER_PRESETS, { age: "child" }).every((p) => p.ageRange.includes("child"))).toBe(true);
    const piper = filterPresets(STARTER_PRESETS, { engines: ["piper"] });
    expect(piper.length).toBeGreaterThan(0);
    expect(piper.length).toBeLessThan(120);
    expect(piper.every((p) => !p.needs.words && !p.needs.nonverbal)).toBe(true);
  });
  it("filters favourites", () => {
    expect(filterPresets(STARTER_PRESETS, { favoritesOnly: true }, new Set(["film_tv.noir-detective"]))).toHaveLength(1);
  });
  it("recommends without reading appearance into accent, and respects private text", () => {
    const r = recommend(STARTER_PRESETS, { genre: "animation", age: "child", keywords: ["curious"] });
    expect(r[0]!.preset.id).toBe("animation.curious-child");
    const priv = recommend(STARTER_PRESETS, { genre: "film_tv", private: true, keywords: ["noir"] }, ["piper"]);
    expect(priv.every((x) => compatibleEngines(x.preset).some((e) => ["piper", "chatterbox", "wazobia", "local"].includes(e)))).toBe(true);
  });
});

describe("readiness", () => {
  const noir = STARTER_PRESETS.find((p) => p.id === "film_tv.noir-detective")!;
  it("never offers an audition with no compatible engine or voice", () => {
    expect(readiness(noir, ["piper"], ["piper"]).state).toBe("needs_engine");
    const nv = readiness(noir, ["elevenlabs"], []);
    expect(nv.state).toBe("needs_voice");
    expect(readiness(noir, ["elevenlabs"], ["elevenlabs"]).state).toBe("ready");
  });
});

describe("custom, duplicate, import, export", () => {
  const p = STARTER_PRESETS[3]!;
  it("duplicates without changing the starter", () => {
    const d = duplicatePreset(p, new Set(STARTER_PRESETS.map((x) => x.id)));
    expect(d.id).not.toBe(p.id);
    expect(d.availability).toBe("custom");
    expect(p.availability).toBe("starter");
  });
  it("round-trips an export and never overwrites an existing id", () => {
    const json = exportPresets([p]);
    const r = importPresets(json, new Set(STARTER_PRESETS.map((x) => x.id)));
    expect(r.presets).toHaveLength(1);
    expect(r.presets[0]!.id).not.toBe(p.id);
    expect(r.presets[0]!.availability).toBe("imported");
  });
  it("skips bad entries and rejects foreign files", () => {
    expect(importPresets("not json", new Set()).presets).toHaveLength(0);
    expect(importPresets('{"format":"other"}', new Set()).presets).toHaveLength(0);
    const mixed = JSON.stringify({ format: "greenroom.voice-presets", presets: [p, { id: "bad" }] });
    const r = importPresets(mixed, new Set());
    expect(r.presets).toHaveLength(1);
    expect(r.skipped).toHaveLength(1);
  });
  it("is stable across a re-export (migration is idempotent)", () => {
    const r = validatePreset(JSON.parse(JSON.stringify(p)) as VoicePreset);
    expect(r.ok && r.preset).toEqual(p);
  });
});
