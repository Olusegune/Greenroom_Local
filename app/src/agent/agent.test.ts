import { describe, expect, it } from "vitest";
import { newProject, type Project, type Take, type VoiceEntry } from "../types";
import { approve, check, estimateRemaining, merge, needsApproval, progress, regenerate, reject, resume, retry, runAll, runnable, setEnabled, step, type AgentRun, type Executors } from "./graph";
import { interpret, settingsFrom } from "./brief";
import { planProblems, planProduction } from "./plan";
import { linesToRemake, qualityCheck, summarize } from "./quality";
import { executors, type Env } from "./services";

const NOW = "2026-11-09T00:00:00Z";
const now = () => NOW;
const voice = (id: string, provider: VoiceEntry["provider"], over: Partial<VoiceEntry> = {}): VoiceEntry => ({ id, name: id, provider, source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "", ...over });
const LIB = [voice("eleven1", "elevenlabs", { licence: "commercial" }), voice("piper1", "piper", { licence: "commercial" })];

function project(): Project {
  const p = newProject("p1", "Test", NOW);
  p.script = "ADA: Good evening.\nBOB: Your soul is overdue.";
  const approval = (voiceId: string, engine: string) => ({ version: 1 as const, history: [], approval: { voiceId, engine, voiceName: voiceId, modelId: null, speakerId: null, approvedAt: NOW, version: 1, basis: "NEEDS_AUDITION" as const, acknowledged: [], by: "owner" as const } });
  p.characters = [{ id: "ada", name: "Ada", language: "English", voiceId: "eleven1", casting: approval("eleven1", "elevenlabs") }, { id: "bob", name: "Bob", language: "English", voiceId: "piper1", casting: approval("piper1", "piper") }];
  const dir = { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 };
  p.lines = [{ id: "l1", characterId: "ada", scene: 1, text: "Good evening to you.", direction: dir, takes: [], events: [] }, { id: "l2", characterId: "bob", scene: 1, text: "Your soul is overdue.", direction: dir, takes: [], events: [] }];
  return p;
}
const price = (e: string, chars: number) => (e === "elevenlabs" ? chars * 0.01 : 0);
const plan = (over: Partial<Parameters<typeof planProduction>[2]> = {}, p = project()): AgentRun => planProduction(p, LIB, { id: "r1", brief: "", mode: "guided", localOnly: false, cloudLimit: 5, now: NOW, price, ...over });
const ok: Executors = Object.fromEntries((["analyze", "cast", "approve_cast", "audition", "direct", "take", "qc", "sound", "timeline", "export"] as const).map((k) => [k, async () => ({ output: k })]));
const fake = (over: Partial<Record<keyof Executors, NonNullable<Executors[keyof Executors]>>> = {}): Executors => ({ ...ok, ...over });
async function drive(run: AgentRun, ex: Executors, approveAll = false): Promise<AgentRun> {
  let r = run;
  for (let i = 0; i < 12; i++) {
    r = await runAll(r, ex, now);
    const wait = r.nodes.filter((n) => n.status === "awaiting_approval" && n.gate !== "final");
    if (!approveAll || !wait.length) break;
    for (const n of wait) r = approve(r, n.id, NOW);
  }
  return r;
}
const status = (r: AgentRun, id: string) => r.nodes.find((n) => n.id === id)!.status;

