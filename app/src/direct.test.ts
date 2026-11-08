import { describe, expect, it } from "vitest";
import { applyPreset, applyPronunciations, cleanNote, composeText, countChars, INSERT_GROUPS, insertAt, hasStyle, insertTok, joinTokens, moveTok, noteTags, pushHistory, PRESETS, STYLES, toggleStyle, removeTok, stripTags, tagGroup, toggleIn, tokenize, vkInstructions, vkUnsupported } from "./direct";
import { DEFAULT_DIRECTION } from "./types";

const line = (text: string, d: Partial<typeof DEFAULT_DIRECTION> = {}) => ({ text, direction: { ...DEFAULT_DIRECTION, ...d } });

describe("composeText", () => {
  it("puts the emotion and sounds in front of the words", () => {
    expect(composeText(line("Come on, Ada.", { emotion: "excited", sounds: ["laughs", "gasps"] }))).toBe("[excited] [laughs] [gasps] Come on, Ada.");
  });
  it("sends plain text untouched", () => {
    expect(composeText(line("  Hello.  "))).toBe("Hello.");
  });
  it("does not repeat a tag the writer already typed inline", () => {
    expect(composeText(line("[laughs] Oh no.", { sounds: ["laughs"] }))).toBe("[laughs] Oh no.");
  });
  it("counts the characters actually sent", () => {
    expect(countChars([line("ab", { emotion: "sad" }), line("cd")])).toBe("[sad] ab".length + 2);
  });
});

