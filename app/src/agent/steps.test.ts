import { describe, expect, it } from "vitest";
import { exportFullScene, exportStem } from "../exportScene";
import { foleyPlan } from "../foley";
import { newProject, type Project, type Take, type VoiceEntry } from "../types";
import { approve, runAll, type AgentRun } from "./graph";
import { MAX_SOUNDS, planProduction } from "./plan";
import { executors, type Env } from "./services";

const NOW = "2026-11-09T00:00:00Z";
const now = () => NOW;
const voice = (id: string, provider: VoiceEntry["provider"]): VoiceEntry => ({ id, name: id, provider, source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "", licence: "commercial" });
const LIB = [voice("eleven1", "elevenlabs"), voice("piper1", "piper")];
const dir = { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 };
const take = (id: string, seconds = 2): Take => ({ id, at: NOW, model: "piper", ext: "wav", voiceId: "piper1", sent: "x", seconds });

function scene(): Project {
  const p = newProject("p", "My: Scene?", NOW);
  p.script = "# Scene 1\n(The door slams.)\nADA: Good evening to you.\n(Rain hammers the window.)\nADA: Your soul is overdue.";
  p.characters = [{ id: "ada", name: "Ada", language: "English", voiceId: "piper1", casting: { version: 1, history: [], approval: { voiceId: "piper1", engine: "piper", voiceName: "piper1", modelId: null, speakerId: null, approvedAt: NOW, version: 1, basis: "NEEDS_AUDITION", acknowledged: [], by: "owner" } } }];
  p.lines = [{ id: "l1", characterId: "ada", scene: 1, text: "Good evening to you.", direction: dir, takes: [take("t1")], chosen: "t1", events: [] }, { id: "l2", characterId: "ada", scene: 1, text: "Your soul is overdue.", direction: dir, takes: [take("t2")], chosen: "t2", events: [] }];
  return p;
}
const plan = (p: Project, over = {}): AgentRun => planProduction(p, LIB, { id: "r", brief: "", mode: "autonomous", localOnly: false, cloudLimit: 5, now: NOW, price: () => 0, sound: { price: (n) => n * 0.1, cloud: true }, ...over });
const status = (r: AgentRun, id: string) => r.nodes.find((n) => n.id === id)!.status;

function env(p: { current: Project }, over: Partial<Env> = {}): Env {
  return { project: () => p.current, library: () => LIB, ready: () => ["elevenlabs", "piper"], localOnly: false, edit: (fn) => { p.current = fn(p.current); }, makeTake: async () => { throw new Error("not used"); }, measure: async () => ({ peak: 0.5, silenceRatio: 0.1, seconds: 2 }), ...over };
}

describe("the voice audition step", () => {
  it("lines up candidates per character without generating or spending anything", async () => {
    const p = { current: scene() };
    p.current.characters[0] = { ...p.current.characters[0]!, dna: { version: 1, timbre: "", accent: "", tendencies: "", range: "", presets: [], pronunciations: [], references: [], identity: null, profile: { background: "", vocalAge: "", texture: "", signature: [], audition: "", consentNote: "", provenance: { revision: 1, createdAt: NOW, updatedAt: NOW, source: "preset", presetId: "film_tv.noir-detective", presetVersion: 1, appVersion: "0.11.0" } } } };
    let made = 0;
    const r = await runAll(plan(p.current), executors(env(p, { makeTake: async () => { made++; throw new Error("no"); } })), now);
    const out = r.nodes.find((n) => n.id === "audition")!.output as { candidates: { character: string; preset: string | null; voices: { engine: string; cloud: boolean }[] }[] };
    expect(status(r, "audition")).toBe("completed");
    expect(out.candidates[0]).toMatchObject({ character: "Ada", preset: "Noir detective" });
    expect(out.candidates[0]!.voices.some((v) => v.cloud)).toBe(true);
    expect(made).toBe(0);
    expect(r.spent).toBe(0);
  });
  it("offers only local voices in a local-only run", async () => {
    const p = { current: scene() };
    const r = await runAll(plan(p.current, { localOnly: true, cloudLimit: 0 }), executors(env(p, { localOnly: true })), now);
    const out = r.nodes.find((n) => n.id === "audition")!.output as { candidates: { voices: { cloud: boolean }[] }[] };
    expect(out.candidates.every((c) => c.voices.every((v) => !v.cloud))).toBe(true);
  });
});

