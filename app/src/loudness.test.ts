import { describe, expect, it } from "vitest";
import { applyGain, integratedLoudness, measure, planNormalization, samplePeakDb, truePeakDb } from "./loudness";

function sine(fs: number, seconds: number, amp: number, hz = 997, phase = 0): Float32Array {
  const n = Math.round(fs * seconds);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = amp * Math.sin((2 * Math.PI * hz * i) / fs + phase);
  return out;
}
const dbfs = (db: number) => Math.pow(10, db / 20);

describe("integrated loudness (BS.1770)", () => {
  it("reads a -23 dBFS stereo 997 Hz tone as about -23 LUFS at common sample rates", () => {
    for (const fs of [44100, 48000, 96000]) {
      const t = sine(fs, 6, dbfs(-23));
      expect(integratedLoudness([t, t], fs)).toBeCloseTo(-23, 0);
      expect(Math.abs(integratedLoudness([t, t], fs) + 23)).toBeLessThan(0.15);
    }
  });
  it("rises by about 6 dB when the level doubles", () => {
    const a = sine(48000, 5, 0.05);
    const b = sine(48000, 5, 0.1);
    expect(integratedLoudness([b, b], 48000) - integratedLoudness([a, a], 48000)).toBeCloseTo(6.02, 1);
  });
  it("counts a mono signal as one channel, so it reads 3 dB lower than the same tone on both", () => {
    const t = sine(48000, 5, 0.1);
    expect(integratedLoudness([t, t], 48000) - integratedLoudness([t], 48000)).toBeCloseTo(3.01, 1);
  });
  it("ignores silence and very quiet passages (gating)", () => {
    const fs = 48000;
    const loud = sine(fs, 5, dbfs(-20));
    const quiet = sine(fs, 20, dbfs(-80));
    const all = new Float32Array(loud.length + quiet.length);
    all.set(loud);
    all.set(quiet, loud.length);
    expect(Math.abs(integratedLoudness([all, all], fs) - integratedLoudness([loud, loud], fs))).toBeLessThan(0.3);
  });
  it("is -Infinity for silence or nothing, and measures audio shorter than one block", () => {
    expect(integratedLoudness([new Float32Array(48000), new Float32Array(48000)], 48000)).toBe(-Infinity);
    expect(integratedLoudness([], 48000)).toBe(-Infinity);
    expect(Number.isFinite(integratedLoudness([sine(48000, 0.2, 0.3)], 48000))).toBe(true);
  });
});

describe("peaks", () => {
  it("finds the sample peak", () => {
    expect(samplePeakDb([new Float32Array([0, 0.5, -0.25])])).toBeCloseTo(-6.02, 1);
    expect(samplePeakDb([new Float32Array(10)])).toBe(-Infinity);
  });
  it("finds a peak between samples that the sample peak misses", () => {
    // A tone at a quarter of the sample rate, 45 degrees in: every sample is +-0.707 but the wave reaches 1.0.
    const t = sine(48000, 0.5, 1, 12000, Math.PI / 4);
    expect(samplePeakDb([t])).toBeCloseTo(-3.01, 1);
    const tp = truePeakDb([t]);
    expect(tp).toBeGreaterThan(-0.4);
    expect(tp).toBeLessThan(0.3);
  });
  it("never reports less than the sample peak", () => {
    const t = sine(48000, 0.3, 0.3, 440);
    expect(truePeakDb([t])).toBeGreaterThanOrEqual(samplePeakDb([t]) - 1e-9);
  });
});

describe("normalization plan", () => {
  const m = { lufs: -30, tpDb: -12, peakDb: -13 };
  it("applies the gain that reaches the target when there is headroom", () => {
    const p = planNormalization(m, -23, -1);
    expect(p.gainDb).toBeCloseTo(7, 5);
    expect(p).toMatchObject({ reached: true, limitedBy: null });
    expect(p.finalTpDb).toBeCloseTo(-5, 5);
  });
  it("stops at the true-peak ceiling and says it did not reach the target", () => {
    const p = planNormalization({ lufs: -30, tpDb: -3, peakDb: -3.2 }, -16, -1);
    expect(p.gainDb).toBeCloseTo(2, 5);
    expect(p).toMatchObject({ reached: false, limitedBy: "ceiling" });
    expect(p.finalLufs).toBeCloseTo(-28, 5);
  });
  it("turns loud material down, and does nothing when off or silent", () => {
    expect(planNormalization({ lufs: -10, tpDb: -0.5, peakDb: -1 }, -23, -1).gainDb).toBeCloseTo(-13, 5);
    expect(planNormalization(m, null, -1)).toMatchObject({ gainDb: 0, reached: true });
    expect(planNormalization({ lufs: -Infinity, tpDb: -Infinity, peakDb: -Infinity }, -23, -1).gainDb).toBe(0);
  });
  it("brings a quiet tone to the target when applied", () => {
    const t = sine(48000, 6, dbfs(-35));
    const before = measure([t, t], 48000);
    const plan = planNormalization(before, -23, -1);
    const out = applyGain([t, t], plan.gainDb);
    expect(Math.abs(integratedLoudness(out, 48000) + 23)).toBeLessThan(0.2);
  });
});
