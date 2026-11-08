import { describe, expect, it } from "vitest";
import { assemblePlan, beatMode, beatsFor, cueText, emphasise, hasBeats, isAssembled, phrases } from "./beats";
import { plan, requestsFor } from "./generate";
import { effectiveLine } from "./performance";
import { DEFAULT_DIRECTION, type Line, type VoiceEntry } from "./types";

const TEXT = "Closed. Yes. [laughs] Everything is closed, Miss Hale, until it has been inspected.";
const line = (extra: Partial<Line> = {}, text = TEXT): Line => ({ id: "l", characterId: "c", scene: 0, text, direction: { ...DEFAULT_DIRECTION }, takes: [], events: [], ...extra });
const voice = (provider: VoiceEntry["provider"]): VoiceEntry => ({ id: "v", name: "V", provider, source: "library", language: "en", accent: "", gender: "", notes: "", createdAt: "" });

describe("phrases", () => {
  it("cuts at punctuation, joins one-word pieces to a neighbour and keeps every character", () => {
    const p = phrases(TEXT);
    expect(p).toEqual(["Closed. Yes.", "[laughs] Everything is closed,", "Miss Hale,", "until it has been inspected."]);
    expect(p.join(" ")).toBe(TEXT);
  });
  it("joins a leading single word to the next and leaves a one-phrase line alone", () => {
    expect(phrases("Well. I suppose so.")).toEqual(["Well. I suppose so."]);
    expect(phrases("Just this")).toEqual(["Just this"]);
    expect(phrases("   ")).toEqual([]);
  });
});

describe("beat settings", () => {
  it("find their phrase again and are dropped when the phrase is edited away", () => {
    const l = line({ beats: [{ text: "Miss Hale,", emotion: "sarcastic" }, { text: "a phrase that no longer exists", emotion: "angry" }] });
    const b = beatsFor(l);
    expect(b.find((x) => x.text === "Miss Hale,")!.setting!.emotion).toBe("sarcastic");
    expect(b.some((x) => x.setting?.emotion === "angry")).toBe(false);
    expect(hasBeats(l)).toBe(true);
    expect(hasBeats(line())).toBe(false);
  });
  it("limits wild values and unsafe text", () => {
    const l = line({ beats: [{ text: "Miss Hale,", emotion: "<script>", intention: "[bad]\nline", pace: 9, pauseAfter: -2 } as never] });
    const s = beatsFor(l).find((x) => x.text === "Miss Hale,")!.setting!;
    expect(s.emotion).toBeUndefined();
    expect(s.intention).toBe("bad line");
    expect(s.pace).toBe(1.2);
    expect(s.pauseAfter).toBe(0);
  });
});

describe("cues mode", () => {
  it("writes each beat's emotion in front of its phrase, keeping the text", () => {
    const l = line({ beats: [{ text: "Closed. Yes.", emotion: "sarcastic" }, { text: "until it has been inspected.", emotion: "angry", intention: "to warn her" }] });
    const c = cueText(l, false);
    expect(c.text).toBe("[sarcastic] Closed. Yes. [laughs] Everything is closed, Miss Hale, [angry] [to warn her] until it has been inspected.");
    expect(l.text).toBe(TEXT);
  });
  it("lists what it cannot send: pace, pause and emphasis off Inworld", () => {
    const l = line({ beats: [{ text: "Miss Hale,", pace: 0.8, pauseAfter: 1, emphasis: true }] });
    expect(cueText(l, false).notSent).toEqual(["emphasis (only Inworld voices act on capital letters)", "a phrase's pace (needs assemble mode)", "a pause after a phrase (needs assemble mode)"]);
    expect(cueText(l, true).text).toContain("MISS Hale");
  });
  it("capitalises only the longest word and never touches tags", () => {
    expect(emphasise("[laughs] Everything is closed")).toBe("[laughs] EVERYTHING is closed");
    expect(emphasise("no it")).toBe("no it");
  });
  it("reaches the voice: ElevenLabs gets tags, Piper gets plain words, Inworld TTS 2 gets steering and capitals", () => {
    const l = line({ beats: [{ text: "Closed. Yes.", emotion: "sarcastic" }] });
    expect(plan(l, voice("elevenlabs"), "eleven_v4").text).toMatch(/^\[sarcastic\] Closed\. Yes\. \[laughs\]/);
    expect(plan(l, voice("piper"), "eleven_v4").text).toBe("Closed. Yes. Everything is closed, Miss Hale, until it has been inspected.");
    const e = line({ beats: [{ text: "Miss Hale,", emphasis: true }] });
    expect(plan(e, voice("inworld"), "eleven_v4", [], { inworldModel: "inworld-tts-2" }).text).toContain("MISS Hale");
    expect(plan(e, voice("elevenlabs"), "eleven_v4").notSent?.join(" ")).toMatch(/emphasis/);
  });
  it("never changes a line with no beats", () => {
    const l = line();
    expect(effectiveLine(l)).toBe(l);
  });
});

describe("assemble mode", () => {
  const beats = [{ text: "Closed. Yes.", emotion: "sarcastic", pace: 0.8, pauseAfter: 0.6 }, { text: "Miss Hale,", intention: "to warn her" }];
  it("is on only in assemble mode with two phrases and a beat set", () => {
    expect(beatMode(line())).toBe("cues");
    expect(isAssembled(line({ beats, beatMode: "assemble" }))).toBe(true);
    expect(isAssembled(line({ beats }))).toBe(false);
    expect(isAssembled(line({ beats: [], beatMode: "assemble" }))).toBe(false);
    expect(isAssembled(line({ beats, beatMode: "assemble" }, "One phrase only"))).toBe(false);
  });
  it("plans one request per phrase with its own emotion, pace and pause, and the sounds only on the first", () => {
    const l = line({ beats, beatMode: "assemble", direction: { ...DEFAULT_DIRECTION, sounds: ["sighs"], note: "Dry." } });
    const steps = assemblePlan(l);
    expect(steps).toHaveLength(4);
    expect(steps[0]!.line.direction.emotion).toBe("sarcastic");
    expect(steps[0]!.line.direction.speed).toBe(0.8);
    expect(steps[0]!.pauseAfter).toBe(0.6);
    expect(steps[0]!.line.direction.sounds).toEqual(["sighs"]);
    expect(steps[1]!.line.direction.sounds).toEqual([]);
    expect(steps[2]!.line.direction.note).toBe("Dry. to warn her");
    expect(steps[1]!.pauseAfter).toBe(0.12);
    expect(steps[3]!.pauseAfter).toBe(0);
    expect(steps.map((s) => s.line.text).join(" ")).toBe(TEXT);
  });
  it("counts the requests and the characters for the cost sheet", () => {
    const l = line({ beats, beatMode: "assemble" });
    const r = requestsFor(l, voice("elevenlabs"), "eleven_v4", []);
    expect(r).toHaveLength(4);
    expect(requestsFor(line({ beats }), voice("elevenlabs"), "eleven_v4", [])).toHaveLength(1);
  });
});
