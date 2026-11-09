import { describe, expect, it } from "vitest";
import { cueText } from "./beats";
import { carryFrom, compileActing, parseDirection, renderActing, withActing } from "./performanceCompiler";
import { effectiveLine } from "./performance";
import { DEFAULT_DIRECTION, type Line } from "./types";

const VENOM = "Venomspur begins with impeccable British politeness, clears his throat, chuckles quietly, pauses, and delivers the final sentence with restrained menace.";
const TEXT = "Good evening. I do hope you are well. Your soul is overdue.";
const line = (over: Partial<Line> = {}): Line => ({ id: "l1", characterId: "c1", scene: 1, text: TEXT, direction: { ...DEFAULT_DIRECTION }, takes: [], events: [], ...over });

describe("parsing the director's words", () => {
  const d = parseDirection(VENOM);
  it("splits the Venomspur direction into five ordered clauses with start and end anchors", () => {
    expect(d.clauses).toHaveLength(5);
    expect(d.clauses[0]!.anchor).toBe("start");
    expect(d.clauses[4]!.anchor).toBe("end");
    expect(d.unrecognized).toEqual([]);
  });
  it("finds the emotions, events and pause", () => {
    expect(d.items.filter((i) => i.kind === "emotion").map((i) => (i as { emotion: string }).emotion)).toEqual(["polite", "menacing"]);
    expect(d.items.filter((i) => i.kind === "event").map((i) => (i as { event: string }).event)).toEqual(["clear_throat", "chuckle"]);
    expect(d.items.some((i) => i.kind === "pause")).toBe(true);
  });
  it("reads impeccable as strong and restrained as held back", () => {
    const [polite, menace] = d.items.filter((i) => i.kind === "emotion") as { intensity: number; restrained: boolean }[];
    expect(polite!.intensity).toBeGreaterThan(0.75);
    expect(menace!.restrained).toBe(true);
    expect(menace!.intensity).toBeLessThan(0.45);
  });
  it("does not mistake 'British politeness' for an accent request", () => {
    expect(d.items.some((i) => i.kind === "language")).toBe(false);
  });
  it("reports what it cannot understand instead of dropping it", () => {
    expect(parseDirection("sings the blues, whispers urgently").unrecognized).toEqual(["sings the blues"]);
    expect(parseDirection("xyzzy plugh").unrecognized).toEqual(["xyzzy plugh"]);
  });
  it("is deterministic and survives hostile input", () => {
    expect(parseDirection(VENOM)).toEqual(parseDirection(VENOM));
    expect(() => parseDirection("[[[ ]]] \u0000 ".repeat(500))).not.toThrow();
    expect(parseDirection("a".repeat(5000)).source.length).toBe(5000);
    expect(parseDirection("").items).toEqual([]);
  });
});

describe("covering the requested behaviours", () => {
  const kinds = (t: string) => parseDirection(t).items.map((i) => (i.kind === "event" ? i.event : i.kind === "delivery" ? i.mode : i.kind === "emotion" ? i.emotion : i.kind));
  it.each([
    ["whispers", "whisper"], ["shouts", "shout"], ["laughs", "laugh"], ["chuckles", "chuckle"], ["sobs", "sob"], ["cries", "cry"],
    ["coughs", "cough"], ["sighs", "sigh"], ["gasps", "gasp"], ["groans", "groan"], ["takes a deep breath", "breath"], ["hesitates", "pause"],
    ["sarcastic", "sarcastic"], ["with contempt", "contemptuous"], ["tenderly", "tender"], ["ironic", "wry"], ["speaks slowly", "slow"],
  ])("understands %s", (text, expected) => expect(kinds(text)).toContain(expected));
  it("reads fatigue, strain, exertion and pain as a physical state", () => {
    const c = compileActing("exhausted from lifting, in pain, out of breath", "Help me. I cannot hold it.");
    expect(c.plan.physical.fatigue).toBeGreaterThan(0.5);
    expect(c.plan.physical.effort).toBeGreaterThan(0.5);
    expect(c.plan.physical.pain).toBeGreaterThan(0.5);
    expect(c.plan.physical.breathlessness).toBeGreaterThan(0.5);
    expect(c.plan.physical.activity).toBe("lifting");
  });
  it("captures intent and subtext", () => {
    const c = compileActing("trying to charm the guard, secretly terrified", "Please. After you.");
    expect(c.plan.objective).toBe("charm the guard");
    expect(c.plan.subtext).toBe("terrified");
  });
  it("offers pronunciations for the dictionary without applying them", () => {
    const d = parseDirection("Pronounce Venomspur as VEN-om-spur, politely");
    expect(d.pronunciations).toEqual([{ from: "Venomspur", to: "VEN-om-spur" }]);
  });
  it("never treats a language change as something it can do", () => {
    const c = compileActing("begins in English, then switches to Yoruba, with a Nigerian accent", "Good morning. E kaaro.");
    expect(c.languageRequests.length).toBeGreaterThan(0);
    expect(c.warnings.join(" ")).toMatch(/cannot change language or accent/);
  });
});

