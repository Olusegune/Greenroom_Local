// A character's reaction library: sound clips already made for them (a laugh, a sigh, a cough) kept so they can be used
// again on other lines at no cost. The audio file is the same immutable take, so its provenance and rights go with it.

import type { SoundEvent } from "./types";

export const MAX_REACTIONS = 24;

export interface Reaction {
  id: string;
  prompt: string;
  seconds: number;
  take: NonNullable<SoundEvent["take"]>;
}

export function migrateReactions(raw: unknown): Reaction[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((r): Reaction | null => {
      const o = (r ?? {}) as Record<string, unknown>;
      const t = (o.take ?? {}) as Record<string, unknown>;
      if (typeof o.id !== "string" || typeof t.id !== "string" || (t.ext !== "wav" && t.ext !== "mp3")) return null;
      return { id: o.id.slice(0, 60), prompt: typeof o.prompt === "string" ? o.prompt.replace(/\s+/g, " ").trim().slice(0, 200) : "", seconds: typeof o.seconds === "number" && Number.isFinite(o.seconds) ? o.seconds : 0, take: { id: t.id.slice(0, 60), ext: t.ext, seconds: typeof t.seconds === "number" && Number.isFinite(t.seconds) ? t.seconds : 0, sha256: typeof t.sha256 === "string" ? t.sha256 : undefined, prompt: typeof t.prompt === "string" ? t.prompt.slice(0, 200) : undefined } };
    })
    .filter((r): r is Reaction => r !== null)
    .slice(0, MAX_REACTIONS);
}

/** Saves a made sound clip to the character's library. A clip already there is not added twice, and the newest are kept. */
export function saveReaction(list: Reaction[] | undefined, e: SoundEvent): Reaction[] {
  if (!e.take) return migrateReactions(list);
  const have = migrateReactions(list).filter((r) => r.take.id !== e.take!.id);
  return [{ id: "r-" + e.take.id, prompt: e.prompt, seconds: e.take.seconds, take: e.take }, ...have].slice(0, MAX_REACTIONS);
}

/** A new sound event on a line that uses a saved clip. No request is made and nothing is spent. */
export function reuse(r: Reaction, id: string, placement: "before" | "after"): SoundEvent {
  return { id, prompt: r.prompt, placement, seconds: r.take.seconds || r.seconds, take: r.take };
}