describe("the sound step", () => {
  it("is off by default, estimated, capped, and spend-gated when the sound engine is a cloud one", () => {
    const n = plan(scene()).nodes.find((x) => x.id === "sound")!;
    expect(n).toMatchObject({ enabled: false, cloud: true, gate: "spend" });
    expect(n.estimate).toBeCloseTo(foleyPlan(scene().script, scene().lines).length * 0.1);
    const many = scene(); many.script = Array.from({ length: 20 }, (_, i) => `(Rain hammers window ${i}.)\nADA: Line number ${i}.`).join("\n");
    expect(plan(many).nodes.find((x) => x.id === "sound")!.detail).toMatch(new RegExp(`at most ${MAX_SOUNDS}`));
  });
  it("makes the sounds next to the lines they came from and records what it spent, once", async () => {
    const p = { current: scene() };
    const prompts: string[] = [];
    const e = env(p, { makeSound: async (prompt, seconds) => { prompts.push(prompt); return { take: { id: "s" + prompts.length, ext: "wav", seconds }, spent: 0.1 }; } });
    let r = plan(p.current);
    r = { ...r, nodes: r.nodes.map((n) => (n.id === "sound" ? { ...n, enabled: true } : n)) };
    r = await runAll(r, executors(e), now);
    expect(status(r, "sound")).toBe("completed");
    expect(prompts.length).toBeGreaterThan(0);
    expect(p.current.lines.some((l) => l.events.length > 0)).toBe(true);
    expect(r.spent).toBeCloseTo(prompts.length * 0.1);
    // running the finished plan again makes nothing more
    const again = await runAll(r, executors(e), now);
    expect(prompts.length).toBe(again.nodes.length ? prompts.length : 0);
  });
  it("is blocked past the cloud limit and in a local-only run, and makes nothing", async () => {
    for (const over of [{ cloudLimit: 0.05 }, { localOnly: true, cloudLimit: 0 }]) {
      const p = { current: scene() };
      let made = 0;
      let r = plan(p.current, over);
      r = { ...r, nodes: r.nodes.map((n) => (n.id === "sound" ? { ...n, enabled: true } : n)) };
      r = await runAll(r, executors(env(p, { makeSound: async () => { made++; return { take: { id: "s", ext: "wav", seconds: 1 }, spent: 0 }; } })), now);
      expect(status(r, "sound")).toBe("failed");
      expect(made).toBe(0);
    }
  });
  it("does not remake a sound the line already has", async () => {
    const p = { current: scene() };
    let made = 0;
    const e = env(p, { makeSound: async (_prompt, seconds) => { made++; return { take: { id: "s" + made, ext: "wav", seconds }, spent: 0 }; } });
    let r = plan(p.current);
    r = { ...r, nodes: r.nodes.map((n) => (n.id === "sound" ? { ...n, enabled: true } : n)) };
    await runAll(r, executors(e), now);
    const first = made;
    let r2 = plan(p.current);
    r2 = { ...r2, nodes: r2.nodes.map((n) => (n.id === "sound" ? { ...n, enabled: true } : n)) };
    await runAll(r2, executors(e), now);
    expect(made).toBe(first);
  });
});

