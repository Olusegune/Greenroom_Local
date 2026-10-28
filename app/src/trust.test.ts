import { describe, expect, it } from "vitest";
import { DEFAULT_PRICES } from "./engines";
import { budgetView, estimateCost, money, ledgerByEngine, ledgerTotal, productionReportMd, projectRights, rightsCsv, rightsFor, rightsSummary, sha256Hex, shortHash, spendLines } from "./trust";
import { DEFAULT_DIRECTION, newProject, type LedgerEntry, type Project, type VoiceEntry } from "./types";

const prices = { ...DEFAULT_PRICES, currency: "USD", perKChars: { elevenlabs: 0.2, voicekiller: 0.1 }, sfxClip: 0.05, directorCall: 0.02, designPreview: 0.1 };
const voice = (o: Partial<VoiceEntry> = {}): VoiceEntry => ({ id: "v1", name: "Ada", provider: "elevenlabs", source: "library", language: "en", accent: "", gender: "", notes: "", createdAt: "", ...o });

describe("sha256", () => {
  it("matches the known value for abc", async () => {
    expect(await sha256Hex(new TextEncoder().encode("abc"))).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(shortHash("ba7816bf8f01cfea")).toBe("ba7816bf8f01");
    expect(shortHash(undefined)).toBe("none");
  });
});

describe("cost estimates", () => {
  it("price speech by the thousand characters and the other work by the item", () => {
    const e = estimateCost(prices, [{ kind: "speech", engine: "elevenlabs", chars: 2500 }, { kind: "sound", count: 2 }, { kind: "director" }, { kind: "design", count: 3 }]);
    expect(e.cost).toBeCloseTo(0.5 + 0.1 + 0.02 + 0.3, 6);
    expect(e.priced).toBe(true);
  });
  it("price a music request by the request, and flag it when no price is set", () => {
    expect(estimateCost({ ...prices, musicRun: 0.5 }, [{ kind: "music" }, { kind: "music" }])).toEqual({ cost: 1, priced: true });
    expect(estimateCost(prices, [{ kind: "music" }])).toEqual({ cost: 0, priced: false });
  });
  it("counts offline engines as free and flags unknown prices as a lower bound", () => {
    expect(estimateCost(prices, [{ kind: "speech", engine: "piper", chars: 99999 }])).toEqual({ cost: 0, priced: true });
    const e = estimateCost(prices, [{ kind: "speech", engine: "kie", chars: 1000 }, { kind: "speech", engine: "elevenlabs", chars: 1000 }]);
    expect(e.priced).toBe(false);
    expect(e.cost).toBeCloseTo(0.2, 6);
  });
});

describe("money", () => {
  it("keeps small amounts visible", () => {
    expect(money(0.0036, "USD")).toBe("0.0036 USD");
    expect(money(0, "USD")).toBe("0.00 USD");
    expect(money(12.5, "EUR")).toBe("12.50 EUR");
    expect(money(0.1, "USD")).toBe("0.10 USD");
  });
});

