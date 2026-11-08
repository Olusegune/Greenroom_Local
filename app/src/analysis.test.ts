import { describe, expect, it } from "vitest";
import { analyzeSamples, NOMINAL_WPS, referenceHint, wordCount } from "./analysis";

const RATE = 16000;
const tone = (sec: number, f0: number, f1 = f0, amp = 0.3): number[] => {
  const n = Math.round(sec * RATE);
  const out: number[] = [];
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const f = f0 + ((f1 - f0) * i) / n;
    phase += (2 * Math.PI * f) / RATE;
    out.push(Math.sin(phase) * amp);
  }
  return out;
};
const gap = (sec: number) => new Array(Math.round(sec * RATE)).fill(0);
const sig = (...parts: number[][]) => Float32Array.from(parts.flat());

describe("analyzeSamples", () => {
  it("finds the speech, the pause inside it and the silence at each end", () => {
    const s = analyzeSamples(sig(gap(0.3), tone(1, 220), gap(0.4), tone(1, 220), gap(0.5)), RATE, 5);
    expect(s.seconds).toBeCloseTo(3.2, 1);
    expect(s.leadSilence).toBeCloseTo(0.3, 1);
    expect(s.trailSilence).toBeCloseTo(0.5, 1);
    expect(s.pausesMs).toHaveLength(1);
    expect(s.pausesMs[0]!).toBeGreaterThan(350);
    expect(s.pausesMs[0]!).toBeLessThan(450);
    expect(s.speechSeconds).toBeCloseTo(2.4, 1);
    expect(s.wordsPerSecond).toBeCloseTo(5 / 2.4, 1);
  });

  it("measures pitch and a rising contour", () => {
    const steady = analyzeSamples(sig(tone(2, 200)), RATE, 4);
    expect(steady.pitchHz).toBeGreaterThan(190);
    expect(steady.pitchHz).toBeLessThan(210);
    expect(steady.pitchRangeSemitones!).toBeLessThan(1);
    const rising = analyzeSamples(sig(tone(2, 120, 240)), RATE, 4);
    const c = rising.pitchContour.filter((v): v is number => v !== null);
    expect(c[c.length - 1]!).toBeGreaterThan(c[0]!);
    expect(rising.pitchRangeSemitones!).toBeGreaterThan(6);
  });

  it("measures level and liveliness", () => {
    const quiet = analyzeSamples(sig(tone(1, 200, 200, 0.05)), RATE, 2);
    const loud = analyzeSamples(sig(tone(1, 200, 200, 0.5)), RATE, 2);
    expect(loud.levelDb).toBeGreaterThan(quiet.levelDb + 15);
    const swell = analyzeSamples(sig(tone(0.5, 200, 200, 0.05), tone(0.5, 200, 200, 0.5)), RATE, 2);
    expect(swell.liveliness).toBeGreaterThan(loud.liveliness);
  });

  it("reports no pitch and no speech for silence, and does not invent either for noise", () => {
    const quiet = analyzeSamples(new Float32Array(RATE), RATE, 3);
    expect(quiet.speechSeconds).toBe(0);
    expect(quiet.pitchHz).toBeNull();
    expect(quiet.wordsPerSecond).toBe(0);
    let seed = 1;
    const noise = Float32Array.from({ length: RATE }, () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4);
    expect(analyzeSamples(noise, RATE, 3).pitchContour.filter((v) => v !== null).length).toBeLessThan(4);
  });
});

describe("referenceHint", () => {
  it("turns a measured take into a pace, a projection and a pause, all in range", () => {
    const base = analyzeSamples(sig(tone(2, 200, 200, 0.3), gap(0.6)), RATE, Math.round(NOMINAL_WPS * 2));
    const h = referenceHint(base);
    expect(h.pace).toBeCloseTo(1, 1);
    expect(h.pauseAfter).toBeCloseTo(0.6, 1);
    expect(h.projection).toBeGreaterThanOrEqual(0);
    expect(h.projection).toBeLessThanOrEqual(1);
    expect(referenceHint({ ...base, wordsPerSecond: 9 }).pace).toBe(1.2);
    expect(referenceHint({ ...base, wordsPerSecond: 0.2 }).pace).toBe(0.7);
    expect(referenceHint({ ...base, wordsPerSecond: 0 }).pace).toBe(1);
  });
});

describe("wordCount", () => {
  it("counts spoken words, not tags or punctuation", () => {
    expect(wordCount("[laughs] Well - I suppose so, yes!")).toBe(5);
    expect(wordCount("  ")).toBe(0);
  });
});

import { waveformPeaks } from "./analysis";
describe("waveformPeaks", () => {
  it("gives the loudest sample of each slice, from 0 to 1", () => {
    const x = Float32Array.from([0, 0.2, -0.9, 0.1, 0, 0, 0.5, -0.5]);
    expect(waveformPeaks(x, 4)).toEqual([0.2, 0.9, 0, 0.5]);
    expect(waveformPeaks(new Float32Array(0), 3)).toEqual([0, 0, 0]);
    expect(waveformPeaks(Float32Array.from([3, -3]), 2)).toEqual([1, 1]);
  });
});

describe("analysis cost", () => {
  it("measures ten seconds of 48 kHz speech without blocking for long, and still finds the pitch", () => {
    const rate = 48000;
    const x = Float32Array.from({ length: rate * 10 }, (_, i) => Math.sin((2 * Math.PI * 180 * i) / rate) * 0.3);
    const t = Date.now();
    const s = analyzeSamples(x, rate, 20);
    expect(Date.now() - t).toBeLessThan(2500);
    expect(s.pitchHz!).toBeGreaterThan(170);
    expect(s.pitchHz!).toBeLessThan(190);
  });
});