describe("compiling the Venomspur plan", () => {
  const c = compileActing(VENOM, TEXT);
  it("builds an arc from polite to restrained menace", () => {
    expect(c.plan.arc.map((p) => p.emotion)).toEqual(["polite", "menacing"]);
    expect(c.plan.arc[0]!.position).toBe(0);
    expect(c.plan.arc[1]!.position).toBe(1);
    expect(c.plan.projection).toBeLessThan(0.4);
    expect(c.plan.tension).toBeGreaterThan(0.4);
  });
  it("places the menace on the final sentence and politeness on the first", () => {
    expect(c.beats.find((b) => b.text === "Good evening.")!.emotion).toBe("polite");
    expect(c.beats.find((b) => b.text === "Your soul is overdue.")!.emotion).toBe("menacing");
  });
  it("puts the throat clear early, the chuckle in the middle and the pause before the last sentence", () => {
    expect(c.events.map((e) => [e.event, e.boundary])).toEqual([["clear_throat", 1], ["chuckle", 2]]);
    expect(c.events[1]!.soft).toBe(true);
    expect(c.pauses).toEqual([{ after: 1, seconds: 0.7 }]);
  });
});

describe("mapping to an engine, honestly", () => {
  const c = compileActing(VENOM, TEXT);
  const on = (engine: Parameters<typeof renderActing>[2]["engine"]) => renderActing(line(), c, { engine });
  it("ElevenLabs gets positioned tags and the pause is reported as not sent in one-request mode", () => {
    const r = on("elevenlabs");
    expect(r.line.text).toBe("Good evening. [clears throat] I do hope you are well. [chuckles] Your soul is overdue.");
    expect(r.items.find((i) => i.what === "clear throat")!.status).toBe("sent");
    expect(r.items.find((i) => i.what.startsWith("pause"))!.status).toBe("not_sent");
    expect(r.notSent.join(" ")).toMatch(/pause/);
    expect(r.suggestions.join(" ")).toMatch(/phrase by phrase/);
    expect(r.requests).toBe(1);
  });
  it("makes the pause real, and counts the requests, when the line is made phrase by phrase", () => {
    const r = renderActing(line({ beatMode: "assemble" }), c, { engine: "elevenlabs" });
    expect(r.items.find((i) => i.what.startsWith("pause"))!.status).toBe("sent");
    expect(r.requests).toBe(3);
    expect(r.notSent.join(" ")).not.toMatch(/pause/);
  });
  it("Piper cannot act, play sounds or hold the pause, and says so for each", () => {
    const r = on("piper");
    expect(r.line.text).toBe(TEXT);
    for (const w of ["emotion", "clear throat", "chuckle", "pause"]) expect(r.items.find((i) => i.what.startsWith(w))!.status, w).toBe("not_sent");
    expect(r.notSent.length).toBeGreaterThanOrEqual(4);
  });
  it("VoiceKiller acts on words but plays no sounds", () => {
    const r = on("voicekiller");
    expect(r.items.find((i) => i.what.startsWith("emotion"))!.status).not.toBe("not_sent");
    expect(r.items.find((i) => i.what === "chuckle")!.status).toBe("not_sent");
    expect(r.line.text).toBe(TEXT);
  });
  it("Inworld sends only the sounds it documents", () => {
    const r = renderActing(line(), compileActing("sighs, giggles, coughs", "One moment. Please. Thank you."), { engine: "inworld" });
    expect(r.items.find((i) => i.what === "sigh")!.status).toBe("sent");
    expect(r.items.find((i) => i.what === "giggle")!.status).toBe("not_sent");
    expect(r.line.text).toContain("[sigh]");
    expect(r.line.text).not.toContain("giggle");
  });
  it("never reports an unsupported behaviour as sent", () => {
    for (const engine of ["piper", "kie", "chatterbox", "wazobia", "local"] as const) {
      const r = on(engine);
      expect(r.items.filter((i) => i.status !== "not_sent").every((i) => !/emotion|chuckle|clear throat/.test(i.what)), engine).toBe(true);
    }
  });
  it("does not change the saved line", () => {
    const l = line();
    const before = JSON.stringify(l);
    on("elevenlabs");
    expect(JSON.stringify(l)).toBe(before);
  });
});

