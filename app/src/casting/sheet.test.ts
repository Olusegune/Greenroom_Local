import { describe, expect, it } from "vitest";
import { applyCharacterSheet, factsFrom, readCharacterSheet } from "./sheet";
import { extractStated } from "./extract";
import { char } from "./fixtures";

const NL = String.fromCharCode(10);
const NAMES = ["VENOMSPUR", "RICO", "MISS GRIMBLE", "MAMA T"];
const SHEET = [
  "VENOMSPUR", "", "Elderly, highly educated British male voice. Rich baritone, restrained, dry, with condescending politeness.", "",
  "RICO", "", "Young Nigerian male rapper, late twenties. Lagos-influenced Nigerian English with light Pidgin code-switching.", "", "",
  "MISS GRIMBLE", "", "Middle-aged British woman. Crisp, clipped, bureaucratic, effortlessly sarcastic.", "",
  "MAMA T", "", "Elderly Nigerian woman. Warm but commanding Nigerian English accent with brief Yoruba expressions.",
].join(NL);

describe("reading a character sheet", () => {
  it("finds the paragraph under each name", () => {
    const s = readCharacterSheet(SHEET, NAMES);
    expect(Object.keys(s).sort()).toEqual([...NAMES].sort());
    expect(s["VENOMSPUR"]).toMatch(/^Elderly, highly educated British male voice/);
    expect(s["MAMA T"]).toMatch(/Nigerian English accent/);
  });
  it("ignores names it does not know, names without a paragraph, and dialogue lines", () => {
    const s = readCharacterSheet(["BEN", "", "Tall and quiet, a young man of few words.", "", "ADA: Hello there, how are you today?", "", "RICO"].join(NL), ["BEN", "ADA", "RICO"]);
    expect(Object.keys(s)).toEqual(["BEN"]);
  });
  it("also reads one line each under a Characters heading", () => {
    const s = readCharacterSheet(["Characters", "ADA: A young woman, sharp and quick.", "BEN - An elderly man who speaks slowly.", "", "# Scene one", "ADA: Hello there."].join(NL), ["ADA", "BEN"]);
    expect(s["ADA"]).toMatch(/young woman/);
    expect(s["BEN"]).toMatch(/elderly man/);
  });
  it("does not read a colon line as a description when there is no Characters heading", () => {
    expect(readCharacterSheet("ADA: A young woman, sharp and quick.", ["ADA"])).toEqual({});
  });
  it("copes with bold names and markdown", () => {
    const s = readCharacterSheet(["**RICO**", "", "Young Nigerian male rapper, late twenties. Fast talker."].join(NL), ["RICO"]);
    expect(s["RICO"]).toMatch(/^Young Nigerian male rapper/);
  });
  it("limits what it keeps", () => {
    const s = readCharacterSheet(["ADA", "", "word ".repeat(300)].join(NL), ["ADA"]);
    expect(s["ADA"]!.length).toBeLessThanOrEqual(400);
  });
});

describe("what a description states", () => {
  it("takes gender, age and accent for the four stress-test characters, and each with its quote", () => {
    const s = readCharacterSheet(SHEET, NAMES);
    const f = (n: string) => factsFrom(n, s[n]!);
    expect(f("VENOMSPUR").spec).toMatchObject({ vocalGender: "masculine", vocalAge: ["old"], accent: "British", accentStrictness: "preferred" });
    expect(f("RICO").spec).toMatchObject({ vocalGender: "masculine", accent: "Nigerian" });
    expect(f("MISS GRIMBLE").spec).toMatchObject({ vocalGender: "feminine", vocalAge: ["mid"] });
    expect(f("MAMA T").spec).toMatchObject({ vocalGender: "feminine", vocalAge: ["old"] });
    expect(f("VENOMSPUR").quotes.some((q) => /British male voice/.test(q))).toBe(true);
  });
  it("does not turn 'a British woman' into an accent, or a nationality into a language", () => {
    const e = extractStated("MISS GRIMBLE", "Middle-aged British woman. Crisp and clipped.");
    expect(e.spec.accent).toBeUndefined();
    expect(e.spec.language).toBeUndefined();
    expect(e.spec.nationality).toBe("British");
  });
  it("reads '<Nationality> English' and '<Nationality> male voice' as how the voice speaks, as a preference only", () => {
    expect(extractStated("A", "A man with Nigerian English and a loud laugh.").spec).toMatchObject({ accent: "Nigerian", accentStrictness: "preferred" });
    expect(extractStated("B", "A British female voice, calm.").spec).toMatchObject({ accent: "British", accentStrictness: "preferred" });
    expect(extractStated("C", "She is Nigerian.").spec.accent).toBeUndefined();
  });
});

describe("applying a sheet", () => {
  it("fills about, requirements and look, and never overwrites what the owner already set", () => {
    const s = readCharacterSheet(SHEET, NAMES);
    const out = applyCharacterSheet([char("v", "VENOMSPUR"), char("r", "RICO", { about: "my own words", cast: { version: 1, vocalGender: "feminine" }, look: { gender: "f" } })], s);
    expect(out[0]!.about).toMatch(/British male voice/);
    expect(out[0]!.cast?.vocalGender).toBe("masculine");
    expect(out[0]!.look).toMatchObject({ gender: "m", age: "old" });
    expect(out[1]).toMatchObject({ about: "my own words", cast: { vocalGender: "feminine" }, look: { gender: "f" } });
  });
  it("does nothing for a character the sheet does not describe", () => {
    const c = char("x", "NOBODY");
    expect(applyCharacterSheet([c], readCharacterSheet(SHEET, NAMES))[0]).toBe(c);
  });
});
