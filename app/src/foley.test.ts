import { describe, expect, it } from "vitest";
import { foleyPlan } from "./foley";

const lines = [{ id: "l1" }, { id: "l2" }, { id: "l3" }];
const SCRIPT = `# The Night Inspection
(Rain hammers the high windows. A door slams downstairs.)

VENOMSPUR (polite): Good evening, Miss Hale.
MIRA (nervous): I thought the office was closed.

TOLLEY drags a heavy crate across the floor and sets it down with a thud.

TOLLEY: Mind your backs.

Footsteps approach slowly.
`;

describe("foleyPlan", () => {
  it("finds sounds in stage directions and anchors each to the line that follows", () => {
    const f = foleyPlan(SCRIPT, lines);
    const first = f.filter((x) => x.lineId === "l1");
    expect(first.map((x) => x.prompt)).toEqual(["A heavy door slamming shut", "Steady rain against a window"]);
    expect(first.every((x) => x.placement === "before")).toBe(true);
    expect(f.find((x) => x.lineId === "l3" && /crate/i.test(x.prompt))).toBeTruthy();
  });

  it("anchors a trailing direction after the last line", () => {
    const f = foleyPlan(SCRIPT, lines);
    const last = f.find((x) => /footsteps/i.test(x.prompt));
    expect(last).toBeTruthy();
    expect(last!.lineId).toBe("l3");
    expect(last!.placement).toBe("after");
  });

  it("treats a row straight after a spoken line as part of that line, as the script parser does", () => {
    expect(foleyPlan("A: Hello there.\nFootsteps approach.\n", [{ id: "a" }])).toEqual([]);
  });

  it("does not read spoken words as stage directions", () => {
    const f = foleyPlan("A: The rain is awful.\nB: Knock knock.\n", [{ id: "a" }, { id: "b" }]);
    expect(f).toEqual([]);
  });

  it("returns nothing for a script with no speakers or no lines", () => {
    expect(foleyPlan("Just a paragraph about rain.", lines)).toEqual([]);
    expect(foleyPlan(SCRIPT, [])).toEqual([]);
  });

  it("offers each sound once per line and never changes the script", () => {
    const s = "(Rain. Rain. Heavy rain.)\n\nA: Hi.\n";
    const before = s;
    expect(foleyPlan(s, [{ id: "a" }]).filter((x) => /rain/i.test(x.prompt))).toHaveLength(1);
    expect(s).toBe(before);
  });
});
