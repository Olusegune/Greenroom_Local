import { describe, expect, it } from "vitest";
import { auditionScripts } from "./auditionScripts";

describe("audition scripts", () => {
  it("give every candidate the same words, in a fixed order", () => {
    const a = auditionScripts({});
    expect(a.map((s) => s.id)).toEqual(["neutral", "emotional", "pronunciation", "expression"]);
    expect(auditionScripts({})).toEqual(a);
  });
  it("add the character's own line and the required language and accent when there are any", () => {
    const a = auditionScripts({ language: "Yoruba", accent: "Nigerian English", characterLine: "Come here, my child." });
    expect(a.map((s) => s.id)).toEqual(["neutral", "emotional", "pronunciation", "character", "language", "accent", "expression"]);
    expect(a.find((s) => s.id === "character")!.text).toBe("Come here, my child.");
  });
  it("say when a line in another language was not checked by a native speaker", () => {
    expect(auditionScripts({ language: "Yoruba" }).find((s) => s.id === "language")!.unchecked).toBe(true);
    expect(auditionScripts({ language: "English" }).some((s) => s.id === "language")).toBe(false);
  });
  it("never claim what a voice can do", () => {
    for (const s of auditionScripts({ language: "French", accent: "Irish" })) expect(s.purpose).not.toMatch(/\b(will|can) (sound|speak) (perfectly|natural)/i);
  });
});
