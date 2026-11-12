import { describe, expect, it } from "vitest";
import { asksForStems, EXPORT_PRESETS, presetFromWords } from "../exportPresets";
import { interpret } from "./brief";

describe("delivery wording", () => {
  it("has a preset for training and e-learning", () => {
    const t = EXPORT_PRESETS.find((p) => p.id === "training")!;
    expect(t.set.scenes).toBe(true);
    expect(t.note).toMatch(/starting point/);
  });
  it("names the destination from plain words", () => {
    expect(presetFromWords("export this as a podcast")?.id).toBe("podcast");
    expect(presetFromWords("deliver it for YouTube")?.id).toBe("youtube");
    expect(presetFromWords("master it for an audiobook")?.id).toBe("audiobook");
    expect(presetFromWords("a game build in Unity")?.id).toBe("game");
    expect(presetFromWords("for our e-learning course")?.id).toBe("training");
    expect(presetFromWords("hand it to an editor")?.id).toBe("editor");
    expect(presetFromWords("keep the villain menacing")).toBeNull();
  });
  it("asks for stems only when it says so", () => {
    expect(asksForStems("with stems")).toBe(true);
    expect(asksForStems("one track for each character")).toBe(true);
    expect(asksForStems("each character on its own track")).toBe(true);
    expect(asksForStems("make it dramatic")).toBe(false);
  });
  it("turns an export instruction into reviewable proposals and never reads a destination from story words", () => {
    const a = interpret("Export this as a podcast with stems.");
    expect(a.proposals.map((p) => p.kind)).toEqual(["delivery", "stems"]);
    expect(a.proposals[0]).toMatchObject({ kind: "delivery", preset: "podcast" });
    const b = interpret("Treat this as a children's animated film.");
    expect(b.proposals.some((p) => p.kind === "delivery")).toBe(false);
    expect(interpret("Make it sound good.").unmatched).toEqual(["Make it sound good."]);
  });
});
