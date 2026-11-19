import { describe, expect, it } from "vitest";
import { newProject, type Project } from "../types";
import { parseScript } from "../script";
import { describeProject, describeRun, handleTool, TOOL_NAMES, type BridgeApp } from "./tools";
import type { AgentRun, JobNode } from "../agent/graph";

const node = (over: Partial<JobNode>): JobNode => ({ id: "n" + Math.random(), kind: "analyze", title: "Step", detail: "does a thing", deps: [], status: "planned", gate: "none", approved: false, enabled: true, attempts: 0, maxAttempts: 1, cloud: false, estimate: 0, key: "k", ...over }) as JobNode;
const run = (nodes: JobNode[]): AgentRun => ({ version: 1, id: "r", mode: "guided", brief: "b", localOnly: true, cloudLimit: 0, spent: 0, nodes, audit: [], createdAt: "t", updatedAt: "t" });

const project = (): Project => {
  const p = newProject("p1", "Test", "2026-11-19T00:00:00Z");
  const parsed = parseScript("ADA: Hello there.\nBEN: Hi.\n[SFX: A door closes.]", [], []);
  return { ...p, script: "x", ...parsed };
};

const fakeApp = (open: Project | null): BridgeApp => {
  let cur = open;
  const live = { current: cur };
  const set = (p: Project) => { cur = p; live.current = p; };
  return {
    app: { library: [], keys: { elevenlabs: true, kie: false }, createProject: async (name: string) => set(newProject("p9", name, "t")), openProject: async (id: string) => set(newProject(id, "Opened", "t")), edit: () => undefined, engines: {} } as never,
    live,
    current: () => cur,
  };
};

describe("the tools match what the server advertises", () => {
  it("every advertised tool is handled, and an unknown one is refused", async () => {
    expect(TOOL_NAMES.length).toBeGreaterThanOrEqual(8);
    for (const name of TOOL_NAMES) {
      const out = await handleTool(name, name === "create_project" ? { name: "X" } : name === "open_project" ? { id: "p1" } : name === "set_script" ? { script: "A: b" } : { brief: "b" }, fakeApp(null)).catch((e: Error) => e.message);
      expect(String(typeof out === "string" ? out : "ok"), name).not.toMatch(/Unknown tool/);
    }
    await expect(handleTool("approve_cast", {}, fakeApp(null))).rejects.toThrow("Unknown tool");
  });
  it("offers no tool that decides what only the person decides", () => {
    for (const n of TOOL_NAMES) expect(n, n).not.toMatch(/approve|deliver|export|spend|pay|unlock|clone/);
  });
  it("tools that need a project say so plainly when none is open", async () => {
    for (const n of ["plan_production", "run_production", "get_listening_todo", "set_script"]) {
      await expect(handleTool(n, { brief: "b", script: "A: b" }, fakeApp(null)), n).rejects.toThrow(/No project is open/);
    }
  });
  it("status lists key names but never anything secret, and says who decides approvals", async () => {
    const s = (await handleTool("greenroom_status", {}, fakeApp(null))) as { cloudKeysSaved: string[]; note: string };
    expect(s.cloudKeysSaved).toEqual(["elevenlabs"]);
    expect(JSON.stringify(s)).not.toMatch(/sk-|token|secret|password/i);
    expect(s.note).toMatch(/person/);
  });
  it("planning a project that has no script is refused with a way forward", async () => {
    const empty = newProject("p2", "Empty", "t");
    await expect(handleTool("plan_production", { brief: "x" }, fakeApp(empty))).rejects.toThrow(/set_script/);
  });
});

describe("what an outside agent is told about a run", () => {
  it("says nothing is planned before a plan", () => {
    expect(describeRun(null)).toMatchObject({ planned: false });
  });
  it("lists what is waiting for the person and why, and never offers a way to approve it", () => {
    const r = describeRun(run([node({ title: "Analyze", status: "completed" }), node({ title: "Approve and lock the cast", status: "awaiting_approval", gate: "rights" }), node({ title: "Export the full scene", status: "awaiting_approval", gate: "final" })])) as { waitingForThePerson: { step: string; because: string }[]; finished: boolean; note: string };
    expect(r.finished).toBe(false);
    expect(r.waitingForThePerson.map((w) => w.step)).toEqual(["Approve and lock the cast", "Export the full scene"]);
    expect(r.waitingForThePerson[0]!.because).toMatch(/voice-rights/);
    expect(r.waitingForThePerson[1]!.because).toMatch(/delivering/);
    expect(r.note).toMatch(/cannot be approved from here/);
  });
  it("is finished only when every step is done", () => {
    expect((describeRun(run([node({ status: "completed" }), node({ status: "skipped" })])) as { finished: boolean }).finished).toBe(true);
    expect((describeRun(run([node({ status: "completed" }), node({ status: "planned" })])) as { finished: boolean }).finished).toBe(false);
  });
  it("leaves out disabled steps and long details", () => {
    const r = describeRun(run([node({ title: "Off", enabled: false }), node({ title: "On", detail: "x".repeat(500) })])) as { steps: { title: string; detail: string }[] };
    expect(r.steps.map((s) => s.title)).toEqual(["On"]);
    expect(r.steps[0]!.detail.length).toBe(160);
  });
});

describe("what an outside agent is told about a project", () => {
  it("says none is open", () => {
    expect(describeProject(null)).toMatchObject({ open: false });
  });
  it("summarises scenes, characters, takes, cues and the owner's verdicts", () => {
    const d = describeProject(project()) as { open: boolean; lines: number; linesWithTakes: number; soundCues: number; characters: { name: string; voiceApproved: boolean }[]; listening: { heard: number } };
    expect(d.open).toBe(true);
    expect(d.lines).toBe(2);
    expect(d.linesWithTakes).toBe(0);
    expect(d.soundCues).toBe(1);
    expect(d.characters.map((c) => c.name)).toEqual(["ADA", "BEN"]);
    expect(d.characters.every((c) => c.voiceApproved === false)).toBe(true);
    expect(d.listening.heard).toBe(0);
  });
});
