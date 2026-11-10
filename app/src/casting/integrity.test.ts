import { describe, expect, it } from "vitest";
import { integrityOf } from "./integrity";
import { assignVoice } from "./lock";
import { CLAIMED_MAN, ELDER_MAN, NOW, PIPER_ALAN, WOMAN_MID_UK, YORUBA_ELDER, char } from "./fixtures";

const baba = (extra = {}) => char("baba", "Baba Ade", { cast: { version: 1, vocalGender: "masculine", vocalAge: ["old"], language: "Yoruba", accent: "Yoruba-influenced", ...extra } });
const row = (i: ReturnType<typeof integrityOf>, id: string) => i.rows.find((r) => r.id === id)!;

describe("the casting integrity table", () => {
  it("shows what is required against what the voice has, one row each, with the engine's verdict", () => {
    const t = integrityOf(baba(), YORUBA_ELDER);
    expect(row(t, "gender")).toMatchObject({ required: "Masculine", state: "verified" });
    expect(row(t, "age").state).toBe("verified");
    expect(row(t, "language")).toMatchObject({ required: "Yoruba", state: "verified" });
    expect(t.rows.at(-1)!.id).toBe("identity");
  });
  it("says 'claimed', never 'meets', when something was stated but not heard, and the summary names what is unconfirmed", () => {
    const t = integrityOf(baba({ language: undefined, accent: undefined }), CLAIMED_MAN);
    expect(t.status).toBe("NEEDS_AUDITION");
    expect(row(t, "gender").state).toBe("claimed");
    expect(row(t, "gender").has).toMatch(/claimed/);
    expect(t.summary).toMatch(/has not been confirmed by listening/);
    expect(t.summary).not.toMatch(/meets|everything required is confirmed/i);
  });
  it("an unknown fact is shown as unknown, not as a match", () => {
    const t = integrityOf(baba({ language: undefined, accent: undefined }), PIPER_ALAN);
    expect(row(t, "gender")).toMatchObject({ state: "unknown", has: "Unknown" });
    expect(t.status).toBe("UNKNOWN_METADATA");
  });
  it("a contradiction is a conflict, in the row that conflicts", () => {
    const t = integrityOf(baba({ language: undefined, accent: undefined }), WOMAN_MID_UK);
    expect(row(t, "gender").state).toBe("conflict");
    expect(t.status).toBe("INCOMPATIBLE");
  });
  it("the identity row reports the lock, the approved speaker and the version", () => {
    const c = assignVoice([baba({ language: undefined, accent: undefined })], { characterId: "baba", voice: ELDER_MAN, by: "owner", approve: true, acknowledge: true, now: NOW }).characters[0]!;
    const t = integrityOf(c, ELDER_MAN);
    expect(t.locked).toBe(true);
    expect(row(t, "identity")).toMatchObject({ state: "verified", has: expect.stringContaining("version 1") });
    expect(t.summary).toMatch(/Casting stays locked/);
    expect(integrityOf(c, YORUBA_ELDER).locked).toBe(false);
  });
  it("shows a licence row only when it matters", () => {
    expect(integrityOf(baba(), ELDER_MAN).rows.some((r) => r.id === "licence")).toBe(false);
    const l2 = { ...PIPER_ALAN, id: "en_US-l2arctic-medium@3" };
    expect(integrityOf(char("c", "C"), l2, { commercial: true }).rows.find((r) => r.id === "licence")).toMatchObject({ state: "conflict" });
  });
});
