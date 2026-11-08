import { describe, expect, it } from "vitest";
import { breathGroups, diagnose, rhythm } from "./scriptDoctor";
import { DEFAULT_DIRECTION, type Line } from "./types";

let n = 0;
const line = (text: string): Line => ({ id: `l${++n}`, characterId: "c", scene: 0, text, direction: { ...DEFAULT_DIRECTION }, takes: [], events: [] });

describe("breath groups", () => {
  it("splits on punctuation and counts spoken words only", () => {
    const g = breathGroups("Well, I think [laughs] so. Yes!");
    expect(g.map((x) => x.words)).toEqual([1, 3, 1]);
  });
});

describe("Script Doctor", () => {
  it("suggests a comma before a conjunction in a long unbroken stretch, and leaves the original alone", () => {
    const l = line("I walked all the way down to the old harbour in the pouring rain and I could not find the boat anywhere at all");
    const before = l.text;
    const f = diagnose([l], []).findings.filter((x) => x.kind === "breath");
    expect(f).toHaveLength(1);
    expect(f[0]!.rewrite).toContain("rain, and I could");
    expect(l.text).toBe(before);
    expect(diagnose([line("Short and sweet, like this one.")], []).findings).toEqual([]);
  });

  it("flags a long stretch even when no good comma spot exists, without a rewrite", () => {
    const f = diagnose([line("one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen")], []).findings;
    expect(f[0]!.kind).toBe("breath");
    expect(f[0]!.rewrite).toBeUndefined();
  });

  it("finds names, abbreviations and accents that need a spoken form, once, and respects existing rules", () => {
    const lines = [line("Please ask Nguyen about the NASA letter."), line("Then Nguyen met Zoë at 3pm."), line("Monday was fine. I think so.")];
    const f = diagnose(lines, []).findings.filter((x) => x.kind === "pronunciation").map((x) => x.word);
    expect(f).toEqual(["Nguyen", "NASA", "Zoë", "3pm"]);
    const withRule = diagnose(lines, [{ from: "nguyen", to: "Win" }]).findings.filter((x) => x.kind === "pronunciation").map((x) => x.word);
    expect(withRule).not.toContain("Nguyen");
  });

  it("does not flag the first word of a sentence, I, or days and months", () => {
    const f = diagnose([line("Tomorrow I will go. Then it is Friday in May.")], []).findings;
    expect(f).toEqual([]);
  });

  it("offers emphasis for the word a not-but sentence turns on", () => {
    const f = diagnose([line("It was not money but love that mattered.")], []).findings.filter((x) => x.kind === "emphasis");
    expect(f).toHaveLength(1);
    expect(f[0]!.rewrite).toBe("It was not money but LOVE that mattered.");
  });

  it("describes rhythm and notices a drone and a very long line", () => {
    const drone = Array.from({ length: 8 }, () => line("This is one more plain sentence here."));
    expect(rhythm(drone).monotone).toBe(true);
    expect(diagnose(drone, []).findings.some((x) => x.id === "scene:rhythm")).toBe(true);
    const varied = [line("Go."), line("I really did not expect to see you here after all this time, today of all days."), line("No."), line("Well then, let us begin the long and careful work.")];
    expect(rhythm(varied).monotone).toBe(false);
    expect(rhythm(varied).shortest).toBe(1);
    const huge = line(Array.from({ length: 45 }, (_, i) => `word${i}`).join(" ") + ".");
    expect(diagnose([huge], []).findings.some((x) => x.kind === "rhythm" && x.lineId === huge.id)).toBe(true);
    expect(rhythm([]).sentences).toBe(0);
  });
});
