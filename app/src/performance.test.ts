import { describe, expect, it } from "vitest";
import { plan } from "./generate";
import { buildManifest } from "./manifest";
import { compilePerformance, DEFAULT_PERFORMANCE, effectiveLine, isDefaultPerformance, migratePerformance, physicalDirection, type PerformancePlan } from "./performance";
import { DEFAULT_DIRECTION, newProject, type Line, type VoiceEntry } from "./types";

const line = (text: string, performance?: unknown, d: Partial<Line["direction"]> = {}): Line => ({ id: "l1", characterId: "c1", scene: 0, text, direction: { ...DEFAULT_DIRECTION, ...d }, takes: [], events: [], performance: performance as PerformancePlan | undefined });
const voice = (provider: VoiceEntry["provider"]): VoiceEntry => ({ id: "v", name: "V", provider, source: "library", language: "en", accent: "", gender: "", notes: "", createdAt: "" });
const lifting: PerformancePlan = { ...DEFAULT_PERFORMANCE, physical: { activity: "lifting", effort: 0.85, fatigue: 0.5, pain: 0, breathlessness: 0.8, note: "" }, pace: 0.85 };

describe("performance compiler", () => {
  it("directs sustained exertion rather than pasting in a grunt", () => {
    const text = physicalDirection({ activity: "lifting", effort: 0.85, fatigue: 0.5, pain: 0, breathlessness: 0.7, note: "The load gets heavier" });
    expect(text).toContain("sustained muscular effort");
    expect(text).toContain("shorter phrases");
    expect(text).toContain("Do not reduce this to a single sound effect");
  });

  it("compiles intent, an emotional arc, the body and the voice into short sentences", () => {
    const c = compilePerformance({
      ...DEFAULT_PERFORMANCE,
      objective: "intimidate while appearing polite",
      subtext: "afraid of being found out",
      arc: [{ position: 0, emotion: "sarcastic", intensity: 0.4 }, { position: 1, emotion: "angry", intensity: 0.9 }],
      physical: { ...lifting.physical },
      pace: 0.9,
      projection: 0.2,
    });
    expect(c.sentences.length).toBeLessThanOrEqual(4);
    expect(c.sentences.every((s) => s.length <= 160)).toBe(true);
    expect(c.sentences[0]).toBe("The character is trying to intimidate while appearing polite, but underneath, afraid of being found out.");
    expect(c.sentences.join(" ")).toMatch(/Starts moderately sarcastic and ends strongly angry/);
    expect(compilePerformance({ ...DEFAULT_PERFORMANCE, arc: [{ position: 0, emotion: "neutral", intensity: 0.35 }, { position: 1, emotion: "angry", intensity: 0.9 }] }).sentences[0]).toBe("Starts neutral and ends strongly angry.");
    expect(c.emotion).toBe("sarcastic");
    expect(c.pace).toBe(0.9);
  });

  it("makes lifting change breath, effort and fatigue in the words, plus a breath sound only when very breathless", () => {
    const c = compilePerformance(lifting);
    const t = c.sentences.join(" ");
    expect(t).toMatch(/Speaking while lifting/);
    expect(t).toMatch(/straining hard/);
    expect(t).toMatch(/short phrases with recovery breaths/);
    expect(t).toMatch(/tired/);
    expect(c.sounds).toEqual(["out of breath"]);
    expect(compilePerformance({ ...lifting, physical: { ...lifting.physical, breathlessness: 0.4 } }).sounds).toEqual([]);
  });
});

describe("saved plans", () => {
  it("reads old and damaged data safely", () => {
    expect(migratePerformance(undefined)).toBeUndefined();
    expect(migratePerformance("x")).toBeUndefined();
    expect(migratePerformance([1])).toBeUndefined();
    const m = migratePerformance({ objective: "  [hack]\nwin ", pace: 99, projection: -3, arc: [{ position: 9, emotion: "an<gry>", intensity: "high" }], physical: { activity: "flying", effort: 5 }, events: [{ x: 1 }] })!;
    expect(m.objective).toBe("hack win");
    expect(m.pace).toBe(1.2);
    expect(m.projection).toBe(0);
    expect(m.arc).toEqual([{ position: 1, emotion: "angry", intensity: 0.35 }]);
    expect(m.physical.activity).toBe("still");
    expect(m.physical.effort).toBe(1);
    expect(m.events).toEqual([]);
  });

  it("recognises an untouched plan", () => {
    expect(isDefaultPerformance(DEFAULT_PERFORMANCE)).toBe(true);
    expect(isDefaultPerformance({ ...DEFAULT_PERFORMANCE, objective: "win" })).toBe(false);
  });
});

