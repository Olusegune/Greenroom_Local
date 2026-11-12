// Strict portrait matching. A face is chosen only from what is STATED about the character or preset, and a stated fact is never given up
// to find a face: if nothing fits, no face is shown (a neutral mark), which is better than a wrong one.
//
//   gender    stated        -> the portrait presents that gender, always. Not stated -> no face is chosen.
//   heritage  stated        -> the portrait shows that heritage, always. Not stated -> any heritage may be offered.
//   age       child or teen -> only child or teen portraits, and an adult is never given one.
//   age       otherwise     -> the portraits for that age band; if none fit, the nearest ADULT bands (flagged "age approximate").
//
// What counts as "stated": the owner's choice, a character's own look, or a field an author wrote on a preset (its culture). Never an
// accent, a name, a language, a voice's sound, or an AI guess. See docs/AVATARS.md.

import { AGE_FIT, isChildish, isPlainFace, LOOKS, type AvatarEntry, type AvatarManifest, type CustomFace, type Heritage, type VoiceAge } from "./avatarLibrary";

export interface FaceWant { gender?: "m" | "f"; age?: VoiceAge; heritage?: Heritage }

export interface FaceMatch { entry: AvatarEntry; /** False when no portrait of the exact age band fit and a nearby adult band was used. */ ageExact: boolean }

export interface FaceResult {
  faces: FaceMatch[];
  /** The facts the match used, in words, so the owner can see why a face was offered. */
  used: string[];
  /** Why there is no face, when there is none. */
  reason?: string;
}

const NEARBY_ADULT: Record<VoiceAge, VoiceAge[]> = { child: [], teen: ["young"], young: ["mid", "teen"], mid: ["young", "old"], old: ["mid"] };

export function matchFaces(manifest: AvatarManifest | null, want: FaceWant, opts: { custom?: CustomFace[]; costumes?: boolean } = {}): FaceResult {
  const used = [want.gender ? (want.gender === "m" ? "male" : "female") : "", want.age ? `age ${want.age}` : "", want.heritage ? want.heritage.replace(/_/g, " ") : ""].filter(Boolean);
  if (!manifest) return { faces: [], used, reason: "The portrait library is not loaded." };
  if (!want.gender) return { faces: [], used, reason: "No gender is stated, so no face is chosen. A face that guesses the gender is worse than none." };
  const custom = new Map((opts.custom ?? []).map((c) => [c.entry.id, c]));
  const pool = [...manifest.avatars, ...(opts.custom ?? []).map((c) => c.entry)];
  const lookOf = (a: AvatarEntry) => LOOKS[a.id] ?? custom.get(a.id)?.look;
  const fits = pool.filter((a) => {
    const l = lookOf(a);
    if (!l || l.g === "n" || l.g !== want.gender) return false;
    if (want.heritage && l.h !== want.heritage) return false;
    if (!opts.costumes && !isPlainFace(a)) return false;
    return true;
  });
  const childhood = want.age === "child" || want.age === "teen";
  const grownOnly = fits.filter((a) => !isChildish(a));
  const base = childhood ? fits.filter(isChildish) : grownOnly;
  const exactBands = want.age ? AGE_FIT[want.age] : (["young_adult", "adult", "middle_aged"] as const);
  const exact = base.filter((a) => (exactBands as readonly string[]).includes(a.age_category));
  if (exact.length) return { faces: sorted(exact.map((entry) => ({ entry, ageExact: true }))), used };
  if (want.age && !childhood) {
    const near = base.filter((a) => NEARBY_ADULT[want.age!].some((b) => AGE_FIT[b].includes(a.age_category)));
    if (near.length) return { faces: sorted(near.map((entry) => ({ entry, ageExact: false }))), used };
  }
  return { faces: [], used, reason: `No portrait in the library is ${used.join(", ")}. Choose one by hand in the browser, or add your own.` };
}

const sorted = (f: FaceMatch[]) => f.sort((a, b) => Number(b.ageExact) - Number(a.ageExact) || a.entry.id.localeCompare(b.entry.id));

/** One face from the matches, the least used first so many presets spread across the library; stable for the same seed. */
export function pickFace(result: FaceResult, seed: string, usage?: Map<string, number>): AvatarEntry | null {
  let pool = result.faces.filter((f) => f.ageExact).map((f) => f.entry);
  if (!pool.length) pool = result.faces.map((f) => f.entry);
  if (!pool.length) return null;
  if (usage) { const least = Math.min(...pool.map((a) => usage.get(a.id) ?? 0)); pool = pool.filter((a) => (usage.get(a.id) ?? 0) === least); }
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) { h ^= seed.charCodeAt(i); h = Math.imul(h, 16777619); }
  return pool[(h >>> 0) % pool.length]!;
}
