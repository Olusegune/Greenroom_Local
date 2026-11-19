import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseScript, SAMPLE_SCRIPT } from "./script";
import { DEFAULT_DIRECTION } from "./types";

let n = 0;
const gen = () => `id${++n}`;

describe("parseScript", () => {
  it("reads scenes, speakers, directions and lines from the sample", () => {
    const p = parseScript(SAMPLE_SCRIPT, [], [], gen);
    expect(p.scenes).toEqual(["Scene 1: The Late Delivery", "Scene 2: The Kitchen"]);
    expect(p.characters.map((c) => c.name)).toEqual(["ADA", "TUNDE"]);
    expect(p.lines).toHaveLength(7);
    expect(p.lines[0]).toMatchObject({ scene: 0, direction: { emotion: "annoyed" } });
    expect(p.lines[4]).toMatchObject({ scene: 1, direction: { sounds: ["whispers"] } });
    expect(p.lines[2]!.text).toBe("[sighs] Every time. Every single time.");
  });

  it("joins a continuation line, and ignores stage direction after a blank line", () => {
    const p = parseScript("MIA: First part\nsecond part\n\nShe walks away.\nMIA: Done.", [], [], gen);
    expect(p.lines.map((l) => l.text)).toEqual(["First part second part", "Done."]);
  });

  it("does not mistake a URL or a heading for a speaker", () => {
    const p = parseScript("# Act 1\nSee https://example.com for more\nBO: Hi", [], [], gen);
    expect(p.characters.map((c) => c.name)).toEqual(["BO"]);
  });

  it("handles other alphabets and mixed-language lines", () => {
    const p = parseScript("서연: 안녕하세요, how are you?\nAMA: Abeg, come chop.", [], [], gen);
    expect(p.characters.map((c) => c.name)).toEqual(["서연", "AMA"]);
    expect(p.lines[0]!.text).toBe("안녕하세요, how are you?");
  });

  it("keeps voices, takes and direction when the script is edited", () => {
    const first = parseScript("ADA: Hello.\nTUNDE: Hi.", [], [], gen);
    first.characters[0]!.voiceId = "voiceA";
    first.lines[0]!.takes.push({ id: "t1", at: "", model: "eleven_v4", ext: "mp3", voiceId: "voiceA", sent: "Hello.", seconds: 1 });
    first.lines[0]!.direction = { ...DEFAULT_DIRECTION, emotion: "sad" };
    const second = parseScript("ADA: Hello.\nADA: A new line.\nTUNDE: Hi.", first.characters, first.lines, gen);
    expect(second.characters[0]!.voiceId).toBe("voiceA");
    expect(second.lines[0]!.id).toBe(first.lines[0]!.id);
    expect(second.lines[0]!.takes).toHaveLength(1);
    expect(second.lines[0]!.direction.emotion).toBe("sad");
    expect(second.lines[1]!.takes).toHaveLength(0);
    expect(second.lines[2]!.id).toBe(first.lines[1]!.id);
  });

  it("matches speaker names ignoring case", () => {
    const a = parseScript("Ada: one", [], [], gen);
    const b = parseScript("ADA: two", a.characters, a.lines, gen);
    expect(b.characters).toHaveLength(1);
  });

  it("reads plain text with no names as one narrator, a paragraph per line", () => {
    const one = parseScript("i am happy", [], [], gen);
    expect(one.characters.map((c) => c.name)).toEqual(["Narrator"]);
    expect(one.lines.map((l) => l.text)).toEqual(["i am happy"]);
    const many = parseScript("First thought\ncontinues here.\n\nSecond paragraph.", [], [], gen);
    expect(many.lines.map((l) => l.text)).toEqual(["First thought continues here.", "Second paragraph."]);
    expect(parseScript("# Act\nHello world", [], [], gen).lines).toHaveLength(1);
  });

  it("still ignores stage direction when the script has speakers", () => {
    const p = parseScript("ADA: Hi.\n\nShe waves.\n\nADA: Bye.", [], [], gen);
    expect(p.lines.map((l) => l.text)).toEqual(["Hi.", "Bye."]);
    expect(p.characters.map((c) => c.name)).toEqual(["ADA"]);
  });

  it("gives an empty script one scene and nothing else", () => {
    const p = parseScript("", [], [], gen);
    expect(p).toMatchObject({ scenes: ["Scene 1"], characters: [], lines: [] });
  });
});

