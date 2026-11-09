// Using your own audio for a line, and adding expressions (a laugh, a sigh, a gasp) to any take.
//
// The owner's recording is used AS IT IS: nothing here changes how it sounds, except where an expression is added on request. An
// expression is a clip already made for the character (their reaction library), placed either over the speech or inserted at a
// point (the speech pauses for it). The result is always a NEW take; the recording and the original take are never changed.

import type { Take } from "./types";

export const MAX_BASE_SECONDS = 300;
export const MAX_CLIP_SECONDS = 15;
export type Mode = "overlay" | "insert";

const num = (x: number, fallback = 0) => (Number.isFinite(x) ? x : fallback);

/** Linear resampling, so a clip made at one rate can be mixed into a recording made at another. */
export function resample(x: Float32Array, from: number, to: number): Float32Array {
  if (!(from > 0) || !(to > 0) || x.length === 0) return new Float32Array(0);
  if (from === to) return x;
  const n = Math.max(1, Math.round((x.length * to) / from));
  const out = new Float32Array(n);
  const ratio = from / to;
  for (let i = 0; i < n; i++) {
    const p = i * ratio;
    const a = Math.floor(p);
    const f = p - a;
    out[i] = (x[a] ?? 0) * (1 - f) + (x[Math.min(a + 1, x.length - 1)] ?? 0) * f;
  }
  return out;
}

export const peakOf = (x: Float32Array): number => {
  let p = 0;
  for (let i = 0; i < x.length; i++) p = Math.max(p, Math.abs(x[i]!));
  return p;
};

/** A short fade in and out on the clip, so it never clicks where it starts and stops. */
function faded(clip: Float32Array, rate: number, gain: number): Float32Array {
  const out = new Float32Array(clip.length);
  const fade = Math.min(Math.floor(rate * 0.006), Math.floor(clip.length / 2));
  for (let i = 0; i < clip.length; i++) {
    const edge = fade > 0 ? Math.min(1, i / fade, (clip.length - 1 - i) / fade) : 1;
    out[i] = clip[i]! * gain * edge;
  }
  return out;
}

/**
 * Puts an expression into a recording at a time, in seconds from its start. `overlay` plays it over the speech; `insert` cuts the
 * recording at that point and puts the clip in between (the speech stops for it, then goes on). The recording is never changed
 * in place. If the sum would clip, the whole result is turned down a little instead of distorting.
 */
export function mixExpression(base: Float32Array, baseRate: number, clip: Float32Array, clipRate: number, atSeconds: number, mode: Mode, gain = 0.9): Float32Array {
  if (!(baseRate > 0) || base.length === 0) return base;
  const g = Math.min(2, Math.max(0, num(gain, 0.9)));
  const c = faded(resample(clip, clipRate, baseRate), baseRate, g);
  const at = Math.min(base.length, Math.max(0, Math.round(num(atSeconds) * baseRate)));
  let out: Float32Array;
  if (mode === "insert") {
    out = new Float32Array(base.length + c.length);
    out.set(base.subarray(0, at), 0);
    out.set(c, at);
    out.set(base.subarray(at), at + c.length);
  } else {
    out = new Float32Array(Math.max(base.length, at + c.length));
    out.set(base);
    for (let i = 0; i < c.length; i++) out[at + i] = out[at + i]! + c[i]!;
  }
  const peak = peakOf(out);
  if (peak > 0.98) for (let i = 0; i < out.length; i++) out[i] = (out[i]! * 0.98) / peak;
  return out;
}

/** What is wrong with a request to add an expression, if anything. */
export function checkExpression(baseSeconds: number, clipSeconds: number, atSeconds: number): string | null {
  if (!(baseSeconds > 0)) return "There is no audio to add the expression to.";
  if (baseSeconds > MAX_BASE_SECONDS) return "That audio is longer than 5 minutes. Use one line at a time.";
  if (!(clipSeconds > 0)) return "That expression has no sound.";
  if (clipSeconds > MAX_CLIP_SECONDS) return "That expression is longer than 15 seconds.";
  if (!Number.isFinite(atSeconds) || atSeconds < 0 || atSeconds > baseSeconds) return "Choose a point inside the audio.";
  return null;
}

interface Common { id: string; at: string; seconds: number; sha256: string; appVersion: string; emotion: string; note: string; voiceId?: string }

/** A take made from the owner's own recording, used as it is. The record says a real person performed it, and where it came from. */
export function ownTake(a: Common & { source: string }): Take {
  return {
    id: a.id,
    at: a.at,
    model: "local",
    ext: "wav",
    voiceId: a.voiceId ?? "",
    sent: `(my own audio: ${a.source}, used as it is)`,
    seconds: a.seconds,
    provenance: { engine: "local", voiceName: "My own audio", speed: 1, instructions: `A recording made or chosen by the owner (${a.source}), used as it is. No voice engine produced this audio.`, chars: 0, sha256: a.sha256, appVersion: a.appVersion, emotion: a.emotion, sounds: [], note: a.note, pronunciations: 0 },
  };
}

/** A take made by adding an expression to another take or recording. It says what was added, where, and to what. */
export function expressionTake(a: Common & { expression: string; atSeconds: number; mode: Mode; from: string }): Take {
  const where = `${a.atSeconds.toFixed(2)} s`;
  return {
    id: a.id,
    at: a.at,
    model: "local",
    ext: "wav",
    voiceId: a.voiceId ?? "",
    sent: `(${a.from} with "${a.expression.slice(0, 60)}" ${a.mode === "insert" ? "inserted at" : "over the speech at"} ${where})`,
    seconds: a.seconds,
    provenance: { engine: "local", voiceName: "My own audio", speed: 1, instructions: `${a.from}, with the expression "${a.expression.slice(0, 80)}" ${a.mode === "insert" ? "inserted" : "mixed over the speech"} at ${where}. The original is unchanged.`, chars: 0, sha256: a.sha256, appVersion: a.appVersion, emotion: a.emotion, sounds: [a.expression.slice(0, 80)], note: a.note, pronunciations: 0 },
  };
}
