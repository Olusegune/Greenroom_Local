import { describe, expect, it } from "vitest";
import { applySuggestion, describe as say, isDirected, parseDirector, systemPrompt, userPrompt } from "./director";
import { DEFAULT_DIRECTION } from "./types";

const ids = ["l-a", "l-b", "l-c"];

describe("parseDirector", () => {
  it("reads clean JSON and keeps only allowed tags, clamping numbers", () => {
    const r = parseDirector(
      JSON.stringify({
        lines: [
          { id: "l-a", emotion: "Excited", sounds: ["laughs", "explodes", "laughs", "sighs"], note: "bright [and] quick\nplease", speed: 3, pauseAfter: -2 },
          { id: "l-b", emotion: "furious", sounds: "gasps", note: 42, speed: "fast" },
        ],
        atmosphere: "  soft rain [on glass] ",
      }),
      ids,
    );
    expect(r.suggestions[0]).toEqual({ id: "l-a", emotion: "excited", sounds: ["laughs", "sighs"], note: "bright and quick please", speed: 1.15, pauseAfter: 0 });
    expect(r.suggestions[1]).toMatchObject({ id: "l-b", emotion: "", sounds: [], note: "", speed: 1, pauseAfter: 0.4 });
    expect(r.atmosphere).toBe("soft rain on glass");
  });

  it("finds the JSON inside a code fence or chatter", () => {
    const r = parseDirector('Sure! ```json\n{"lines":[{"id":"l-c","emotion":"sad","sounds":[],"note":"","speed":1,"pauseAfter":1}]}\n``` Hope it helps', ids);
    expect(r.suggestions).toHaveLength(1);
    expect(r.suggestions[0]!.pauseAfter).toBe(1);
  });

  it("ignores unknown and repeated ids", () => {
    const r = parseDirector('{"lines":[{"id":"zzz"},{"id":"l-a","emotion":"sad"},{"id":"l-a","emotion":"happy"}]}', ids);
    expect(r.suggestions.map((s) => [s.id, s.emotion])).toEqual([["l-a", "sad"]]);
  });

  it("refuses answers it cannot trust", () => {
    expect(() => parseDirector("I cannot do that.", ids)).toThrow(/not in a form/);
    expect(() => parseDirector("{not json}", ids)).toThrow(/not in a form/);
    expect(() => parseDirector('{"lines":"nope"}', ids)).toThrow(/no lines/);
    expect(() => parseDirector('{"lines":[{"id":"zzz"}]}', ids)).toThrow(/did not suggest/);
  });
});

describe("prompts", () => {
  it("tell the model the allowed tags and never to change the dialogue", () => {
    const s = systemPrompt();
    expect(s).toContain("laughs");
    expect(s).toContain("grunts");
    expect(s).toContain("excited");
    expect(s).toMatch(/Never change, translate or repeat the dialogue/);
  });
  it("send the whole script and every line with its id and speaker", () => {
    const u = userPrompt({
      script: "ADA: Hello.\n\nHe lifts the crate.\nTUNDE: Ugh.",
      characters: [{ id: "c1", name: "ADA", language: "English" }, { id: "c2", name: "TUNDE", language: "English" }],
      lines: [
        { id: "l-a", characterId: "c1", scene: 0, text: "Hello.", direction: { ...DEFAULT_DIRECTION }, takes: [], events: [] },
        { id: "l-b", characterId: "c2", scene: 0, text: "Ugh.", direction: { ...DEFAULT_DIRECTION }, takes: [], events: [] },
      ],
    });
    expect(u).toContain("He lifts the crate.");
    expect(u).toContain("l-b | TUNDE | Ugh.");
  });
});

describe("applying", () => {
  it("replaces the direction and keeps other settings", () => {
    const d = applySuggestion({ ...DEFAULT_DIRECTION, pauseAfter: 1 }, { id: "x", emotion: "sad", sounds: ["sighs"], note: "low", speed: 0.9, pauseAfter: 0.8 });
    expect(d).toMatchObject({ emotion: "sad", sounds: ["sighs"], note: "low", speed: 0.9, pauseAfter: 0.8 });
  });
  it("recognises a line the owner already directed, including older saves with no note", () => {
    expect(isDirected({ ...DEFAULT_DIRECTION })).toBe(false);
    expect(isDirected({ ...DEFAULT_DIRECTION, sounds: ["sighs"] })).toBe(true);
    expect(isDirected({ ...DEFAULT_DIRECTION, note: "quiet" })).toBe(true);
    const old = { emotion: "", sounds: [], speed: 1, pauseAfter: 0.4 } as unknown as typeof DEFAULT_DIRECTION;
    expect(isDirected(old)).toBe(false);
  });
  it("describes a suggestion for the review list", () => {
    expect(say({ emotion: "sad", sounds: ["sighs"], note: "low" })).toBe("sad · sighs · “low”");
    expect(say({ emotion: "", sounds: [], note: "" })).toBe("no change needed");
  });
});