describe("production planning", () => {
  const r = plan();
  it("plans every stage with dependencies and one take per line", () => {
    expect(r.nodes.map((n) => n.kind)).toEqual(["analyze", "cast", "approve_cast", "audition", "direct", "take", "take", "qc", "sound", "timeline", "export"]);
    expect(r.nodes.find((n) => n.id === "take:l1")!.deps).toEqual(["direct"]);
    expect(r.nodes.find((n) => n.id === "qc")!.deps).toEqual(["take:l1", "take:l2"]);
  });
  it("marks cloud work and estimates its cost, local work is free", () => {
    expect(r.nodes.find((n) => n.id === "take:l1")).toMatchObject({ cloud: true, gate: "spend", maxAttempts: 1 });
    expect(r.nodes.find((n) => n.id === "take:l1")!.estimate).toBeCloseTo(0.2);
    expect(r.nodes.find((n) => n.id === "take:l2")).toMatchObject({ cloud: false, estimate: 0, maxAttempts: 2 });
  });
  it("keeps sound generation off by default and delivery behind a final gate", () => {
    expect(r.nodes.find((n) => n.id === "sound")!.enabled).toBe(false);
    expect(r.nodes.find((n) => n.id === "export")!.gate).toBe("final");
  });
  it("keeps approved takes: a line with a chosen take comes back finished", () => {
    const p = project();
    const take = { id: "t1", at: NOW, model: "eleven_v4", ext: "mp3", voiceId: "eleven1", sent: "x", seconds: 1 } as Take;
    p.lines[0] = { ...p.lines[0]!, takes: [take], chosen: "t1" };
    expect(status(plan({}, p), "take:l1")).toBe("completed");
  });
  it("reports problems up front: missing voice, cloud voice in a local-only run, unconsented clone, over-budget", () => {
    const p = project();
    p.characters[0] = { ...p.characters[0]!, voiceId: undefined };
    expect(planProblems(plan({}, p), p, LIB).join(" ")).toMatch(/Ada has no voice/);
    expect(planProblems(plan({ localOnly: true }), project(), LIB).join(" ")).toMatch(/local-only/);
    const cloned = [voice("c1", "elevenlabs", { source: "cloned" })];
    const p2 = project(); p2.characters[0] = { ...p2.characters[0]!, voiceId: "c1" };
    expect(planProblems(plan({}, p2), p2, cloned).join(" ")).toMatch(/no consent record/);
    expect(planProblems(plan({ cloudLimit: 0.05 }), project(), LIB).join(" ")).toMatch(/over your limit/);
  });
  it("puts the approval of the cast behind a rights gate that is never automatic, with or without a cloned voice", () => {
    const cloned = [voice("c1", "elevenlabs", { source: "cloned" })];
    const p = project(); p.characters[0] = { ...p.characters[0]!, voiceId: "c1" };
    delete (p.characters[0] as { casting?: unknown }).casting;
    const n = planProduction(p, cloned, { id: "r", brief: "", mode: "autonomous", localOnly: false, cloudLimit: 5, now: NOW, price }).nodes.find((x) => x.id === "approve_cast")!;
    expect(n.gate).toBe("rights");
    expect(n.status).toBe("planned");
    expect(n.deps).toEqual(["cast"]);
  });
  it("finds the cast already approved and keeps it: the approval step comes back finished", () => {
    expect(status(plan(), "approve_cast")).toBe("completed");
  });
});

describe("approval checkpoints", () => {
  it("guided mode stops at the creative gate and runs nothing past it", async () => {
    const r = await drive(plan(), fake());
    expect(status(r, "analyze")).toBe("completed");
    expect(status(r, "direct")).toBe("awaiting_approval");
    expect(status(r, "take:l1")).toBe("planned");
    expect(r.audit.some((a) => a.event.startsWith("waiting for approval"))).toBe(true);
  });
  it("runs to the end when each checkpoint is approved, and still stops at delivery", async () => {
    const r = await drive(plan(), fake(), true);
    expect(["completed", "awaiting_approval"]).toContain(status(r, "export"));
    expect(status(r, "timeline")).toBe("completed");
    expect(status(r, "export")).toBe("awaiting_approval");
  });
  it("autonomous mode skips creative and spend gates but never rights or delivery", async () => {
    const auto = plan({ mode: "autonomous" });
    const r = await drive(auto, fake());
    expect(status(r, "take:l1")).toBe("completed");
    expect(status(r, "timeline")).toBe("completed");
    expect(status(r, "export")).toBe("awaiting_approval");
    expect(needsApproval(auto, auto.nodes.find((n) => n.id === "export")!)).toBe(true);
  });
  it("manual mode runs nothing", async () => {
    const r = await drive(plan({ mode: "manual" }), fake());
    expect(status(r, "analyze")).toBe("failed");
    expect(r.nodes.find((n) => n.id === "analyze")!.error).toMatch(/Manual Studio/);
  });
  it("rejecting a step cancels it and its dependents do not run", async () => {
    let r = await drive(plan(), fake());
    r = reject(r, "direct", NOW, "wrong direction");
    r = await runAll(r, fake(), now);
    expect(status(r, "direct")).toBe("cancelled");
    expect(status(r, "take:l1")).toBe("planned");
  });
});

