import { describe, expect, it } from "vitest";
import { KEYS, NO_PICK, applyPick, hasPick, sessionQueue } from "./session";
import { profileOf } from "./voiceProfile";
import { ELDER_MAN, NOW, PIPER_ALAN, voice } from "./fixtures";

describe("the listening session", () => {
  it("queues only voices whose presentation or age is not yet confirmed, optionally per engine", () => {
    const lib = [ELDER_MAN, PIPER_ALAN, voice("kokoro1", { provider: "kokoro" })];
    expect(sessionQueue(lib).map((v) => v.id)).toEqual(["en_GB-alan-medium", "kokoro1"]);
    expect(sessionQueue(lib, { engine: "kokoro" }).map((v) => v.id)).toEqual(["kokoro1"]);
    expect(sessionQueue(lib, { onlyUnconfirmed: false })).toHaveLength(3);
  });
  it("a pick records only what was heard, as confirmed by listening, with evidence", () => {
    const v = applyPick(PIPER_ALAN, { gender: "masculine", age: "unsure" }, NOW);
    const p = profileOf(v);
    expect(p.gender).toMatchObject({ value: "masculine", status: "verified", source: "owner_listening" });
    expect(p.age.status).toBe("unknown");
    expect(v.meta!.revisions.at(-1)!.evidence).toMatch(/Listening session 2026-11-10/);
  });
  it("unsure about everything records nothing, so nothing is guessed", () => {
    expect(hasPick(NO_PICK)).toBe(false);
    expect(applyPick(PIPER_ALAN, NO_PICK, NOW)).toBe(PIPER_ALAN);
  });
  it("one voice's pick does not touch another voice", () => {
    const other = voice("o");
    applyPick(other, { gender: "feminine", age: "old" }, NOW);
    expect(other.meta).toBeUndefined();
  });
  it("every key maps to a real choice", () => {
    for (const k of Object.keys(KEYS)) expect(Object.keys(KEYS[k]!).length).toBe(1);
  });
});
