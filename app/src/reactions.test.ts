import { describe, expect, it } from "vitest";
import { MAX_REACTIONS, migrateReactions, reuse, saveReaction } from "./reactions";
import type { SoundEvent } from "./types";

const ev = (n: number, extra: Partial<SoundEvent> = {}): SoundEvent => ({ id: `e${n}`, prompt: `a sigh ${n}`, placement: "after", seconds: 2, take: { id: `s${n}`, ext: "wav", seconds: 1.8, sha256: "ab", prompt: `a sigh ${n}` }, ...extra });

describe("reaction library", () => {
  it("saves a made clip once and keeps the newest", () => {
    let list = saveReaction(undefined, ev(1));
    list = saveReaction(list, ev(1));
    expect(list).toHaveLength(1);
    for (let i = 2; i < MAX_REACTIONS + 5; i++) list = saveReaction(list, ev(i));
    expect(list).toHaveLength(MAX_REACTIONS);
    expect(list[0]!.take.id).toBe(`s${MAX_REACTIONS + 4}`);
  });
  it("ignores an event with no clip", () => {
    expect(saveReaction([], { id: "x", prompt: "p", placement: "after", seconds: 1 })).toEqual([]);
  });
  it("reuses the same immutable clip on another line at no cost", () => {
    const r = saveReaction(undefined, ev(3))[0]!;
    const e = reuse(r, "new-id", "before");
    expect(e.take).toBe(r.take);
    expect(e.take!.id).toBe("s3");
    expect(e.placement).toBe("before");
    expect(e.id).toBe("new-id");
  });
  it("reads damaged saved data safely", () => {
    expect(migrateReactions(undefined)).toEqual([]);
    expect(migrateReactions([null, { id: 5 }, { id: "r", take: { id: "t", ext: "exe" } }, { id: "ok", prompt: "  a\n laugh ", take: { id: "t1", ext: "mp3", seconds: "x" } }])).toEqual([{ id: "ok", prompt: "a laugh", seconds: 0, take: { id: "t1", ext: "mp3", seconds: 0, sha256: undefined, prompt: undefined } }]);
  });
});
