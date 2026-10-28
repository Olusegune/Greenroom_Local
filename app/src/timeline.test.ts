import { describe, expect, it } from "vitest";
import type { Placed } from "./audio";
import { applyCrossfades, DUCK_RATE, duckCurve, fadeCurve, fitFades, formatClock, layoutRows, parseClock, rulerStep, snapTime } from "./timeline";

const cfg = { amountDb: -12, attack: 0.2, hold: 0.3, release: 1 };
const low = Math.pow(10, -12 / 20);
const at = (g: Float32Array, t: number) => g[Math.round(t * DUCK_RATE)]!;

describe("duckCurve", () => {
  it("leaves music alone when nobody speaks", () => {
    const g = duckCurve([], 10, cfg);
    expect(g.length).toBe(1001);
    expect([...new Set(g)]).toEqual([1]);
  });
  it("falls before a line, holds through it and a little after, then returns", () => {
    const g = duckCurve([{ start: 2, end: 4 }], 10, cfg);
    expect(at(g, 1.7)).toBe(1);
    expect(at(g, 1.9)).toBeCloseTo(1 + (low - 1) * 0.5, 2); // halfway down the attack
    expect(at(g, 2.0)).toBeCloseTo(low, 4);
    expect(at(g, 3.0)).toBeCloseTo(low, 4);
    expect(at(g, 4.3)).toBeCloseTo(low, 4);
    expect(at(g, 4.8)).toBeCloseTo(low + (1 - low) * 0.5, 2); // halfway back up
    expect(at(g, 5.4)).toBe(1);
  });
  it("drops by exactly the chosen amount", () => {
    const g = duckCurve([{ start: 1, end: 2 }], 5, { ...cfg, amountDb: -20 });
    expect(20 * Math.log10(at(g, 1.5))).toBeCloseTo(-20, 3);
    const none = duckCurve([{ start: 1, end: 2 }], 5, { ...cfg, amountDb: 0 });
    expect(at(none, 1.5)).toBe(1);
  });
  it("lets the deepest dip win where lines overlap or follow closely, and never goes below it", () => {
    const g = duckCurve([{ start: 2, end: 3 }, { start: 3.2, end: 4 }], 8, cfg);
    for (let t = 2; t <= 4.3; t += 0.1) expect(at(g, t)).toBeCloseTo(low, 4);
    expect(Math.min(...g)).toBeCloseTo(low, 4);
  });
  it("can step instantly when there is no attack, and stays inside the mix", () => {
    const g = duckCurve([{ start: 0, end: 1 }, { start: 9.9, end: 20 }], 10, { ...cfg, attack: 0 });
    expect(at(g, 0)).toBeCloseTo(low, 4);
    expect(g.length).toBe(1001);
    expect(at(g, 10)).toBeCloseTo(low, 4);
  });
});

describe("fades", () => {
  it("run 0 to 1 and 1 to 0 with equal power", () => {
    const i = fadeCurve("in");
    const o = fadeCurve("out");
    expect([i[0], i[i.length - 1]]).toEqual([0, 1]);
    expect(o[0]).toBe(1);
    expect(o[o.length - 1]!).toBeCloseTo(0, 6);
    for (let k = 0; k < i.length; k++) expect(i[k]! ** 2 + o[k]! ** 2).toBeCloseTo(1, 6);
    expect(i[Math.floor(i.length / 2)]!).toBeCloseTo(Math.SQRT1_2, 1);
  });
  it("are scaled down so two fades never overlap inside a short clip", () => {
    expect(fitFades(10, 1, 2)).toEqual({ fi: 1, fo: 2 });
    const f = fitFades(1, 0.8, 0.8);
    expect(f.fi + f.fo).toBeCloseTo(1, 9);
    expect(fitFades(0.5, -1, 9).fi).toBe(0);
  });
});

