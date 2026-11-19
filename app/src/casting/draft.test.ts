import { describe, expect, it } from "vitest";
import { planDraftCasting } from "./draft";
import { assignVoice } from "./lock";
import { char, KOKORO_F, MAN_UK, NOW, PIPER_ALAN, voice, WOMAN_MID_UK } from "./fixtures";
import { readCasting } from "./persist";

const PIPER_AMY = voice("en_US-amy-medium", { name: "Amy (American)", provider: "piper", accent: "American", gender: "female" });
const draft = (characters: ReturnType<typeof char>[], id: string, v: ReturnType<typeof voice> | null, extra: object = {}) => assignVoice(characters, { characterId: id, voice: v, by: "draft", now: NOW, draft: { placeholder: false, basis: ["stated: a feminine voice"] }, ...extra });

describe("a draft voice fills an empty slot and nothing more", () => {
  it("gives the character the voice, records that the agent chose it as a draft, and approves nothing", () => {
    const r = draft([char("a", "ADA")], "a", PIPER_AMY);
    expect(r.ok).toBe(true);
    const c = r.characters[0]!;
    expect(c.voiceId).toBe("en_US-amy-medium");
    expect(c.casting?.approval).toBeUndefined();
    expect(c.casting?.draft).toMatchObject({ voiceId: "en_US-amy-medium", engine: "piper", placeholder: false });
    expect(c.casting?.history.at(-1)).toMatchObject({ action: "assigned", by: "draft" });
    expect(c.casting?.history.at(-1)?.reason).toMatch(/Not approved/);
  });
  it("never approves: asking to approve is refused", () => {
    const r = draft([char("a", "ADA")], "a", PIPER_AMY, { approve: true });
    expect(r.ok).toBe(false);
    expect(r.code).toBe("needs_owner");
  });
  it("never replaces a voice the character already has, an approved voice, or an earlier draft", () => {
    const has = char("a", "ADA", { voiceId: "other" });
    expect(draft([has], "a", PIPER_AMY).ok).toBe(false);
    const owner = assignVoice([char("a", "ADA")], { characterId: "a", voice: MAN_UK, by: "owner", approve: true, acknowledge: true, now: NOW });
    expect(draft(owner.characters, "a", PIPER_AMY).code).toBe("locked");
    const first = draft([char("a", "ADA")], "a", PIPER_AMY);
    expect(draft(first.characters, "a", KOKORO_F).ok).toBe(false);
  });
  it("never uses a voice that conflicts with what is stated", () => {
    const woman = char("a", "ADA", { look: { gender: "f" } });
    const r = draft([woman], "a", MAN_UK);
    expect(r.ok).toBe(false);
    expect(r.code).toBe("incompatible");
    expect(r.characters[0]!.voiceId).toBeUndefined();
  });
  it("is ended by the owner's own choice or approval, which are then recorded as the owner's", () => {
    const d = draft([char("a", "ADA")], "a", PIPER_AMY).characters;
    const chosen = assignVoice(d, { characterId: "a", voice: KOKORO_F, by: "owner", confirmChange: true, now: NOW });
    expect(chosen.ok).toBe(true);
    expect(chosen.characters[0]!.casting?.draft).toBeUndefined();
    const approved = assignVoice(d, { characterId: "a", voice: PIPER_AMY, by: "owner", approve: true, acknowledge: true, confirmChange: true, now: NOW });
    expect(approved.ok).toBe(true);
    expect(approved.characters[0]!.casting?.draft).toBeUndefined();
    expect(approved.characters[0]!.casting?.approval).toBeDefined();
  });
  it("is read back from a saved project, but never next to an approval, and a damaged draft is dropped", () => {
    const d = draft([char("a", "ADA")], "a", PIPER_AMY).characters[0]!.casting!;
    expect(readCasting(JSON.parse(JSON.stringify(d)))?.draft?.voiceId).toBe("en_US-amy-medium");
    const withApproval = { ...d, approval: { voiceId: "x", engine: "piper", voiceName: "X", modelId: null, speakerId: null, approvedAt: NOW, version: 1, basis: "NEEDS_AUDITION", acknowledged: [], by: "owner" } };
    expect(readCasting(JSON.parse(JSON.stringify(withApproval)))?.draft).toBeUndefined();
    expect(readCasting({ ...d, draft: { voiceId: 5, status: "VERIFIED" } })?.draft).toBeUndefined();
  });
});

describe("planning the drafts", () => {
  const lib = [PIPER_ALAN, PIPER_AMY, KOKORO_F, voice("cloud-f", { name: "Cloud woman", gender: "female", accent: "British" }), WOMAN_MID_UK];
  it("uses only voices on this PC unless cloud is allowed", () => {
    const p = planDraftCasting([char("a", "ADA", { look: { gender: "f" } })], lib, {}, { allowCloud: false });
    expect(p.picks).toHaveLength(1);
    expect(["piper", "kokoro", "chatterbox", "qwen", "wazobia", "local"]).toContain(lib.find((v) => v.id === p.picks[0]!.voiceId)!.provider);
  });
  it("respects a stated gender", () => {
    const p = planDraftCasting([char("a", "ADA", { look: { gender: "f" } }), char("b", "BEN", { look: { gender: "m" } })], lib, {}, { allowCloud: false });
    const g = (id: string) => lib.find((v) => v.id === p.picks.find((x) => x.characterId === id)!.voiceId)!.gender;
    expect(g("a")).toBe("female");
    expect(g("b")).toBe("male");
  });
  it("gives distinct voices to different characters while there are enough, and says so when nothing was stated", () => {
    const p = planDraftCasting([char("a", "ADA"), char("b", "BEN"), char("c", "CAL")], lib, {}, { allowCloud: false });
    expect(p.picks).toHaveLength(3);
    expect(new Set(p.picks.map((x) => x.voiceId)).size).toBe(3);
    expect(p.picks.every((x) => x.placeholder)).toBe(true);
    expect(p.picks[0]!.basis[0]).toMatch(/placeholder/);
  });
  it("leaves alone a character that already has a voice or an approval", () => {
    const p = planDraftCasting([char("a", "ADA", { voiceId: PIPER_AMY.id }), char("b", "BEN")], lib, {}, { allowCloud: false });
    expect(p.picks.map((x) => x.characterId)).toEqual(["b"]);
    expect(p.picks[0]!.voiceId).not.toBe(PIPER_AMY.id);
  });
  it("says so when no allowed voice can serve a character", () => {
    const p = planDraftCasting([char("a", "ADA", { look: { gender: "f" } })], [PIPER_ALAN], {}, { allowCloud: false });
    expect(p.picks).toHaveLength(0);
    expect(p.none).toHaveLength(1);
  });
  it("prefers a quick engine to a slow one when both fit", () => {
    const slow = voice("qwen-x", { name: "Qwen woman", provider: "qwen", gender: "female" });
    const p = planDraftCasting([char("a", "ADA", { look: { gender: "f" } })], [slow, PIPER_AMY], {}, { allowCloud: false });
    expect(p.picks[0]!.voiceId).toBe("en_US-amy-medium");
  });
  it("makes no pick at all for an empty library", () => {
    expect(planDraftCasting([char("a", "ADA")], [], {}, { allowCloud: true }).picks).toEqual([]);
  });
});
