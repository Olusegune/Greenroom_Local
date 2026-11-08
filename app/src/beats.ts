// Beat-by-beat acting inside one line. A line is split into phrases; each phrase can carry its own emotion, intention,
// emphasis, pace and pause. Two ways to reach a voice:
//   "cues"      one request: an emotion tag is written in front of each phrase (and emphasis as capitals for Inworld).
//               Needs a voice that acts on written words. Pace and pause cannot be sent this way and are reported as not sent.
//   "assemble"  one request per phrase, joined with silence in between. Pace and pauses are real because each phrase is
//               spoken separately, and it works with any voice, but it costs a request per phrase and the joins can sound
//               different from one continuous read, so listen to them.
// Beats never change the line's text: the script stays as written and the phrase texts are only used to find the beats again.

import { spokenWords } from "./direct";
import type { Line } from "./types";

export interface BeatSetting {
  /** The phrase this applies to, so it is dropped if the line is edited and the phrase no longer exists. */
  text: string;
  emotion?: string;
  intention?: string;
  /** Capitalise the key word (Inworld only). */
  emphasis?: boolean;
  /** Speed multiplier for this phrase, 0.8 to 1.2. Only used when assembling. */
  pace?: number;
  /** Silence after this phrase, in seconds, 0 to 2. Only used when assembling. */
  pauseAfter?: number;
}

export type BeatMode = "cues" | "assemble";

export interface Phrase {
  text: string;
  setting: BeatSetting | null;
}

const clamp = (n: unknown, lo: number, hi: number): number | undefined => (typeof n === "number" && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : undefined);

/** Phrases of a line, cut at punctuation, with very short ones (and tags on their own) joined to a neighbour so no phrase is a single word. Every character of the line is kept. */
export function phrases(text: string): string[] {
  const parts = text.replace(/\s+/g, " ").trim().split(/(?<=[,;:.!?…—–])\s+/).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) {
    if (out.length && spokenWords(p) < 2) out[out.length - 1] += ` ${p}`;
    else out.push(p);
  }
  if (out.length > 1 && spokenWords(out[0]!) < 2) out.splice(0, 2, `${out[0]} ${out[1]}`);
  return out;
}

/** The line's phrases with the settings that still belong to them. Settings for text that is gone are ignored. */
export function beatsFor(line: Pick<Line, "text"> & { beats?: unknown }): Phrase[] {
  const list = Array.isArray(line.beats) ? (line.beats as BeatSetting[]) : [];
  return phrases(line.text).map((p) => {
    const s = list.find((b) => b && b.text === p);
    return { text: p, setting: s ? clean(s) : null };
  });
}

function clean(s: BeatSetting): BeatSetting {
  return { text: s.text, emotion: typeof s.emotion === "string" && /^[a-z -]{1,30}$/i.test(s.emotion) ? s.emotion.toLowerCase() : undefined, intention: typeof s.intention === "string" ? s.intention.replace(/[\[\]\r\n]+/g, " ").trim().slice(0, 100) || undefined : undefined, emphasis: s.emphasis === true ? true : undefined, pace: clamp(s.pace, 0.8, 1.2), pauseAfter: clamp(s.pauseAfter, 0, 2) };
}

const active = (s: BeatSetting | null): boolean => !!s && !!(s.emotion || s.intention || s.emphasis || (s.pace !== undefined && s.pace !== 1) || (s.pauseAfter !== undefined && s.pauseAfter > 0));

export const hasBeats = (line: Pick<Line, "text"> & { beats?: unknown }): boolean => beatsFor(line).some((p) => active(p.setting));

export const beatMode = (line: { beatMode?: unknown }): BeatMode => (line.beatMode === "assemble" ? "assemble" : "cues");

/** Whether this line is to be made phrase by phrase and joined: assemble mode, with at least two phrases and at least one beat set. */
export const isAssembled = (line: Pick<Line, "text"> & { beats?: unknown; beatMode?: unknown }): boolean => beatMode(line) === "assemble" && hasBeats(line) && phrases(line.text).length >= 2;

