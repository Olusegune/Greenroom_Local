// The casting regression suite: one test for each way a character has been given the wrong voice. These run against fixture voices
// with KNOWN metadata (see fixtures.ts). They prove the rules; they do not prove how any voice sounds.

import { describe, expect, it } from "vitest";
import { planCast } from "../autocast";
import { applyCast, castFrom } from "../cast";
import { CastingError, clipRequest, makeBeatTake, makeTake, plan, remakeBeat } from "../generate";
import { applyPreset } from "../presets/cast";
import { STARTER_PRESETS } from "../presets/index";
import { parseScript } from "../script";
import type { Character } from "../types";
import { buildManifest } from "../manifest";
import { auditCasting, assignVoice, castingGuard, isLocked, unlockVoice } from "./lock";
import { readProjectCasting } from "./persist";
import { rank } from "./engine";
import { requirementsOf } from "./requirements";
import { profileOf, speakerOf } from "./voiceProfile";
import { BOY_US, DEEP_WOMAN, ELDER_MAN, MAN_UK, NOW, PIPER_ALAN, TEEN_NG, WOMAN_MID_UK, YORUBA_ELDER, char, line, project, take, voice } from "./fixtures";

const owner = (characters: Character[], characterId: string, v: Parameters<typeof assignVoice>[1]["voice"], extra: Partial<Parameters<typeof assignVoice>[1]> = {}) => assignVoice(characters, { characterId, voice: v, by: "owner", now: NOW, ...extra });
const approved = (c: Character, v = ELDER_MAN) => owner([c], c.id, v, { approve: true, acknowledge: true }).characters[0]!;

