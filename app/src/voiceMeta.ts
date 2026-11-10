import { profileOf } from "./casting/voiceProfile";
import type { VoiceEntry } from "./types";

export interface MetaChip { kind: "language" | "accent" | "gender" | "text"; text: string; title?: string }

const title = (s: string) => s.trim().replace(/^./, (c) => c.toUpperCase());

/** The facts a voice card shows as chips, in a fixed order, only when known. Older entries that only have a combined line still show it. */
export function voiceChips(v: Pick<VoiceEntry, "language" | "accent" | "gender">, fallbackLine = ""): MetaChip[] {
  const out: MetaChip[] = [];
  if (v.language.trim()) out.push({ kind: "language", text: v.language.trim().length <= 3 ? v.language.trim().toUpperCase() : title(v.language) });
  if (v.accent.trim()) out.push({ kind: "accent", text: title(v.accent) });
  if (v.gender.trim()) out.push({ kind: "gender", text: title(v.gender) });
  if (out.length === 0 && fallbackLine.trim()) out.push({ kind: "text", text: fallbackLine.trim() });
  return out;
}

/**
 * The chips for a library voice, honest about what is known. A gender the voice's record states but nobody has confirmed by listening is
 * written "claimed"; one that is unknown (a Piper voice's name is not evidence) is left out. Language and accent chips are unchanged.
 */
export function voiceChipsChecked(v: VoiceEntry, fallbackLine = ""): MetaChip[] {
  const p = profileOf(v);
  const g = p.gender.value;
  const gender = g ? { kind: "gender" as const, text: `${g === "masculine" ? "Masculine" : g === "feminine" ? "Feminine" : "Androgynous"}${p.gender.status === "verified" ? "" : " (claimed)"}`, title: p.gender.status === "verified" ? "Confirmed by listening" : "Stated by the voice's record; nobody has listened to confirm it" } : null;
  return voiceChips({ language: v.language, accent: v.accent, gender: "" }, fallbackLine).concat(gender ? [gender] : []);
}

/** Favourites first, everything else in its existing order (a stable partition). */
export function favouritesFirst<T>(items: T[], isFavourite: (item: T) => boolean): T[] {
  return [...items.filter(isFavourite), ...items.filter((x) => !isFavourite(x))];
}
