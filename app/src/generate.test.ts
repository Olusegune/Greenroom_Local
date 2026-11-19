import { describe, expect, it } from "vitest";
import { clipRequest, neighboursOf } from "./generate";
describe("neighbours as context for a line made on its own", () => {
  const L = (id: string, scene: number, text: string) => ({ id, scene, text });
  const lines = [L("a", 0, "[sighs] You said ten o'clock."), L("b", 0, "It is nearly noon."), L("c", 0, "I know."), L("d", 1, "New scene.")];
  it("gives the spoken words before and after in the same scene, without tags", () => {
    expect(neighboursOf(lines, lines[1]!)).toEqual({ previous: "You said ten o'clock.", next: "I know." });
  });
  it("gives nothing across a scene change or at the edges", () => {
    expect(neighboursOf(lines, lines[0]!)).toEqual({ next: "It is nearly noon." });
    expect(neighboursOf(lines, lines[2]!)).toEqual({ previous: "It is nearly noon." });
    expect(neighboursOf(lines, lines[3]!)).toEqual({});
    expect(neighboursOf(lines, { id: "zzz", scene: 0 })).toEqual({});
  });
  it("only ElevenLabs requests carry it", () => {
    const base = { text: "x", model: "eleven_v4" as never };
    const eleven = clipRequest({ ...base, provider: "eleven-v4" } as never, { id: "v" }, 1, undefined, { previous: "p", next: "n" });
    expect(eleven).toMatchObject({ previousText: "p", nextText: "n" });
    const other = clipRequest({ ...base, provider: "kokoro" } as never, { id: "v" }, 1, undefined, { previous: "p", next: "n" });
    expect(other).not.toHaveProperty("previousText");
  });
});
