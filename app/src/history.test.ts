import { describe, expect, it } from "vitest";
import { History, MERGE_MS, keepWork } from "./history";
import { DEFAULT_DIRECTION, newProject, type Line, type Take } from "./types";

describe("history", () => {
  it("steps back and forward, and a new change drops the steps ahead", () => {
    const h = new History<number>();
    h.record(0, "a", 0);
    h.record(1, "b", 5000);
    expect(h.undo(2)).toBe(1);
    expect(h.undo(1)).toBe(0);
    expect(h.undo(0)).toBeNull();
    expect(h.redo(0)).toBe(1);
    h.record(1, "c", 9000);
    expect(h.canRedo()).toBe(false);
  });

  it("counts a quick run of the same kind of change as one step, and never merges key empty", () => {
    const h = new History<number>();
    h.record(0, "type", 1000);
    h.record(1, "type", 1000 + MERGE_MS - 1);
    h.record(2, "type", 1000 + 2 * MERGE_MS - 2);
    expect(h.undo(3)).toBe(0);
    expect(h.undo(0)).toBeNull();
    const g = new History<number>();
    g.record(0, "x", 0);
    g.record(1, "x", MERGE_MS + 10);
    expect(g.undo(2)).toBe(1);
    const k = new History<number>();
    k.record(0, "", 0);
    k.record(1, "", 1);
    expect(k.undo(2)).toBe(1);
    expect(k.undo(1)).toBe(0);
  });

  it("ignores a repeat of the same state, keeps at most 100 steps, and can be cleared", () => {
    const o = {};
    const h = new History<object>();
    h.record(o, "", 0);
    h.record(o, "", 5000);
    expect(h.undo({})).toBe(o);
    expect(h.undo(o)).toBeNull();
    const big = new History<number>();
    for (let i = 0; i < 150; i++) big.record(i, "", i);
    let n = 0;
    let cur = 150;
    for (let s = big.undo(cur); s !== null; s = big.undo(cur)) (cur = s, n++);
    expect(n).toBe(100);
    h.record(o, "", 9);
    h.clear();
    expect(h.canUndo() || h.canRedo()).toBe(false);
  });
});

const take = (id: string): Take => ({ id, at: "", model: "eleven_v4", ext: "mp3", voiceId: "v", sent: "x", seconds: 1 });
const line = (id: string, takes: Take[], o: Partial<Line> = {}): Line => ({ id, characterId: "c", scene: 0, text: id, direction: { ...DEFAULT_DIRECTION }, takes, events: [], ...o });

describe("going back never loses paid work", () => {
  it("keeps takes made since, falls back to a take that still exists, and keeps the ledger", () => {
    const snap = { ...newProject("p", "P", ""), lines: [line("a", [take("t1")], { chosen: "t1" }), line("gone", [])], ledger: [] };
    const cur = { ...snap, lines: [line("a", [take("t1"), take("t2")], { chosen: "t2" })], ledger: [{ at: "", kind: "speech" as const, engine: "E", chars: 5, cost: 0.1 }] };
    const back = keepWork(cur, snap);
    expect(back.lines.map((l) => l.id)).toEqual(["a", "gone"]);
    expect(back.lines[0]!.takes.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(back.lines[0]!.chosen).toBe("t1");
    expect(back.ledger).toHaveLength(1);
    const noChoice = keepWork(cur, { ...snap, lines: [line("a", [take("t1")])] });
    expect(noChoice.lines[0]!.chosen).toBe("t2");
  });
  it("does not change either project it is given", () => {
    const snap = { ...newProject("p", "P", ""), lines: [line("a", [take("t1")])] };
    const cur = { ...snap, lines: [line("a", [take("t1"), take("t2")])] };
    keepWork(cur, snap);
    expect(snap.lines[0]!.takes).toHaveLength(1);
    expect(cur.lines[0]!.takes).toHaveLength(2);
  });
});