describe("approval is a lock", () => {
  it("an approved elderly masculine voice stays with the elderly male character through every non-owner path", () => {
    const grand = char("g", "Grandfather", { cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"] } });
    const [locked] = owner([grand], "g", ELDER_MAN, { approve: true }).characters;
    expect(isLocked(locked!)).toBe(true);
    for (const by of ["agent", "auto", "preset", "cast_import", "script_edit", "model_switch"] as const) {
      const r = assignVoice([locked!], { characterId: "g", voice: WOMAN_MID_UK, by, now: NOW });
      expect(r.ok, by).toBe(false);
      expect(r.code, by).toBe("locked");
      expect(r.characters[0]!.voiceId, by).toBe("elder-man");
      expect(r.characters[0]!.casting!.approval!.voiceId, by).toBe("elder-man");
    }
  });
  it("a refused attempt is written to the history", () => {
    const [c] = owner([char("g", "G")], "g", ELDER_MAN, { approve: true, acknowledge: true }).characters;
    const r = assignVoice([c!], { characterId: "g", voice: MAN_UK, by: "agent", now: NOW });
    expect(r.characters[0]!.casting!.history.at(-1)).toMatchObject({ action: "refused", by: "agent" });
  });
  it("the owner can change it, but only by confirming", () => {
    const [c] = owner([char("g", "G")], "g", ELDER_MAN, { approve: true, acknowledge: true }).characters;
    expect(owner([c!], "g", MAN_UK, { approve: true, acknowledge: true }).code).toBe("locked");
    const changed = owner([c!], "g", MAN_UK, { approve: true, acknowledge: true, confirmChange: true });
    expect(changed.code).toBe("approved");
    expect(changed.characters[0]!.casting!.approval).toMatchObject({ voiceId: "man-uk", version: 2 });
    expect(changed.characters[0]!.casting!.history.map((h) => h.action)).toEqual(["approved", "refused", "changed"].filter((a) => a !== "refused"));
  });
  it("unlocking is the owner's alone and leaves the voice in place", () => {
    const [c] = owner([char("g", "G")], "g", ELDER_MAN, { approve: true, acknowledge: true }).characters;
    expect(unlockVoice([c!], "g", "agent", NOW).ok).toBe(false);
    const u = unlockVoice([c!], "g", "owner", NOW);
    expect(u.ok).toBe(true);
    expect(isLocked(u.characters[0]!)).toBe(false);
    expect(u.characters[0]!.voiceId).toBe("elder-man");
  });
  it("only the owner can approve, and an unproven voice needs the owner's acknowledgement", () => {
    const g = char("g", "G", { cast: { version: 1, vocalGender: "masculine" } });
    expect(assignVoice([g], { characterId: "g", voice: ELDER_MAN, by: "agent", approve: true, now: NOW }).code).toBe("needs_owner");
    const claimed = voice("claimed", { gender: "male" });
    const r = owner([g], "g", claimed, { approve: true });
    expect(r.code).toBe("needs_acknowledgement");
    expect(r.characters[0]!.casting).toBeUndefined();
    const ok = owner([g], "g", claimed, { approve: true, acknowledge: true });
    expect(ok.code).toBe("approved");
    expect(ok.characters[0]!.casting!.approval!.acknowledged.length).toBeGreaterThan(0);
  });
  it("an incompatible voice is refused, and only the owner can override it knowingly (recorded)", () => {
    const g = char("g", "G", { cast: { version: 1, vocalGender: "masculine" } });
    expect(assignVoice([g], { characterId: "g", voice: WOMAN_MID_UK, by: "auto", now: NOW }).code).toBe("incompatible");
    expect(owner([g], "g", WOMAN_MID_UK).code).toBe("incompatible");
    const o = owner([g], "g", WOMAN_MID_UK, { approve: true, override: true, acknowledge: true });
    expect(o.ok).toBe(true);
    expect(o.characters[0]!.casting!.approval!.acknowledged[0]).toMatch(/despite a conflicting requirement/);
  });
  it("non-owners can fill an empty slot but never replace a chosen voice", () => {
    const g = char("g", "G", { voiceId: "elder-man" });
    expect(assignVoice([g], { characterId: "g", voice: MAN_UK, by: "preset", now: NOW }).code).toBe("needs_owner");
    expect(assignVoice([char("g", "G")], { characterId: "g", voice: MAN_UK, by: "preset", now: NOW }).ok).toBe(true);
  });
});

describe("casting survives save, reopen, script edits and model changes", () => {
  const withApproval = () => approved(char("g", "Grandfather", { cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"], language: "English" } }));
  it("persists through a save and a reload", () => {
    const c = withApproval();
    const reloaded = readProjectCasting(JSON.parse(JSON.stringify(project([c]))));
    expect(reloaded.characters[0]!.casting!.approval).toMatchObject({ voiceId: "elder-man", engine: "elevenlabs", version: 1 });
    expect(reloaded.characters[0]!.cast).toEqual(c.cast);
    expect(reloaded.characters[0]!.voiceId).toBe("elder-man");
  });
  it("a damaged file cannot invent an approval, and the approval wins over a stale voice id", () => {
    const bad = JSON.parse(JSON.stringify(project([char("g", "G", { voiceId: "x" })])));
    bad.characters[0].casting = { version: 1, approval: { voiceId: "", engine: "" }, history: "nonsense" };
    expect(readProjectCasting(bad).characters[0]!.casting!.approval).toBeUndefined();
    const stale = JSON.parse(JSON.stringify(project([withApproval()])));
    stale.characters[0].voiceId = "someone-else";
    expect(readProjectCasting(stale).characters[0]!.voiceId).toBe("elder-man");
    const hostile = JSON.parse(JSON.stringify(project([withApproval()])));
    hostile.characters[0].casting.approval.by = "<script>";
    hostile.characters[0].casting.approval.basis = "VERIFIED_FOREVER";
    const r = readProjectCasting(hostile).characters[0]!.casting!.approval!;
    expect(r.by).toBe("owner");
    expect(r.basis).toBe("NEEDS_AUDITION");
  });
  it("persists through script edits: the same speaker keeps the character, its voice and its approval", () => {
    const c = withApproval();
    const first = parseScript("GRANDFATHER: Come here.\n", [c], []);
    expect(first.characters).toHaveLength(1);
    const edited = parseScript("GRANDFATHER: Come here, my child.\nGRANDFATHER: Sit.\n", first.characters, first.lines);
    expect(edited.characters[0]!.id).toBe(c.id);
    expect(edited.characters[0]!.casting!.approval!.voiceId).toBe("elder-man");
    expect(edited.characters[0]!.voiceId).toBe("elder-man");
  });
  it("two speakers with the same name are one character, never two with swapped voices", () => {
    const p = parseScript("ADA: One.\nADA: Two.\nBOLA: Three.\n", [], []);
    expect(p.characters.map((c) => c.name).sort()).toEqual(["ADA", "BOLA"]);
    expect(new Set(p.characters.map((c) => c.id)).size).toBe(2);
  });
  it("a model switch is refused at generation until the owner confirms", () => {
    const c = approved(char("q", "Q"), { ...ELDER_MAN, provider: "qwen", id: "qwen-gravel-man" });
    const g = castingGuard(c, { ...ELDER_MAN, provider: "qwen", id: "qwen-gravel-man" }, [ELDER_MAN], "Qwen/Other-Checkpoint");
    expect(g.ok).toBe(false);
    expect(g.code).toBe("model_changed");
  });
  it("applying a saved cast or a preset cannot overwrite an approved voice, and cannot corrupt assignments", () => {
    const locked = withApproval();
    const saved = castFrom(project([{ ...locked, voiceId: "elder-man" }], [line("l1", "g")]), [ELDER_MAN], "Cast", "cast-1", NOW);
    const other = { ...saved, members: [{ ...saved.members[0]!, voiceId: "man-uk", voiceName: "Aristocrat", name: "Grandfather" }] };
    const a = applyCast({ characters: [locked], lines: [line("l1", "g")] }, other, [ELDER_MAN, MAN_UK]);
    expect(a.characters[0]!.voiceId).toBe("elder-man");
    expect(a.characters[0]!.casting!.approval!.voiceId).toBe("elder-man");
    expect(a.kept).toEqual(["Grandfather"]);
    expect(a.applied).toEqual([]);
    const preset = STARTER_PRESETS[0]!;
    const p = applyPreset(locked, preset, { voice: MAN_UK, replace: true, now: NOW, appVersion: "t" });
    expect(p.character.voiceId).toBe("elder-man");
    expect(p.character.casting!.approval!.voiceId).toBe("elder-man");
  });
});

describe("the voice that speaks is the voice that was approved", () => {
  it("generation refuses a different voice and offers choices instead of substituting", async () => {
    const c = approved(char("g", "Grandfather", { cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"] } }));
    const l = line("l1", "g");
    await expect(makeTake("p-1", l, MAN_UK, "eleven_v4" as never, [], undefined, { casting: { character: c, library: [ELDER_MAN, MAN_UK] } })).rejects.toBeInstanceOf(CastingError);
    await expect(makeBeatTake("p-1", l, MAN_UK, "eleven_v4" as never, [], undefined, { casting: { character: c, library: [ELDER_MAN, MAN_UK] } })).rejects.toMatchObject({ code: "voice_changed" });
  });
  it("a missing approved voice is an actionable error with compatible alternatives, never an automatic swap", () => {
    const c = approved(char("g", "G", { cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"] } }));
    const g = castingGuard(c, undefined, [MAN_UK, WOMAN_MID_UK, ELDER_MAN], null);
    expect(g.ok).toBe(false);
    expect(g.code).toBe("voice_missing");
    expect(g.message).toMatch(/was not replaced/);
    expect(g.alternatives.map((a) => a.voiceId)).not.toContain("woman-uk");
    expect(g.alternatives[0]!.voiceId).toBe("elder-man");
  });
  it("a take records the exact character, voice, engine and speaker it was made for", () => {
    const l2 = voice("en_US-l2arctic-medium@7", { provider: "piper", accent: "Arabic English", gender: "female" });
    const c = char("c", "C", { voiceId: l2.id });
    const g = castingGuard(c, l2, [l2]);
    expect(g.ok).toBe(true);
    expect(g.cast).toMatchObject({ characterId: "c", voiceId: l2.id, engine: "piper", speakerId: "7", castingVersion: null });
  });
  it("a multi-speaker voice sends its speaker number to the engine unchanged", () => {
    const v = voice("en_US-l2arctic-medium@7", { provider: "piper" });
    const p = plan(line("l", "c"), v, "eleven_v4" as never);
    expect(clipRequest(p, v, 1).voice).toBe("en_US-l2arctic-medium@7");
    expect(clipRequest(plan(line("l", "c"), voice("ife@yo", { provider: "wazobia" }), "eleven_v4" as never), voice("ife@yo"), 1).voice).toBe("ife@yo");
    expect(speakerOf(v)).toBe("7");
  });
  it("a phrase is never remade with a different voice than the take it joins", async () => {
    const from = take("t1", "elder-man", { provenance: { parts: [{ text: "a", start: 0, end: 1, pause: 0 }] } as never });
    await expect(remakeBeat("p-1", line("l", "c"), from, 0, MAN_UK, "eleven_v4" as never)).rejects.toMatchObject({ code: "voice_changed" });
  });
});

describe("the export audit follows the audio to its character", () => {
  const c = approved(char("g", "Grandfather"));
  it("a take made with another voice is a problem, and so is one made for another character", () => {
    const wrong = line("l1", "g", { takes: [take("t1", "man-uk")], chosen: "t1" });
    expect(auditCasting([c], [wrong], [ELDER_MAN, MAN_UK])[0]).toMatchObject({ severity: "problem", kind: "voice_mismatch" });
    const swapped = line("l2", "g", { takes: [take("t2", "elder-man", { cast: { characterId: "someone-else", voiceId: "elder-man", engine: "elevenlabs", modelId: null, speakerId: null, castingVersion: 1 } })], chosen: "t2" });
    expect(auditCasting([c], [swapped], [ELDER_MAN])[0]!.text).toMatch(/another character/);
  });
  it("a take of the approved voice passes, and an older one without a stamp is only a note", () => {
    const ok = line("l1", "g", { takes: [take("t1", "elder-man", { cast: { characterId: "g", voiceId: "elder-man", engine: "elevenlabs", modelId: null, speakerId: null, castingVersion: 1 } })], chosen: "t1" });
    expect(auditCasting([c], [ok], [ELDER_MAN])).toEqual([]);
    const old = line("l2", "g", { takes: [take("t2", "elder-man")], chosen: "t2" });
    expect(auditCasting([c], [old], [ELDER_MAN])[0]!.severity).toBe("listen");
  });
  it("after the voice is changed by the owner, earlier takes are flagged, not silently reused", () => {
    const changed = owner([c], "g", MAN_UK, { approve: true, acknowledge: true, confirmChange: true }).characters[0]!;
    const l = line("l1", "g", { takes: [take("t1", "elder-man")], chosen: "t1" });
    expect(auditCasting([changed], [l], [ELDER_MAN, MAN_UK])[0]).toMatchObject({ severity: "problem", kind: "voice_mismatch" });
  });
  it("the manifest names the voice that actually spoke, not the character's current voice", () => {
    const changed = owner([c], "g", MAN_UK, { approve: true, acknowledge: true, confirmChange: true }).characters[0]!;
    const l = line("l1", "g", { takes: [take("t1", "elder-man")], chosen: "t1" });
    const m = buildManifest(project([changed], [l]), [ELDER_MAN, MAN_UK], "t", NOW);
    expect(m.lines[0]!.spokenBy).toBe("elder-man");
    expect(m.lines[0]!.matchesCharacter).toBe(false);
  });
});

describe("identical names, stale data and hostile input", () => {
  it("malformed speaker ids never become a speaker", () => {
    for (const id of ["", "@", "a@", "../x@7", "a@b@c", "a@ ", "@7"]) {
      const s = speakerOf(voice(id, { provider: "piper" }));
      expect(s === null || /^[A-Za-z0-9_-]*$/.test(s ?? "")).toBe(true);
    }
  });
  it("a character that does not exist cannot be cast", () => {
    expect(assignVoice([char("a", "A")], { characterId: "zzz", voice: ELDER_MAN, by: "owner", now: NOW }).code).toBe("unknown_character");
  });
  it("two jobs racing for the same character cannot both win: the second sees the approval", () => {
    const base = [char("g", "G")];
    const first = owner(base, "g", ELDER_MAN, { approve: true, acknowledge: true });
    // The second job started from the same snapshot (the stale one) but is applied to the current state.
    const second = assignVoice(first.characters, { characterId: "g", voice: MAN_UK, by: "agent", now: NOW });
    expect(second.ok).toBe(false);
    expect(second.characters[0]!.voiceId).toBe("elder-man");
  });
  it("a preset import with the same ids cannot change a character's voice", () => {
    const c = approved(char("g", "G"));
    const r = applyPreset(c, STARTER_PRESETS[1]!, { voice: PIPER_ALAN, replace: true, now: NOW, appVersion: "t" });
    expect(r.character.voiceId).toBe("elder-man");
  });
  it("rank is stable and never drops a voice, so nothing is hidden", () => {
    const lib = [ELDER_MAN, WOMAN_MID_UK, BOY_US, TEEN_NG, MAN_UK, DEEP_WOMAN, YORUBA_ELDER].map(profileOf);
    const req = requirementsOf(char("c", "C", { cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"], language: "Yoruba" } }));
    const a = rank(req, lib);
    expect(a).toHaveLength(lib.length);
    expect(a.map((m) => m.voiceId)).toEqual(rank(req, [...lib].reverse()).map((m) => m.voiceId));
    expect(a[0]!.voiceId).toBe("elder_deji@yo");
    expect(a[0]!.status).toBe("VERIFIED_MATCH");
  });
  it("the English-only engines are ruled out for a Yoruba requirement", () => {
    const req = requirementsOf(char("c", "C", { cast: { version: 1, language: "Yoruba" } }));
    for (const provider of ["piper", "kokoro", "chatterbox", "qwen"] as const) {
      const m = rank(req, [profileOf(voice("v-" + provider, { provider, language: "English" }))])[0]!;
      expect(m.status, provider).toBe("INCOMPATIBLE");
    }
  });
  it("planCast never gives an unknown-gender Piper voice to a masculine character without an audition", () => {
    const plan2 = planCast([char("g", "G", { cast: { version: 1, vocalGender: "masculine" } })], [PIPER_ALAN]);
    expect(plan2.assign).toEqual({});
    expect(plan2.proposals[0]!.candidates[0]!.status).toBe("UNKNOWN_METADATA");
  });
});

describe("a saved voice library cannot smuggle in verified facts", () => {
  it("a hand-edited voices.json is read through the same checks as a review", async () => {
    const { readLibraryMeta } = await import("./persist");
    const bad = [{ ...voice("v1"), meta: { version: 1, gender: { value: "masculine", status: "verified", source: "provider_label", confidence: "high" }, revisions: [] } }, { ...voice("v2"), meta: "junk" }, voice("v3")];
    const clean = readLibraryMeta(bad as never);
    expect(profileOf(clean[0]!).gender.status).toBe("unverified");
    expect(clean[1]!.meta).toBeUndefined();
    expect(clean).toHaveLength(3);
    expect(readLibraryMeta(null as never)).toEqual([]);
  });
});
