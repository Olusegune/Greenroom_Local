// Pictures for voices. A voice can have a real picture instead of its drawn clay face: one the owner chooses, or one made
// from a description by an image model. The picture belongs to the voice, so it shows wherever that voice appears.
// Pictures are small (a 256 pixel square JPEG kept with the voice in the library), and they are fictional characters:
// the prompt asks for a person who is not real and resembles nobody.

import { hash, lookFor } from "./avatar";
import { autoAvatar, pipergender, type AvatarEntry, type AvatarManifest, type CustomFace, type VoiceMeta } from "./avatarLibrary";
import type { VoiceEntry } from "./types";

/** The seed a voice's drawn face uses everywhere, so a picture can be found for the same voice on every screen. */
export const voiceSeed = (v: Pick<VoiceEntry, "id" | "name">): string => String(v.id ?? "") + String(v.name ?? "");

const pictures = new Map<string, string>();
const hints = new Map<string, string>();
const metas = new Map<string, VoiceMeta>();
interface Cast {
  seed: string;
  gender?: string;
  hint: string;
  meta?: VoiceMeta;
}
const NO_CUSTOM: CustomFace[] = [];
let order: Cast[] = [];
let version = 0;
let cache: { manifest: AvatarManifest | null; custom: CustomFace[]; version: number; map: Map<string, string> } | null = null;

/** Rebuilds the lookup from the library. Cheap, and called whenever the library changes. */
/** Everything a voice says about itself, in one string: its gender, accent, language, the tags after the dash in its name, and its notes. */
export function voiceHint(v: Partial<Pick<VoiceEntry, "id" | "name" | "gender" | "accent" | "language" | "notes">>): string {
  // a stored voice is untrusted data: only strings are read, and each is cut short before any pattern runs on it
  const str = (x: unknown, n: number) => (typeof x === "string" ? x.slice(0, n) : "");
  const gender = str(v.gender, 40);
  const pg = gender ? undefined : pipergender(str(v.id, 120));
  const tags = str(v.name, 200).split(/ +[-\u2013\u2014] +/).slice(1).join(" ");
  return [gender || (pg === "f" ? "female" : pg === "m" ? "male" : ""), str(v.accent, 80), str(v.language, 80), tags, str(v.notes, 1500)].filter(Boolean).join(" ").slice(0, 2000);
}

export function syncPortraits(library: (Pick<VoiceEntry, "id" | "name" | "portrait"> & Partial<Pick<VoiceEntry, "gender" | "accent" | "language" | "notes" | "age" | "heritage">>)[]): void {
  pictures.clear();
  hints.clear();
  metas.clear();
  order = [];
  version++;
  for (const v of library) {
    if (v.portrait && v.portrait.startsWith("data:image/")) pictures.set(voiceSeed(v), v.portrait);
    if (v.age || v.heritage) metas.set(voiceSeed(v), { age: typeof v.age === "string" ? v.age : undefined, heritage: typeof v.heritage === "string" ? v.heritage : undefined });
    hints.set(voiceSeed(v), voiceHint(v));
    if (!(v.portrait && v.portrait.startsWith("data:image/"))) order.push({ seed: voiceSeed(v), gender: v.gender, hint: voiceHint(v), meta: v.age || v.heritage ? { age: typeof v.age === "string" ? v.age : undefined, heritage: typeof v.heritage === "string" ? v.heritage : undefined } : undefined });
  }
}

/**
 * The automatic face of a voice in the library. Every voice is placed in library order, each taking the least-used fitting face,
 * so a library of forty voices shows a spread of faces and not the same one six times. Voices keep their faces when new voices
 * are added at the end. Returns null for a seed that is not a library voice.
 */
export function assignedFace(manifest: AvatarManifest | null, seed: string, custom: CustomFace[] = NO_CUSTOM): AvatarEntry | null {
  if (!manifest) return null;
  if (!cache || cache.manifest !== manifest || cache.custom !== custom || cache.version !== version) {
    const usage = new Map<string, number>();
    const map = new Map<string, string>();
    for (const o of order) {
      const a = autoAvatar(manifest, o.seed, o.gender, o.hint, o.meta, usage, custom);
      if (a) {
        map.set(o.seed, a.id);
        usage.set(a.id, (usage.get(a.id) ?? 0) + 1);
      }
    }
    cache = { manifest, custom, version, map };
  }
  const id = cache.map.get(seed);
  return id ? (manifest.avatars.find((a) => a.id === id) ?? custom.find((c) => c.entry.id === id)?.entry ?? null) : null;
}

/** What a voice says about itself (accent, notes), used to pick an automatic face that fits it. */
export const hintFor = (seed: string): string | undefined => hints.get(seed);
/** The age and heritage the owner (or ElevenLabs) gave a voice, if any. */
export const metaFor = (seed: string): VoiceMeta | undefined => metas.get(seed);

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
