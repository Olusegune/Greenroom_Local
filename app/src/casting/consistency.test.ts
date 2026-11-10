import { describe, expect, it } from "vitest";
import { LIKELY_DIFFERENT_BELOW, SAME_SPEAKER_AT, consistencyOf, cosine, verdictOf } from "./consistency";

const unit = (angleDeg: number): number[] => { const r = (angleDeg * Math.PI) / 180; return [Math.cos(r), Math.sin(r), 0, 0]; };
const tv = (id: string, v: number[]) => ({ takeId: id, lineId: "l-" + id, embedding: v });

describe("speaker consistency", () => {
  it("cosine similarity is 1 for the same direction, 0 at right angles, and safe on bad input", () => {
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
    expect(cosine([1, 0], [1])).toBe(0);
    expect(cosine([], [])).toBe(0);
    expect(cosine([0, 0], [1, 1])).toBe(0);
  });
  it("uses the thresholds measured on real audio", () => {
    expect(SAME_SPEAKER_AT).toBe(0.75);
    expect(LIKELY_DIFFERENT_BELOW).toBe(0.65);
    expect(verdictOf(0.9)).toBe("consistent");
    expect(verdictOf(0.7)).toBe("check");
    expect(verdictOf(0.5)).toBe("different");
  });
  it("takes of one speaker are consistent", () => {
    const r = consistencyOf([tv("a", unit(0)), tv("b", unit(10)), tv("c", unit(-8)), tv("d", unit(5))]);
    expect(r.verdict).toBe("consistent");
    expect(r.takes.every((t) => t.verdict === "consistent")).toBe(true);
    expect(r.note).toMatch(/one speaker.*for your ears/);
  });
  it("one take of another voice is flagged and the others are not blamed more than they must be", () => {
    const r = consistencyOf([tv("a", unit(0)), tv("b", unit(8)), tv("c", unit(-6)), tv("odd", unit(75))]);
    expect(r.verdict).toBe("different");
    expect(r.takes.filter((t) => t.verdict !== "consistent").map((t) => t.takeId)).toEqual(["odd"]);
    const odd = r.takes.find((t) => t.takeId === "odd")!;
    expect(odd.verdict).toBe("different");
    expect(odd.similarity).toBeLessThan(r.takes.find((t) => t.takeId === "a")!.similarity);
    expect(r.note).toMatch(/different voice/);
  });
  it("needs two takes, and ignores takes with no vector", () => {
    expect(consistencyOf([tv("a", unit(0))]).verdict).toBe("not_enough");
    expect(consistencyOf([tv("a", unit(0)), tv("b", [])]).verdict).toBe("not_enough");
    expect(consistencyOf([]).takes).toEqual([]);
  });
  it("with two takes both are judged on the one pair", () => {
    const r = consistencyOf([tv("a", unit(0)), tv("b", unit(45))]);
    expect(r.takes.map((t) => t.verdict)).toEqual(["check", "check"]);
    expect(r.meanPair).toBeCloseTo(0.707, 2);
    expect(consistencyOf([tv("a", unit(0)), tv("b", unit(70))]).takes.map((t) => t.verdict)).toEqual(["different", "different"]);
  });
});

describe("a character split into two voices", () => {
  it("flags every take, because no take matches most of the others", () => {
    const r = consistencyOf([tv("a1", unit(0)), tv("a2", unit(5)), tv("b1", unit(80)), tv("b2", unit(85))]);
    expect(r.takes.every((t) => t.verdict !== "consistent")).toBe(true);
    expect(r.verdict).not.toBe("consistent");
  });
});