describe("budget, privacy and consent are enforced", () => {
  it("never runs a cloud step past the cloud limit, and spends nothing when blocked", async () => {
    let spent = 0;
    const ex = fake({ take: async (n) => { spent += n.estimate; return { output: "t", spent: n.estimate }; } });
    const r = await drive(plan({ mode: "autonomous", cloudLimit: 0.1 }), ex);
    expect(status(r, "take:l1")).toBe("failed");
    expect(r.nodes.find((n) => n.id === "take:l1")!.error).toMatch(/past the limit/);
    expect(spent).toBe(0);
    expect(r.spent).toBe(0);
  });
  it("a local-only run never runs a cloud step, whatever the mode", async () => {
    let cloudRan = false;
    const ex = fake({ take: async (n) => { if (n.cloud) cloudRan = true; return { output: "t" }; } });
    const r = await drive(plan({ mode: "autonomous", localOnly: true, cloudLimit: 0 }), ex);
    expect(cloudRan).toBe(false);
    expect(status(r, "take:l1")).toBe("failed");
    expect(r.nodes.find((n) => n.id === "take:l1")!.error).toMatch(/local-only/);
    expect(status(r, "take:l2")).toBe("completed");
  });
  it("tracks what was actually spent and stops at the limit across steps", async () => {
    const p = project();
    p.lines.push({ ...p.lines[0]!, id: "l3" }); p.lines[2] = { ...p.lines[2]!, text: "A second line for Ada here." };
    const r0 = plan({ mode: "autonomous", cloudLimit: 0.45 }, p);
    const ex = fake({ take: async (n) => ({ output: "t", spent: n.estimate }) });
    const r = await drive(r0, ex);
    expect(r.spent).toBeLessThanOrEqual(0.45);
    expect(r.nodes.filter((n) => n.cloud && n.status === "failed").length).toBe(1);
  });
  it("estimates what is left to spend", () => {
    expect(estimateRemaining(plan())).toBeCloseTo(0.2);
  });
  it("check() blocks without running anything", () => {
    const r = plan({ localOnly: true });
    expect(check(r, r.nodes.find((n) => n.id === "take:l1")!)).toMatchObject({ blocked: true });
    expect(check(r, r.nodes.find((n) => n.id === "take:l2")!)).toEqual({ blocked: false });
  });
  it("the take step refuses a cloned voice with no consent", async () => {
    const p = project();
    const lib = [voice("eleven1", "elevenlabs", { source: "cloned" }), LIB[1]!];
    let made = 0;
    const env: Env = { project: () => p, library: () => lib, ready: () => ["elevenlabs", "piper"], edit: () => undefined, makeTake: async () => { made++; throw new Error("should not be called"); }, measure: async () => null, localOnly: false };
    await expect(executors(env).take!({ ...plan().nodes.find((n) => n.id === "take:l1")! }, plan(), new AbortController().signal)).rejects.toThrow(/no consent record/);
    expect(made).toBe(0);
  });
});

