import { describe, expect, it } from "vitest";
import type { VoiceEntry } from "../types";
import { auditionLine, auditionPlan } from "./audition";
import { STARTER_PRESETS } from "./index";

const voice = (provider: VoiceEntry["provider"]) => ({ id: "v", name: "V", provider, source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "" }) as VoiceEntry;
const noir = STARTER_PRESETS.find((p) => p.id === "film_tv.noir-detective")!;

describe("auditioning with the preset's acting direction", () => {
  it("ElevenLabs gets the direction written in front of the audition line", () => {
    const a = auditionPlan(noir, voice("elevenlabs"));
    expect(a.directed).toBe(true);
    expect(a.text).toContain(noir.audition);
    expect(a.text).toMatch(/^\[/);
    expect(a.text.length).toBeGreaterThan(noir.audition.length);
  });
  it("says that pace is not carried by a preview", () => {
    expect(auditionPlan(noir, voice("elevenlabs")).notSent.join(" ")).toMatch(/pace/);
  });
  it("engines that do not read direction in the text get a plain read and are told so", () => {
    for (const e of ["piper", "inworld", "voicekiller", "kie"] as const) {
      const a = auditionPlan(noir, voice(e));
      expect(a.text, e).toBe(noir.audition);
      expect(a.directed, e).toBe(false);
      expect(a.notSent.join(" "), e).toMatch(/plain read/);
    }
  });
  it("never claims direction was sent when the text is unchanged", () => {
    const flat = { ...noir, acting: { ...noir.acting, direction: "", emotionalRange: ["neutral"], pace: 1, projection: 0.5, tension: 0.2, breathiness: 0.15 } };
    const a = auditionPlan(flat, voice("elevenlabs"));
    expect(a.directed).toBe(a.text !== flat.audition);
  });
  it("is only text and numbers: it builds a line without touching any project", () => {
    const l = auditionLine(noir);
    expect(l.takes).toEqual([]);
    expect(l.text).toBe(noir.audition);
  });
  it("works for every starter preset on ElevenLabs without throwing and keeps the line intact", () => {
    for (const p of STARTER_PRESETS) {
      const a = auditionPlan(p, voice("elevenlabs"));
      expect(a.text, p.id).toContain(p.audition.replace(/\s+/g, " ").trim().slice(0, 12));
    }
  });
});
