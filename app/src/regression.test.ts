// Regression: the "Venomspur" test. A three-word line, "Twice,  actually." (two spaces), carried an AI-written three-sentence
// direction. It was sent as about 270 characters of bracketed tags before three words and the voice repeated the line.
import { describe, expect, it } from "vitest";
import { composeText, fitCues, noteFit, shorten, spokenWords, tagBudget } from "./direct";
import { plan } from "./generate";
import { analyzeSamples, takeFlags } from "./analysis";
import { DEFAULT_DIRECTION, type Line, type VoiceEntry } from "./types";

const NOTE = "Deliver with a dry, slow cadence, masking deep irritation behind mock amusement. Keep the breath controlled and heavy, letting the yawn feel forced and condescending. Tighten the throat slightly on key words to let the quiet rage bleed through.";
const line = (text: string, note = NOTE, sounds: string[] = [], emotion = ""): Line => ({ id: "l", characterId: "c", scene: 0, text, direction: { ...DEFAULT_DIRECTION, note, sounds, emotion }, takes: [], events: [] });
const voice = (provider: VoiceEntry["provider"]): VoiceEntry => ({ id: "v", name: "V", provider, source: "library", language: "en", accent: "", gender: "", notes: "", createdAt: "" });
const bracketChars = (s: string) => [...s.matchAll(/\[([^\]]*)\]/g)].reduce((n, m) => n + m[1]!.length, 0);

describe("Venomspur regression: a long direction on a short line", () => {
  it("sends one short cue before three words, not three long ones", () => {
    const sent = composeText(line("Twice,  actually."));
    expect(sent).toBe("[deliver with a dry, slow cadence] Twice, actually.");
    expect(bracketChars(sent)).toBeLessThanOrEqual(tagBudget("Twice, actually."));
    expect(sent).not.toMatch(/\s{2}/);
  });

  it("is what ElevenLabs v4 and v3 are sent", () => {
    for (const m of ["eleven_v4", "eleven_v3"] as const) expect(plan(line("Twice,  actually."), voice("elevenlabs"), m).text).toBe("[deliver with a dry, slow cadence] Twice, actually.");
  });

  it("shortens Inworld steering the same way and says so", () => {
    const p = plan(line("Twice,  actually."), voice("inworld"), "eleven_v4", [], { inworldModel: "inworld-tts-2" });
    expect(p.text.endsWith("Twice, actually.")).toBe(true);
    expect(bracketChars(p.text)).toBeLessThanOrEqual(tagBudget("Twice, actually.") * 1.5);
    expect(p.notSent?.join(" ")).toMatch(/shortened to fit a 2-word line/);
  });

  it("never lets direction outweigh the words, whatever the line length", () => {
    for (const words of [1, 2, 3, 4, 5, 8, 10, 11, 20, 25, 26, 60]) {
      const text = Array.from({ length: words }, (_, i) => `word${i}`).join(" ") + ".";
      const sent = composeText(line(text, NOTE, ["laughs", "sighs"], "sarcastic"));
      expect(bracketChars(sent), `${words} words`).toBeLessThanOrEqual(tagBudget(text) + 20);
      expect(sent.endsWith(text)).toBe(true);
      expect(spokenWords(sent)).toBe(words);
    }
  });

  it("keeps the whole direction once the line is long enough to carry it", () => {
    const long = "I did not expect to see you here after all this time, and yet here you are standing in my doorway.";
    expect(composeText(line(long))).toMatch(/masking deep irritation behind mock amusement\]/);
  });

  it("never changes the saved line", () => {
    const l = line("Twice,  actually.");
    composeText(l);
    expect(l.text).toBe("Twice,  actually.");
    expect(l.direction.note).toBe(NOTE);
  });
});

describe("shortening", () => {
  it("cuts at a comma or a space and never leaves a dangling connector", () => {
    expect(shorten(NOTE.split(". ")[0]!, 60)).toBe("Deliver with a dry, slow cadence");
    expect(shorten("Speak softly and quickly", 16)).toBe("Speak softly");
    expect(shorten("short", 60)).toBe("short");
  });
  it("keeps whole later cues only", () => {
    expect(fitCues(["First cue here that is fine", "Second cue that is far too long to fit in what is left over", "x"], 50)).toEqual(["First cue here that is fine"]);
    expect(fitCues([], 50)).toEqual([]);
    expect(fitCues(["Anything"], 5)).toEqual([]);
  });
});

describe("take check for a repeated line", () => {
  const RATE = 16000;
  const speech = (sec: number) => Float32Array.from({ length: Math.round(sec * RATE) }, (_, i) => Math.sin((2 * Math.PI * 200 * i) / RATE) * 0.3);
  it("flags a take far slower than speech, as when a short line is said several times", () => {
    const f = takeFlags(analyzeSamples(speech(4), RATE, 2), 2);
    expect(f.length).toBeGreaterThan(0);
    expect(f[0]).toMatch(/slower than speech/);
  });
  it("leaves a normal take alone", () => {
    expect(takeFlags(analyzeSamples(speech(1.2), RATE, 2), 2)).toEqual([]);
    expect(takeFlags(analyzeSamples(speech(0.5), RATE, 0), 0)).toEqual([]);
  });
  it("flags a short line broken into several phrases", () => {
    const gap = new Float32Array(Math.round(0.4 * RATE));
    const s = Float32Array.from([...speech(0.4), ...gap, ...speech(0.4), ...gap, ...speech(0.4)]);
    expect(takeFlags(analyzeSamples(s, RATE, 3), 3).join(" ")).toMatch(/phrases/);
  });
});

describe("telling the owner when a direction is cut back", () => {
  it("counts how many sentences a line can carry", () => {
    expect(noteFit(line("Twice, actually."))).toEqual({ sent: 1, total: 3 });
    expect(noteFit(line("I did not expect to see you here after all this time, and yet here you are standing in my doorway."))).toEqual({ sent: 1, total: 3 });
    const thirty = Array.from({ length: 30 }, (_, i) => `word${i}`).join(" ");
    expect(noteFit(line(thirty))).toEqual({ sent: 2, total: 3 });
    expect(noteFit(line("Hi.", ""))).toEqual({ sent: 0, total: 0 });
  });
});
