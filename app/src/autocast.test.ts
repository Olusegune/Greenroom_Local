import { describe, expect, it } from "vitest";
import { describePlan, planCast, wantsNarration } from "./autocast";
import { PIPER_ROLES } from "./castcall";
import { ELDER_MAN, MAN_UK, WOMAN_MID_UK, char, listened, voice } from "./casting/fixtures";
import { assignVoice } from "./casting/lock";
import type { Character, VoiceEntry } from "./types";

const v = (id: string, over: Partial<VoiceEntry> = {}): VoiceEntry => voice(id, { provider: "piper", ...over });
const ch = (id: string, name: string, over: Partial<Character> = {}): Character => char(id, name, over);

describe("auto-cast decides only what it can prove", () => {
  it("with nothing stated about the characters it assigns nothing and proposes ranked candidates", () => {
    const lib = [v("a", { accent: "British" }), v("b", { accent: "American" }), v("c", { accent: "Scottish" })];
    const plan = planCast([ch("1", "PIP"), ch("2", "BOLO"), ch("3", "GUARD")], lib);
    expect(plan.assign).toEqual({});
    expect(plan.proposals.map((p) => p.characterId).sort()).toEqual(["1", "2", "3"]);
    for (const p of plan.proposals) expect(p.candidates.length).toBeGreaterThan(0);
  });
  it("assigns a voice only when it is a VERIFIED_MATCH for something required", () => {
    const lib = [ELDER_MAN, WOMAN_MID_UK];
    const plan = planCast([ch("g", "Grandfather", { cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"] } })], lib);
    expect(plan.assign).toEqual({ g: "elder-man" });
    expect(plan.proposals).toEqual([]);
  });
  it("never assigns a voice that is only claimed to fit", () => {
    const claimed = voice("claimed", { gender: "male", age: "old" });
    const plan = planCast([ch("g", "Grandfather", { cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"] } })], [claimed]);
    expect(plan.assign).toEqual({});
    expect(plan.proposals[0]!.candidates[0]!.status).toBe("NEEDS_AUDITION");
  });
  it("never changes a character that already has a voice, and does not reuse it", () => {
    const lib = [ELDER_MAN, MAN_UK];
    const plan = planCast([ch("1", "A", { voiceId: "elder-man" }), ch("2", "B", { cast: { version: 1, vocalGender: "masculine" } })], lib);
    expect(plan.assign).toEqual({ "2": "man-uk" });
  });
  it("never touches a locked character, even if its voice has gone from the library", () => {
    const locked = assignVoice([ch("1", "A")], { characterId: "1", voice: ELDER_MAN, by: "owner", approve: true, acknowledge: true, now: "t" }).characters;
    const plan = planCast(locked, [MAN_UK]);
    expect(plan.assign).toEqual({});
    expect(plan.proposals).toEqual([]);
    expect(plan.none).toEqual([]);
  });
  it("a required language rules out voices of other languages; none is a result, not a fallback", () => {
    const lib = [v("en"), v("fr", { language: "French" })];
    const fr = planCast([ch("1", "AMELIE", { language: "French" })], lib);
    expect(fr.assign).toEqual({ "1": "fr" });
    const yo = planCast([ch("2", "TUNDE", { language: "Yoruba" })], lib);
    expect(yo.assign).toEqual({});
    expect(yo.proposals).toEqual([]);
    expect(yo.none).toHaveLength(1);
    expect(yo.none[0]!.why).toMatch(/needs Yoruba/);
  });
  it("two characters with the same need get different voices when there are enough, and a shared one is flagged", () => {
    const need = { cast: { version: 1 as const, vocalGender: "masculine" as const } };
    const two = planCast([ch("1", "A", need), ch("2", "B", need)], [ELDER_MAN, MAN_UK]);
    expect(new Set(Object.values(two.assign)).size).toBe(2);
    const one = planCast([ch("1", "A", need), ch("2", "B", need)], [MAN_UK]);
    expect(Object.keys(one.assign)).toHaveLength(1);
    expect(one.proposals[0]!.shared || one.proposals.length === 1).toBe(true);
  });
  it("narration names get narration voices first, among voices of the same status", () => {
    const lib = [v("chatty", { notes: "Casual, podcast co-host" }), v("doc", { notes: "Narrator, documentary" })];
    const plan = planCast([ch("1", "PIP"), ch("2", "Narrator")], lib);
    expect(plan.proposals.find((p) => p.characterId === "2")!.candidates[0]!.voiceId).toBe("doc");
    expect(wantsNarration("NARRATOR")).toBe(true);
    expect(wantsNarration("Ada")).toBe(false);
  });
  it("suggests Casting-call voices for a character the library cannot serve, never one that conflicts", () => {
    const plan = planCast([ch("1", "A", { language: "French" })], []);
    expect(plan.suggestions).toHaveLength(1);
    expect(plan.suggestions[0]!.role.language).toBe("French");
    const yo = planCast([ch("2", "T", { language: "Yoruba" })], []);
    expect(yo.suggestions).toEqual([]);
    for (const s of plan.suggestions) expect(PIPER_ROLES.some((r) => r.key === s.role.key)).toBe(true);
  });
  it("does not suggest a voice that is already in the library", () => {
    const key = PIPER_ROLES.find((r) => r.language === "French")!.key;
    const plan = planCast([ch("1", "A", { language: "French" }), ch("2", "B", { language: "French" })], [v(key, { language: "French" })]);
    expect(plan.suggestions.every((s) => s.role.key !== key)).toBe(true);
  });
  it("is deterministic and describes the plan in words", () => {
    const chars = [ch("1", "PIP", { cast: { version: 1, vocalGender: "masculine" } })];
    const lib = [{ ...MAN_UK, name: "Alan" }];
    expect(planCast(chars, lib)).toEqual(planCast(chars, lib));
    expect(describePlan(planCast(chars, lib), chars, lib)).toEqual(["PIP: Alan"]);
  });
});

void listened;
