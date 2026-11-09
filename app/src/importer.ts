// Adding portraits from the owner's computer. Everything here is the checking, kept apart from the screen so it can be tested.
//
// The trust boundary: a file chosen by the owner is untrusted bytes. It is accepted only if its declared type, its first bytes
// and its extension all agree on PNG, JPEG or WebP (never SVG, GIF or anything else); it is bounded in size, number and pixels;
// it is decoded by the browser and drawn onto a canvas, so what is kept is a fresh JPEG with no metadata and no embedded
// payload; and the file's own name is never stored.

import { AGES, type Age, type Heritage } from "./avatarLibrary";

export const ACCEPT_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
export const ACCEPT_ATTR = ".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp";
export const MAX_FILE_BYTES = 15_000_000;
export const MAX_BATCH = 24;
export const MAX_PIXELS = 40_000_000;
export const MIN_SIDE = 256;
export const GOOD_SIDE = 512;
export const MAX_CUSTOM = 300;
export const MAX_ENCODED_CHARS = 400_000;

export type SniffedType = (typeof ACCEPT_TYPES)[number];

/** What the first bytes of a file really are, or null when it is none of the three accepted kinds. */
export function sniff(head: Uint8Array): SniffedType | null {
  const b = (i: number) => head[i] ?? -1;
  if (b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4e && b(3) === 0x47 && b(4) === 0x0d && b(5) === 0x0a && b(6) === 0x1a && b(7) === 0x0a) return "image/png";
  if (b(0) === 0xff && b(1) === 0xd8 && b(2) === 0xff) return "image/jpeg";
  if (b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50) return "image/webp";
  return null;
}

const EXT: Record<SniffedType, RegExp> = { "image/png": /\.png$/i, "image/jpeg": /\.jpe?g$/i, "image/webp": /\.webp$/i };

/** An error in plain words, or null when the file may be read. Declared type, first bytes and extension must all agree. */
export function checkFile(file: { type: string; size: number; name: string }, head: Uint8Array): string | null {
  if (!(ACCEPT_TYPES as readonly string[]).includes(file.type)) return "Only PNG, JPEG and WebP pictures can be added.";
  if (file.size <= 0) return "That file is empty.";
  if (file.size > MAX_FILE_BYTES) return "That file is over 15 MB.";
  const real = sniff(head);
  if (!real) return "That file is not a PNG, JPEG or WebP picture, whatever its name says.";
  if (real !== file.type) return "The file's contents do not match its type, so it was not read.";
  if (!EXT[real].test(file.name)) return "The file's name does not match its contents, so it was not read.";
  return null;
}

/** An error for a picture that is too big to decode safely or too small to use, a warning for a small one, or neither. */
export function checkSize(w: number, h: number): { error?: string; warning?: string } {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 1 || h < 1) return { error: "That picture has no size." };
  if (w * h > MAX_PIXELS) return { error: "That picture is over 40 megapixels, which is too large to read safely." };
  const side = Math.min(w, h);
  if (side < MIN_SIDE) return { error: `That picture is only ${side} pixels on its short side. At least ${MIN_SIDE} are needed, and a picture is never enlarged.` };
  if (side < GOOD_SIDE) return { warning: `Small: ${side} pixels on its short side. It will look soft at large sizes.` };
  return {};
}

/** A name safe to keep and show: no control, invisible or direction-changing characters, one line, at most 60 characters. */
export function sanitizeName(raw: unknown, fallback = "Portrait"): string {
  const s = typeof raw === "string" ? raw.slice(0, 400) : "";
  const clean = s
    .replace(/[\u0000-\u001f\u007f-\u009f​-‏‪-‮⁠-⁯﻿]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60)
    .trim();
  return clean || fallback;
}

/** A name from a file name when the owner has not typed one: without folders and without the extension. */
export const nameFromFile = (fileName: string): string => sanitizeName(fileName.replace(/^.*[\\/]/, "").replace(/\.[^.]+$/, "").replace(/[_-]+/g, " "));

export interface Look {
  gender?: "m" | "f";
  age?: Age;
  heritage?: Heritage;
}
const HERITAGE_VALUES: readonly string[] = ["black", "white", "east_asian", "south_asian", "middle_eastern", "latino", "indigenous"];