describe("toggleIn", () => {
  it("adds and removes", () => {
    expect(toggleIn([], "a")).toEqual(["a"]);
    expect(toggleIn(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("VoiceKiller", () => {
  it("turns delivery and pace into one instruction sentence", () => {
    expect(vkInstructions("whispers", 1)).toBe("Speak in a tone that is whispering softly.");
    expect(vkInstructions("", 1.2)).toBe("Speak faster than normal.");
    expect(vkInstructions("excited", 0.8)).toBe("Speak in a tone that is excited and energetic. Speak slower than normal.");
    expect(vkInstructions("", 1)).toBeUndefined();
  });
  it("strips tags so none is read aloud", () => {
    expect(stripTags("[laughs] Oh   no [sighs] really")).toBe("Oh no really");
  });
  it("reports body sounds it cannot make, from chips or typed inline", () => {
    expect(vkUnsupported(line("[coughs] Sorry.", { sounds: ["laughs"] })).sort()).toEqual(["coughs", "laughs"]);
    expect(vkUnsupported(line("Plain."))).toEqual([]);
  });
});

describe("direction notes", () => {
  it("go into the tags after the emotion and sounds, and cannot break the brackets", () => {
    expect(composeText(line("Hold it.", { emotion: "tired", sounds: ["grunts"], note: "as if lifting a [heavy]\nbox" }))).toBe("[tired] [grunts] [as if lifting a heavy box] Hold it.");
    expect(composeText({ text: "Hi.", direction: { emotion: "", sounds: [], speed: 1, pauseAfter: 0 } as never })).toBe("Hi.");
    expect(cleanNote("  a   b ")).toBe("a b");
    expect(cleanNote("x".repeat(500))).toHaveLength(400);
  });
  it("splits a long written direction into one cue per sentence, and sends as many whole cues as the line can carry", () => {
    const note = "Quietly furious, barely holding it together. A long beat before the last word! Then a shaky breath";
    expect(noteTags(note)).toEqual(["Quietly furious, barely holding it together", "A long beat before the last word", "Then a shaky breath"]);
    expect(composeText(line("Fine.", { note }))).toBe("[quietly furious, barely holding it together] Fine.");
    expect(composeText(line("I did not expect to see you here after all this time.", { note }))).toBe("[quietly furious, barely holding it together] [a long beat before the last word] [then a shaky breath] I did not expect to see you here after all this time.");
    expect(noteTags("a. b. c. d. e. f.")).toHaveLength(4);
    expect(noteTags("  ")).toEqual([]);
  });
  it("reach VoiceKiller as a sentence in its instructions", () => {
    expect(vkInstructions("", 1, "tired, carrying a box")).toBe("Direction: tired, carrying a box.");
  });
});

describe("presets and the insert menu", () => {
  it("fill emotion, sounds, note and speed, without losing sounds already chosen", () => {
    const p = PRESETS.find((x) => x.id === "lifting")!;
    const d = applyPreset({ emotion: "sad", note: "", sounds: ["sighs", "grunts"], speed: 1, pauseAfter: 0.4 }, p);
    expect(d.emotion).toBe("sad");
    expect(d.sounds).toEqual(["sighs", "grunts", "straining"]);
    expect(d.note).toMatch(/heavy/);
    expect(d.speed).toBe(0.9);
  });
  it("offers heavy-lifting and effort sounds", () => {
    const all = INSERT_GROUPS.flatMap((g) => g.tags.map((t) => t.tag));
    for (const t of ["grunts", "straining", "panting", "groans", "laughs", "sighs", "coughs"]) expect(all).toContain(t);
    expect(INSERT_GROUPS.flatMap((g) => g.tags).find((t) => t.tag === "laughs")!.verified).toBe(true);
    expect(INSERT_GROUPS.flatMap((g) => g.tags).find((t) => t.tag === "grunts")!.verified).toBe(false);
  });
  it("insert a tag at the caret with tidy spacing", () => {
    expect(insertAt("Hello there", 5, "laughs")).toEqual({ text: "Hello [laughs] there", caret: 15 });
    expect(insertAt("Hello", 0, "sighs")).toEqual({ text: "[sighs] Hello", caret: 8 });
    expect(insertAt("Hello", 99, "gasps").text).toBe("Hello [gasps] ");
  });
});

describe("pronunciations", () => {
  const dict = [{ from: "Tunde", to: "Toon-day" }, { from: "Mr.", to: "Mister" }];
  it("swap whole words outside tags, ignoring case", () => {
    expect(applyPronunciations("tunde and Tundest [Tunde laughs] met Mr. Ade", dict)).toBe("Toon-day and Tundest [Tunde laughs] met Mister Ade");
  });
  it("work for other alphabets and ignore empty rules", () => {
    expect(applyPronunciations("서연 안녕", [{ from: "서연", to: "Seo-yeon" }, { from: "", to: "x" }])).toBe("Seo-yeon 안녕");
    expect(applyPronunciations("Hi", [])).toBe("Hi");
  });
  it("treat special characters and dollar signs literally", () => {
    expect(applyPronunciations("Pay $5 (now)", [{ from: "$5", to: "five dollars" }, { from: "(now)", to: "$& now" }])).toBe("Pay five dollars $& now");
  });
});

describe("visual line editor", () => {
  it("splits words and tags and joins them back with single spaces", () => {
    const t = tokenize("Hello [laughs]   there.  [sighs]");
    expect(t).toEqual([{ kind: "word", text: "Hello" }, { kind: "tag", text: "laughs" }, { kind: "word", text: "there." }, { kind: "tag", text: "sighs" }]);
    expect(joinTokens(t)).toBe("Hello [laughs] there. [sighs]");
  });
  it("survives stray brackets, empty tags and tags with spaces", () => {
    expect(joinTokens(tokenize("a [ b [] [out of breath] c"))).toBe("a [ b [out of breath] c");
    expect(tokenize("")).toEqual([]);
  });
  it("inserts a sound at any gap, including both ends", () => {
    const t = tokenize("one two");
    expect(joinTokens(insertTok(t, 0, "gasps"))).toBe("[gasps] one two");
    expect(joinTokens(insertTok(t, 1, "sighs"))).toBe("one [sighs] two");
    expect(joinTokens(insertTok(t, 2, "laughs"))).toBe("one two [laughs]");
    expect(joinTokens(insertTok(t, 99, "x"))).toBe("one two [x]");
    expect(joinTokens(insertTok(t, 1, "  [  ]  "))).toBe("one two");
  });
  it("moves a sound to another gap and removes one", () => {
    const t = tokenize("[gasps] one two [sighs]");
    expect(joinTokens(moveTok(t, 0, 3))).toBe("one two [gasps] [sighs]");
    expect(joinTokens(moveTok(t, 3, 0))).toBe("[sighs] [gasps] one two");
    expect(moveTok(t, 0, 1)).toBe(t);
    expect(moveTok(t, 0, 0)).toBe(t);
    expect(joinTokens(removeTok(t, 0))).toBe("one two [sighs]");
  });
  it("groups tags for colour", () => {
    expect(tagGroup("laughs")).toBe("Reactions");
    expect(tagGroup("grunts")).toBe("Effort and body");
    expect(tagGroup("whispers")).toBe("Voice");
    expect(tagGroup("short pause")).toBe("Beats");
    expect(tagGroup("as if lifting")).toBe("Other");
  });
});

import { ALL_SOUND_TAGS, MORE_SOUNDS, SOUNDS } from "./direct";
describe("more expressions", () => {
  it("adds at least 60 extra tags with unique, bracket-free names that do not repeat the core list", () => {
    const extra = MORE_SOUNDS.flatMap((g) => g.sounds);
    expect(extra.length).toBeGreaterThanOrEqual(60);
    const tags = ALL_SOUND_TAGS.map((s) => s.tag);
    expect(new Set(tags).size).toBe(tags.length);
    for (const t of tags) expect(t).toMatch(/^[a-z][a-z' -]{1,40}$/);
    expect(extra.every((s) => !s.verified)).toBe(true);
    expect(SOUNDS.length).toBeLessThan(ALL_SOUND_TAGS.length);
  });
});

describe("one-click styles", () => {
  const sad = STYLES.find((s) => s.id === "sad")!;
  const tired = STYLES.find((s) => s.id === "tired")!;
  it("add a full sentence to the written direction and take it out again, keeping the owner's own words", () => {
    const a = toggleStyle("Say it slowly", sad);
    expect(a).toBe(`Say it slowly. ${sad.sentence}.`);
    expect(hasStyle(a, sad)).toBe(true);
    expect(toggleStyle(a, sad)).toBe("Say it slowly.");
    expect(toggleStyle("", tired)).toBe(`${tired.sentence}.`);
    expect(toggleStyle(toggleStyle("", sad), sad)).toBe("");
  });
  it("can be stacked, and never grow the note past its limit", () => {
    const both = toggleStyle(toggleStyle("", sad), tired);
    expect(hasStyle(both, sad) && hasStyle(both, tired)).toBe(true);
    expect(toggleStyle("x".repeat(395), sad).length).toBeLessThanOrEqual(400);
  });
  it("send nothing that could break a tag", () => {
    for (const s of STYLES) expect(s.sentence).not.toMatch(/[\[\]\n]/);
  });
});

describe("recent directions", () => {
  it("keep the newest first, drop repeats and blanks, and stop at eight", () => {
    expect(pushHistory([], "  ")).toEqual([]);
    expect(pushHistory(["a", "b"], "B")).toEqual(["B", "a"]);
    let h: string[] = [];
    for (let i = 0; i < 12; i++) h = pushHistory(h, "note " + i);
    expect(h).toHaveLength(8);
    expect(h[0]).toBe("note 11");
  });
});
