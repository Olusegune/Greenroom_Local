import { describe, expect, it } from "vitest";
import { extractStated } from "./extract";

const ex = (name: string, t: string) => extractStated(name, t);

describe("the casting agent reads only what the script states", () => {
  it("an elderly Yoruba-speaking grandfather: age, gender and language are stated, with their quotes", () => {
    const r = ex("Baba", "An elderly Yoruba-speaking grandfather, slow and deliberate.");
    expect(r.spec).toMatchObject({ vocalAge: ["old"], vocalGender: "masculine", language: "Yoruba", languageStrictness: "required" });
    expect(r.stated.find((s) => s.field === "language")!.quote).toMatch(/Yoruba-speaking/);
    expect(r.spec.notes).toMatch(/From the script/);
  });
  it("a nationality is NOT an accent, a language or a gender: it is recorded and questioned", () => {
    const r = ex("Ada", "A Nigerian grandmother.");
    expect(r.spec.accent).toBeUndefined();
    expect(r.spec.language).toBeUndefined();
    expect(r.spec.nationality).toBe("Nigerian");
    expect(r.questions.join(" ")).toMatch(/Nigerian\. That does not say how they sound/);
  });
  it("nothing is invented when the script says nothing", () => {
    const r = ex("Guard", "");
    expect(r.spec).toEqual({});
    expect(r.stated).toEqual([]);
    expect(r.questions[0]).toMatch(/says nothing about their voice/);
  });
  it("a middle-aged British detective: age and nationality stated, gender and accent left as questions", () => {
    const r = ex("Detective", "A middle-aged British detective.");
    expect(r.spec.vocalAge).toEqual(["mid"]);
    expect(r.spec.vocalGender).toBeUndefined();
    expect(r.questions.some((q) => /no vocal gender is stated/.test(q))).toBe(true);
    expect(r.questions.some((q) => /British\. That does not say/.test(q))).toBe(true);
  });
  it("ages from numbers and decades; a kinship word alone is not an age", () => {
    expect(ex("A", "ADA (60s, Nigerian) sits.").spec.vocalAge).toEqual(["old"]);
    expect(ex("A", "She is 8 years old.").spec.vocalAge).toEqual(["child"]);
    expect(ex("A", "He is 16 years old.").spec.vocalAge).toEqual(["teen"]);
    expect(ex("A", "His grandfather arrives.").spec.vocalAge).toBeUndefined();
  });
  it("conflicting gendered words are a question, not a guess", () => {
    const r = ex("X", "He and she share a name.");
    expect(r.spec.vocalGender).toBeUndefined();
    expect(r.questions.join(" ")).toMatch(/both masculine and feminine/);
  });
  it("an explicit accent is stated; creative ideas are suggestions and never in the spec", () => {
    const r = ex("Demon", "An aristocratic man with a British accent.");
    expect(r.spec).toMatchObject({ vocalGender: "masculine", accent: "British", accentStrictness: "preferred" });
    const none = ex("Robot", "A robotic voice.");
    expect(none.suggestions.length).toBeGreaterThan(0);
    expect(Object.keys(none.spec)).toEqual([]);
  });
  it("a name is never read as a gender", () => {
    expect(ex("Tunde", "Tunde enters.").spec.vocalGender).toBeUndefined();
  });
});