describe("the export step", () => {
  const sine = (n: number, rate: number) => Float32Array.from({ length: n }, (_, i) => 0.1 * Math.sin((2 * Math.PI * 220 * i) / rate));
  const fakeExport = { render: async (planned: { total: number }, _bed: number, rate: number) => [sine(Math.ceil(planned.total * rate), rate), sine(Math.ceil(planned.total * rate), rate)], sha256: async () => "abc123" };
  it("never runs before the person approves delivery, in any mode", async () => {
    const p = { current: scene() };
    let exported = 0;
    const e = env(p, { exportScene: async () => { exported++; return { path: "x", name: "x", seconds: 1, lufs: -20, truePeakDb: -3, gainDb: 0, targetReached: true, limitedBy: null, sha256: "s", rate: 48000, bits: 24 }; } });
    let r = await runAll(plan(p.current), executors(e), now);
    expect(status(r, "export")).toBe("awaiting_approval");
    expect(exported).toBe(0);
    r = await runAll(approve(r, "export", NOW), executors(e), now);
    expect(status(r, "export")).toBe("completed");
    expect(exported).toBe(1);
    expect(r.nodes.find((n) => n.id === "export")!.output).toMatchObject({ path: "x" });
  });
  it("refuses to export while there are unresolved problems", async () => {
    const p = { current: scene() };
    p.current.lines[1] = { ...p.current.lines[1]!, takes: [], chosen: undefined };
    let exported = 0;
    const e = env(p, { exportScene: async () => { exported++; throw new Error("no"); } });
    await expect(executors(e).export!({ ...plan(p.current).nodes.find((n) => n.id === "export")! }, plan(p.current), new AbortController().signal)).rejects.toThrow(/must be fixed/);
    expect(exported).toBe(0);
  });
  it("exportFullScene mixes the chosen takes, applies the loudness target and writes one safe-named WAV", async () => {
    const p = scene();
    p.export = { target: "web", ceiling: -1, rate: 48000, bits: 24 };
    let wrote: { name: string; b64: string } | null = null;
    const r = await exportFullScene(p, { ...fakeExport, write: async (name, b64) => { wrote = { name, b64 }; return `C:/exports/${name}` } });
    expect(wrote!.name).toBe("My Scene - full scene.wav");
    expect(wrote!.name).not.toMatch(/[:?\\/]/);
    expect(atob(wrote!.b64.slice(0, 8))).toMatch(/^RIFF/);
    expect(r).toMatchObject({ rate: 48000, bits: 24, sha256: "abc123" });
    expect(r.lufs).toBeCloseTo(-16, 0);
    expect(r.truePeakDb).toBeLessThanOrEqual(-1 + 0.1);
  });
  it("exportFullScene reports when the peak ceiling stopped the loudness target, instead of squashing the sound", async () => {
    const p = scene();
    p.export = { target: "stream", ceiling: -16 };
    const r = await exportFullScene(p, { ...fakeExport, write: async (n) => n });
    expect(r.targetReached).toBe(false);
    expect(r.limitedBy).toBe("ceiling");
  });
  it("exportFullScene refuses an empty project and lines with no take, and writes nothing", async () => {
    let wrote = 0;
    const deps = { ...fakeExport, write: async () => { wrote++; return "x"; } };
    await expect(exportFullScene(newProject("e", "e", NOW), deps)).rejects.toThrow(/nothing to export/);
    const p = scene(); p.lines[0] = { ...p.lines[0]!, takes: [], chosen: undefined };
    await expect(exportFullScene(p, deps)).rejects.toThrow(/no take/);
    expect(wrote).toBe(0);
  });
  it("names files from letters, digits, spaces and dashes only", () => {
    expect(exportStem("../../etc/passwd")).toBe("etcpasswd");
    expect(exportStem("???")).toBe("Greenroom");
    expect(exportStem("A".repeat(200)).length).toBe(60);
  });
});

describe("the quality step and speaker consistency", () => {
  const withTakes = () => {
    const p = scene();
    p.lines = Array.from({ length: 4 }, (_, i) => ({ id: `l${i + 1}`, characterId: "ada", scene: 1, text: `Line number ${i + 1} is here.`, direction: dir, takes: [take(`t${i + 1}`)], chosen: `t${i + 1}`, events: [] }));
    return { current: p };
  };
  const vec = (angle: number) => { const r = (angle * Math.PI) / 180; return [Math.cos(r), Math.sin(r), ...Array(254).fill(0)]; };
  const qc = async (p: { current: Project }, over: Partial<Env> = {}) => {
    const r = await runAll(plan(p.current), executors(env(p, { measure: async () => ({ peak: 0.5, silenceRatio: 0.1, seconds: 2, lufs: -20, clipRuns: 0 }), ...over })), now);
    return r.nodes.find((n) => n.id === "qc")!.output as { findings: { kind: string; severity: string; text: string }[]; consistency: string };
  };
  it("flags a take that does not sound like the character's others, as 'listen' and never as a problem", async () => {
    const p = withTakes();
    const out = await qc(p, { embed: async () => ({ t1: vec(0), t2: vec(6), t3: vec(-5), t4: vec(80) }) });
    const f = out.findings.filter((x) => x.kind === "consistency");
    expect(f).toHaveLength(1);
    expect(f[0]!.severity).toBe("listen");
    expect(f[0]!.text).toMatch(/Ada: this take is unlike/);
    expect(out.consistency).toBe("checked for 1 character");
  });
  it("finds nothing to flag when the takes measure as one speaker", async () => {
    const out = await qc(withTakes(), { embed: async () => ({ t1: vec(0), t2: vec(6), t3: vec(-5), t4: vec(9) }) });
    expect(out.findings.some((x) => x.kind === "consistency")).toBe(false);
  });
  it("says so plainly when the tool is missing or fails, instead of reporting everything fine", async () => {
    expect((await qc(withTakes())).consistency).toMatch(/not checked/);
    expect((await qc(withTakes(), { embed: async () => { throw new Error("not installed"); } })).consistency).toBe("not checked (the speaker tool is not installed)");
    expect((await qc(withTakes(), { embed: async () => { throw new Error("boom"); } })).consistency).toBe("not checked (the speaker tool failed)");
  });
});
