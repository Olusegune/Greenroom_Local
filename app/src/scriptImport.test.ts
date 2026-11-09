import { describe, expect, it } from "vitest";
import { convertScript, mergeScript } from "./scriptImport";
import { parseScript, SAMPLE_SCRIPT } from "./script";

const FOUNTAIN = `Title: The Late Delivery
Author: Someone

INT. KITCHEN - DAY

ADA (60s, Nigerian) sits at the table, stern. She taps her watch. TUNDE bursts in, out of breath.

ADA
(annoyed)
You said ten o'clock. It is nearly noon.

TUNDE (V.O.)
I know, I know. The traffic on the bridge
was impossible.

ADA (CONT'D)
(whispering)
Keep your voice down.
(beat)
Mama is asleep.

CUT TO:

EXT. BRIDGE - NIGHT

TUNDE
NO! Come back!

> THE END
`;

describe("a Fountain or screenplay file is turned into the app's script format", () => {
  const c = convertScript(FOUNTAIN);
  it("is recognised as a screenplay", () => {
    expect(c.kind).toBe("screenplay");
    expect(c.scenes).toBe(2);
    expect(c.lines).toBe(4);
  });
  it("reads scene headings, cues, parentheticals and extensions", () => {
    expect(c.text).toContain("# INT. KITCHEN - DAY");
    expect(c.text).toContain("# EXT. BRIDGE - NIGHT");
    expect(c.text).toContain("Ada (annoyed): You said ten o'clock. It is nearly noon.");
    expect(c.text).toContain("Tunde (voice over): I know, I know. The traffic on the bridge was impossible.");
    expect(c.text).toContain("Ada (whispering): Keep your voice down. [beat] Mama is asleep.");
    expect(c.text).toContain("Tunde: NO! Come back!");
    expect(c.text).not.toMatch(/CUT TO|THE END|Title:|Author:/);
  });
  it("finds each character's description in the action lines", () => {
    const ada = c.characters.find((x) => x.name === "Ada")!;
    expect(ada.lines).toBe(2);
    expect(ada.about).toMatch(/60s, Nigerian/);
    expect(ada.gender).toBe("f");
    expect(ada.age).toBe("old");
    expect(ada.heritage).toBe("black");
    expect(c.characters.find((x) => x.name === "Tunde")!.lines).toBe(2);
  });
  it("makes a script the app reads back to the same lines", () => {
    const p = parseScript(c.text, [], [], () => "x");
    expect(p.lines.map((l) => l.text)).toEqual(["You said ten o'clock. It is nearly noon.", "I know, I know. The traffic on the bridge was impossible.", "Keep your voice down. [beat] Mama is asleep.", "NO! Come back!"]);
    expect(p.characters.map((x) => x.name).sort()).toEqual(["Ada", "Tunde"]);
  });
});

describe("text taken from a PDF or a Word file", () => {
  it("handles a screenplay with no blank lines, indentation and page furniture", () => {
    const t = ["   INT. KITCHEN - DAY", "   ADA", "   You said ten o'clock.", "   TUNDE", "   Traffic.", "   It was the bridge.", "12.", "   ADA", "   (sighing)", "   Every time.", "(CONTINUED)", "Page 3 of 10"].join("\n");
    const c = convertScript(t);
    expect(c.kind).toBe("screenplay");
    expect(c.lines).toBe(3);
    expect(c.text).toContain("Ada: You said ten o'clock.");
    expect(c.text).toContain("Tunde: Traffic. It was the bridge.");
    expect(c.text).toContain("Ada (sighing): Every time.");
    expect(c.text).not.toMatch(/Page 3|CONTINUED|^12\.$/m);
  });
  it("passes a script already written as NAME: line through unchanged", () => {
    const c = convertScript(SAMPLE_SCRIPT);
    expect(c.kind).toBe("app");
    expect(c.lines).toBe(7);
    expect(c.scenes).toBe(2);
    expect(c.characters.map((x) => x.name).sort()).toEqual(["ADA", "TUNDE"]);
  });
  it("reads prose as one narrator, one paragraph per line, and says so", () => {
    const c = convertScript("It was a dark night\nand the wind blew.\n\nThe next morning came\nwith rain.");
    expect(c.kind).toBe("plain");
    expect(c.text).toBe("It was a dark night and the wind blew.\n\nThe next morning came with rain.");
    expect(c.warnings.join(" ")).toMatch(/narrator/);
    expect(c.lines).toBe(2);
  });
  it("shouted lines and ordinary capitals are not mistaken for speakers", () => {
    const c = convertScript("INT. ROOM - DAY\n\nADA\nSTOP! NOW!\n\nA LOUD BANG shakes the house.\n\nTUNDE\nWhat was that?\n");
    expect(c.characters.map((x) => x.name).sort()).toEqual(["Ada", "Tunde"]);
    expect(c.text).toContain("Ada: STOP! NOW!");
  });
  it("says when it finds no dialogue, and nothing for an empty file", () => {
    expect(convertScript("").lines).toBe(0);
    expect(convertScript("").warnings.join(" ")).toMatch(/No lines/);
  });
});

describe("names and merging", () => {
  it("title-cases capital names and joins an extension to the same person", () => {
    const c = convertScript("INT. X - DAY\n\nDR. OKAFOR\nHello.\n\nMAMA ADA (O.S.)\nWho is there?\n\nDR. OKAFOR (CONT'D)\nIt is me.\n");
    expect(c.characters.map((x) => [x.name, x.lines])).toEqual([["Dr. Okafor", 2], ["Mama Ada", 1]]);
    expect(c.text).toContain("Mama Ada (off screen): Who is there?");
  });
  it("replaces or appends", () => {
    expect(mergeScript("A: one", "B: two", "replace")).toBe("B: two");
    expect(mergeScript("A: one\n", "B: two", "append")).toBe("A: one\n\nB: two");
    expect(mergeScript("   ", "B: two", "append")).toBe("B: two");
  });
});

describe("hostile or huge text is read safely", () => {
  const bad = ["A".repeat(500_000), "ADA\n".repeat(20_000), "(".repeat(100_000), " ".repeat(300_000) + "x", "ADA\nhi\n\n".repeat(30_000), "INT. ".repeat(50_000), "‮\u0000​".repeat(50_000), "x:".repeat(100_000)];
  for (const [i, s] of bad.entries()) {
    it(`case ${i} finishes in well under 3 seconds and does not throw`, () => {
      const t = performance.now();
      const c = convertScript(s);
      expect(typeof c.text).toBe("string");
      expect(performance.now() - t).toBeLessThan(3000);
    });
  }
  it("treats non-text input as empty", () => {
    expect(convertScript(null as never).lines).toBe(0);
    expect(convertScript(42 as never).lines).toBe(0);
  });
  it("keeps a speaker name from becoming markup or a long line", () => {
    const c = convertScript("INT. X\n\nA\nOne.\n\nB\nTwo.\n\n<SCRIPT>\nalert(1)\n");
    for (const x of c.characters) expect(x.name.length).toBeLessThanOrEqual(38);
    expect(c.characters.every((x) => !/[<>]/.test(x.name))).toBe(true);
  });
});