describe("budget", () => {
  const ledger: LedgerEntry[] = [
    { at: "", kind: "speech", engine: "ElevenLabs", chars: 1000, cost: 0.2 },
    { at: "", kind: "speech", engine: "ElevenLabs", chars: 500, cost: 0.1 },
    { at: "", kind: "sound", engine: "ElevenLabs", chars: 20, cost: 0.05 },
    { at: "", kind: "speech", engine: "VoiceKiller", chars: 400, cost: 0 },
  ];
  it("adds up the ledger and groups it by engine", () => {
    expect(ledgerTotal(ledger)).toBeCloseTo(0.35, 6);
    expect(ledgerTotal(undefined)).toBe(0);
    const g = ledgerByEngine(ledger);
    expect(g[0]).toMatchObject({ engine: "ElevenLabs", count: 3, chars: 1520 });
    expect(g[1]).toMatchObject({ engine: "VoiceKiller", count: 1, chars: 400 });
  });
  it("says how much is left and whether the next job goes over", () => {
    expect(budgetView(1, ledger, 0.5).over).toBe(false);
    expect(budgetView(1, ledger, 0.5).left).toBeCloseTo(0.65, 6);
    expect(budgetView(1, ledger, 0.7).over).toBe(true);
    expect(budgetView(undefined, ledger, 100)).toMatchObject({ budget: null, over: false, left: null });
    expect(budgetView(0, ledger, 100).budget).toBeNull();
  });
  it("writes the lines for a confirmation sheet, with a warning only when over budget", () => {
    const ok = spendLines(prices, [{ kind: "speech", engine: "elevenlabs", chars: 1000 }], 5, ledger);
    expect(ok.lines[0]).toBe("Estimated cost: 0.20 USD");
    expect(ok.lines[1]).toContain("Budget: 0.35 USD spent of 5.00 USD");
    expect(ok.warn).toBeUndefined();
    const over = spendLines(prices, [{ kind: "speech", engine: "elevenlabs", chars: 10000 }], 1, ledger);
    expect(over.warn).toContain("over your 1.00 USD budget");
    expect(spendLines(prices, [{ kind: "speech", engine: "piper", chars: 5000 }], 1, ledger)).toEqual({ lines: [] });
    expect(spendLines(DEFAULT_PRICES, [{ kind: "speech", engine: "elevenlabs", chars: 1000 }], undefined, [])).toEqual({ lines: ["Cost unknown: set your prices in Studio to see an estimate."], warn: undefined });
  });
});

describe("rights", () => {
  it("require a consent record for a cloned voice", () => {
    const r = rightsFor(voice({ source: "cloned" }), ["ADA"]);
    expect(r.level).toBe("missing");
    expect(r.issues[0]).toContain("No consent record");
    const ok = rightsFor(voice({ source: "cloned", consent: { speaker: "Mum", basis: "self", reference: "", date: "2026-10-26" } }), ["ADA"]);
    expect(ok.level).toBe("clear");
  });
  it("ask for a reference when the basis is Other, and flag personal-use voices", () => {
    expect(rightsFor(voice({ source: "cloned", consent: { speaker: "X", basis: "other", reference: " ", date: "" } }), []).level).toBe("review");
    const p = rightsFor(voice({ licence: "personal" }), []);
    expect(p.level).toBe("review");
    expect(p.issues[0]).toContain("personal use only");
  });
  it("treat designed voices and cleared voices as clear, and unknown library voices as review", () => {
    expect(rightsFor(voice({ source: "designed" }), []).level).toBe("clear");
    expect(rightsFor(voice({ licence: "commercial" }), []).level).toBe("clear");
    expect(rightsFor(voice(), []).level).toBe("review");
    expect(rightsFor(voice({ provider: "piper" }), []).issues[0]).toContain("model card");
  });
  it("list only the voices a project uses, with who speaks with them", () => {
    const p = newProject("p", "T", "");
    p.characters = [{ id: "c1", name: "ADA", language: "English", voiceId: "v1" }, { id: "c2", name: "BO", language: "English", voiceId: "v2" }, { id: "c3", name: "UNUSED", language: "English", voiceId: "v3" }];
    p.lines = [{ id: "l1", characterId: "c1", scene: 0, text: "x", direction: { ...DEFAULT_DIRECTION }, takes: [], events: [] }, { id: "l2", characterId: "c2", scene: 0, text: "y", direction: { ...DEFAULT_DIRECTION }, takes: [], events: [] }];
    const rows = projectRights(p, [voice({ id: "v1", name: "A" }), voice({ id: "v2", name: "B", source: "cloned" }), voice({ id: "v3", name: "C" })]);
    expect(rows.map((r) => [r.name, r.usedBy.join(), r.level])).toEqual([["A", "ADA", "review"], ["B", "BO", "missing"]]);
    expect(rightsSummary(rows)).toEqual({ clear: 0, review: 1, missing: 1 });
  });
  it("write a CSV with the issues", () => {
    const csv = rightsCsv([rightsFor(voice({ source: "cloned", name: 'Mum, "M"' }), ["ADA"])]);
    expect(csv.startsWith("﻿Voice,Engine")).toBe(true);
    expect(csv).toContain('"Mum, ""M"""');
    expect(csv).toContain("missing");
  });
});

