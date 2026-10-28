import { describe, expect, it } from "vitest";
import { ALL_ACCENTS, CONTROL, DESIGN_ACCENTS, SAMPLE_TEXT, average, describe as describeVoice, emptySheet, groupKey, groups, letter, parseSheet, reportCsv, reportMd, runSize, type Sheet, type SheetSample } from "./accents";

const s = (id: string, accent: string, o: Partial<SheetSample> = {}): SheetSample => ({ id, accent, gender: "female", description: "d", generatedVoiceId: "g" + id, seconds: 7.25, createdAt: "2026-10-26T10:00:00Z", ...o });

describe("the sheet's fixed inputs", () => {
  it("use one passage that the designer accepts and a description that differs only by accent", () => {
    expect(SAMPLE_TEXT.length).toBeGreaterThanOrEqual(100);
    expect(SAMPLE_TEXT.length).toBeLessThanOrEqual(1000);
    const a = describeVoice(DESIGN_ACCENTS[0]!, "female");
    const b = describeVoice(DESIGN_ACCENTS[1]!, "female");
    expect(a.replace(DESIGN_ACCENTS[0]!.phrase, "X")).toBe(b.replace(DESIGN_ACCENTS[1]!.phrase, "X"));
    expect(describeVoice(CONTROL, "male")).toContain("man");
    for (const x of ALL_ACCENTS) expect(describeVoice(x, "female").length).toBeGreaterThanOrEqual(20);
    expect(new Set(ALL_ACCENTS.map((x) => x.label)).size).toBe(ALL_ACCENTS.length);
  });
  it("count the previews a run will make", () => {
    expect(runSize(11)).toEqual({ calls: 11, previews: 33 });
    expect(runSize(0)).toEqual({ calls: 0, previews: 0 });
  });
});

describe("reading saved data", () => {
  it("keeps only well-formed samples, clamps scores and drops best choices that point nowhere", () => {
    const raw = JSON.stringify({ samples: [s("a", "X", { accentScore: 9, naturalScore: 0.2 }), { id: 5 }, { id: "b", accent: "Y", gender: "other" }, s("c", "X", { note: "n".repeat(900) })], best: { "X|female": "a", "Y|female": "zzz", "Z|male": 3 } });
    const sheet = parseSheet(raw);
    expect(sheet.samples.map((x) => x.id)).toEqual(["a", "c"]);
    expect(sheet.samples[0]).toMatchObject({ accentScore: 5, naturalScore: 1 });
    expect(sheet.samples[1]!.note).toHaveLength(500);
    expect(sheet.best).toEqual({ "X|female": "a" });
  });
  it("returns an empty sheet for damage", () => {
    expect(parseSheet("not json")).toEqual(emptySheet());
    expect(parseSheet("{}")).toEqual(emptySheet());
    expect(parseSheet('{"samples":"x"}').samples).toEqual([]);
  });
});

describe("groups and averages", () => {
  const sheet: Sheet = { version: 1, samples: [s("1", "A"), s("2", "B"), s("3", "A", { gender: "male" }), s("4", "A")], best: {} };
  it("group by accent and voice in the order first made, lettering within a group", () => {
    const g = groups(sheet);
    expect(g.map((x) => [x.key, x.samples.map((y) => y.id)])).toEqual([[groupKey("A", "female"), ["1", "4"]], [groupKey("B", "female"), ["2"]], [groupKey("A", "male"), ["3"]]]);
    expect([letter(0), letter(2)]).toEqual(["A", "C"]);
  });
  it("average only the rated values", () => {
    expect(average([4, undefined, 2])).toBe(3);
    expect(average([undefined])).toBeNull();
    expect(average([])).toBeNull();
  });
});

describe("reports", () => {
  const sheet: Sheet = { version: 1, samples: [s("1", "Yoruba | test", { accentScore: 4, naturalScore: 3, note: "warm,\nnice" }), s("2", "Yoruba | test", { accentScore: 2 }), s("3", "=SUM(A1)", { note: "@bad" })], best: { [groupKey("Yoruba | test", "female")]: "2" } };
  it("write a Markdown summary that says the scores are the listener's and marks the preferred sample", () => {
    const md = reportMd(sheet, "2026-10-26 12:00", "0.12.0");
    expect(md).toContain("Greenroom 0.12.0");
    expect(md).toContain("listener's judgement");
    expect(md).toContain("| Yoruba / test | female | 3.0 | 3.0 | B |");
    expect(md).toContain("- **B** (preferred): accent 2, natural not rated");
    expect(md).toContain(SAMPLE_TEXT);
    expect(reportMd(emptySheet(), "now", "1")).toContain("No samples have been made yet.");
  });
  it("write a CSV that quotes awkward text and cannot run as a spreadsheet formula", () => {
    const csv = reportCsv(sheet);
    expect(csv.startsWith("﻿Accent,Voice,Sample")).toBe(true);
    expect(csv).toContain('Yoruba | test,female,A,,4,3,7.3,"warm,\nnice"');
    expect(csv).toContain("'=SUM(A1)");
    expect(csv).toContain("'@bad");
    expect(csv.split("\r\n").filter(Boolean)).toHaveLength(1 + 3);
  });
});
