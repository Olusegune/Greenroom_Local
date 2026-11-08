import { describe, expect, it } from "vitest";
import { ACTING_PRESETS, applyPreset, applyVariation, VARIATIONS } from "./acting";
import { EMOTIONS } from "./direct";
import { plan } from "./generate";
import { compilePerformance, DEFAULT_PERFORMANCE, effectiveLine, migratePerformance } from "./performance";
import { DEFAULT_DIRECTION, type Line, type VoiceEntry } from "./types";

const line = (performance?: unknown): Line => ({ id: "l", characterId: "c", scene: 0, text: "Good morning.", direction: { ...DEFAULT_DIRECTION }, takes: [], events: [], performance: performance as never });
const voice = (provider: VoiceEntry["provider"]): VoiceEntry => ({ id: "v", name: "V", provider, source: "library", language: "en", accent: "", gender: "", notes: "", createdAt: "" });

describe("acting presets", () => {
  it("has the twelve requested, each with its own id", () => {
    expect(ACTING_PRESETS).toHaveLength(12);
    expect(new Set(ACTING_PRESETS.map((p) => p.id)).size).toBe(12);
    const labels = ACTING_PRESETS.map((p) => p.label);
    for (const want of ["British bureaucratic sarcasm", "Suppressed grief", "Controlled anger", "Cold menace", "Quiet tenderness", "Frightened whisper", "Emotional confession", "Physical exhaustion", "Comedic deadpan", "Inspirational narration", "Cinematic documentary", "Childlike wonder"]) expect(labels).toContain(want);
  });

  it("maps every preset onto real plan parameters that compile to words and stay in range", () => {
    const known = new Set(["neutral", ...EMOTIONS.map((e) => e.tag)]);
    for (const p of ACTING_PRESETS) {
      const plan = applyPreset(undefined, p);
      expect(plan.arc.every((a) => known.has(a.emotion)), p.id).toBe(true);
      const migrated = migratePerformance(plan)!;
      expect(migrated.arc).toEqual(plan.arc);
      expect(migrated.pace).toBe(plan.pace);
      const c = compilePerformance(plan);
      expect(c.sentences.length, p.id).toBeGreaterThan(0);
      const e = effectiveLine({ ...line(plan) });
      expect(e.direction.speed).toBeGreaterThanOrEqual(0.7);
      expect(e.direction.speed).toBeLessThanOrEqual(1.2);
    }
  });

  it("keeps the line's own objective and subtext", () => {
    const base = { ...DEFAULT_PERFORMANCE, objective: "win the argument", subtext: "fear of losing her" };
    const p = applyPreset(base, ACTING_PRESETS.find((x) => x.id === "controlled-anger")!);
    expect(p.objective).toBe("win the argument");
    expect(p.subtext).toBe("fear of losing her");
    expect(p.tension).toBe(0.8);
  });

  it("physical exhaustion changes the body, not just the words", () => {
    const p = applyPreset(undefined, ACTING_PRESETS.find((x) => x.id === "physical-exhaustion")!);
    expect(p.physical.fatigue).toBe(0.9);
    expect(compilePerformance(p).sentences.join(" ")).toMatch(/tired/);
  });
});

describe("interpretations", () => {
  const base = { ...DEFAULT_PERFORMANCE, arc: [{ position: 0, emotion: "angry", intensity: 0.5 }, { position: 1, emotion: "angry", intensity: 0.5 }] };

  it("offers the four, with Natural returning the very same line", () => {
    expect(VARIATIONS.map((v) => v.id)).toEqual(["natural", "restrained", "expressive", "intense"]);
    const l = line(base);
    expect(applyVariation(l, "natural")).toBe(l);
  });

  it("turns the feeling down for restrained and up for expressive and intense, never past the limits", () => {
    const l = line(base);
    const i = (v: "restrained" | "expressive" | "intense") => applyVariation(l, v).performance!.arc[0]!.intensity;
    expect(i("restrained")).toBeLessThan(0.5);
    expect(i("expressive")).toBeGreaterThan(0.5);
    expect(i("intense")).toBeGreaterThan(i("expressive"));
    expect(applyVariation(line({ ...base, arc: [{ position: 0, emotion: "angry", intensity: 0.9 }] }), "intense").performance!.arc[0]!.intensity).toBe(1);
  });

  it("never changes the saved line, and works on a line with no plan", () => {
    const l = line(base);
    const before = JSON.stringify(l);
    applyVariation(l, "intense");
    expect(JSON.stringify(l)).toBe(before);
    expect(applyVariation(line(), "restrained").performance!.direction).toBe("Understated and held back");
  });

  it("sends four different texts to a voice that acts on words, and the same one to a voice that does not", () => {
    const l = line(base);
    const texts = VARIATIONS.map((v) => plan(l, voice("elevenlabs"), "eleven_v4", [], { variation: v.id }).text);
    expect(new Set(texts).size).toBe(4);
    const piper = VARIATIONS.map((v) => plan(l, voice("piper"), "eleven_v4", [], { variation: v.id }).text);
    expect(new Set(piper).size).toBe(1);
  });
});
