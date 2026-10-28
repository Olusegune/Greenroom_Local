import { describe, expect, it } from "vitest";
import { buildReport, CLIPS, countByProvider, characters, type Result } from "./lab";

describe("lab clips", () => {
  it("has unique ids and non-empty text within the provider limits", () => {
    expect(new Set(CLIPS.map((c) => c.id)).size).toBe(CLIPS.length);
    for (const c of CLIPS) expect(c.text.length).toBeGreaterThan(0);
  });
  it("counts clips and characters per provider", () => {
    const rows = countByProvider(CLIPS);
    expect(rows.reduce((n, r) => n + r.n, 0)).toBe(CLIPS.length);
    expect(rows.reduce((n, r) => n + r.chars, 0)).toBe(characters(CLIPS));
  });
});

describe("report", () => {
  it("lists rated clips, failures and averages, and escapes table pipes", () => {
    const a = CLIPS.find((c) => c.id === "eleven-tts:plain")!;
    const b = CLIPS.find((c) => c.id === "eleven-tts:laugh")!;
    const results: Record<string, Result> = {
      [a.id]: { state: "done", rating: 4, ms: 2400, note: "good | warm" },
      [b.id]: { state: "error", error: "ElevenLabs did not accept the key | check" },
    };
    const md = buildReport(results, "2026-10-26");
    expect(md).toContain("| 4 | 2.4s | good / warm |");
    expect(md).toContain("failed: ElevenLabs did not accept the key / check");
    expect(md).toContain("ElevenLabs v3: 4.0 over 1 clips");
  });
  it("says so when nothing is rated", () => {
    expect(buildReport({}, "2026-10-26")).toContain("Nothing rated yet.");
  });
});