describe("production report", () => {
  function project(): Project {
    const p = newProject("p1", "Late Delivery", "2026-10-26");
    p.characters = [{ id: "c1", name: "ADA", language: "English", voiceId: "v1" }];
    p.budget = 5;
    p.ledger = [{ at: "", kind: "speech", engine: "ElevenLabs", chars: 1200, cost: 0.24 }];
    p.lines = [{ id: "l1", characterId: "c1", scene: 0, text: "Hello | there", direction: { ...DEFAULT_DIRECTION }, takes: [{ id: "t1", at: "2026-10-26T10:00:00.000Z", model: "eleven_v4", ext: "mp3", voiceId: "v1", sent: "[sighs] Hello | there", seconds: 2, provenance: { engine: "elevenlabs", voiceName: "Ada", quality: "mp3_44100_128", speed: 1, chars: 20, sha256: "abcdef0123456789abcdef", appVersion: "0.6.0", emotion: "", sounds: [], note: "", pronunciations: 0 } }], events: [] }];
    return p;
  }
  it("tells a producer what was made, with which voices and rights, at what cost", () => {
    const md = productionReportMd({ project: project(), library: [voice({ source: "cloned" })], prices, appVersion: "0.6.0", now: "2026-10-26 12:00" });
    expect(md).toContain("# Production report: Late Delivery");
    expect(md).toContain("Greenroom 0.6.0");
    expect(md).toContain("## AI disclosure");
    expect(md).toContain("1 missing a consent record");
    expect(md).toContain("No consent record for this cloned voice");
    expect(md).toContain("Total estimated: 0.24 USD of a 5.00 USD budget");
    expect(md).toContain("abcdef012345");
    expect(md).toContain("[sighs] Hello / there");
    expect(md).not.toContain("Hello | there");
  });
  it("says so plainly when nothing has been generated or used", () => {
    const empty = newProject("p2", "Empty", "");
    const md = productionReportMd({ project: empty, library: [], prices, appVersion: "0.6.0", now: "now" });
    expect(md).toContain("No voices are used yet.");
    expect(md).toContain("Nothing has been generated with a paid engine");
  });
});

describe("production report: music", () => {
  it("lists imported music with its fingerprint and says plainly when no licence is noted", () => {
    const p = newProject("p3", "Scored", "");
    p.music = [
      { id: "m1", name: "Theme | main", take: { id: "t", ext: "mp3", seconds: 30, sha256: "abcdef0123456789abcdef" }, start: 0, gainDb: -6, fadeIn: 0, fadeOut: 1, trimIn: 0, length: 30, duck: true, source: "Licensed from Studio X, invoice 41" },
      { id: "m2", name: "Stinger", take: { id: "t2", ext: "wav", seconds: 3 }, start: 5, gainDb: 0, fadeIn: 0, fadeOut: 0, trimIn: 0, length: 3, duck: false, source: " " },
    ];
    const md = productionReportMd({ project: p, library: [], prices, appVersion: "0.8.0", now: "now" });
    expect(md).toContain("## Music and imported audio");
    expect(md).toContain("| Theme / main | 30.0 s | -6.0 dB | yes | abcdef012345 | Licensed from Studio X, invoice 41 |");
    expect(md).toContain("| Stinger | 3.0 s | 0.0 dB | no | none | not noted: check the rights before release |");
    expect(productionReportMd({ project: newProject("p4", "Plain", ""), library: [], prices, appVersion: "0.8.0", now: "now" })).toContain("No music or imported audio is used.");
  });
});