describe("reaching the existing generation pipeline", () => {
  it("withActing leaves a line with no brief untouched", () => {
    const l = line();
    expect(withActing(l, { engine: "elevenlabs" })).toEqual({ line: l, render: null });
  });
  it("the compiled line flows through the existing effectiveLine and beat cues", () => {
    const { line: acted } = withActing(line({ acting: VENOM }), { engine: "elevenlabs" });
    const sent = effectiveLine(acted);
    expect(sent.text).toContain("[polite]");
    expect(sent.text).toContain("[menacing]");
    expect(sent.text).toContain("[clears throat]");
    expect(sent.direction.note).toMatch(/Starts .*polite and ends .*menacing/);
    expect(cueText(acted, false).notSent.join(" ")).toMatch(/pause/);
  });
  it("tagged text and phrase beats stay aligned", () => {
    const { line: acted } = withActing(line({ acting: VENOM }), { engine: "elevenlabs" });
    for (const b of acted.beats as { text: string }[]) expect(acted.text.includes(b.text), b.text).toBe(true);
  });
});

describe("continuity across lines", () => {
  it("carries the last emotion and a fading physical state into a line with no direction", () => {
    const first = compileActing("exhausted, out of breath, ends in grief", "I ran all the way. I am sorry.");
    const next = compileActing("says it quietly", "It is done.", carryFrom(first));
    expect(next.plan.arc[0]!.emotion).toBe("sad");
    expect(next.plan.physical.fatigue).toBeGreaterThan(0.3);
    expect(next.plan.physical.fatigue).toBeLessThan(first.plan.physical.fatigue);
    expect(next.carried.length).toBe(2);
  });
  it("does not override a new emotion", () => {
    const next = compileActing("suddenly furious", "Get out.", { emotion: "sad", intensity: 0.6 });
    expect(next.plan.arc[0]!.emotion).toBe("angry");
    expect(next.carried).toEqual([]);
  });
});

describe("wired into take planning", () => {
  const voice = (provider: "elevenlabs" | "piper") => ({ id: "v", name: "V", provider, source: "library" as const, language: "English", accent: "", gender: "", notes: "", createdAt: "" });
  it("ElevenLabs gets tags and the unsent pause is recorded in the plan", async () => {
    const { plan } = await import("./generate");
    const p = plan(line({ acting: VENOM }), voice("elevenlabs"), "eleven_v4");
    expect(p.text).toContain("[clears throat]");
    expect(p.text).toContain("[menacing]");
    expect(p.notSent?.join(" ")).toMatch(/pause/);
  });
  it("Piper gets plain words and every unsupported behaviour is listed", async () => {
    const { plan } = await import("./generate");
    const p = plan(line({ acting: VENOM }), voice("piper"), "eleven_v4");
    expect(p.text).toBe(TEXT);
    expect(p.notSent!.length).toBeGreaterThanOrEqual(4);
  });
  it("a line with no brief plans exactly as before", async () => {
    const { plan } = await import("./generate");
    expect(plan(line(), voice("elevenlabs"), "eleven_v4").notSent).toBeUndefined();
  });
});