describe("interruption, resume, retry and failure recovery", () => {
  it("cancelling mid-run stops cleanly and resume carries on without redoing finished work", async () => {
    const ac = new AbortController();
    const calls: string[] = [];
    const ex = fake({ analyze: async () => { calls.push("analyze"); return {}; }, cast: async () => { calls.push("cast"); ac.abort(); return {}; } });
    let r = plan({ mode: "autonomous" });
    r = await runAll(r, ex, now, ac.signal);
    expect(r.audit.some((a) => a.event.startsWith("cancelled"))).toBe(true);
    expect(status(r, "analyze")).toBe("completed");
    r = resume(r, NOW);
    expect(r.nodes.some((n) => n.status === "running")).toBe(false);
    const again: string[] = [];
    r = await runAll(r, fake({ analyze: async () => { again.push("analyze"); return {}; }, cast: async () => { again.push("cast"); return {}; } }), now);
    expect(again).not.toContain("analyze");
  });
  it("a crash while running comes back as ready, not stuck", () => {
    let r = plan();
    r = { ...r, nodes: r.nodes.map((n) => (n.id === "analyze" ? { ...n, status: "running" as const } : n)) };
    expect(status(resume(r, NOW), "analyze")).toBe("ready");
  });
  it("a local step is retried once, then fails and stays failed until the person retries it", async () => {
    let n = 0;
    const ex = fake({ qc: async () => { n++; throw new Error("measure failed"); } });
    let r = await drive(plan({ mode: "autonomous" }), ex);
    expect(n).toBe(2);
    expect(status(r, "qc")).toBe("failed");
    expect(status(r, "timeline")).toBe("planned");
    r = retry(r, "qc", NOW);
    r = await runAll(r, fake(), now);
    expect(status(r, "qc")).toBe("completed");
  });
  it("a cloud step is never retried automatically, so a failure cannot charge twice", async () => {
    let n = 0;
    const ex = fake({ take: async (node) => { if (node.cloud) { n++; throw new Error("provider error"); } return { output: "t" }; } });
    const r = await drive(plan({ mode: "autonomous" }), ex);
    expect(n).toBe(1);
    expect(status(r, "take:l1")).toBe("failed");
    expect(r.spent).toBe(0);
  });
  it("a missing executor fails clearly instead of hanging", async () => {
    const r = await step(plan(), {}, now);
    expect(r.event).toBe("blocked" === r.event ? "blocked" : "failed");
  });
  it("the loop is bounded", async () => {
    const r = await runAll(plan({ mode: "autonomous" }), fake(), now);
    expect(r.audit.length).toBeLessThan(200);
  });
});

describe("selective regeneration and replanning", () => {
  it("remakes only the chosen line and what depends on it; other takes are kept", async () => {
    let r = await drive(plan({ mode: "autonomous" }), fake());
    r = regenerate(r, ["l1"], NOW);
    expect(status(r, "take:l1")).toBe("planned");
    expect(status(r, "take:l2")).toBe("completed");
    expect(status(r, "qc")).toBe("planned");
    expect(status(r, "analyze")).toBe("completed");
    expect(r.audit.some((a) => a.event === "regenerate" && a.nodeId === "take:l1")).toBe(true);
  });
  it("replanning keeps finished steps whose inputs did not change and redoes the ones that did", async () => {
    const r = await drive(plan({ mode: "autonomous" }), fake());
    const p = project(); p.lines[0] = { ...p.lines[0]!, text: "A completely different line of text." };
    const merged = merge(r, plan({ mode: "autonomous" }, p), NOW);
    expect(status(merged, "analyze")).toBe("completed");
    expect(status(merged, "take:l2")).toBe("completed");
    expect(status(merged, "take:l1")).toBe("planned");
    expect(status(merged, "qc")).toBe("planned");
  });
  it("disabling a step skips it and lets its dependents continue", async () => {
    let r = setEnabled(plan({ mode: "autonomous" }), "sound", true, NOW);
    r = setEnabled(r, "sound", false, NOW);
    r = await drive(r, fake());
    expect(status(r, "sound")).toBe("skipped");
    expect(progress(r).failed).toBe(0);
  });
  it("is idempotent: running a finished plan again does nothing", async () => {
    const r = await drive(plan({ mode: "autonomous" }), fake());
    const again = await runAll(r, fake(), now);
    expect(again.nodes.map((n) => n.status)).toEqual(r.nodes.map((n) => n.status));
    expect(runnable(again).length).toBe(0);
  });
});

