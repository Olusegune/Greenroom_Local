import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { directorCloud, directorLabel, directorReady } from "./engines";

const none = { kie: false, openai: false, gemini: false };
describe("which AI provider answers the Director", () => {
  it("is ready only when the chosen provider has what it needs", () => {
    expect(directorReady({}, { ...none, kie: true }, false)).toBe(true);
    expect(directorReady({}, { ...none, openai: true }, false)).toBe(false);
    expect(directorReady({ directorEngine: "openai" }, { ...none, openai: true }, false)).toBe(true);
    expect(directorReady({ directorEngine: "openai" }, { ...none, kie: true, gemini: true }, false)).toBe(false);
    expect(directorReady({ directorEngine: "gemini" }, { ...none, gemini: true }, false)).toBe(true);
    expect(directorReady({ directorEngine: "local" }, none, true)).toBe(true);
    expect(directorReady({ directorEngine: "local" }, { kie: true, openai: true, gemini: true }, false)).toBe(false);
  });
  it("sends Kie requests with no model and OpenAI or Gemini ones with the chosen model", () => {
    expect(directorCloud({})).toEqual({ provider: "kie" });
    expect(directorCloud({ directorEngine: "kie", directorModel: "gpt-6-luna" })).toEqual({ provider: "kie" });
    expect(directorCloud({ directorEngine: "openai", directorModel: "gpt-6-luna" })).toEqual({ provider: "openai", model: "gpt-6-luna" });
    expect(directorCloud({ directorEngine: "gemini" })).toEqual({ provider: "gemini", model: undefined });
  });
  it("names the provider in the spend sheet and the ledger", () => {
    expect(directorLabel({})).toBe("a Kie text model");
    expect(directorLabel({ directorEngine: "openai", directorModel: "gpt-6.1-sol" })).toBe("OpenAI (gpt-6.1-sol)");
    expect(directorLabel({ directorEngine: "gemini" })).toMatch(/^Gemini \(/);
    expect(directorLabel({ directorEngine: "local" })).toBe("the local Director");
  });
  it("every cloud request on the Perform screen goes through the one place that picks the provider and says so before spending", () => {
    const s = readFileSync(join(__dirname, "screens", "Perform.tsx"), "utf8");
    expect(s).not.toMatch(/api\.directorComplete\(/);
    expect(s).not.toMatch(/a Kie text model/);
    expect((s.match(/askCloud\(engines,/g) ?? []).length).toBe(4);
    expect((s.match(/confirmSpend\(/g) ?? []).length).toBeGreaterThanOrEqual(4);
  });
});
