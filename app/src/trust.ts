// Studio trust: what produced each take, who agreed to each voice, what it cost, and the reports that say so.
// This is a record, not a gate. It warns and explains; it never stops the owner from working.

import { fmtTime, planTimeline } from "./audio";
import { chosenTake } from "./direct";
import { ENGINES, type Engine, type Prices } from "./engines";
import type { Consent, ConsentBasis, LedgerEntry, LicenceUse, Project, VoiceEntry } from "./types";

export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes);
  const d = await crypto.subtle.digest("SHA-256", copy);
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const shortHash = (h?: string) => (h ? h.slice(0, 12) : "none");

// ---- cost -----------------------------------------------------------------------------------------------------

export type SpendItem = { kind: "speech"; engine: Engine; chars: number } | { kind: "sound"; count: number } | { kind: "director" } | { kind: "design"; count: number } | { kind: "music" };

export interface Estimate {
  cost: number;
  /** False when something in the list has no price set, so the cost shown is a lower bound. */
  priced: boolean;
}

export function estimateCost(prices: Prices, items: SpendItem[]): Estimate {
  let cost = 0;
  let priced = true;
  for (const it of items) {
    let unit: number | undefined;
    let amount = 1;
    if (it.kind === "speech") {
      if (ENGINES[it.engine].local) continue;
      unit = prices.perKChars[it.engine];
      amount = it.chars / 1000;
    } else if (it.kind === "sound") {
      unit = prices.sfxClip;
      amount = it.count;
    } else if (it.kind === "director") {
      unit = prices.directorCall;
    } else if (it.kind === "music") {
      unit = prices.musicRun;
    } else {
      unit = prices.designPreview;
      amount = it.count;
    }
    if (unit && unit > 0) cost += unit * amount;
    else priced = false;
  }
  return { cost, priced };
}

/** Two decimals, or four for amounts under 0.10 so a small cost does not read as zero. */
export const money = (n: number, currency: string) => `${(n > 0 && n < 0.1 ? n.toFixed(4) : n.toFixed(2))} ${currency}`;

export const ledgerTotal = (ledger: LedgerEntry[] = []) => ledger.reduce((s, e) => s + e.cost, 0);

export function ledgerByEngine(ledger: LedgerEntry[] = []): { engine: string; count: number; chars: number; cost: number }[] {
  const m = new Map<string, { engine: string; count: number; chars: number; cost: number }>();
  for (const e of ledger) {
    const r = m.get(e.engine) ?? { engine: e.engine, count: 0, chars: 0, cost: 0 };
    r.count += 1;
    r.chars += e.chars;
    r.cost += e.cost;
    m.set(e.engine, r);
  }
  return [...m.values()].sort((a, b) => b.cost - a.cost || b.chars - a.chars);
}

export interface BudgetView {
  budget: number | null;
  spent: number;
  after: number;
  over: boolean;
  left: number | null;
}

export function budgetView(budget: number | undefined, ledger: LedgerEntry[] | undefined, adding: number): BudgetView {
  const spent = ledgerTotal(ledger);
  const b = budget && budget > 0 ? budget : null;
  const after = spent + adding;
  return { budget: b, spent, after, over: b !== null && after > b + 1e-9, left: b === null ? null : b - spent };
}

/** The lines added to a confirmation sheet, and a warning if the work would pass the budget. */
export function spendLines(prices: Prices, items: SpendItem[], budget: number | undefined, ledger: LedgerEntry[] | undefined): { lines: string[]; warn?: string } {
  const est = estimateCost(prices, items);
  const lines: string[] = [];
  const anyPaid = items.some((i) => i.kind !== "speech" || !ENGINES[i.engine].local);
  if (!anyPaid) return { lines };
  if (est.cost > 0) lines.push(`Estimated cost: ${money(est.cost, prices.currency)}${est.priced ? "" : " or more (some prices are not set)"}`);
  else lines.push("Cost unknown: set your prices in Studio to see an estimate.");
  const v = budgetView(budget, ledger, est.cost);
  if (v.budget !== null) lines.push(`Budget: ${money(v.spent, prices.currency)} spent of ${money(v.budget, prices.currency)}`);
  return { lines, warn: v.over ? `This would take the project to about ${money(v.after, prices.currency)}, over your ${money(v.budget!, prices.currency)} budget.` : undefined };
}