describe("running for real against a project (fake engine)", () => {
  function setup(opts: { localOnly?: boolean } = {}) {
    let p = project();
    const made: string[] = [];
    const env: Env = {
      project: () => p, library: () => LIB, ready: () => ["elevenlabs", "piper"], localOnly: !!opts.localOnly,
      edit: (fn) => { p = fn(p); },
      makeTake: async (line, v) => { made.push(`${line.id}:${v.id}`); return { take: { id: `t-${line.id}`, at: NOW, model: v.provider === "piper" ? "piper" : "eleven_v4", ext: "wav", voiceId: v.id, sent: line.text, seconds: 1.5 } as Take, spent: v.provider === "piper" ? 0 : 0.2 }; },
      measure: async () => ({ peak: 0.6, silenceRatio: 0.1, seconds: 1.5 }),
    };
    return { env, made, get project() { return p; } };
  }
  it("assembles the timeline from approved takes and gets to a ready-to-export state, with delivery still waiting", async () => {
    const s = setup();
    const r0 = plan({ mode: "autonomous" }, s.project);
    const r = await drive(r0, executors(s.env));
    expect(s.made.sort()).toEqual(["l1:eleven1", "l2:piper1"]);
    expect(s.project.lines.every((l) => l.chosen)).toBe(true);
    expect(status(r, "qc")).toBe("completed");
    expect(status(r, "timeline")).toBe("completed");
    expect(status(r, "export")).toBe("awaiting_approval");
    expect(r.spent).toBeCloseTo(0.2);
    const done = await runAll(approve(r, "export", NOW), executors(s.env), now);
    expect(done.nodes.find((n) => n.id === "export")!.output).toMatchObject({ ready: true });
  });
  it("the cast step lists candidates for a character with nothing stated, invents nothing, and never overrides a choice", async () => {
    const s = setup();
    s.project.characters = s.project.characters.map((c) => (c.id === "bob" ? { ...c, voiceId: undefined, casting: undefined, about: "a dry noir detective" } : c));
    const r = await drive(plan({ mode: "autonomous" }, s.project), executors(s.env));
    expect(s.project.characters.find((c) => c.id === "ada")!.voiceId).toBe("eleven1");
    // Nothing STATED about Bob's voice (the description is not a requirement), so nothing is assigned and the person decides.
    expect(s.project.characters.find((c) => c.id === "bob")!.voiceId).toBeUndefined();
    expect(s.project.characters.find((c) => c.id === "bob")!.cast).toBeUndefined();
    expect(status(r, "cast")).toBe("failed");
    expect(r.nodes.find((n) => n.id === "cast")!.error).toMatch(/needs your decision[\s\S]*Bob[\s\S]*nothing required is stated/);
  });
  it("the cast step assigns a voice only when it is proven to fit what was stated, and leaves it unapproved", async () => {
    const s = setup();
    const proven = { ...voice("proven", "piper"), meta: { version: 1 as const, revisions: [], gender: { value: "masculine" as const, status: "verified" as const, source: "owner_listening" as const, confidence: "high" as const }, age: { value: "old" as const, status: "verified" as const, source: "owner_listening" as const, confidence: "high" as const }, languages: { value: ["english"], status: "verified" as const, source: "owner_listening" as const, confidence: "high" as const } } };
    s.env.library = () => [...LIB, proven];
    s.project.characters = s.project.characters.map((c) => (c.id === "bob" ? { ...c, voiceId: undefined, casting: undefined, cast: { version: 1 as const, vocalGender: "masculine" as const, vocalAge: ["old" as const] } } : c));
    const r = await drive(plan({ mode: "autonomous" }, s.project), executors(s.env));
    const bob = s.project.characters.find((c) => c.id === "bob")!;
    expect(bob.voiceId).toBe("proven");
    expect(bob.casting?.approval).toBeUndefined();
    expect(status(r, "cast")).toBe("completed");
    // The approval step is the person's: autonomous mode stops there.
    expect(status(r, "approve_cast")).toBe("awaiting_approval");
    expect(status(r, "take:l2")).toBe("planned");
  });
  it("only the person's approval locks the cast, and the agent cannot approve a voice", async () => {
    const s = setup();
    s.project.characters = s.project.characters.map((c) => ({ ...c, casting: undefined }));
    let r = await drive(plan({ mode: "autonomous" }, s.project), executors(s.env));
    expect(status(r, "approve_cast")).toBe("awaiting_approval");
    expect(s.project.characters.every((c) => !c.casting?.approval)).toBe(true);
    r = approve(r, "approve_cast", NOW);
    r = await runAll(r, executors(s.env), now);
    expect(s.project.characters.every((c) => !!c.casting?.approval)).toBe(true);
    expect(status(r, "approve_cast")).toBe("completed");
  });
  it("a local-only run casts only local voices and says so when none fit", async () => {
    const s = setup({ localOnly: true });
    s.project.characters = s.project.characters.map((c) => (c.id === "bob" ? { ...c, voiceId: undefined, casting: undefined, cast: { version: 1 as const, vocalGender: "masculine" as const } } : c));
    const r = await drive(plan({ mode: "autonomous", localOnly: true, cloudLimit: 0 }, s.project), executors(s.env));
    expect(s.project.characters.find((c) => c.id === "bob")!.voiceId).not.toBe("eleven1");
    expect(["completed", "failed"]).toContain(status(r, "cast"));
  });
  it("export refuses while there are unresolved problems", async () => {
    const s = setup();
    s.project.characters[1] = { ...s.project.characters[1]!, voiceId: "gone" };
    const ex = executors(s.env);
    await expect(ex.export!({ ...plan().nodes.find((n) => n.id === "export")! }, plan(), new AbortController().signal)).rejects.toThrow(/must be fixed/);
  });
  it("the brief's tone reaches lines that have no direction of their own, and leaves the rest alone", async () => {
    const s = setup();
    s.project.lines[0] = { ...s.project.lines[0]!, acting: "my own direction" };
    s.env.interpretation = interpret("Make this scene more emotionally restrained.");
    await executors(s.env).direct!(plan().nodes.find((n) => n.id === "direct")!, plan(), new AbortController().signal);
    expect(s.project.lines[0]!.acting).toBe("my own direction");
    expect(s.project.lines[1]!.acting).toMatch(/restrained/);
  });
});

