import { describe, expect, it } from "vitest";
import { evaluate, rank, summaryOf } from "./engine";
import { accentRelation, langKey } from "./lang";
import { requirementsOf } from "./requirements";
import { applyMetaChange, profileOf, readMeta, speakerOf } from "./voiceProfile";
import { BOY_US, CLAIMED_MAN, DEEP_WOMAN, ELDER_MAN, HIGH_MAN, KOKORO_F, MAN_UK, NOW, PIPER_ALAN, TEEN_NG, WOMAN_MID_UK, YORUBA_ELDER, char, listened, voice } from "./fixtures";

const eval1 = (c: Parameters<typeof char>[2], v: Parameters<typeof profileOf>[0], ctx = {}) => evaluate(requirementsOf(char("c", "C", c)), profileOf(v), ctx);

describe("the engine returns the right status, with reasons", () => {
  it("VERIFIED_MATCH: elderly Yoruba grandfather against a Yoruba masculine old voice, everything listened to", () => {
    const m = eval1({ cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"], language: "Yoruba" } }, YORUBA_ELDER);
    expect(m.status).toBe("VERIFIED_MATCH");
    expect(m.reasons.length).toBeGreaterThan(0);
  });
  it("NEEDS_AUDITION: right on paper, but never listened to", () => {
    const m = eval1({ cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"] } }, CLAIMED_MAN);
    expect(m.status).toBe("NEEDS_AUDITION");
    expect(m.reasons.some((r) => r.outcome === "unverified")).toBe(true);
  });
  it("UNKNOWN_METADATA: the voice says nothing about its age", () => {
    const v = listened(voice("half"), { gender: "masculine", languages: ["english"] });
    expect(eval1({ cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"] } }, v).status).toBe("UNKNOWN_METADATA");
  });
  it("INCOMPATIBLE: an English-only voice for a Yoruba character", () => {
    const m = eval1({ cast: { version: 1, language: "Yoruba" }, language: "Yoruba" }, ELDER_MAN);
    expect(m.status).toBe("INCOMPATIBLE");
    expect(summaryOf(m)).toMatch(/english only|needs Yoruba/i);
  });
  it("UNAVAILABLE: a good fit whose engine is not installed is reported, not swapped", () => {
    const m = eval1({ cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"], language: "Yoruba" } }, YORUBA_ELDER, { available: () => ({ ok: false, why: "the Wazobia model is not installed" }) });
    expect(m.status).toBe("UNAVAILABLE");
    expect(m.reasons.some((r) => /not installed/.test(r.text))).toBe(true);
  });
  it("COMPATIBLE_WITH_LIMITATIONS: one age band away but confirmed", () => {
    const m = eval1({ cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"] } }, MAN_UK);
    expect(m.status).toBe("COMPATIBLE_WITH_LIMITATIONS");
  });
  it("with nothing required nothing is verified", () => {
    const m = eval1({ language: "" }, ELDER_MAN);
    expect(m.status).toBe("COMPATIBLE_WITH_LIMITATIONS");
    expect(m.reasons.some((r) => r.attribute === "requirements")).toBe(true);
  });
});

describe("hard requirements are never relaxed", () => {
  const lib = [ELDER_MAN, WOMAN_MID_UK, BOY_US, TEEN_NG, MAN_UK, DEEP_WOMAN, HIGH_MAN].map(profileOf);
  it("a masculine requirement ranks no feminine voice as a fit", () => {
    const r = rank(requirementsOf(char("c", "C", { cast: { version: 1, vocalGender: "masculine" } })), lib);
    for (const m of r) if (m.voiceId === "woman-uk" || m.voiceId === "deep-woman" || m.voiceId === "teen-ng") expect(m.status).toBe("INCOMPATIBLE");
    expect(r[0]!.status).not.toBe("INCOMPATIBLE");
  });
  it("a child requirement rules out every adult voice", () => {
    const r = rank(requirementsOf(char("c", "C", { cast: { version: 1, vocalAge: ["child"] } })), lib);
    expect(r.find((m) => m.voiceId === "boy-us")!.status).toBe("VERIFIED_MATCH");
    for (const m of r.filter((x) => x.voiceId !== "boy-us")) expect(m.status).toBe("INCOMPATIBLE");
  });
  it("a required accent rules out a different accent and is never silently relaxed", () => {
    const req = requirementsOf(char("c", "C", { cast: { version: 1, accent: "Nigerian English", accentStrictness: "required" } }));
    expect(evaluate(req, profileOf(listened(voice("us"), { accent: "American" }))).status).toBe("INCOMPATIBLE");
    expect(evaluate(req, profileOf(listened(voice("ng"), { accent: "Nigerian" }))).status).toBe("VERIFIED_MATCH");
  });
  it("a preferred accent only orders voices", () => {
    const req = requirementsOf(char("c", "C", { cast: { version: 1, accent: "Nigerian English" } }));
    expect(evaluate(req, profileOf(listened(voice("us"), { accent: "American" }))).status).not.toBe("INCOMPATIBLE");
  });
  it("consent and licence are never traded for a better fit", () => {
    const cloned = voice("c1", { source: "cloned" });
    expect(eval1({}, cloned).status).toBe("INCOMPATIBLE");
    const l2 = voice("en_US-l2arctic-medium@3", { provider: "piper", accent: "Arabic English", gender: "female" });
    expect(eval1({}, l2, { commercial: true }).status).toBe("INCOMPATIBLE");
    expect(eval1({}, l2, { commercial: false }).status).not.toBe("INCOMPATIBLE");
  });
});

describe("unknown is never treated as proof", () => {
  it("a Piper voice is not given a gender from its name", () => {
    const p = profileOf(PIPER_ALAN);
    expect(p.gender.value).toBeNull();
    expect(p.gender.status).toBe("unknown");
    expect(eval1({ cast: { version: 1, vocalGender: "masculine" } }, PIPER_ALAN).status).toBe("UNKNOWN_METADATA");
  });
  it("words in a description are not read as facts", () => {
    const v = voice("d", { notes: "An old man, a grandfather, he is eighty years old" });
    const p = profileOf(v);
    expect(p.age.value).toBeNull();
    expect(p.gender.value).toBeNull();
  });
  it("Kokoro's documented gender is a claim until someone listens", () => {
    const p = profileOf(KOKORO_F);
    expect(p.gender).toMatchObject({ value: "feminine", status: "unverified", source: "engine_documentation" });
  });
  it("a route fact (Piper is single-language) is verified; a cloud label is not", () => {
    expect(profileOf(PIPER_ALAN).languages.status).toBe("verified");
    expect(profileOf(CLAIMED_MAN).languages.status).toBe("unverified");
  });
  it("a cloud voice labelled English might speak another language, and says so instead of failing or passing", () => {
    const m = eval1({ cast: { version: 1, language: "Yoruba" } }, CLAIMED_MAN);
    expect(m.status).toBe("UNKNOWN_METADATA");
    expect(m.reasons.find((r) => r.attribute === "languages")!.text).toMatch(/has not verified/);
  });
});

describe("what a character requires comes only from what was stated", () => {
  it("ethnicity, nationality and cultural background never become a requirement", () => {
    const r = requirementsOf(char("c", "C", { language: "", look: { heritage: "black" }, cast: { version: 1, nationality: "Nigerian", culturalBackground: "Yoruba" } }));
    expect(r.empty).toBe(true);
    expect(r.accent).toBeUndefined();
    expect(r.language).toBeUndefined();
    expect(r.gender).toBeUndefined();
  });
  it("the default label English, and a free label Greenroom does not know, are preferences; a set language is a rule", () => {
    expect(requirementsOf(char("c", "C")).language!.strictness).toBe("preferred");
    expect(requirementsOf(char("c", "C", { language: "Taglish" })).language!.strictness).toBe("preferred");
    expect(requirementsOf(char("c", "C", { language: "Yoruba" })).language!.strictness).toBe("required");
    expect(requirementsOf(char("c", "C", { cast: { version: 1, language: "English" } })).language!.strictness).toBe("required");
  });
  it("the stated look gender and age are read as requirements and named as such", () => {
    const r = requirementsOf(char("c", "C", { look: { gender: "m", age: "old" } }));
    expect(r.gender).toMatchObject({ value: "masculine", strictness: "required" });
    expect(r.age!.value).toEqual(["old"]);
  });
  it("a name alone says nothing", () => {
    expect(requirementsOf(char("c", "Tunde")).gender).toBeUndefined();
  });
});

describe("pitch is never a gender test", () => {
  it("a woman with a deep voice stays eligible for a feminine character", () => {
    const m = eval1({ cast: { version: 1, vocalGender: "feminine", pitch: "high" } }, DEEP_WOMAN);
    expect(m.status).toBe("VERIFIED_MATCH");
  });
  it("a man with a high voice is not rejected for his pitch", () => {
    const m = eval1({ cast: { version: 1, vocalGender: "masculine", pitch: "low" } }, HIGH_MAN);
    expect(m.status).toBe("VERIFIED_MATCH");
  });
});

describe("language and accent helpers", () => {
  it("reads codes and names as the same language", () => {
    expect(langKey("en-US")).toBe("english");
    expect(langKey("Yoruba")).toBe("yoruba");
    expect(langKey("yo")).toBe("yoruba");
  });
  it("Nigerian English is not American English, and Scottish is only related to British", () => {
    expect(accentRelation("Nigerian English", "American")).toBe("different");
    expect(accentRelation("Nigerian English", "Nigerian")).toBe("same");
    expect(accentRelation("British", "Scottish")).toBe("related");
    expect(accentRelation("Nigerian", "")).toBe("unknown");
  });
});

describe("recording what the owner heard", () => {
  it("listening makes a fact verified, typing without listening does not, and the old fact is kept as evidence", () => {
    const v0 = voice("v");
    const typed = applyMetaChange(v0, { gender: "masculine", listened: false }, NOW);
    expect(profileOf(typed).gender.status).toBe("unverified");
    const heard = applyMetaChange(typed, { gender: "masculine", listened: true, evidence: "heard in the audition" }, NOW);
    expect(profileOf(heard).gender).toMatchObject({ status: "verified", source: "owner_listening" });
    expect(heard.meta!.revisions).toHaveLength(2);
    expect(heard.meta!.revisions[1]!.before.gender!.status).toBe("unverified");
    expect(v0.meta).toBeUndefined(); // the original voice was not changed
  });
  it("a saved file cannot smuggle in a verified label from an unlisted source", () => {
    const meta = readMeta({ version: 1, gender: { value: "feminine", status: "verified", source: "name_table", confidence: "high" }, revisions: [] })!;
    expect(meta.gender!.status).toBe("unverified");
    const ok = readMeta({ version: 1, gender: { value: "feminine", status: "verified", source: "owner_listening", confidence: "high" }, revisions: [] })!;
    expect(ok.gender!.status).toBe("verified");
    expect(readMeta({ version: 1, gender: { value: "robot", status: "verified", source: "owner_listening" }, revisions: [] })!.gender).toBeUndefined();
  });
  it("a speaker number travels with the voice", () => {
    expect(speakerOf(voice("en_US-l2arctic-medium@7", { provider: "piper" }))).toBe("7");
    expect(speakerOf(voice("ife@yo", { provider: "wazobia" }))).toBe("yo");
    expect(speakerOf(voice("abc@def", { provider: "elevenlabs" }))).toBeNull();
  });
});
