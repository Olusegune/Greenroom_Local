import { describe, expect, it } from "vitest";
import { qaMarkdown, validateClip } from "./soundQa";

const RATE = 48000;
const tone = (sec: number, amp: number, f = 220) => Float32Array.from({ length: Math.round(sec * RATE) }, (_, i) => Math.sin((2 * Math.PI * f * i) / RATE) * amp);
const cat = (...a: Float32Array[]) => Float32Array.from(a.flatMap((x) => [...x]));

describe("validateClip", () => {
  it("passes a clean clip", () => {
    const q = validateClip([tone(1, 0.3)], RATE);
    expect(q.issues).toEqual([]);
    expect(q.peakDb).toBeCloseTo(-10.5, 0);
    expect(q.lufs).not.toBeNull();
  });

  it("finds silence, clipping, a quiet clip and an offset", () => {
    expect(validateClip([new Float32Array(RATE)], RATE).issues[0]!.text).toMatch(/silent/);
    expect(validateClip([], RATE).issues[0]!.level).toBe("error");
    const clipped = validateClip([tone(1, 2).map((x) => Math.max(-1, Math.min(1, x)))], RATE);
    expect(clipped.issues.some((i) => /Clipped/.test(i.text) && i.level === "error")).toBe(true);
    expect(validateClip([tone(1, 0.01)], RATE).issues.some((i) => /Very quiet/.test(i.text))).toBe(true);
    expect(validateClip([tone(1, 0.2).map((x) => x + 0.05)], RATE).issues.some((i) => /DC offset/.test(i.text))).toBe(true);
  });

  it("measures silence at each end and length against what was asked", () => {
    const q = validateClip([cat(new Float32Array(RATE * 2), tone(1, 0.3), new Float32Array(RATE * 3))], RATE);
    expect(q.leadSilence).toBeCloseTo(2, 1);
    expect(q.trailSilence).toBeCloseTo(3, 1);
    expect(q.issues.filter((i) => /silence/.test(i.text))).toHaveLength(2);
    expect(validateClip([tone(1, 0.3)], RATE, { requestedSeconds: 5, kind: "sound" }).issues.some((i) => /Asked for about 5/.test(i.text))).toBe(true);
    expect(validateClip([tone(1, 0.3)], RATE, { requestedSeconds: 1.2, kind: "sound" }).issues).toEqual([]);
  });

  it("warns about a low sample rate and a very short speech clip, and handles stereo", () => {
    expect(validateClip([tone(0.1, 0.3)], 22050).issues.map((i) => i.text).join(" ")).toMatch(/22050 Hz is low/);
    expect(validateClip([tone(0.1, 0.3)], RATE).issues.some((i) => /fifth of a second/.test(i.text))).toBe(true);
    expect(validateClip([tone(0.1, 0.3)], RATE, { kind: "sound" }).issues).toEqual([]);
    expect(validateClip([tone(1, 0.3), tone(1, 0.3)], RATE).channels).toBe(2);
  });
});

describe("qaMarkdown", () => {
  it("lists every file and says it measures, not judges", () => {
    const md = qaMarkdown("Test|Scene", [{ name: "a|b.wav", kind: "speech", qa: validateClip([tone(1, 0.3)], RATE) }, { name: "boom.wav", kind: "sound", qa: validateClip([new Float32Array(RATE)], RATE) }], "0.5.0", "now");
    expect(md).toMatch(/2 files checked; 1 with something/);
    expect(md).toMatch(/not a judgement/);
    expect(md).toMatch(/\| a\/b\.wav \| speech/);
    expect(md).toMatch(/ERROR: The clip is silent/);
  });
});
