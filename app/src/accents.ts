// The accent listening sheet: the same voice description and the same spoken text for every accent, so what differs is
// the accent. Nothing here claims a voice sounds right: the scores are the listener's.

export interface AccentDef {
  label: string;
  /** What the voice designer is told. */
  phrase: string;
}

/** Accents to build into a description. The wording is what the designer model is told; whether it sounds right is for the owner's ear. */
export const DESIGN_ACCENTS: AccentDef[] = [
  { label: "Nigerian English (Yoruba)", phrase: "speaks English with a Yoruba-influenced Nigerian accent" },
  { label: "Nigerian English (Igbo)", phrase: "speaks English with an Igbo-influenced Nigerian accent" },
  { label: "Nigerian English (Hausa)", phrase: "speaks English with a Hausa-influenced Nigerian accent" },
  { label: "Nigerian Pidgin", phrase: "speaks Nigerian Pidgin English with a natural Lagos street rhythm" },
  { label: "Ghanaian English", phrase: "speaks English with a Ghanaian accent" },
  { label: "Filipino English", phrase: "speaks English with a Filipino accent" },
  { label: "Indian English", phrase: "speaks English with an Indian accent" },
  { label: "Jamaican English", phrase: "speaks English with a Jamaican accent" },
  { label: "South African English", phrase: "speaks English with a South African accent" },
  { label: "Scottish English", phrase: "speaks English with a Scottish accent" },
];

/** A reference with no accent asked for, to hear what the designer does by default. */
export const CONTROL: AccentDef = { label: "No accent asked for (control)", phrase: "speaks clear English with no strong regional accent" };

export const ALL_ACCENTS: AccentDef[] = [...DESIGN_ACCENTS, CONTROL];

/** One passage for every sample (the designer needs 100 to 1000 characters). Plain words with a few sounds that differ between accents. */
export const SAMPLE_TEXT = "Good morning, everyone. I am glad you could all come today. Please sit down, make yourselves comfortable, and let me tell you a short story about my village, the river, and the three children who found a little boat.";

export type Gender = "female" | "male";

export function describe(a: AccentDef, gender: Gender): string {
  return `A ${gender === "female" ? "woman" : "man"} in their forties with a warm, clear voice and a natural conversational pace, who ${a.phrase}.`;
}

export const PREVIEWS_PER_ACCENT = 3;

export interface SheetSample {
  id: string;
  accent: string;
  gender: Gender;
  description: string;
  /** ElevenLabs' id for this preview, used to keep it as a voice if it is the one. */
  generatedVoiceId: string;
  seconds: number;
  createdAt: string;
  /** 1 to 5: how convincing the accent is. */
  accentScore?: number;
  /** 1 to 5: how much it sounds like a real person talking. */
  naturalScore?: number;
  note?: string;
  /** Set when this preview was kept as a voice in the library. */
  savedAs?: string;
}

export interface Sheet {
  version: 1;
  samples: SheetSample[];
  /** The preferred sample for each accent and gender, keyed `accent|gender`. */
  best: Record<string, string>;
}

export const emptySheet = (): Sheet => ({ version: 1, samples: [], best: {} });
export const groupKey = (accent: string, gender: Gender) => `${accent}|${gender}`;

const score = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? Math.min(5, Math.max(1, Math.round(v))) : undefined);

/** Reads saved data, keeping only what is well formed, so a damaged file never breaks the screen. */
export function parseSheet(json: string): Sheet {
  try {
    const v = JSON.parse(json) as Partial<Sheet>;
    const samples = (Array.isArray(v.samples) ? v.samples : []).flatMap((s): SheetSample[] => {
      if (!s || typeof s.id !== "string" || typeof s.accent !== "string" || (s.gender !== "female" && s.gender !== "male")) return [];
      return [{ id: s.id, accent: s.accent, gender: s.gender, description: String(s.description ?? ""), generatedVoiceId: String(s.generatedVoiceId ?? ""), seconds: Number(s.seconds) || 0, createdAt: String(s.createdAt ?? ""), accentScore: score(s.accentScore), naturalScore: score(s.naturalScore), note: typeof s.note === "string" ? s.note.slice(0, 500) : undefined, savedAs: typeof s.savedAs === "string" ? s.savedAs : undefined }];
    });
    const ids = new Set(samples.map((s) => s.id));
    const best: Record<string, string> = {};
    for (const [k, id] of Object.entries(v.best ?? {})) if (typeof id === "string" && ids.has(id)) best[k] = id;
    return { version: 1, samples, best };
  } catch {
    return emptySheet();
  }
}