/** Only the known values survive; anything else (from a screen, or from a damaged file) is dropped. */
export function cleanLook(raw: unknown): Look {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const out: Look = {};
  if (o.gender === "m" || o.gender === "f") out.gender = o.gender;
  if (typeof o.age === "string" && (AGES as readonly string[]).includes(o.age) && o.age !== "ageless") out.age = o.age as Age;
  if (typeof o.heritage === "string" && HERITAGE_VALUES.includes(o.heritage)) out.heritage = o.heritage as Heritage;
  return out;
}

/** The square cut from a picture: zoom 1 is the largest square, higher zooms cut a smaller one; cx and cy (0 to 1) slide it. Always inside the picture. */
export function cropRect(w: number, h: number, zoom: number, cx: number, cy: number): { x: number; y: number; size: number } {
  const z = Math.min(4, Math.max(1, Number.isFinite(zoom) ? zoom : 1));
  const size = Math.max(1, Math.floor(Math.min(w, h) / z));
  const fx = Math.min(1, Math.max(0, Number.isFinite(cx) ? cx : 0.5));
  const fy = Math.min(1, Math.max(0, Number.isFinite(cy) ? cy : 0.5));
  return { x: Math.round((w - size) * fx), y: Math.round((h - size) * fy), size };
}

/** A 64-bit difference hash of a 9 x 8 grayscale thumbnail (72 values), as a bit string. */
export function dHash(gray: ArrayLike<number>): string {
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += (gray[y * 9 + x] ?? 0) > (gray[y * 9 + x + 1] ?? 0) ? "1" : "0";
  return bits;
}
export function hamming(a: string, b: string): number {
  let d = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) d++;
  return d + Math.abs(a.length - b.length);
}
/** Two pictures this close are almost certainly the same face. */
export const DUPLICATE_DISTANCE = 6;
/** The closest hash to this one among the known ones, with its name, if it is near enough to be the same picture. */
export function nearDuplicate(hash: string, known: { name: string; hash: string }[]): string | null {
  let best: { name: string; d: number } | null = null;
  for (const k of known) {
    const d = hamming(hash, k.hash);
    if (d <= DUPLICATE_DISTANCE && (!best || d < best.d)) best = { name: k.name, d };
  }
  return best ? best.name : null;
}

/**
 * The pixel size of a picture, read from its header without decoding it, so a file that would expand to gigabytes (a small PNG
 * that is 30,000 pixels across) is refused before anything decodes it. Null when the header cannot be read.
 */
export function readDimensions(bytes: Uint8Array, type: SniffedType): { w: number; h: number } | null {
  const u8 = (i: number) => bytes[i] ?? 0;
  const be16 = (i: number) => (u8(i) << 8) | u8(i + 1);
  const be32 = (i: number) => ((u8(i) << 24) | (u8(i + 1) << 16) | (u8(i + 2) << 8) | u8(i + 3)) >>> 0;
  const le16 = (i: number) => u8(i) | (u8(i + 1) << 8);
  const le24 = (i: number) => u8(i) | (u8(i + 1) << 8) | (u8(i + 2) << 16);
  if (type === "image/png") return bytes.length >= 24 ? { w: be32(16), h: be32(20) } : null;
  if (type === "image/webp") {
    if (bytes.length < 30) return null;
    const kind = String.fromCharCode(u8(12), u8(13), u8(14), u8(15));
    if (kind === "VP8 ") return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff };
    if (kind === "VP8L") {
      const b = u8(21) | (u8(22) << 8) | (u8(23) << 16) | (u8(24) << 24);
      return { w: (b & 0x3fff) + 1, h: ((b >>> 14) & 0x3fff) + 1 };
    }
    if (kind === "VP8X") return { w: le24(24) + 1, h: le24(27) + 1 };
    return null;
  }
  // JPEG: walk the segments to the start-of-frame marker
  let i = 2;
  while (i + 9 < bytes.length) {
    if (u8(i) !== 0xff) return null;
    const m = u8(i + 1);
    if (m === 0xff) {
      i++;
      continue;
    }
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: be16(i + 5), w: be16(i + 7) };
    if (m === 0xd8 || (m >= 0xd0 && m <= 0xd7) || m === 0x01) {
      i += 2;
      continue;
    }
    const len = be16(i + 2);
    if (len < 2) return null;
    i += 2 + len;
  }
  return null;
}
