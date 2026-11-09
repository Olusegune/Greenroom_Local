import { describe, expect, it } from "vitest";
import { STARTER_PRESETS } from "./index";
import { addReview, buildAccentTests, earnedQuality, exportReviews, importReviews, isSupportive, loadReviews, readReview, saveReviews, type AccentReview } from "./accentTests";

const tests = buildAccentTests(STARTER_PRESETS);
const yoruba = tests.find((t) => /yoruba/.test(t.id))!;
const PASS = { intelligible: "pass", pronunciation: "pass", rhythm: "pass", no_caricature: "pass", consistent: "pass", names: "pass" } as const;
const review = (over: Partial<AccentReview> = {}): AccentReview => ({ id: "r" + Math.random(), testId: yoruba.id, engine: "elevenlabs", voiceName: "Ada", reviewer: { name: "Tunde", relation: "native_speaker" }, date: "2026-11-10", ratings: { ...PASS }, verdict: "supported", comment: "", imported: false, ...over });
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) }; };

describe("a listening test for every advertised accent", () => {
  it("covers every accent and language the presets advertise, once each, and skips neutral and invented", () => {
    const advertised = new Set(STARTER_PRESETS.filter((p) => !["Neutral", "Invented"].includes(p.accent.label)).map((p) => `${p.language}|${p.accent.label}`));
    expect(tests.length).toBe(advertised.size);
    expect(new Set(tests.map((t) => t.id)).size).toBe(tests.length);
    expect(tests.flatMap((t) => t.presetIds).length).toBe(STARTER_PRESETS.filter((p) => !["Neutral", "Invented"].includes(p.accent.label)).length);
  });
  it("includes the four Nigerian accents, Pidgin and Latin American Spanish", () => {
    for (const k of ["yoruba", "igbo", "hausa", "pidgin", "spanish"]) expect(tests.some((t) => t.id.includes(k)), k).toBe(true);
  });
  it("has short phrases for each, and marks the ones whose wording needs a native check", () => {
    for (const t of tests) { expect(t.phrases.length, t.id).toBeGreaterThanOrEqual(2); for (const p of t.phrases) expect(p.length).toBeLessThan(120); }
    expect(tests.filter((t) => t.phrasesNeedReview).every((t) => /pidgin|spanish/.test(t.id))).toBe(true);
    expect(tests.find((t) => /pidgin/.test(t.id))!.note).toMatch(/replace these phrases/);
  });
});

describe("a label goes up only through a recorded review", () => {
  it("with no review it keeps the label it shipped with", () => {
    expect(earnedQuality([], yoruba.id, "elevenlabs", "Ada", "experimental")).toMatchObject({ quality: "experimental" });
  });
  it("one supportive review by a native speaker on this computer earns native-speaker reviewed, for that voice only", () => {
    const rs = [review()];
    expect(earnedQuality(rs, yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("native_reviewed");
    expect(earnedQuality(rs, yoruba.id, "elevenlabs", "Someone else", "experimental").quality).toBe("experimental");
    expect(earnedQuality(rs, yoruba.id, "wazobia", "Ada", "experimental").quality).toBe("experimental");
  });
  it("a review with a failed required criterion, or a verdict of partly, does not raise the label", () => {
    expect(isSupportive(review({ ratings: { ...PASS, pronunciation: "fail" } }))).toBe(false);
    expect(isSupportive(review({ ratings: { ...PASS, intelligible: undefined } }))).toBe(false);
    expect(earnedQuality([review({ verdict: "partly" })], yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("experimental");
  });
  it("a community reviewer alone is not enough; two make it community reviewed", () => {
    const one = [review({ reviewer: { name: "Ngozi", relation: "community_member" } })];
    expect(earnedQuality(one, yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("experimental");
    const two = [...one, review({ reviewer: { name: "Bola", relation: "community_member" } })];
    expect(earnedQuality(two, yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("community_reviewed");
  });
  it("the same person twice does not count as two", () => {
    const rs = [review({ reviewer: { name: "Ngozi", relation: "community_member" } }), review({ reviewer: { name: "ngozi", relation: "community_member" } })];
    expect(earnedQuality(rs, yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("experimental");
  });
  it("a newer native review that finds it not supported marks it unsupported", () => {
    const rs = [review({ date: "2026-11-10" }), review({ date: "2026-12-01", verdict: "not_supported", ratings: { ...PASS, pronunciation: "fail" } })];
    expect(earnedQuality(rs, yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("unsupported");
  });
  it("imported reviews can never earn native-speaker reviewed, because Greenroom cannot check who wrote them", () => {
    const rs = [review({ imported: true })];
    expect(earnedQuality(rs, yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("experimental");
    const two = [review({ imported: true, reviewer: { name: "A", relation: "native_speaker" } }), review({ imported: true, reviewer: { name: "B", relation: "native_speaker" } })];
    expect(earnedQuality(two, yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("community_reviewed");
  });
  it("an 'other' reviewer never raises a label", () => {
    expect(earnedQuality([review({ reviewer: { name: "Me", relation: "other" } })], yoruba.id, "elevenlabs", "Ada", "experimental").quality).toBe("experimental");
  });
});

describe("keeping and sharing reviews", () => {
  it("reads only complete, sensible reviews and cleans the text", () => {
    expect(readReview(null)).toBeNull();
    expect(readReview({ testId: "x", engine: "elevenlabs", verdict: "supported", reviewer: { name: "", relation: "native_speaker" } })).toBeNull();
    expect(readReview({ testId: "x", engine: "rm -rf", verdict: "supported", reviewer: { name: "A", relation: "native_speaker" } })).toBeNull();
    const r = readReview({ testId: "x", engine: "piper", verdict: "partly", reviewer: { name: "A\u0000B", relation: "other" }, comment: "c".repeat(5000), ratings: { intelligible: "pass", bogus: "pass" } })!;
    expect(r.reviewer.name).toBe("A B");
    expect(r.comment.length).toBe(600);
    expect(Object.keys(r.ratings)).toEqual(["intelligible"]);
  });
  it("survives a blocked store and keeps reviews across a reload", () => {
    expect(loadReviews(null)).toEqual([]);
    expect(saveReviews({ getItem: () => null, setItem: () => { throw new Error("full"); } }, [review()])).toBe(false);
    const s = mem(); const r = review();
    expect(saveReviews(s, addReview([], r))).toBe(true);
    expect(loadReviews(s)).toEqual([r]);
  });
  it("exports only reviews made here, and everything imported is marked imported", () => {
    const own = review({ id: "own" }); const got = review({ id: "got", imported: true });
    const file = exportReviews([own, got]);
    expect(file).toContain('"own"'); expect(file).not.toContain('"got"');
    const back = importReviews(file);
    expect(back.reviews).toHaveLength(1);
    expect(back.reviews[0]!.imported).toBe(true);
  });
  it("refuses foreign or broken files", () => {
    expect(importReviews("nope").reviews).toEqual([]);
    expect(importReviews('{"format":"x"}').reviews).toEqual([]);
    expect(importReviews(JSON.stringify({ format: "greenroom.accent-reviews", reviews: [{ junk: 1 }, review()] })).skipped).toBe(1);
  });
});
