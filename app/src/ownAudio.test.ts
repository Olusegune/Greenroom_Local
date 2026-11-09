import { describe, expect, it } from "vitest";
import { checkExpression, expressionTake, mixExpression, ownTake, peakOf, resample } from "./ownAudio";

const tone = (n: number, v: number) => new Float32Array(n).fill(v);

describe("mixing an expression into a recording", () => {
  const base = tone(1000, 0.2); // 1 second at 1000 Hz
  it("inserting makes the recording longer by exactly the clip, with the speech before and after untouched", () => {
    const clip = tone(300, 0.5);
    const out = mixExpression(base, 1000, clip, 1000, 0.4, "insert", 1);
    expect(out.length).toBe(1300);
    expect(out[0]).toBeCloseTo(0.2, 5);
    expect(out[399]).toBeCloseTo(0.2, 5);
    expect(out[550]).toBeCloseTo(0.5, 2);
    expect(out[700]).toBeCloseTo(0.2, 5);
    expect(out[1299]).toBeCloseTo(0.2, 5);
  });
  it("overlaying keeps the length and adds the clip over the speech", () => {
    const out = mixExpression(base, 1000, tone(200, 0.3), 1000, 0.5, "overlay", 1);
    expect(out.length).toBe(1000);
    expect(out[400]).toBeCloseTo(0.2, 5);
    expect(out[600]).toBeCloseTo(0.5, 2);
    expect(out[900]).toBeCloseTo(0.2, 5);
  });
  it("an expression at the end extends the recording instead of being cut off", () => {
    expect(mixExpression(base, 1000, tone(300, 0.3), 1000, 1, "overlay", 1).length).toBe(1300);
  });
  it("the original array is never changed", () => {
    const keep = Float32Array.from(base);
    mixExpression(base, 1000, tone(200, 0.9), 1000, 0.1, "overlay", 1);
    mixExpression(base, 1000, tone(200, 0.9), 1000, 0.1, "insert", 1);
    expect(Array.from(base)).toEqual(Array.from(keep));
  });
  it("turns the result down rather than letting it clip", () => {
    const loud = mixExpression(tone(1000, 0.9), 1000, tone(1000, 0.9), 1000, 0, "overlay", 1);
    expect(peakOf(loud)).toBeLessThanOrEqual(0.9801);
  });
  it("the clip fades in and out so it cannot click", () => {
    const out = mixExpression(tone(2000, 0), 1000, tone(1000, 1), 1000, 0.5, "overlay", 1);
    expect(Math.abs(out[500]!)).toBeLessThan(0.2);
    expect(Math.abs(out[1499]!)).toBeLessThan(0.2);
    expect(out[1000]).toBeCloseTo(0.98, 1);
  });
  it("a clip made at another sample rate is brought to the recording's rate", () => {
    const out = mixExpression(tone(48000, 0), 48000, tone(22050, 0.5), 22050, 0, "insert", 1);
    expect(out.length).toBe(48000 + 48000);
    expect(resample(tone(100, 1), 50, 100).length).toBe(200);
    expect(resample(tone(100, 1), 100, 100).length).toBe(100);
    expect(resample(new Float32Array(0), 100, 50).length).toBe(0);
  });
  it("hostile numbers do not throw or produce garbage", () => {
    for (const at of [NaN, -5, Infinity, 1e9]) for (const gain of [NaN, -1, 1e9]) {
      const out = mixExpression(base, 1000, tone(50, 0.4), 1000, at, "insert", gain);
      expect(out.every((v) => Number.isFinite(v))).toBe(true);
    }
    expect(mixExpression(new Float32Array(0), 1000, tone(10, 1), 1000, 0, "overlay").length).toBe(0);
    expect(mixExpression(base, 0, tone(10, 1), 1000, 0, "overlay")).toBe(base);
  });
});

describe("checks and records", () => {
  it("refuses an impossible request in plain words", () => {
    expect(checkExpression(5, 1, 2)).toBeNull();
    expect(checkExpression(0, 1, 0)).toMatch(/no audio/);
    expect(checkExpression(400, 1, 2)).toMatch(/5 minutes/);
    expect(checkExpression(5, 0, 2)).toMatch(/no sound/);
    expect(checkExpression(5, 20, 2)).toMatch(/15 seconds/);
    expect(checkExpression(5, 1, 6)).toMatch(/inside/);
    expect(checkExpression(5, 1, NaN)).toMatch(/inside/);
  });
  it("a take of the owner's own audio says a person made it and no engine did", () => {
    const t = ownTake({ id: "t1", at: "now", seconds: 3, sha256: "abc", appVersion: "1", emotion: "", note: "", source: "file my line.wav" });
    expect(t.provenance?.voiceName).toBe("My own audio");
    expect(t.provenance?.instructions).toMatch(/used as it is/);
    expect(t.provenance?.chars).toBe(0);
    expect(t.sent).toContain("my own audio");
  });
  it("an expression take says what was added, where and to what", () => {
    const t = expressionTake({ id: "t2", at: "now", seconds: 4, sha256: "abc", appVersion: "1", emotion: "", note: "", expression: "a warm laugh", atSeconds: 1.5, mode: "insert", from: "take t1" });
    expect(t.sent).toMatch(/a warm laugh.*inserted at 1\.50 s/);
    expect(t.provenance?.sounds).toEqual(["a warm laugh"]);
    expect(t.provenance?.instructions).toMatch(/original is unchanged/);
  });
});