const sp = (id: string, ch: string, start: number, seconds: number): Placed => ({ kind: "speech", lineId: id, characterId: ch, ref: { id, ext: "wav" }, start, seconds, gainDb: 0, fadeIn: 0.005, fadeOut: 0.01 });

describe("automatic crossfades", () => {
  it("fade the earlier line out and the later one in across their overlap, for the same character", () => {
    const r = applyCrossfades([sp("a", "c1", 0, 3), sp("b", "c1", 2.5, 3)]);
    expect(r[0]!.fadeOut).toBeCloseTo(0.5, 9);
    expect(r[1]!.fadeIn).toBeCloseTo(0.5, 9);
    expect(r[0]!.fadeIn).toBe(0.005);
  });
  it("leave different characters talking over each other alone", () => {
    const r = applyCrossfades([sp("a", "c1", 0, 3), sp("b", "c2", 1, 3)]);
    expect([r[0]!.fadeOut, r[1]!.fadeIn]).toEqual([0.01, 0.005]);
  });
  it("leave a line that sits entirely inside another, and lines that do not touch, alone", () => {
    const inside = applyCrossfades([sp("a", "c1", 0, 5), sp("b", "c1", 1, 2)]);
    expect([inside[0]!.fadeOut, inside[1]!.fadeIn]).toEqual([0.01, 0.005]);
    const apart = applyCrossfades([sp("a", "c1", 0, 2), sp("b", "c1", 2, 2)]);
    expect([apart[0]!.fadeOut, apart[1]!.fadeIn]).toEqual([0.01, 0.005]);
  });
  it("never changes the input and caps the crossfade inside short clips", () => {
    const input = [sp("a", "c1", 0, 1), sp("b", "c1", 0.2, 1)];
    const r = applyCrossfades(input);
    expect(input[0]!.fadeOut).toBe(0.01);
    expect(r[0]!.fadeOut).toBeLessThanOrEqual(0.9);
  });
});

describe("snapping and layout", () => {
  it("snaps to a nearby edge, else to the grid, else stays put", () => {
    expect(snapTime(2.04, [2, 5], 0.05)).toBe(2);
    expect(snapTime(2.2, [2, 5], 0.05, 0.1)).toBeCloseTo(2.2, 9);
    expect(snapTime(2.26, [2, 5], 0.05, 0.1)).toBeCloseTo(2.3, 9);
    expect(snapTime(2.26, [], 0.05)).toBe(2.26);
    expect(snapTime(4.97, [5, 4.95], 0.1)).toBe(4.95);
  });
  it("stack overlapping clips on the lowest free row", () => {
    expect(layoutRows([{ start: 0, end: 3 }, { start: 1, end: 2 }, { start: 3, end: 4 }, { start: 1.5, end: 5 }])).toEqual([0, 1, 0, 2]);
    expect(layoutRows([])).toEqual([]);
    expect(layoutRows([{ start: 2, end: 3 }, { start: 0, end: 2 }])).toEqual([0, 0]);
  });
});

describe("clock text and the ruler", () => {
  it("formats and reads m:ss.mmm, plain seconds and m:ss", () => {
    expect(formatClock(83.5)).toBe("1:23.500");
    expect(formatClock(0)).toBe("0:00.000");
    expect(formatClock(-3)).toBe("0:00.000");
    expect(parseClock("1:23.5")).toBe(83.5);
    expect(parseClock("83.5")).toBe(83.5);
    expect(parseClock(" 0:05 ")).toBe(5);
    expect(parseClock("abc")).toBeNull();
    expect(parseClock("1:2:3")).toBeNull();
    expect(parseClock("")).toBeNull();
  });
  it("picks ruler steps that stay readable as you zoom", () => {
    expect(rulerStep(10)).toBe(10);
    expect(rulerStep(100)).toBe(1);
    expect(rulerStep(1000)).toBe(0.1);
    expect(rulerStep(0.01)).toBe(600);
  });
});
