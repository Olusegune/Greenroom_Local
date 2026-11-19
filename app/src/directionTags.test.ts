import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { composeText } from "./direct";
import { directionFrom, interpretDirection } from "./directionTags";
import { parseScript } from "./script";

const tags = (raw: string) => {
  const i = interpretDirection(raw);
  return { emotion: i.emotion, sounds: i.sounds, speed: i.speed };
};

describe("written directions become short engine tags", () => {
  it("maps body sounds to their tags", () => {
    expect(tags("Soft throat clearing").sounds).toEqual(["clears throat"]);
    expect(tags("Nervous laugh, then silence").sounds).toEqual(["laughs nervously"]);
    expect(tags("Long irritated exhale").sounds).toEqual(["exhales"]);
    expect(tags("Exhausted sigh, then quietly").sounds).toEqual(["sighs"]);
    expect(tags("Barely suppressing laughter").sounds).toEqual(["chuckles"]);
    expect(tags("Short explosive laugh").sounds).toEqual(["laughs"]);
    expect(tags("Whispers, close to microphone").sounds).toEqual(["whispers"]);
  });
  it("keeps the feeling and the manner as short tags", () => {
    expect(tags("Furious, projecting").emotion).toEqual(["angry", "loudly"]);
    expect(tags("Controlled, icy politeness").emotion).toEqual(["controlled", "icy", "polite"]);
    expect(tags("Matter-of-fact").emotion).toEqual(["matter-of-fact"]);
    expect(tags("Trying to maintain control").emotion).toEqual(["controlled"]);
  });
  it("drops silent stage business instead of sending it to the engine", () => {
    const i = interpretDirection("Slowly removes his glasses; dry");
    expect(i.emotion).toEqual(["dry"]);
    expect(i.dropped.length).toBeGreaterThan(0);
    expect(interpretDirection("Without looking up; quietly").emotion).toEqual(["quietly"]);
    expect(interpretDirection("A beat, dignified").emotion).toEqual(["dignified"]);
  });
  it("turns pace words into a speed, and never both fast and slow", () => {
    expect(tags("Defensive, fast").speed).toBe(1.12);
    expect(tags("Very soft, deliberate").speed).toBe(0.9);
    expect(tags("Slowly removes his glasses; dry").speed).toBeUndefined();
    expect(tags("Angry").speed).toBeUndefined();
  });
  it("a whisper is not also marked quiet, and nothing is repeated", () => {
    expect(tags("Whispers quietly").emotion).toEqual([]);
    const i = interpretDirection("angry, furious, angry");
    expect(i.emotion).toEqual(["angry"]);
  });
  it("limits what one direction can send, and an empty direction sends nothing", () => {
    const i = interpretDirection("angry, sad, happy, tired, nervous, tender, laughs, sighs, coughs");
    expect(i.emotion.length).toBeLessThanOrEqual(3);
    expect(i.sounds.length).toBeLessThanOrEqual(2);
    expect(directionFrom("")).toEqual({ emotion: "", sounds: [] });
    expect(interpretDirection(undefined).emotion).toEqual([]);
  });
});

describe("what the engine receives for the whole stress script", () => {
  const raw = readFileSync(new URL("../../docs/samples/the-wrong-department.md", import.meta.url), "utf8");
  const p = parseScript(raw, [], []);
  it("is only short tags then the spoken words: no stage business, no semicolons, no long tags", () => {
    for (const l of p.lines) {
      const sent = composeText(l);
      for (const t of sent.match(/\[[^\]]*\]/g) ?? []) {
        expect(t.length, t).toBeLessThanOrEqual(22);
        expect(t, t).not.toMatch(/[;,]/);
      }
      expect(sent, sent).not.toMatch(/glasses|looking up|microphone|stamp/i);
      expect(sent.endsWith(l.text), sent).toBe(true);
    }
  });
  it("sends the laughs, whispers and throat clearing as sound tags", () => {
    const sentFor = (start: string) => composeText(p.lines.find((l) => l.text.startsWith(start))!);
    expect(sentFor("Come on, boss")).toContain("[laughs]");
    expect(sentFor("Yes. We noticed")).toContain("[clears throat]");
    expect(sentFor("You're in Hell")).toContain("[whispers]");
    expect(sentFor("Ha! Nice one")).toContain("[laughs nervously]");
  });
});
