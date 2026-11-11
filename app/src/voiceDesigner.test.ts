import { describe, expect, it } from "vitest";
import { QWEN_SAMPLE, defaultEngine, designFailure, isSlotLimit, qwenSampleFor } from "./voiceDesigner";

const FULL = "ElevenLabs returned an error (400). You have reached your maximum amount of custom voices (8 / 3). You can upgrade your subscription to increase your custom voice limit.";

describe("designing a voice on either engine", () => {
  it("recognises a full ElevenLabs account from its own words", () => {
    expect(isSlotLimit(FULL)).toBe(true);
    expect(isSlotLimit("Check your plan and available voice slots.")).toBe(true);
    expect(isSlotLimit("The network dropped.")).toBe(false);
  });
  it("a full account is explained plainly and offers the free local designer", () => {
    const f = designFailure("elevenlabs", FULL, "keep");
    expect(f.offerLocal).toBe(true);
    expect(f.text).toMatch(/no free custom-voice slot/);
    expect(f.text).toMatch(/on this PC for free/);
    expect(f.text).toMatch(/preview is safe/);
  });
  it("other cloud errors keep the provider's words and still offer the local designer", () => {
    const f = designFailure("elevenlabs", "The network dropped.", "make");
    expect(f.text).toBe("ElevenLabs could not make the previews. The network dropped.");
    expect(f.offerLocal).toBe(true);
  });
  it("a local failure does not offer itself again", () => {
    const f = designFailure("qwen", "Qwen3-TTS is not set up on this PC yet.", "make");
    expect(f.offerLocal).toBe(false);
    expect(f.text).toMatch(/designed on this PC/);
  });
  it("starts on the engine the owner can use: ElevenLabs only when its key is set", () => {
    expect(defaultEngine(true)).toBe("elevenlabs");
    expect(defaultEngine(false)).toBe("qwen");
  });
  it("the local preview sentence is the owner's own when long enough, never longer than 300 characters, else a plain default", () => {
    expect(qwenSampleFor("")).toBe(QWEN_SAMPLE);
    expect(qwenSampleFor("too short")).toBe(QWEN_SAMPLE);
    expect(qwenSampleFor("A robot! A real, actual robot, and he is stuck in the mud!")).toBe("A robot! A real, actual robot, and he is stuck in the mud!");
    expect(qwenSampleFor("x".repeat(500))).toHaveLength(300);
  });
});
