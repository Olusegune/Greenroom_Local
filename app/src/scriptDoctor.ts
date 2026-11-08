// Script Doctor: suggestions about how a script will be spoken. It only ever SUGGESTS. Nothing here changes the script;
// a change happens when the owner presses Apply on one suggestion, and the original wording is shown beside it.
// It has no pronunciation lexicon, so it cannot say how a name is pronounced: it finds names and sounds that likely need
// a spoken form and asks the owner to supply one. It does not offer IPA because none of Greenroom's engines documents it.

import type { Line, Pronunciation } from "./types";

export type FindingKind = "breath" | "pronunciation" | "emphasis" | "rhythm";

export interface Finding {
  id: string;
  kind: FindingKind;
  lineId: string;
  message: string;
  /** A rewrite of the line the owner can apply. The original is never changed until they do. */
  rewrite?: string;
  /** A word that probably needs a spoken form. */
  word?: string;
}

const MAX_GROUP_WORDS = 14;
const CONJUNCTIONS = new Set(["and", "but", "because", "so", "which", "that", "when", "while", "until", "then", "although", "if", "or"]);
const COMMON_CAPS = new Set(["i", "i'm", "i'll", "i've", "i'd", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday", "january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december", "mr", "mrs", "ms", "dr", "english", "god", "christmas", "okay", "ok"]);

const words = (t: string) => t.split(/\s+/).filter(Boolean);
const clean = (w: string) => w.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}'’-]+$/gu, "");
const plain = (text: string) => text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();

/** Stretches of speech between punctuation, with the character offsets where each starts. A long one leaves the actor no place to breathe. */
export function breathGroups(text: string): { text: string; start: number; words: number }[] {
  const out: { text: string; start: number; words: number }[] = [];
  const re = /[^,;:.!?…—–]+[,;:.!?…—–]*/g;
  for (const m of text.matchAll(re)) {
    const t = m[0];
    const n = words(plain(t)).length;
    if (n > 0) out.push({ text: t, start: m.index ?? 0, words: n });
  }
  return out;
}

/** Where to add a comma in a long breath group: before the conjunction nearest the middle, leaving at least four words on each side. */
function splitPoint(group: string, offset: number): number | null {
  const ws = [...group.matchAll(/\S+/g)];
  const mid = ws.length / 2;
  let best: { i: number; d: number } | null = null;
  ws.forEach((w, i) => {
    if (i < 4 || i > ws.length - 4) return;
    if (!CONJUNCTIONS.has(clean(w[0]).toLowerCase())) return;
    const d = Math.abs(i - mid);
    if (!best || d < best.d) best = { i, d };
  });
  if (!best) return null;
  const w = ws[(best as { i: number }).i]!;
  const before = group.slice(0, w.index ?? 0);
  return /[,;:]\s*$/.test(before) ? null : offset + (w.index ?? 0);
}

function breath(line: Line): Finding[] {
  const out: Finding[] = [];
  for (const g of breathGroups(line.text)) {
    if (g.words <= MAX_GROUP_WORDS) continue;
    const at = splitPoint(g.text, g.start);
    const rewrite = at === null ? undefined : `${line.text.slice(0, at).replace(/\s+$/, "")}, ${line.text.slice(at).replace(/^\s+/, "")}`;
    out.push({ id: `${line.id}:breath:${g.start}`, kind: "breath", lineId: line.id, message: `${g.words} words with no pause. ${rewrite ? "A comma before the conjunction gives a breath." : "Consider a pause or a shorter phrase here."}`, rewrite });
  }
  return out;
}

function pronunciation(line: Line, rules: Pronunciation[], seen: Set<string>): Finding[] {
  const have = new Set(rules.map((r) => r.from.trim().toLowerCase()));
  const out: Finding[] = [];
  const ws = words(plain(line.text));
  ws.forEach((raw, i) => {
    const w = clean(raw);
    const lw = w.toLowerCase();
    if (w.length < 2 || have.has(lw) || seen.has(lw) || COMMON_CAPS.has(lw)) return;
    const startsSentence = i === 0 || /[.!?…]$/.test(ws[i - 1]!);
    const name = /^\p{Lu}\p{Ll}{2,}/u.test(w) && !startsSentence;
    const acronym = /^\p{Lu}{2,}$/u.test(w);
    const accented = /[À-ɏ]/.test(w);
    const mixed = /\d/.test(w) && /\p{L}/u.test(w);
    const odd = /['’-]/.test(w.slice(1, -1)) && /\p{Lu}/u.test(w) && !/^[A-Z][a-z]+'(s|t|re|ve|ll|d|m)$/.test(w);
    if (!(name || acronym || accented || mixed || odd)) return;
    seen.add(lw);
    const why = acronym ? "an abbreviation (letters or a word?)" : mixed ? "letters and numbers" : accented ? "an accented word" : "a name";
    out.push({ id: `${line.id}:pron:${lw}`, kind: "pronunciation", lineId: line.id, word: w, message: `"${w}" looks like ${why}. If the voice may say it wrongly, add how it should be spoken.` });
  });
  return out;
}

/** "not X but Y", "never X" and "only X": the word the sentence turns on. Suggested as capitals, which Inworld documents as emphasis. */
function emphasis(line: Line): Finding[] {
  const m = /\bnot\s+([\p{L}']+)[^.!?]*?\bbut\s+([\p{L}']+)/iu.exec(line.text);
  if (!m) return [];
  const target = m[2]!;
  if (target === target.toUpperCase()) return [];
  const idx = (m.index ?? 0) + m[0].toLowerCase().lastIndexOf(target.toLowerCase());
  const rewrite = line.text.slice(0, idx) + target.toUpperCase() + line.text.slice(idx + target.length);
  return [{ id: `${line.id}:emph:${target.toLowerCase()}`, kind: "emphasis", lineId: line.id, word: target, message: `The line turns on "${target}". Capital letters mark emphasis on Inworld voices; other voices may read them as shouting, so use this only with Inworld.`, rewrite }];
}

export interface Rhythm {
  sentences: number;
  averageWords: number;
  longest: number;
  shortest: number;
  /** Many sentences of nearly the same length read as a drone. */
  monotone: boolean;
}

export function rhythm(lines: Pick<Line, "text">[]): Rhythm {
  const counts = lines.flatMap((l) => plain(l.text).split(/(?<=[.!?…])\s+/).map((s) => words(s).length)).filter((n) => n > 0);
  if (counts.length === 0) return { sentences: 0, averageWords: 0, longest: 0, shortest: 0, monotone: false };
  const avg = counts.reduce((a, b) => a + b, 0) / counts.length;
  const sd = Math.sqrt(counts.reduce((a, b) => a + (b - avg) * (b - avg), 0) / counts.length);
  return { sentences: counts.length, averageWords: Number(avg.toFixed(1)), longest: Math.max(...counts), shortest: Math.min(...counts), monotone: counts.length >= 6 && sd < 1.6 };
}

export function diagnose(lines: Line[], rules: Pronunciation[]): { findings: Finding[]; rhythm: Rhythm } {
  const seen = new Set<string>();
  const findings = lines.flatMap((l) => [...breath(l), ...pronunciation(l, rules, seen), ...emphasis(l)]);
  const r = rhythm(lines);
  const long = lines.filter((l) => words(plain(l.text)).length > 40);
  for (const l of long) findings.push({ id: `${l.id}:rhythm`, kind: "rhythm", lineId: l.id, message: `A ${words(plain(l.text)).length}-word line. Splitting it into two lines gives the actor and the mix room to breathe.` });
  if (r.monotone) findings.push({ id: "scene:rhythm", kind: "rhythm", lineId: "", message: `Nearly every sentence is about ${Math.round(r.averageWords)} words long, which can read as a drone. Vary a few.` });
  return { findings, rhythm: r };
}
