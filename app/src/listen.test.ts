import { describe, expect, it } from "vitest";
import { heard, isVerdict, nextUnheard, queue, reportMarkdown, summarise, takeToHear, todoList, voiceComplaints, withNote, withVerdict, type Listened } from "./listen";
import type { Character, Line, Take } from "./types";

const take = (id: string): Take => ({ id, at: "2026-11-19T10:00:00Z", model: "eleven_v4", ext: "mp3", voiceId: "v", sent: "x", seconds: 2 }) as Take;
let n = 0;
const line = (over: Partial<Line> & { listened?: Listened } = {}): Line =>
  ({ id: "l" + ++n, characterId: "c1", scene: 0, text: "Hello there, how are you today?", direction: { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 }, takes: [take("t1")], events: [], ...over }) as Line;
const NOW = "2026-11-19 11:00";
const chars: Pick<Character, "id" | "name">[] = [{ id: "c1", name: "ADA" }, { id: "c2", name: "BEN" }];

describe("recording what the owner heard", () => {
  it("plays the chosen take, else the newest", () => {
    const l = line({ takes: [take("a"), take("b")] });
    expect(takeToHear(l)!.id).toBe("b");
    expect(takeToHear({ ...l, chosen: "a" })!.id).toBe("a");
    expect(takeToHear(line({ takes: [] }))).toBeUndefined();
  });
  it("records a verdict against the exact take, with a clean short note", () => {
    const l = withVerdict(line(), "delivery", NOW, "  too   angry\nfor a whisper ");
    expect(l.listened).toEqual({ verdict: "delivery", note: "too angry for a whisper", takeId: "t1", at: NOW });
    expect(withVerdict(line(), "good", NOW, "x".repeat(900)).listened!.note!.length).toBe(300);
  });
  it("does nothing for a line with no take", () => {
    const l = line({ takes: [] });
    expect(withVerdict(l, "good", NOW)).toBe(l);
  });
  it("pressing the same verdict again takes it back; a different one replaces it and keeps the note", () => {
    const a = withVerdict(line(), "voice", NOW);
    expect(a.listened?.verdict).toBe("voice");
    expect(withVerdict(a, "voice", NOW).listened).toBeUndefined();
    const b = withNote(a, "reads like a man");
    expect(withVerdict(b, "glitch", NOW).listened).toMatchObject({ verdict: "glitch", note: "reads like a man" });
  });
  it("a verdict belongs to the take it was given for: a new take is not heard yet", () => {
    const a = withVerdict(line(), "good", NOW);
    expect(heard(a)?.verdict).toBe("good");
    const remade = { ...a, takes: [...a.takes, take("t2")] };
    expect(heard(remade)).toBeUndefined();
    expect(heard({ ...remade, chosen: "t1" })?.verdict).toBe("good");
  });
  it("ignores a verdict it does not know (a damaged or newer project file)", () => {
    const l = line({ listened: { verdict: "excellent" as never, takeId: "t1", at: NOW } });
    expect(heard(l)).toBeUndefined();
    expect(isVerdict("good") && !isVerdict("excellent") && !isVerdict(undefined)).toBe(true);
  });
});

describe("the queue and the summary", () => {
  const lines = [line(), withVerdict(line(), "good", NOW), withVerdict(line(), "voice", NOW), line({ takes: [] }), withVerdict(line(), "glitch", NOW)];
  it("lists only lines with a take, and filters by heard and flagged", () => {
    expect(queue(lines, "all")).toEqual([0, 1, 2, 4]);
    expect(queue(lines, "unheard")).toEqual([0]);
    expect(queue(lines, "flagged")).toEqual([2, 4]);
  });
  it("counts what was heard", () => {
    expect(summarise(lines)).toEqual({ lines: 5, withTake: 4, heard: 3, unheard: 1, good: 1, voice: 1, delivery: 0, glitch: 1 });
  });
  it("finds the next unheard line, wrapping round, and says -1 when all are heard", () => {
    expect(nextUnheard(lines, 0)).toBe(0);
    expect(nextUnheard(lines, 2)).toBe(0);
    expect(nextUnheard([withVerdict(line(), "good", NOW)], 0)).toBe(-1);
    expect(nextUnheard([], 0)).toBe(-1);
  });
});

describe("the to-do list and the report", () => {
  const lines = [
    withVerdict(line({ text: "First line." }), "good", NOW),
    withVerdict(line({ characterId: "c2", text: "Second line, with a long middle part that goes on and on and on and on and on and on and on and on and on and on." }), "voice", NOW, "sounds like a child"),
    withVerdict(line({ characterId: "c2", text: "Third." }), "voice", NOW),
    withVerdict(line({ text: "Fourth." }), "delivery", NOW),
    line({ text: "Fifth, not heard." }),
  ];
  const project = { name: "Test scene", lines, characters: chars as Character[] };
  it("lists what needs doing in script order, with the owner's note", () => {
    const t = todoList(lines, chars);
    expect(t.map((x) => [x.lineNumber, x.character, x.verdict])).toEqual([[2, "BEN", "voice"], [3, "BEN", "voice"], [4, "ADA", "delivery"]]);
    expect(t[0]!.note).toBe("sounds like a child");
    expect(t[2]!.todo).toMatch(/direction/i);
  });
  it("groups voice complaints by character so a voice change is one decision", () => {
    expect(voiceComplaints(todoList(lines, chars))).toEqual([{ characterId: "c2", character: "BEN", lines: 2 }]);
  });
  it("writes a report from the owner's verdicts, and says nothing about how anything sounds", () => {
    const md = reportMarkdown(project, { now: NOW, appVersion: "0.18.0" });
    expect(md).toContain("# Listening notes: Test scene");
    expect(md).toContain("Heard: 4, not heard yet: 1");
    expect(md).toContain("## Voices to reconsider");
    expect(md).toContain("**BEN**: wrong voice on 2 lines.");
    expect(md).toContain('Line 2 (BEN) "Second line, with a long middle part');
    expect(md).toContain("…");
    expect(md).toContain('("sounds like a child")');
    expect(md).toContain("## Marked good\n\n1");
    expect(md).toContain("does not judge how anything sounds");
  });
  it("says so when everything heard was good, and says nothing to do before anything is heard", () => {
    const allGood = { name: "S", lines: [withVerdict(line(), "good", NOW)], characters: chars as Character[] };
    expect(reportMarkdown(allGood, { now: NOW, appVersion: "x" })).toContain("every line heard so far was marked good");
    const none = { name: "S", lines: [line()], characters: chars as Character[] };
    expect(reportMarkdown(none, { now: NOW, appVersion: "x" })).not.toContain("## To do");
  });
});
