import { describe, expect, it } from "vitest";
import { newProject, type Project, type Take, type VoiceEntry } from "../types";
import { parseScript } from "../script";
import { runAll, type AgentRun } from "./graph";
import { planProduction } from "./plan";
import { executors, type Env } from "./services";

const NOW = "2026-11-19T00:00:00Z";
const now = () => NOW;
const voice = (id: string, name: string, provider: VoiceEntry["provider"], gender = ""): VoiceEntry => ({ id, name, provider, source: "library", language: "English", accent: "", gender, notes: "", createdAt: "", licence: "commercial" });
const LIB = [voice("alan", "Alan", "piper", "male"), voice("amy", "Amy", "piper", "female"), voice("heart", "Heart", "kokoro", "female"), voice("cloud-f", "Cloud woman", "elevenlabs", "female")];

const SCRIPT = ["VENOMSPUR", "", "Elderly, highly educated British male voice. Rich baritone.", "", "MAMA T", "", "Elderly Nigerian woman. Warm but commanding Nigerian English accent.", "", "# Scene one", "VENOMSPUR (dry): Good evening.", "MAMA T (furious): Who is in charge here?", "RICO: Hello there."].join("\n");

function project(): Project {
  const p = newProject("p1", "Draft test", NOW);
  return { ...p, script: SCRIPT, ...parseScript(SCRIPT, [], []) };
}

function env(p: { current: Project }, over: Partial<Env> = {}): { env: Env; made: string[] } {
  const made: string[] = [];
  return {
    made,
    env: {
      project: () => p.current,
      library: () => LIB,
      ready: () => ["piper", "kokoro", "elevenlabs"],
      localOnly: true,
      draftCasting: true,
      edit: (fn) => { p.current = fn(p.current); },
      makeTake: async (line, v) => { made.push(`${line.id}:${v.id}`); const take: Take = { id: "t-" + line.id, at: NOW, model: "piper", ext: "wav", voiceId: v.id, sent: line.text, seconds: 2 }; return { take, spent: 0 }; },
      measure: async () => null,
      ...over,
    } as Env,
  };
}

const plan = (p: Project, over = {}): AgentRun => planProduction(p, LIB, { id: "r", brief: "", mode: "autonomous", localOnly: true, cloudLimit: 0, draftCasting: true, now: NOW, price: () => 0, ...over });
const status = (r: AgentRun, id: string) => r.nodes.find((n) => n.id === id)!.status;

describe("the script's character descriptions reach casting", () => {
  it("fills what is stated about each character from the paragraph under its name", () => {
    const p = project();
    const by = (n: string) => p.characters.find((c) => c.name === n)!;
    expect(by("VENOMSPUR").cast).toMatchObject({ vocalGender: "masculine", vocalAge: ["old"], accent: "British" });
    expect(by("MAMA T").cast).toMatchObject({ vocalGender: "feminine", vocalAge: ["old"] });
    expect(by("VENOMSPUR").look).toMatchObject({ gender: "m", age: "old" });
    expect(by("RICO").cast).toBeUndefined();
  });
});

describe("a run with draft casting on", () => {
  it("carries a script to takes with draft voices, and leaves approval and delivery to the person", async () => {
    const p = { current: project() };
    const { env: e, made } = env(p);
    const r = await runAll(plan(p.current), executors(e), now);
    expect(status(r, "analyze")).toBe("completed");
    expect(status(r, "cast")).toBe("completed");
    const out = r.nodes.find((n) => n.id === "cast")!.output as { drafts: { character: string; voice: string; placeholder: boolean }[] };
    expect(out.drafts).toHaveLength(3);
    // the description decided the voices where it said something
    const voiceOf = (n: string) => p.current.characters.find((c) => c.name === n)!.voiceId;
    expect(voiceOf("VENOMSPUR")).toBe("alan");
    expect(["amy", "heart"]).toContain(voiceOf("MAMA T"));
    // RICO had nothing stated: a placeholder, and it says so
    expect(out.drafts.find((d) => d.character === "RICO")!.placeholder).toBe(true);
    expect(p.current.characters.find((c) => c.name === "RICO")!.casting?.draft?.placeholder).toBe(true);
    // takes were made with the drafts; nothing was spent and no cloud voice was used
    expect(made).toHaveLength(3);
    expect(made.every((m) => !m.includes("cloud-f"))).toBe(true);
    expect(r.spent).toBe(0);
    // nothing is approved: the approval and the delivery wait for the person
    expect(p.current.characters.every((c) => !c.casting?.approval)).toBe(true);
    expect(status(r, "approve_cast")).toBe("awaiting_approval");
    expect(status(r, "export")).not.toBe("completed");
    expect(r.draftCasting).toBe(true);
  });

  it("never touches a voice the owner approved or chose", async () => {
    const p = { current: project() };
    p.current.characters = p.current.characters.map((c) => (c.name === "VENOMSPUR" ? { ...c, voiceId: "amy" } : c));
    const { env: e } = env(p);
    await runAll(plan(p.current), executors(e), now);
    expect(p.current.characters.find((c) => c.name === "VENOMSPUR")!.voiceId).toBe("amy");
    expect(p.current.characters.find((c) => c.name === "VENOMSPUR")!.casting?.draft).toBeUndefined();
  });

  it("keeps the old behaviour when it is off: the cast step stops and asks", async () => {
    const p = { current: project() };
    const { env: e, made } = env(p, { draftCasting: false });
    const r = await runAll(plan(p.current, { draftCasting: false }), executors(e), now);
    expect(status(r, "cast")).toBe("failed");
    expect(r.nodes.find((n) => n.id === "cast")!.error).toMatch(/needs your decision/);
    expect(made).toHaveLength(0);
    expect(p.current.characters.every((c) => !c.voiceId)).toBe(true);
  });

  it("uses only voices on this PC, even when cloud voices exist", async () => {
    const p = { current: project() };
    const { env: e } = env(p);
    await runAll(plan(p.current), executors(e), now);
    for (const c of p.current.characters) expect(["piper", "kokoro"]).toContain(LIB.find((v) => v.id === c.voiceId)!.provider);
  });

  it("says so when no voice on this PC can serve a character, and still makes no approval", async () => {
    const p = { current: project() };
    const { env: e } = env(p, { library: () => [LIB[0]!] });
    const r = await runAll(plan(p.current), executors(e), now);
    expect(status(r, "cast")).toBe("failed");
    expect(p.current.characters.every((c) => !c.casting?.approval)).toBe(true);
  });
});