describe("reading creative instructions into reviewable actions", () => {
  it("turns each example instruction into an explicit proposal", () => {
    const k = (t: string) => interpret(t).proposals.map((p) => p.kind);
    expect(k("Make this scene more emotionally restrained.")).toContain("tone");
    expect(k("Give the villain a more sophisticated British voice.")).toContain("recast");
    expect(k("Make the dialogue feel less robotic.")).toContain("naturalness");
    expect(k("Use Nigerian English where appropriate.")).toContain("accent_where_apt");
    expect(k("Regenerate only the lines that sound unnatural.")).toContain("regenerate_flagged");
    expect(k("Create a version suitable for a children's animated film.")).toContain("genre");
    expect(k("Use local models unless cloud generation is necessary.")).toContain("prefer_local");
    expect(interpret("Keep total cloud spending below $5.").proposals[0]).toMatchObject({ kind: "set_budget", amount: 5 });
  });
  it("budget and privacy proposals become settings; everything else stays a suggestion", () => {
    expect(settingsFrom(interpret("Keep total cloud spending below $5.").proposals)).toEqual({ cloudLimit: 5 });
    expect(settingsFrom(interpret("Keep everything offline.").proposals)).toEqual({ localOnly: true, cloudLimit: 0 });
    expect(settingsFrom(interpret("Make it more restrained.").proposals)).toEqual({});
  });
  it("shows back what it did not understand and survives hostile input", () => {
    expect(interpret("Paint the moon purple.").unmatched).toEqual(["Paint the moon purple."]);
    expect(() => interpret("$".repeat(5000))).not.toThrow();
    expect(interpret("").proposals).toEqual([]);
  });
});

describe("quality check", () => {
  const p = project();
  const take = (id: string, voiceId: string, extra: Partial<Take> = {}) => ({ id, at: NOW, model: "eleven_v4", ext: "wav", voiceId, sent: "x", seconds: 1, ...extra }) as Take;
  it("flags missing lines, wrong voices, unsupported sounds, clipping, silence and odd timing", () => {
    p.lines[0] = { ...p.lines[0]!, takes: [take("a", "someone-else", { provenance: { notSent: ["chuckle"] } as Take["provenance"] })], chosen: "a" };
    const f = qualityCheck(p, LIB, { a: { peak: 1, silenceRatio: 0.6, seconds: 30 } });
    const kinds = f.map((x) => x.kind);
    for (const k of ["assignment", "unsupported", "clipping", "silence", "timing", "missing"]) expect(kinds, k).toContain(k);
    expect(summarize(f).problems).toBeGreaterThan(0);
  });
  it("says a take was not measured instead of assuming it is fine", () => {
    const q = project(); q.lines[0] = { ...q.lines[0]!, takes: [take("a", "eleven1")], chosen: "a" };
    expect(qualityCheck(q, LIB).some((x) => x.kind === "listen" && /not measured/.test(x.text))).toBe(true);
  });
  it("never decides a performance is bad: subjective findings are 'listen', and remake targets are explicit", () => {
    const q = project(); q.lines[0] = { ...q.lines[0]!, takes: [take("a", "eleven1")], chosen: "a" };
    const f = qualityCheck(q, LIB, { a: { peak: 0.5, silenceRatio: 0.7, seconds: 1 } });
    expect(f.find((x) => x.kind === "silence")!.severity).toBe("listen");
    expect(linesToRemake(f)).toEqual(["l1"]);
  });
  it("blocks a cloned voice with no consent", () => {
    const q = project(); q.characters[0] = { ...q.characters[0]!, voiceId: "c" };
    expect(qualityCheck(q, [voice("c", "elevenlabs", { source: "cloned" })]).some((x) => x.kind === "rights")).toBe(true);
  });
});