// ---- rights ---------------------------------------------------------------------------------------------------

export const BASIS_LABEL: Record<ConsentBasis, string> = {
  self: "It is my own voice",
  permission: "I have the speaker's written permission",
  licence: "Licensed from the speaker or their agent",
  designed: "Designed from a description (no real person)",
  other: "Other (explain in the reference)",
};

export const LICENCE_LABEL: Record<LicenceUse, string> = {
  unknown: "Not noted yet",
  commercial: "Cleared for commercial use",
  personal: "Personal use only",
};

export type RightsLevel = "clear" | "review" | "missing";

export interface RightsRow {
  voiceId: string;
  name: string;
  engine: Engine;
  source: VoiceEntry["source"];
  level: RightsLevel;
  issues: string[];
  consent?: Consent;
  licence: LicenceUse;
  licenceNote: string;
  usedBy: string[];
}

export function rightsFor(v: VoiceEntry, usedBy: string[]): RightsRow {
  const issues: string[] = [];
  let level: RightsLevel = "clear";
  const licence = v.licence ?? "unknown";
  if (v.source === "cloned" && !v.consent) {
    level = "missing";
    issues.push("No consent record for this cloned voice. Add who it belongs to and the basis for using it.");
  }
  if (v.consent?.basis === "other" && !v.consent.reference.trim()) {
    if (level === "clear") level = "review";
    issues.push("The consent basis is Other with no reference to explain it.");
  }
  if (licence === "personal") {
    if (level === "clear") level = "review";
    issues.push("Marked personal use only: not for a commercial release.");
  } else if (licence === "unknown" && v.source !== "designed" && !v.consent) {
    if (level === "clear") level = "review";
    issues.push(ENGINES[v.provider].local ? "Check the voice's own licence (its model card)." : "Commercial-use status not noted. Check the engine's terms for this voice.");
  }
  return { voiceId: v.id, name: v.name, engine: v.provider, source: v.source, level, issues, consent: v.consent, licence, licenceNote: v.licenceNote ?? "", usedBy };
}

/** The voices a project actually uses, with who speaks with each. */
export function projectRights(project: Pick<Project, "characters" | "lines">, library: VoiceEntry[]): RightsRow[] {
  const used = new Set(project.lines.map((l) => l.characterId));
  const rows: RightsRow[] = [];
  for (const v of library) {
    const by = project.characters.filter((c) => used.has(c.id) && c.voiceId === v.id).map((c) => c.name);
    if (by.length) rows.push(rightsFor(v, by));
  }
  return rows;
}

export function rightsSummary(rows: RightsRow[]) {
  return { clear: rows.filter((r) => r.level === "clear").length, review: rows.filter((r) => r.level === "review").length, missing: rows.filter((r) => r.level === "missing").length };
}

const csvCell = (v: string | number): string => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function rightsCsv(rows: RightsRow[]): string {
  const head = ["Voice", "Engine", "Source", "Used by", "Status", "Consent: speaker", "Consent: basis", "Consent: reference", "Consent: date", "Commercial use", "Licence note", "Issues"];
  const body = rows.map((r) => [r.name, ENGINES[r.engine].label, r.source, r.usedBy.join("; "), r.level, r.consent?.speaker ?? "", r.consent ? BASIS_LABEL[r.consent.basis] : "", r.consent?.reference ?? "", r.consent?.date ?? "", LICENCE_LABEL[r.licence], r.licenceNote, r.issues.join(" ")].map(csvCell).join(","));
  return "﻿" + [head.map(csvCell).join(","), ...body].join("\r\n") + "\r\n";
}

// ---- production report ----------------------------------------------------------------------------------------

export interface ReportInput {
  project: Project;
  library: VoiceEntry[];
  prices: Prices;
  appVersion: string;
  now: string;
}

const esc = (s: string) => s.replace(/\|/g, "/").replace(/\r?\n/g, " ");

