import { describe, expect, it } from "vitest";
import type { Character, VoiceEntry } from "../types";
import { applyPreset, readyEnginesFrom, voicesFor } from "./cast";
import { STARTER_PRESETS } from "./index";
import { addCustom, EMPTY_STATE, KEY, loadState, markRecent, removeCustom, saveState, toggleFavorite } from "./state";

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }; };
const preset = (id: string) => STARTER_PRESETS.find((p) => p.id === id)!;
const voice = (over: Partial<VoiceEntry> = {}): VoiceEntry => ({ id: "v1", name: "Fiona", provider: "elevenlabs", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "", ...over });
const ada: Character = { id: "c1", name: "Ada", language: "English" };

describe("preset state", () => {
  it("survives a blocked, empty or corrupt store", () => {
    expect(loadState(null)).toEqual(EMPTY_STATE);
    expect(loadState({ getItem: () => { throw new Error("blocked"); }, setItem: () => undefined })).toEqual(EMPTY_STATE);
    const s = mem(); s.setItem(KEY, "{not json");
    expect(loadState(s)).toEqual(EMPTY_STATE);
    expect(saveState({ getItem: () => null, setItem: () => { throw new Error("full"); } }, EMPTY_STATE)).toBe(false);
  });
  it("keeps favourites, recents (newest first, capped) and custom presets across a reload", () => {
    let s = toggleFavorite(EMPTY_STATE, "a");
    s = toggleFavorite(s, "b");
    s = toggleFavorite(s, "a");
    expect(s.favorites).toEqual(["b"]);
    for (let i = 0; i < 20; i++) s = markRecent(s, `p${i}`);
    s = markRecent(s, "p5");
    expect(s.recent).toHaveLength(12);
    expect(s.recent[0]).toBe("p5");
    s = addCustom(s, [{ ...preset("film_tv.noir-detective"), id: "custom-x", availability: "custom" }]);
    const store = mem();
    expect(saveState(store, s)).toBe(true);
    expect(loadState(store)).toEqual(s);
  });
  it("drops invalid custom presets on load and never removes starters", () => {
    const store = mem();
    store.setItem(KEY, JSON.stringify({ favorites: ["x"], custom: [{ id: "bad" }] }));
    expect(loadState(store).custom).toHaveLength(0);
    const s = addCustom(EMPTY_STATE, [{ ...preset("games.shopkeeper"), id: "custom-s", availability: "custom" }]);
    expect(removeCustom(s, "custom-s").custom).toHaveLength(0);
    expect(STARTER_PRESETS.some((p) => p.id === "games.shopkeeper")).toBe(true);
  });
});

describe("engine readiness for presets", () => {
  const keys = { elevenlabs: true, voicekiller: false, inworld: false, kie: false };
  it("counts a cloud engine with a key and a local engine with a voice", () => {
    expect(readyEnginesFrom(keys, [{ provider: "piper" }])).toEqual(["elevenlabs", "piper"]);
    expect(readyEnginesFrom({ ...keys, elevenlabs: false }, [])).toEqual([]);
  });
  it("offers only voices on engines that meet the preset's needs", () => {
    const lib = [voice(), voice({ id: "p", provider: "piper", name: "Amy" })];
    const ready = readyEnginesFrom(keys, lib);
    expect(voicesFor(preset("film_tv.noir-detective"), lib, ready).map((v) => v.id)).toEqual(["v1"]);
    expect(voicesFor(preset("corporate.software-tutorial"), lib, ready).map((v) => v.id).sort()).toEqual(["p", "v1"]);
  });
});

describe("applying a preset to a character", () => {
  it("fills an empty profile and records the chosen voice as the approved identity", () => {
    const r = applyPreset(ada, preset("film_tv.noir-detective"), { voice: voice() });
    expect(r.character.voiceId).toBe("v1");
    expect(r.character.dna?.identity?.voiceId).toBe("v1");
    expect(r.character.dna?.timbre).toContain("gravelly");
    expect(r.filled).toContain("voice");
    expect(r.character.look?.gender).toBe("m");
  });
  it("keeps what the owner already wrote unless asked to replace it", () => {
    const base: Character = { ...ada, dna: { version: 1, timbre: "my own timbre", accent: "", tendencies: "", range: "", presets: [], pronunciations: [], references: [], identity: null } };
    const kept = applyPreset(base, preset("film_tv.noir-detective"));
    expect(kept.character.dna?.timbre).toBe("my own timbre");
    expect(kept.kept).toContain("timbre");
    expect(applyPreset(base, preset("film_tv.noir-detective"), { replace: true }).character.dna?.timbre).toContain("gravelly");
  });
  it("without a voice changes no voice and says the profile is all that was filled", () => {
    const r = applyPreset({ ...ada, voiceId: "keep" }, preset("games.shopkeeper"));
    expect(r.character.voiceId).toBe("keep");
    expect(r.filled).not.toContain("voice");
  });
  it("warns about unknown licences, missing consent and unverified accents", () => {
    const r = applyPreset(ada, preset("international.yoruba-english"), { voice: voice({ source: "cloned" }) });
    expect(r.warnings.join(" ")).toMatch(/licence/);
    expect(r.warnings.join(" ")).toMatch(/consent/);
    expect(r.warnings.join(" ")).toMatch(/experimental/);
  });
  it("warns when the voice's engine cannot perform the preset", () => {
    const r = applyPreset(ada, preset("film_tv.noir-detective"), { voice: voice({ provider: "piper" }) });
    expect(r.warnings.join(" ")).toMatch(/cannot perform/);
  });
  it("does not mutate the original character", () => {
    const copy = JSON.stringify(ada);
    applyPreset(ada, preset("games.shopkeeper"), { voice: voice() });
    expect(JSON.stringify(ada)).toBe(copy);
  });
});
