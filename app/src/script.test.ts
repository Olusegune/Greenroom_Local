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
    expect(p.lines[4]).toMatchObject({ scene: 1, direction: { emotion: "whispering" } });
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
