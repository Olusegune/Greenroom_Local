// Pictures for voices. A voice can have a real picture instead of its drawn clay face: one the owner chooses, or one made
// from a description by an image model. The picture belongs to the voice, so it shows wherever that voice appears.
// Pictures are small (a 256 pixel square JPEG kept with the voice in the library), and they are fictional characters:
// the prompt asks for a person who is not real and resembles nobody.

import { hash, lookFor } from "./avatar";
import type { VoiceEntry } from "./types";

/** The seed a voice's drawn face uses everywhere, so a picture can be found for the same voice on every screen. */
export const voiceSeed = (v: Pick<VoiceEntry, "id" | "name">): string => v.id + v.name;

const pictures = new Map<string, string>();

/** Rebuilds the lookup from the library. Cheap, and called whenever the library changes. */
export function syncPortraits(library: Pick<VoiceEntry, "id" | "name" | "portrait">[]): void {
  pictures.clear();
  for (const v of library) if (v.portrait && v.portrait.startsWith("data:image/")) pictures.set(voiceSeed(v), v.portrait);
}

export const portraitFor = (seed: string): string | undefined => pictures.get(seed);

/** The largest square that can be cut from the middle of a picture, as a source rectangle. */
export function squareCrop(w: number, h: number): { x: number; y: number; size: number } {
  const size = Math.max(1, Math.min(w, h));
  return { x: Math.floor((w - size) / 2), y: Math.floor((h - size) / 2), size };
}

export const PORTRAIT_PX = 256;
export const MAX_PORTRAIT_BYTES = 120_000;

/** Whether a stored picture is acceptable: an image data address of a sensible size. Anything else is ignored. */
export const validPortrait = (s: unknown): s is string => typeof s === "string" && /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(s) && s.length <= MAX_PORTRAIT_BYTES * 1.4;

/** Cuts a picture to a centred square and shrinks it to a small JPEG, in the browser. */
export async function toPortrait(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const c = squareCrop(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = PORTRAIT_PX;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Greenroom could not prepare that picture.");
  g.drawImage(bmp, c.x, c.y, c.size, c.size, 0, 0, PORTRAIT_PX, PORTRAIT_PX);
  bmp.close();
  for (const q of [0.86, 0.75, 0.62]) {
    const url = canvas.toDataURL("image/jpeg", q);
    if (url.length <= MAX_PORTRAIT_BYTES * 1.3) return url;
  }
  return canvas.toDataURL("image/jpeg", 0.5);
}

/** Cuts a picture to a centred square at `px` pixels and encodes it as a JPEG data address, in the browser. */
export async function squareJpeg(blob: Blob, px: number, quality: number): Promise<string> {
  const bmp = await createImageBitmap(blob);
  const c = squareCrop(bmp.width, bmp.height);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const g = canvas.getContext("2d");
  if (!g) throw new Error("Greenroom could not prepare that picture.");
  g.drawImage(bmp, c.x, c.y, c.size, c.size, 0, 0, px, px);
  bmp.close();
  return canvas.toDataURL("image/jpeg", quality);
}

export interface AvatarBrief {
  description: string;
  period: string;
  genre: string;
  style: string;
  clothing: string;
  expression: string;
  background: string;
}

/** A written brief for a new avatar from the owner's choices. It always asks for a fictional person and clean framing, and contains only what the owner typed. */
export function avatarPrompt(b: AvatarBrief): string {
  const clean = (s: string) => s.replace(/[\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  const parts = [
    `A head-and-shoulders portrait of ${clean(b.description) || "a fictional character"}`,
    clean(b.period) && `${clean(b.period)} setting`,
    clean(b.genre) && `${clean(b.genre)} genre`,
    clean(b.clothing) && `wearing ${clean(b.clothing)}`,
    clean(b.expression) && `expression: ${clean(b.expression)}`,
    clean(b.background) ? `a clean ${clean(b.background)} background` : "a clean plain background",
    clean(b.style) && `${clean(b.style)} style`,
  ].filter(Boolean);
  return `${parts.join(", ")}. Square 1:1, the face centred with a generous safe margin, natural skin tones. A fictional character: not a real person, no celebrity likeness, no franchise character. No text, no logo, no watermark.`;
}

const AGE: [RegExp, string][] = [
  [/\b(child|kid|little|boy|girl)\b/i, "child"],
  [/\b(teen|young|youthful|bright)\b/i, "in their twenties"],
  [/\b(elderly|old|aged|ancient|grandmother|grandfather|wise)\b/i, "in their seventies"],
  [/\b(mature|deep|gravelly|husky)\b/i, "in their fifties"],
];
const MOOD: [RegExp, string][] = [
  [/\b(villain|sinister|menac|cold|sly)\b/i, "a cold, knowing expression"],
  [/\b(warm|kind|gentle|friendly|soft)\b/i, "a warm, kind expression"],
  [/\b(stern|authorit|command|serious)\b/i, "a stern, composed expression"],
  [/\b(cheerful|bubbly|happy|playful)\b/i, "a bright, cheerful smile"],
  [/\b(calm|serene|soothing)\b/i, "a calm, serene expression"],
  [/\b(sarcastic|wry|dry|deadpan)\b/i, "a dry, faintly amused expression"],
];

/**
 * A starting description for a portrait, built from what the library knows about the voice. It does not guess heritage
 * from an accent or a name. The owner reads and edits it before anything is made or paid for.
 */
export function portraitPrompt(v: Pick<VoiceEntry, "id" | "name" | "gender" | "notes">, role = ""): string {
  const text = `${v.name} ${v.notes} ${role}`;
  const g = lookFor(v.gender);
  const who = g === "feminine" ? "woman" : g === "masculine" ? "man" : "person";
  const h = hash(v.id + v.name);
  const age = AGE.find(([re]) => re.test(text))?.[1] ?? ["in their thirties", "in their forties", "in their fifties"][h % 3]!;
  const mood = MOOD.find(([re]) => re.test(text))?.[1] ?? ["a thoughtful expression", "a confident, relaxed expression", "a quietly intense expression"][(h >>> 3) % 3]!;
  const light = ["warm amber rim light on a dark teal background", "cool blue rim light on a dark background", "soft green rim light on a dark studio background"][(h >>> 6) % 3]!;
  return `A cinematic studio portrait photograph of a fictional ${who === "person" ? "person" : who} ${age === "child" ? "who is a child" : age}, shoulders up, ${mood}, looking at the camera, natural skin texture, shallow depth of field, ${light}. A fictional character: not a real person and not resembling any celebrity. No text, no logo, no watermark.`;
}
