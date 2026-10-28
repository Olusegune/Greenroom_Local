// Frame rates and timecode. Timecode here is non-drop: frames are counted at the nominal rate (24 for 23.976, 30 for
// 29.97), which is what most film and online work uses. Drop-frame timecode is not supported.

import type { Picture } from "./types";

export interface Fps {
  num: number;
  den: number;
}

export const FPS_PRESETS: { id: string; label: string; fps: Fps }[] = [
  { id: "23.976", label: "23.976 fps", fps: { num: 24000, den: 1001 } },
  { id: "24", label: "24 fps", fps: { num: 24, den: 1 } },
  { id: "25", label: "25 fps", fps: { num: 25, den: 1 } },
  { id: "29.97", label: "29.97 fps", fps: { num: 30000, den: 1001 } },
  { id: "30", label: "30 fps", fps: { num: 30, den: 1 } },
  { id: "50", label: "50 fps", fps: { num: 50, den: 1 } },
  { id: "59.94", label: "59.94 fps", fps: { num: 60000, den: 1001 } },
  { id: "60", label: "60 fps", fps: { num: 60, den: 1 } },
];

export const fpsOf = (p: Pick<Picture, "fpsNum" | "fpsDen">): Fps => ({ num: p.fpsNum, den: p.fpsDen });
export const fpsValue = (f: Fps) => f.num / f.den;
/** The whole number frames are counted at in timecode. */
export const nominal = (f: Fps) => Math.round(fpsValue(f));

export function fpsLabel(f: Fps): string {
  const hit = FPS_PRESETS.find((p) => p.fps.num * f.den === f.num * p.fps.den);
  return hit ? hit.label : `${fpsValue(f).toFixed(3)} fps`;
}

export const secToFrame = (sec: number, f: Fps) => Math.round(sec * fpsValue(f));
export const frameToSec = (frame: number, f: Fps) => frame / fpsValue(f);
/** The time of the nearest frame boundary. */
export const snapToFrame = (sec: number, f: Fps) => frameToSec(secToFrame(sec, f), f);

export function frameToTc(frame: number, f: Fps): string {
  const n = nominal(f);
  const total = Math.max(0, Math.round(frame));
  const ff = total % n;
  const s = Math.floor(total / n);
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(Math.floor(s / 3600))}:${p(Math.floor(s / 60) % 60)}:${p(s % 60)}:${p(ff)}`;
}

/** Timecode text to a frame number, or null if it is not valid. Accepts HH:MM:SS:FF, MM:SS:FF, SS:FF, with : or ; between. */
export function tcToFrame(text: string, f: Fps): number | null {
  const parts = text.trim().split(/[:;.]/);
  if (parts.length < 2 || parts.length > 4 || parts.some((x) => !/^\d{1,3}$/.test(x))) return null;
  const nums = parts.map(Number);
  while (nums.length < 4) nums.unshift(0);
  const [h, m, s, ff] = nums as [number, number, number, number];
  const n = nominal(f);
  if (m > 59 || s > 59 || ff >= n) return null;
  return ((h * 60 + m) * 60 + s) * n + ff;
}

/** Timecode of a time in the picture, counting from the picture's own start timecode. */
export function tcAt(sec: number, pic: Pick<Picture, "fpsNum" | "fpsDen" | "startFrame">): string {
  const f = fpsOf(pic);
  return frameToTc(pic.startFrame + secToFrame(sec, f), f);
}

/** Time in the picture for a timecode, or null if invalid or before the first frame. */
export function secAtTc(text: string, pic: Pick<Picture, "fpsNum" | "fpsDen" | "startFrame">): number | null {
  const f = fpsOf(pic);
  const fr = tcToFrame(text, f);
  if (fr === null || fr < pic.startFrame) return null;
  return frameToSec(fr - pic.startFrame, f);
}

export function defaultPicture(path: string, name: string): Picture {
  return { path, name, fpsNum: 24, fpsDen: 1, fpsKnown: false, duration: 0, width: 0, height: 0, startFrame: 0 };
}

export const baseName = (p: string) => p.replace(/\\/g, "/").split("/").pop() ?? p;