describe("the markdown screenplay shape (bold names, direction after the colon, scene headings, pause and sound cues)", () => {
  const raw = readFileSync(new URL("../../docs/samples/the-wrong-department.md", import.meta.url), "utf8");
  const p = parseScript(raw, [], []);
  it("finds the characters by name, never with markdown marks", () => {
    expect(p.characters.map((c) => c.name).sort()).toEqual(["MAMA T", "MISS GRIMBLE", "RICO", "VENOMSPUR"]);
    expect(p.lines).toHaveLength(55);
  });
  it("reads bold scene headings, and a title does not leave an empty scene", () => {
    expect(p.scenes).toEqual(["SCENE 1 — VENOMSPUR'S OFFICE", "SCENE 2 — AN UNEXPECTED INTERRUPTION", "SCENE 3 — THE FINAL VERDICT"]);
  });
  it("moves a direction written after the colon into the acting note, not the spoken words", () => {
    const l = p.lines.find((x) => x.text.startsWith("Champagne?"))!;
    expect(l.direction.emotion).toBe("quietly");
    expect(p.lines.some((x) => x.text.includes("**") || x.text.startsWith("("))).toBe(false);
  });
  it("turns [PAUSE: n seconds] into the pause after the line before, and never speaks it", () => {
    expect(p.lines.find((x) => x.text === "Champagne?")!.direction.pauseAfter).toBe(1);
    expect(p.lines.find((x) => x.text.startsWith("So you're not the manager"))!.direction.pauseAfter).toBe(2);
    expect(p.lines.some((x) => /PAUSE|SFX/i.test(x.text))).toBe(false);
  });
  it("turns [SFX: ...] into sound events: before the next line at a scene start, after the line before in the middle", () => {
    const events = p.lines.flatMap((l) => l.events.map((e) => ({ at: l.text.slice(0, 12), ...e })));
    expect(events).toHaveLength(9);
    expect(events[0]).toMatchObject({ placement: "before", at: "Next! Mr. Ri" });
    expect(events[1]).toMatchObject({ placement: "after" });
    expect(events.every((e) => e.seconds >= 2 && e.seconds <= (e.placement === "before" ? 4 : 8) && e.prompt.length > 5)).toBe(true);
  });
  it("is stable when read again: lines keep their ids and sounds are not added twice", () => {
    const again = parseScript(raw, p.characters, p.lines);
    expect(again.lines.map((l) => l.id)).toEqual(p.lines.map((l) => l.id));
    expect(again.lines.flatMap((l) => l.events)).toHaveLength(9);
  });
  it("also reads NAME: (direction) words without any markdown", () => {
    const q = parseScript(["ADA: (whispering) Keep quiet.", "[PAUSE: 1.5s]", "BEN: Fine."].join(String.fromCharCode(10)), [], []);
    expect(q.lines[0]!.direction.sounds).toEqual(["whispers"]);
    expect(q.lines[0]!.direction.pauseAfter).toBe(1.5);
    expect(q.lines[0]!.text).toBe("Keep quiet.");
  });
});

describe("edge cases of the script reader", () => {
  const nl = String.fromCharCode(10);
  const read = (...rows: string[]) => parseScript(rows.join(nl), [], []);
  it("removes emphasis marks from spoken words but keeps the words", () => {
    const p = read("ADA: This is *very* important, and **really** urgent.");
    expect(p.lines[0]!.text).toBe("This is very important, and really urgent.");
  });
  it("caps a pause at ten seconds, ignores a pause with nothing before it, and a cue before any speaker makes a scene", () => {
    const p = read("[PAUSE: 3 seconds]", "[SFX: Rain on a window.]", "ADA: Hello there.", "[PAUSE: 99 seconds]", "BEN: Hi.");
    expect(p.scenes).toEqual(["Scene 1"]);
    expect(p.lines[0]!.events).toEqual([expect.objectContaining({ placement: "before", prompt: "Rain on a window." })]);
    expect(p.lines[0]!.direction.pauseAfter).toBe(10);
  });
  it("reads Windows line endings the same way", () => {
    const a = parseScript(["**ADA:** (soft) Hello there.", "[PAUSE: 1 second]", "BEN: Hi."].join(String.fromCharCode(13, 10)), [], []);
    expect(a.lines).toHaveLength(2);
    expect(a.lines[0]!.direction.pauseAfter).toBe(1);
  });
  it("keeps a colon, a web address and brackets inside spoken words", () => {
    const p = read("ADA: Look at https://example.org now: it works [laughs] really.");
    expect(p.lines[0]!.text).toBe("Look at https://example.org now: it works [laughs] really.");
  });
  it("a bold line with no colon is not a speaker, and a scene heading in capitals is a scene", () => {
    const p = read("**THE END**", "**ACT 2 - NIGHT**", "ADA: Hello there.");
    expect(p.scenes).toEqual(["ACT 2 - NIGHT"]);
    expect(p.characters.map((c) => c.name)).toEqual(["ADA"]);
  });
  it("reads a very long script quickly", () => {
    const rows: string[] = [];
    for (let i = 0; i < 5000; i++) rows.push(`**C${i % 9}:** (calm) Line number ${i}.`, "[PAUSE: 1 second]");
    const t0 = performance.now();
    const p = read(...rows);
    expect(p.lines).toHaveLength(5000);
    expect(performance.now() - t0).toBeLessThan(2000);
  });
});

