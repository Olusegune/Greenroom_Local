import { describe, expect, it } from "vitest";
import { newProject, type MusicClip, type Picture, type Project, type Take, type VoiceEntry } from "../types";
import { loudnessChecks, mixChecks, qualityCheck, syncChecks } from "./quality";

const NOW = "2026-11-09T00:00:00Z";
const LIB: VoiceEntry[] = [{ id: "v", name: "v", provider: "piper", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "" }];
const takeOf = (id: string, seconds = 2) => ({ id, at: NOW, model: "piper", ext: "wav", voiceId: "v", sent: "x", seconds }) as Take;
const m = (lufs: number) => ({ peak: 0.5, silenceRatio: 0.1, seconds: 2, lufs });

function withTakes(n: number): Project {
  const p = newProject("p", "t", NOW);
  p.characters = [{ id: "c", name: "Ada", language: "English", voiceId: "v" }];
  p.lines = Array.from({ length: n }, (_, i) => ({ id: `l${i}`, characterId: "c", scene: 1, text: "Hello there my friend.", direction: { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 }, takes: [takeOf(`t${i}`)], chosen: `t${i}`, events: [] }));
  return p;
}
const clip = (duck: boolean): MusicClip => ({ id: "m", name: "m", take: { id: "x", ext: "wav", seconds: 10 }, start: 0, gainDb: 0, fadeIn: 0, fadeOut: 0, trimIn: 0, length: 10, duck, source: "" });
const pic = (duration: number): Picture => ({ path: "a", name: "a", fpsNum: 24, fpsDen: 1, fpsKnown: true, duration, width: 1, height: 1, startFrame: 0 });

describe("loudness consistency", () => {
  it("flags a line far from the scene's typical level and leaves the rest alone", () => {
    const f = loudnessChecks(withTakes(5), Object.fromEntries([-20, -20.5, -19.5, -20.2, -31].map((l, i) => [`t${i}`, m(l)])));
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ lineId: "l4", kind: "loudness", severity: "listen" });
    expect(f[0]!.text).toMatch(/quieter/);
  });
  it("needs three measured lines and ignores silent takes", () => {
    expect(loudnessChecks(withTakes(2), { t0: m(-10), t1: m(-40) })).toEqual([]);
    expect(loudnessChecks(withTakes(4), { t0: m(-20), t1: m(-20), t2: m(-20), t3: m(-Infinity) })).toEqual([]);
  });
});

describe("music ducking", () => {
  it("flags music that does not dip under speech, and dips too weak to keep words clear", () => {
    const p = withTakes(1);
    p.music = [clip(true)];
    expect(mixChecks({ ...p, mix: { duck: false } })[0]).toMatchObject({ kind: "ducking", severity: "problem" });
    expect(mixChecks({ ...p, music: [clip(false)], mix: { duck: true } })[0]!.text).toMatch(/none of the music clips/);
    expect(mixChecks({ ...p, mix: { duck: true, amountDb: -3 } })[0]).toMatchObject({ severity: "listen" });
    expect(mixChecks({ ...p, mix: { duck: true, amountDb: -12, attack: 0.15 } })).toEqual([]);
  });
  it("says nothing when there is no music or no dialogue", () => {
    expect(mixChecks({ ...withTakes(1), music: [] })).toEqual([]);
    const none = withTakes(1); none.music = [clip(true)]; none.lines[0] = { ...none.lines[0]!, takes: [], chosen: undefined };
    expect(mixChecks(none)).toEqual([]);
  });
});

describe("picture sync", () => {
  it("flags a line that overruns the picture and lines that overlap", () => {
    const p = withTakes(3);
    p.picture = pic(10);
    p.lines[0] = { ...p.lines[0]!, cue: 0, takes: [takeOf("t0", 3)] };
    p.lines[1] = { ...p.lines[1]!, cue: 2, takes: [takeOf("t1", 3)] };
    p.lines[2] = { ...p.lines[2]!, cue: 9, takes: [takeOf("t2", 3)] };
    const f = syncChecks(p);
    expect(f.some((x) => x.severity === "problem" && x.lineId === "l2")).toBe(true);
    expect(f.some((x) => x.severity === "listen" && x.lineId === "l1" && /overlap/.test(x.text))).toBe(true);
  });
  it("notes an attached picture with no cues, and does nothing without a picture", () => {
    const p = withTakes(2);
    expect(syncChecks(p)).toEqual([]);
    p.picture = pic(10);
    expect(syncChecks(p)[0]!.text).toMatch(/no line has a cue/);
  });
  it("is part of the full quality check", () => {
    const p = withTakes(1); p.music = [clip(true)]; p.mix = { duck: false };
    expect(qualityCheck(p, LIB).some((x) => x.kind === "ducking")).toBe(true);
  });
});
