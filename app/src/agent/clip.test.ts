import { describe, expect, it } from "vitest";
import { newProject, type Take, type VoiceEntry } from "../types";
import { countClipRuns, qualityCheck } from "./quality";

const NOW = "2026-11-09T00:00:00Z";
const LIB: VoiceEntry[] = [{ id: "v", name: "v", provider: "piper", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "" }];
const take = (id: string): Take => ({ id, at: NOW, model: "piper", ext: "wav", voiceId: "v", sent: "x", seconds: 2 });
function proj() {
  const p = newProject("p", "t", NOW);
  p.characters = [{ id: "c", name: "Ada", language: "English", voiceId: "v" }];
  p.lines = [{ id: "l", characterId: "c", scene: 1, text: "Hello there my friend.", direction: { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 }, takes: [take("t")], chosen: "t", events: [] }];
  return p;
}

describe("clipping is flat tops, not a loud peak", () => {
  it("counts runs of three or more full-scale samples", () => {
    expect(countClipRuns([0, 1, 0, -1, 0])).toBe(0);
    expect(countClipRuns([0, 1, 1, 0, 0.5])).toBe(0);
    expect(countClipRuns([0, 1, 1, 1, 0, -1, -1, -1, -1, 0])).toBe(2);
    expect(countClipRuns(new Float32Array(0))).toBe(0);
  });
  it("a take normalised to full scale (peak 1.0, no flat tops) is not called clipped", () => {
    const sine = Float32Array.from({ length: 4800 }, (_, i) => Math.sin((2 * Math.PI * 220 * i) / 48000));
    expect(Math.max(...sine)).toBeGreaterThan(0.999);
    expect(countClipRuns(sine)).toBe(0);
    const f = qualityCheck(proj(), LIB, { t: { peak: 1, silenceRatio: 0.1, seconds: 2, clipRuns: 0 } });
    expect(f.some((x) => x.kind === "clipping")).toBe(false);
  });
  it("a take with flat tops is a problem", () => {
    const f = qualityCheck(proj(), LIB, { t: { peak: 1, silenceRatio: 0.1, seconds: 2, clipRuns: 3 } });
    expect(f.find((x) => x.kind === "clipping")).toMatchObject({ severity: "problem" });
    expect(f.find((x) => x.kind === "clipping")!.text).toMatch(/3 flat-topped/);
  });
  it("when only the peak is known, full scale is a reason to listen, never a block", () => {
    const f = qualityCheck(proj(), LIB, { t: { peak: 1, silenceRatio: 0.1, seconds: 2 } });
    expect(f.find((x) => x.kind === "clipping")).toMatchObject({ severity: "listen" });
  });
});
