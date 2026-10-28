import { describe, expect, it } from "vitest";
import { physicalDirection } from "./performance";

describe("performance compiler", () => {
  it("directs sustained exertion rather than pasting in a grunt", () => {
    const text = physicalDirection({ activity: "lifting", effort: 0.85, fatigue: 0.5, pain: 0, breathlessness: 0.7, note: "The load gets heavier" });
    expect(text).toContain("sustained muscular effort");
    expect(text).toContain("shorter phrases");
    expect(text).toContain("Do not reduce this to a single sound effect");
  });
});
