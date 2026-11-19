import { describe, expect, it } from "vitest";
import { KIE_DEFAULT_VOICE, KIE_VOICES } from "./engines";
describe("Kie voices", () => {
  it("lists exactly Kie's 83 voices, each once, with the standard built-in voices first and George as the default", () => {
    expect(KIE_VOICES).toHaveLength(83);
    expect(new Set(KIE_VOICES.map((v) => v.id)).size).toBe(83);
    expect(KIE_VOICES.slice(0, 16).map((v) => v.name)).toContain("George");
    expect(KIE_VOICES.find((v) => v.id === KIE_DEFAULT_VOICE)?.name).toBe("George");
    expect(KIE_VOICES.every((v) => /^[A-Za-z0-9]{20}$/.test(v.id))).toBe(true);
  });
});
