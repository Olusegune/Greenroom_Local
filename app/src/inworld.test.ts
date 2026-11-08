import { describe, expect, it } from "vitest";
import { inworldFor, inworldKind } from "./finder";
import { plan } from "./generate";
import { inworldPlan, inworldWords, steers } from "./inworld";
import { DEFAULT_DIRECTION, type Line, type VoiceEntry } from "./types";
import type { InworldVoice } from "./api";

const line = (text: string, d: Partial<Line["direction"]> = {}): Line => ({ id: "l1", characterId: "c1", scene: 0, text, direction: { ...DEFAULT_DIRECTION, ...d }, takes: [], events: [] });
const voice: VoiceEntry = { id: "Olivia", name: "Olivia", provider: "inworld", source: "library", language: "en-GB", accent: "", gender: "", notes: "", createdAt: "" };

describe("Inworld line planning", () => {
  it("sends written direction as one English bracket on TTS 2", () => {
    const p = inworldPlan(line("Good morning.", { emotion: "sarcastic", note: "Dry and polite. A long beat before the last word." }), "inworld-tts-2");
    expect(p.steering).toEqual(["say sarcastically. Dry and polite. A long beat before the last word"]);
    expect(p.text).toBe("[say sarcastically. Dry and polite. A long beat before the last word] Good morning.");
    expect(p.notSent).toEqual([]);
  });

  it("does not pretend Flash follows instructions", () => {
    const p = inworldPlan(line("Hello", { emotion: "angry", note: "Furious." }), "inworld-tts-2-flash");
    expect(p.steering).toEqual([]);
    expect(p.text).toBe("Hello");
    expect(p.notSent.join(" ")).toMatch(/angry/);
    expect(p.notSent.join(" ")).toMatch(/written direction/);
    expect(steers("inworld-tts-2-flash")).toBe(false);
    expect(steers(undefined)).toBe(true);
  });

  it("maps only documented non-verbal sounds and reports the rest", () => {
    const flash = inworldPlan(line("Oh.", { sounds: ["laughs", "sighs", "gasps", "panting"] }), "inworld-tts-2-flash");
    expect(flash.nonverbal).toEqual(["laugh", "sigh", "breathe"]);
    expect(flash.text).toBe("[laugh] [sigh] [breathe] Oh.");
    expect(flash.notSent.some((n) => n.startsWith("gasps"))).toBe(true);
    expect(flash.notSent.some((n) => n.includes("panting") && n.includes("[breathe]"))).toBe(true);
  });

  it("renames the line's own ElevenLabs-style tags and leaves other words alone", () => {
    expect(inworldWords("Well [laughs] I [clears throat] suppose  so [whispers] fine")).toBe("Well [laugh] I [clear throat] suppose so [whispers] fine");
    const p = inworldPlan(line("Ha [laughs] yes", { sounds: ["laughs"] }), "inworld-tts-2-flash");
    expect(p.nonverbal).toEqual([]);
  });

  it("never changes the original line", () => {
    const l = line("Keep this exactly.", { note: "Soft." });
    inworldPlan(l, "inworld-tts-2");
    expect(l.text).toBe("Keep this exactly.");
  });
});

describe("plan() for an Inworld voice", () => {
  it("carries the model id and what was sent into the take", () => {
    const p = plan(line("Hi", { note: "Warm." }), voice, "eleven_v4", [], { inworldModel: "inworld-tts-2" });
    expect(p.provider).toBe("inworld");
    expect(p.model).toBe("inworld");
    expect(p.modelId).toBe("inworld-tts-2");
    expect(p.steering).toEqual(["Warm"]);
  });

  it("defaults to TTS 2 and applies pronunciations to the words only", () => {
    const p = plan(line("Say Nguyen"), voice, "eleven_v4", [{ from: "Nguyen", to: "Win" } as never]);
    expect(p.modelId).toBe("inworld-tts-2");
    expect(p.text).toBe("Say Win");
  });
});

describe("Inworld voice catalogue", () => {
  const v = (id: string, source: string, language: string): InworldVoice => ({ voiceId: id, displayName: id, language, description: "", tags: [], source, gender: "FEMALE", ageGroup: "" });
  it("labels system, cloned and designed voices and keeps the exact id", () => {
    expect(inworldKind("SYSTEM")).toBe("system");
    expect(inworldKind("IVC")).toBe("cloned");
    expect(inworldKind("TVD")).toBe("designed");
    expect(inworldKind("???")).toBe("other");
    const tile = { id: "en", name: "English", lang: "en", cc: "gb" } as never;
    const found = inworldFor(tile, [v("workspace__abc-1", "IVC", "en-US"), v("Olivia", "SYSTEM", "en-GB"), v("Lucia", "SYSTEM", "es-MX")]);
    expect(found.map((f) => f.id)).toEqual(["workspace__abc-1", "Olivia"]);
    expect(found[0]!.description).toMatch(/^Cloned voice/);
    expect(found[1]!.kind).toBe("system");
    expect(found[1]!.gender).toBe("female");
  });
});
