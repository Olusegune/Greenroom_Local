import { describe, expect, it } from "vitest";
import { analyzeSamples } from "./analysis";
import { checkRecordingQuality, compareConversion, speechSegments } from "./convertReport";

const RATE = 16000;
const tone = (sec: number, amp = 0.3, f = 200) => Float32Array.from({ length: Math.round(sec * RATE) }, (_, i) => Math.sin((2 * Math.PI * f * i) / RATE) * amp);
const gap = (sec: number) => new Float32Array(Math.round(sec * RATE));
const cat = (...a: Float32Array[]) => Float32Array.from(a.flatMap((x) => [...x]));
const noise = (sec: number, amp: number) => {
  let seed = 7;
  return Float32Array.from({ length: Math.round(sec * RATE) }, () => (((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5) * 2 * amp);
};

describe("speechSegments", () => {
  it("finds each phrase as a start and end in seconds", () => {
    const s = speechSegments(cat(gap(0.3), tone(1), gap(0.5), tone(0.8), gap(0.2)), RATE);
    expect(s).toHaveLength(2);
    expect(s[0]![0]).toBeCloseTo(0.3, 1);
    expect(s[0]![1]).toBeCloseTo(1.3, 1);
    expect(s[1]![0]).toBeCloseTo(1.8, 1);
    expect(s[1]![1]).toBeCloseTo(2.6, 1);
  });
  it("does not split on a short gap, and returns nothing for silence", () => {
    expect(speechSegments(cat(tone(0.5), gap(0.06), tone(0.5)), RATE)).toHaveLength(1);
    expect(speechSegments(gap(1), RATE)).toEqual([]);
  });
});

describe("checkRecordingQuality", () => {
  it("passes a clean recording with a quiet room", () => {
    const x = cat(noise(0.5, 0.002), tone(1), noise(0.5, 0.002), tone(1), noise(0.5, 0.002));
    const q = checkRecordingQuality(x, RATE);
    expect(q.warnings).toEqual([]);
    expect(q.snrDb!).toBeGreaterThan(20);
  });
  it("warns about a noisy room, clipping, a quiet microphone, silence and a long recording", () => {
    expect(checkRecordingQuality(cat(noise(1, 0.1), tone(1, 0.3), noise(1, 0.1)), RATE).warnings.join(" ")).toMatch(/Noisy/);
    expect(checkRecordingQuality(tone(1, 3).map((v) => Math.max(-1, Math.min(1, v))), RATE).warnings.join(" ")).toMatch(/Clipped/);
    expect(checkRecordingQuality(tone(1, 0.005), RATE).warnings.join(" ")).toMatch(/Very quiet/);
    expect(checkRecordingQuality(gap(2), RATE).warnings.join(" ")).toMatch(/silent/);
    expect(checkRecordingQuality(new Float32Array(RATE * 70).fill(0.1), RATE).warnings.join(" ")).toMatch(/long/);
  });
});

describe("compareConversion", () => {
  const src = cat(gap(0.2), tone(1), gap(0.4), tone(1), gap(0.2));
  const stats = (x: Float32Array) => analyzeSamples(x, RATE, 4);

  it("reports a faithful conversion with no flags", () => {
    const r = compareConversion(stats(src), stats(src), src, RATE);
    expect(r.driftPercent).toBe(0);
    expect(r.flags).toEqual([]);
    expect(r.segmentsResult).toHaveLength(2);
    expect(r.pausesSource).toBe(r.pausesResult);
  });

  it("flags drift, lost pauses, a later start and a flatter delivery", () => {
    const lively = cat(tone(0.5, 0.05), tone(0.5, 0.5), gap(0.4), tone(0.5, 0.05), tone(0.5, 0.5));
    const flat = cat(gap(0.6), tone(2.4, 0.3));
    const r = compareConversion(stats(lively), stats(flat), flat, RATE);
    const f = r.flags.join(" ");
    expect(f).toMatch(/longer than the recording/);
    expect(f).toMatch(/starts .* later/);
    expect(f).toMatch(/flatter/);
    expect(r.driftPercent).toBeGreaterThan(5);
  });
});