describe("backward compatibility", () => {
  it("a project from before the Agent Studio has none of its fields and plans fine", () => {
    const old = JSON.parse(JSON.stringify(project())) as Project;
    expect((old as unknown as Record<string, unknown>).agent).toBeUndefined();
    expect(plan({}, old).nodes.length).toBeGreaterThan(5);
  });
  it("planning does not change the project", () => {
    const p = project(); const before = JSON.stringify(p);
    plan({}, p);
    expect(JSON.stringify(p)).toBe(before);
  });
});

import { migrateRun, MAX_NODES } from "./persist";
describe("reading a saved run (hostile input)", () => {
  it("round-trips a real run", () => {
    const r = plan();
    // Approval is never granted by a file: a finished approval step reads back as finished but not approved, and a person re-approves.
    const back = migrateRun(JSON.parse(JSON.stringify(r)))!;
    expect(back.nodes.map((n) => [n.id, n.status])).toEqual(r.nodes.map((n) => [n.id, n.status]));
    expect(back.nodes.find((n) => n.id === "approve_cast")!.approved).toBe(true);
  });
  it("rejects non-runs without throwing", () => {
    for (const bad of [null, 1, "x", [], {}, { nodes: [] }, { nodes: "no" }]) expect(migrateRun(bad)).toBeUndefined();
  });
  it("does not grant approvals, resets running to ready, and defaults to the safe mode and local-only", () => {
    const r = JSON.parse(JSON.stringify(plan()));
    r.nodes[1].status = "running"; r.nodes[8].approved = true; r.nodes[8].status = "completed"; r.mode = "root"; delete r.localOnly;
    const m = migrateRun(r)!;
    expect(m.nodes[1]!.status).toBe("ready");
    expect(m.mode).toBe("guided");
    expect(m.localOnly).toBe(true);
  });
  it("drops bad nodes, duplicate ids, odd ids and oversized input", () => {
    const r = JSON.parse(JSON.stringify(plan()));
    r.nodes.push({ id: "../../evil", kind: "analyze" }, { id: "x", kind: "rm -rf" }, { ...r.nodes[0] });
    r.nodes.push(...Array.from({ length: 5000 }, (_, i) => ({ id: `n${i}`, kind: "take" })));
    const m = migrateRun(r)!;
    expect(m.nodes.length).toBeLessThanOrEqual(MAX_NODES);
    expect(m.nodes.some((n) => n.id.includes(".."))).toBe(false);
    expect(new Set(m.nodes.map((n) => n.id)).size).toBe(m.nodes.length);
  });
  it("caps text, the audit log and outputs, and strips control characters", () => {
    const r = JSON.parse(JSON.stringify(plan()));
    r.brief = "x".repeat(99999); r.audit = Array.from({ length: 3000 }, () => ({ at: "t", nodeId: "a", event: "e\u0000", by: "user", note: "n" }));
    r.nodes[0].output = { big: "y".repeat(50000) }; r.nodes[0].title = "a\u0000b";
    const m = migrateRun(r)!;
    expect(m.brief.length).toBe(2000); expect(m.audit.length).toBe(500);
    expect(m.nodes[0]!.output).toBeUndefined(); expect(m.nodes[0]!.title).toBe("a b");
  });
  it("a numeric limit cannot be negative or infinite", () => {
    const r = JSON.parse(JSON.stringify(plan())); r.cloudLimit = -5; r.spent = Infinity;
    const m = migrateRun(r)!;
    expect(m.cloudLimit).toBe(0); expect(m.spent).toBe(0);
  });
});