export interface Group {
  key: string;
  accent: string;
  gender: Gender;
  samples: SheetSample[];
}

/** Samples grouped by accent and gender, in the order they were first made. A, B and C are the order within a group. */
export function groups(sheet: Sheet): Group[] {
  const out: Group[] = [];
  for (const s of sheet.samples) {
    const key = groupKey(s.accent, s.gender);
    let g = out.find((x) => x.key === key);
    if (!g) out.push((g = { key, accent: s.accent, gender: s.gender, samples: [] }));
    g.samples.push(s);
  }
  return out;
}

export const letter = (i: number) => String.fromCharCode(65 + i);

export function average(values: (number | undefined)[]): number | null {
  const v = values.filter((x): x is number => typeof x === "number");
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** How many previews and how many designer calls a run of these accents makes. */
export function runSize(accentCount: number): { calls: number; previews: number } {
  return { calls: accentCount, previews: accentCount * PREVIEWS_PER_ACCENT };
}

const fmt = (n: number | null) => (n === null ? "not rated" : n.toFixed(1));

/** The sheet as a Markdown report. Scores are the listener's; the report says so. */
export function reportMd(sheet: Sheet, now: string, appVersion: string): string {
  const L: string[] = ["# Accent listening sheet", "", `Made by Greenroom ${appVersion} on ${now}. The same description and the same text were used for every accent. Scores are the listener's judgement, 1 (poor) to 5 (excellent); Greenroom makes no claim that any voice has an authentic accent.`, ""];
  const gs = groups(sheet);
  if (gs.length === 0) return L.concat("No samples have been made yet.", "").join("\n");
  L.push("## Summary", "", "| Accent | Voice | Accent score | Natural score | Preferred |", "|---|---|---|---|---|");
  for (const g of gs) {
    const best = sheet.best[g.key];
    const bi = g.samples.findIndex((s) => s.id === best);
    L.push(`| ${esc(g.accent)} | ${g.gender} | ${fmt(average(g.samples.map((s) => s.accentScore)))} | ${fmt(average(g.samples.map((s) => s.naturalScore)))} | ${bi >= 0 ? letter(bi) : "none chosen"} |`);
  }
  L.push("", "## Samples", "");
  for (const g of gs) {
    L.push(`### ${esc(g.accent)} (${g.gender})`, "");
    g.samples.forEach((s, i) => L.push(`- **${letter(i)}**${sheet.best[g.key] === s.id ? " (preferred)" : ""}: accent ${s.accentScore ?? "not rated"}, natural ${s.naturalScore ?? "not rated"}${s.note ? `, note: ${esc(s.note)}` : ""}${s.savedAs ? ", kept as a voice" : ""}`));
    L.push("");
  }
  L.push("## What was said", "", `> ${SAMPLE_TEXT}`, "");
  return L.join("\n");
}

function esc(s: string): string {
  return s.replace(/\|/g, "/").replace(/[\r\n]+/g, " ");
}

function cell(v: string | number | undefined): string {
  let t = String(v ?? "");
  // A cell that starts like a formula would be run by a spreadsheet; a leading apostrophe keeps it as text.
  if (/^[=+\-@\t\r]/.test(t)) t = "'" + t;
  return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

export function reportCsv(sheet: Sheet): string {
  const rows = ["Accent,Voice,Sample,Preferred,Accent score,Natural score,Seconds,Note,Made"];
  for (const g of groups(sheet)) {
    g.samples.forEach((s, i) => rows.push([g.accent, g.gender, letter(i), sheet.best[g.key] === s.id ? "yes" : "", s.accentScore ?? "", s.naturalScore ?? "", s.seconds.toFixed(1), s.note ?? "", s.createdAt].map(cell).join(",")));
  }
  return "﻿" + rows.join("\r\n") + "\r\n";
}
