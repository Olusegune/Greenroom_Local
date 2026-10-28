// The mathematics of the timeline: how music dips under dialogue, how clips fade and crossfade, where a dragged clip
// snaps, and how overlapping clips are stacked. All pure, so every number can be tested.

import type { Placed } from "./audio";
import type { MixCfg } from "./types";

export interface DuckCfg {
  amountDb: number;
  attack: number;
  hold: number;
  release: number;
}

/** Samples per second of the duck curve. Ramps are at least 100 ms, so 100 Hz follows them closely. */
export const DUCK_RATE = 100;

export const duckOf = (m: MixCfg): DuckCfg => ({ amountDb: m.amountDb, attack: m.attack, hold: m.hold, release: m.release });

/**
 * The level (0 to 1) music should have at every moment, as one value per 1/100 s from 0 to `total`. It falls to the duck
 * amount over `attack` seconds before a line starts, stays there while the line speaks and for `hold` after, then returns
 * over `release`. Where lines overlap, or one ducks while another is still returning, the deepest dip wins.
 */
export function duckCurve(spans: { start: number; end: number }[], total: number, cfg: DuckCfg): Float32Array {
  const n = Math.max(2, Math.ceil(total * DUCK_RATE) + 1);
  const g = new Float32Array(n).fill(1);
  const low = Math.pow(10, Math.min(0, cfg.amountDb) / 20);
  for (const s of spans) {
    const a = s.start - Math.max(0, cfg.attack);
    const c = s.end + Math.max(0, cfg.hold);
    const d = c + Math.max(0, cfg.release);
    const from = Math.max(0, Math.floor(a * DUCK_RATE));
    const to = Math.min(n - 1, Math.ceil(d * DUCK_RATE));
    for (let i = from; i <= to; i++) {
      const t = i / DUCK_RATE;
      let v: number;
      if (t < a) v = 1;
      else if (t < s.start) v = cfg.attack > 0 ? 1 + (low - 1) * ((t - a) / cfg.attack) : low;
      else if (t <= c) v = low;
      else if (t < d) v = low + (1 - low) * ((t - c) / (d - c));
      else v = 1;
      if (v < g[i]!) g[i] = v;
    }
  }
  return g;
}

/** An equal-power fade shape: gain over `n` points. A fade in goes 0 to 1, a fade out 1 to 0. */
export function fadeCurve(direction: "in" | "out", n = 64): Float32Array {
  const c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    c[i] = direction === "in" ? Math.sin((x * Math.PI) / 2) : Math.cos((x * Math.PI) / 2);
  }
  return c;
}

/** The default few-millisecond fade at a clip's edges, so a cut never clicks. */
export const EDGE_FADE_IN = 0.005;
export const EDGE_FADE_OUT = 0.01;

/**
 * Where one character's line overlaps the end of that same character's earlier line, the earlier one fades out and the
 * later one fades in across the overlap (equal power), so the join does not click or jump. Lines by different
 * characters talking over each other are left alone. A line entirely inside another is left alone too.
 */
export function applyCrossfades(items: Placed[]): Placed[] {
  const out = items.map((i) => ({ ...i }));
  const speech = out.filter((i) => i.kind === "speech" && i.characterId);
  const byChar = new Map<string, Placed[]>();
  for (const s of speech) byChar.set(s.characterId!, [...(byChar.get(s.characterId!) ?? []), s]);
  for (const list of byChar.values()) {
    list.sort((a, b) => a.start - b.start);
    for (let k = 1; k < list.length; k++) {
      const a = list[k - 1]!;
      const b = list[k]!;
      const aEnd = a.start + a.seconds;
      const bEnd = b.start + b.seconds;
      if (b.start >= aEnd || bEnd < aEnd) continue;
      const overlap = Math.min(aEnd - b.start, b.seconds * 0.9, a.seconds * 0.9);
      if (overlap <= 0) continue;
      a.fadeOut = Math.max(a.fadeOut, overlap);
      b.fadeIn = Math.max(b.fadeIn, overlap);
    }
  }
  return out;
}

/** Fades that never overlap each other within a clip. */
export function fitFades(seconds: number, fadeIn: number, fadeOut: number): { fi: number; fo: number } {
  let fi = Math.max(0, Math.min(fadeIn, seconds));
  let fo = Math.max(0, Math.min(fadeOut, seconds));
  if (fi + fo > seconds) {
    const k = seconds / (fi + fo);
    fi *= k;
    fo *= k;
  }
  return { fi, fo };
}

/** The nearest target within `threshold`, else the time rounded to `grid` (if given). */
export function snapTime(t: number, targets: number[], threshold: number, grid?: number): number {
  let best: number | null = null;
  let bestD = threshold;
  for (const x of targets) {
    const d = Math.abs(x - t);
    if (d <= bestD) {
      best = x;
      bestD = d;
    }
  }
  if (best !== null) return best;
  return grid && grid > 0 ? Math.round(t / grid) * grid : t;
}

/** Stack overlapping clips onto rows: the row number for each clip, lowest free row first. */
export function layoutRows(clips: { start: number; end: number }[]): number[] {
  const order = clips.map((_, i) => i).sort((a, b) => clips[a]!.start - clips[b]!.start);
  const ends: number[] = [];
  const rows = new Array<number>(clips.length).fill(0);
  for (const i of order) {
    let r = ends.findIndex((e) => e <= clips[i]!.start + 1e-9);
    if (r < 0) {
      r = ends.length;
      ends.push(0);
    }
    ends[r] = clips[i]!.end;
    rows[i] = r;
  }
  return rows;
}

/** m:ss.mmm for the timeline. */
export function formatClock(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(3).padStart(6, "0")}`;
}

/** Seconds from "83.5", "1:23.5" or "0:05". Null if it is not a time. */
export function parseClock(text: string): number | null {
  const t = text.trim();
  const m = /^(?:(\d+):)?(\d+(?:\.\d+)?)$/.exec(t);
  if (!m) return null;
  const v = Number(m[1] ?? 0) * 60 + Number(m[2]);
  return Number.isFinite(v) ? v : null;
}

/** Evenly spaced ruler marks that suit the zoom: seconds between labels. */
export function rulerStep(pxPerSec: number): number {
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => s * pxPerSec >= 70) ?? 600;
}