/** A plain document a producer or legal team can read: what was made, with which AI voices, on what rights, at what cost. */
export function productionReportMd({ project, library, prices, appVersion, now }: ReportInput): string {
  const plan = planTimeline(project);
  const rows = projectRights(project, library);
  const sum = rightsSummary(rows);
  const byEngine = ledgerByEngine(project.ledger);
  const total = ledgerTotal(project.ledger);
  const L: string[] = [];
  L.push(`# Production report: ${project.name}`, "", `Generated ${now} by Greenroom ${appVersion}.`, "");
  L.push("## Summary", "", `- Spoken lines: ${project.lines.length} (${plan.spans.length} with a chosen take)`, `- Scenes: ${project.scenes.length}`, `- Running time: about ${fmtTime(plan.total)}`, `- Characters: ${project.characters.filter((c) => project.lines.some((l) => l.characterId === c.id)).map((c) => c.name).join(", ") || "none"}`, "");
  L.push("## AI disclosure", "", "The speech in this production was generated by artificial-intelligence voice engines from the script text. No recording of a real performance is included except where a cloned voice is listed below with its consent record. Sound clips and atmosphere were generated by an AI sound-effects model.", "");
  L.push("## Voices and rights", "");
  if (rows.length === 0) L.push("No voices are used yet.", "");
  else {
    L.push(`Status: ${sum.clear} clear, ${sum.review} to review, ${sum.missing} missing a consent record.`, "", "| Voice | Engine | Used by | Source | Consent | Commercial use | Status |", "|---|---|---|---|---|---|---|");
    for (const r of rows) L.push(`| ${esc(r.name)} | ${ENGINES[r.engine].label} | ${esc(r.usedBy.join(", "))} | ${r.source} | ${r.consent ? esc(`${r.consent.speaker}: ${BASIS_LABEL[r.consent.basis]}${r.consent.reference ? " (" + r.consent.reference + ")" : ""}`) : "none recorded"} | ${LICENCE_LABEL[r.licence]}${r.licenceNote ? " (" + esc(r.licenceNote) + ")" : ""} | ${r.level} |`);
    const issues = rows.filter((r) => r.issues.length);
    if (issues.length) L.push("", "### Items to review", ...issues.flatMap((r) => r.issues.map((i) => `- **${esc(r.name)}**: ${i}`)));
    L.push("");
  }
  const music = project.music ?? [];
  L.push("## Music and imported audio", "");
  if (music.length === 0) L.push("No music or imported audio is used.", "");
  else {
    L.push("| Name | Length used | Level | Ducks under dialogue | File fingerprint | Source and licence |", "|---|---|---|---|---|---|");
    for (const m of music) L.push(`| ${esc(m.name)} | ${m.length.toFixed(1)} s | ${m.gainDb.toFixed(1)} dB | ${m.duck ? "yes" : "no"} | ${shortHash(m.take.sha256)} | ${m.source.trim() ? esc(m.source) : "not noted: check the rights before release"} |`);
    L.push("");
  }
  L.push("## Cost", "");
  if (byEngine.length === 0) L.push("Nothing has been generated with a paid engine in this project yet.", "");
  else {
    L.push("Estimates from the prices entered in Greenroom. Greenroom cannot see real invoices: check the providers' own billing pages.", "", `| Engine | Requests | Characters | Estimated cost (${prices.currency}) |`, "|---|---|---|---|");
    for (const e of byEngine) L.push(`| ${esc(e.engine)} | ${e.count} | ${e.chars} | ${e.cost > 0 ? e.cost.toFixed(2) : "price not set"} |`);
    L.push("", `Total estimated: ${money(total, prices.currency)}${project.budget ? ` of a ${money(project.budget, prices.currency)} budget` : ""}.`, "");
  }
  L.push("## Takes used in the mix", "", "| # | Character | Voice | Engine / model | Quality | Created | SHA-256 (first 12) | Sent to the voice |", "|---|---|---|---|---|---|---|---|");
  project.lines.forEach((l, i) => {
    const t = chosenTake(l);
    if (!t) return;
    const who = project.characters.find((c) => c.id === l.characterId)?.name ?? "";
    const p = t.provenance;
    L.push(`| ${i + 1} | ${esc(who)} | ${esc(p?.voiceName ?? t.voiceId)} | ${p ? ENGINES[p.engine].label : "unknown"} / ${t.model} | ${p?.quality ?? "n/a"} | ${t.at.slice(0, 19).replace("T", " ")} | ${shortHash(p?.sha256)} | ${esc(t.sent).slice(0, 140)} |`);
  });
  L.push("", "## Notes", "", "- A take's SHA-256 is the fingerprint of the audio file as it was saved. If a file in the project folder changes, its fingerprint no longer matches.", "- Per-line level, loudness and stems are applied on export and are not part of the original takes.", "");
  return L.join("\n");
}