/** Capitalises the longest word of a phrase as emphasis. Tags in brackets are left alone. */
export function emphasise(p: string): string {
  const words = [...p.matchAll(/(?<!\[)\b[\p{L}']{4,}\b(?![^\[]*\])/gu)];
  if (!words.length) return p;
  const w = words.reduce((a, b) => (b[0].length > a[0].length ? b : a));
  return p.slice(0, w.index) + w[0].toUpperCase() + p.slice(w.index! + w[0].length);
}

/**
 * The line's text with each beat's emotion written in front of its phrase as a tag, for one-request ("cues") mode. The
 * saved text is not changed. Pace and pause settings cannot be sent this way, so they are listed for the owner.
 */
export function cueText(line: Pick<Line, "text"> & { beats?: unknown }, emphasisOk: boolean): { text: string; notSent: string[] } {
  const ps = beatsFor(line);
  if (!ps.some((p) => active(p.setting))) return { text: line.text, notSent: [] };
  const notSent: string[] = [];
  const out = ps.map((p) => {
    const s = p.setting;
    if (!s) return p.text;
    const cues = [s.emotion, s.intention && s.intention.slice(0, 60)].filter(Boolean).map((c) => `[${String(c).toLowerCase()}]`);
    let t = p.text;
    if (s.emphasis) {
      if (emphasisOk) t = emphasise(t);
      else notSent.push("emphasis (only Inworld voices act on capital letters)");
    }
    if (s.pace !== undefined && s.pace !== 1) notSent.push("a phrase's pace (needs assemble mode)");
    if (s.pauseAfter) notSent.push("a pause after a phrase (needs assemble mode)");
    return [...cues, t].join(" ");
  });
  return { text: out.join(" "), notSent: [...new Set(notSent)] };
}

/** The sub-lines to speak one by one in assemble mode, each with its own emotion, intention, pace and the pause to leave after it. */
export function assemblePlan(line: Pick<Line, "text" | "direction"> & { beats?: unknown }): { line: Pick<Line, "text" | "direction">; pauseAfter: number; emphasis: boolean }[] {
  return beatsFor(line).map((p, i, all) => {
    const s = p.setting;
    const d = line.direction;
    const note = [d.note?.trim().replace(/[.!?]+$/, ""), s?.intention?.trim()].filter(Boolean).join(". ");
    const speed = Number(Math.min(1.2, Math.max(0.7, d.speed * (s?.pace ?? 1))).toFixed(2));
    // The line's own pause after is kept after the last phrase; between phrases a short natural gap is used unless the beat sets one.
    return { emphasis: !!s?.emphasis, line: { text: p.text, direction: { ...d, emotion: s?.emotion ?? d.emotion, note, speed, sounds: i === 0 ? d.sounds : [] } }, pauseAfter: i === all.length - 1 ? 0 : s?.pauseAfter ?? 0.12 };
  });
}

export interface BeatPart {
  text: string;
  /** Seconds in the joined take where this phrase's speech starts and ends. */
  start: number;
  end: number;
  /** Silence left after it. */
  pause: number;
}

/**
 * The joined audio with one phrase replaced, keeping every other phrase and every pause exactly as it was. The old take
 * is never changed: the result is new audio for a new take.
 */
export function spliceBeat(joined: Float32Array, rate: number, parts: BeatPart[], index: number, replacement: Float32Array): { samples: Float32Array; parts: BeatPart[] } {
  const p = parts[index];
  if (!p) throw new Error("That phrase does not exist in this take.");
  const a = Math.min(joined.length, Math.max(0, Math.round(p.start * rate)));
  const b = Math.min(joined.length, Math.max(a, Math.round(p.end * rate)));
  const samples = new Float32Array(a + replacement.length + (joined.length - b));
  samples.set(joined.subarray(0, a), 0);
  samples.set(replacement, a);
  samples.set(joined.subarray(b), a + replacement.length);
  const delta = replacement.length / rate - (b - a) / rate;
  const out = parts.map((q, i) => (i < index ? q : i === index ? { ...q, end: Number((q.start + replacement.length / rate).toFixed(3)) } : { ...q, start: Number((q.start + delta).toFixed(3)), end: Number((q.end + delta).toFixed(3)) }));
  return { samples, parts: out };
}