describe("effectiveLine", () => {
  it("returns lines with no plan, or an untouched plan, exactly as they are", () => {
    const l = line("Hi.", undefined, { note: "Soft." });
    expect(effectiveLine(l)).toBe(l);
    const same = line("Hi.", DEFAULT_PERFORMANCE);
    expect(effectiveLine(same)).toBe(same);
  });

  it("puts the director's own note first, adds the plan after it, and never changes the saved line", () => {
    const l = line("Lift!", lifting, { note: "Gruff", speed: 1, sounds: ["laughs"] });
    const before = JSON.stringify(l);
    const e = effectiveLine(l);
    expect(JSON.stringify(l)).toBe(before);
    expect(e.text).toBe("Lift!");
    expect(e.direction.note.startsWith("Gruff. Speaking while lifting")).toBe(true);
    expect(e.direction.sounds).toEqual(["laughs", "out of breath"]);
    expect(e.direction.speed).toBe(0.85);
  });

  it("keeps a chosen emotion chip over the plan, and limits speed to the allowed range", () => {
    const arc = [{ position: 0, emotion: "scared", intensity: 0.5 }];
    expect(effectiveLine(line("a", { ...DEFAULT_PERFORMANCE, arc, objective: "x" }, { emotion: "angry" })).direction.emotion).toBe("angry");
    expect(effectiveLine(line("a", { ...DEFAULT_PERFORMANCE, arc, objective: "x" })).direction.emotion).toBe("scared");
    expect(effectiveLine(line("a", { ...DEFAULT_PERFORMANCE, pace: 1.2 }, { speed: 1.2 })).direction.speed).toBe(1.2);
  });

  it("reaches the voice: ElevenLabs gets tags, Inworld TTS 2 gets one instruction, Piper gets only the plain words", () => {
    const words = "Lift this crate and carry it over to the far wall right now because the others are waiting for us and we are already very late for the next scene today.";
    const l = line(words, { ...DEFAULT_PERFORMANCE, objective: "stay calm", physical: lifting.physical });
    const el = plan(l, voice("elevenlabs"), "eleven_v4");
    expect(el.text).toMatch(/\[the character is trying to stay calm\]/i);
    expect(el.text).toMatch(/\[speaking while lifting/i);
    expect(el.text.endsWith(words)).toBe(true);
    const iw = plan(l, voice("inworld"), "eleven_v4", [], { inworldModel: "inworld-tts-2" });
    expect(iw.steering?.[0]).toMatch(/Speaking while lifting/);
    expect(iw.nonverbal).toEqual(["breathe"]);
    // A short line carries only the first cue: the plan never outweighs the words.
    const short = plan(line("Lift this.", { ...DEFAULT_PERFORMANCE, objective: "stay calm", physical: lifting.physical }), voice("elevenlabs"), "eleven_v4");
    expect(short.text.match(/\[/g)!.length).toBeLessThanOrEqual(2);
    expect(short.text.endsWith("Lift this.")).toBe(true);
    const pp = plan(l, voice("piper"), "eleven_v4");
    expect(pp.text).toBe(words);
  });
});

describe("manifest", () => {
  it("records the plan with the line and null when there is none", () => {
    const p = newProject("p", "T", "now");
    p.characters = [{ id: "c1", name: "A", language: "en" }];
    p.lines = [line("One.", lifting), { ...line("Two."), id: "l2" }];
    const m = buildManifest(p, [], "0.5.0", "now");
    expect(m.lines[0]!.performance?.physical.activity).toBe("lifting");
    expect(m.lines[1]!.performance).toBeNull();
  });
});
