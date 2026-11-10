// The listening session: a fast way to confirm what voices sound like. The logic only; the screen is ListeningSession.tsx.
// A pick is what the owner HEARD. "Unsure" records nothing, so a voice stays unknown rather than being guessed.

import type { VoiceEntry } from "../types";
import type { VocalAge, VocalGender } from "./types";
import { applyMetaChange, profileOf } from "./voiceProfile";

export type GenderPick = VocalGender | "unsure";
export type AgePick = VocalAge | "unsure";
export interface Pick { gender: GenderPick; age: AgePick }
export const NO_PICK: Pick = { gender: "unsure", age: "unsure" };

/** Voices worth a listen: vocal presentation or age not yet confirmed. Voices already confirmed on both are skipped. */
export function sessionQueue(library: VoiceEntry[], opts: { engine?: string; onlyUnconfirmed?: boolean } = {}): VoiceEntry[] {
  return library.filter((v) => {
    if (opts.engine && opts.engine !== "all" && v.provider !== opts.engine) return false;
    if (opts.onlyUnconfirmed === false) return true;
    const p = profileOf(v);
    return p.gender.status !== "verified" || p.age.status !== "verified";
  });
}

export const hasPick = (p: Pick) => p.gender !== "unsure" || p.age !== "unsure";

/** Records one voice's pick as confirmed by listening. Returns the voice unchanged when the owner was unsure of everything. */
export function applyPick(v: VoiceEntry, p: Pick, now: string, evidence = "Listening session"): VoiceEntry {
  if (!hasPick(p)) return v;
  return applyMetaChange(v, { listened: true, evidence: `${evidence} ${now.slice(0, 10)}`, ...(p.gender !== "unsure" ? { gender: p.gender } : {}), ...(p.age !== "unsure" ? { age: p.age } : {}) }, now);
}

/** The key presses the session understands, so a voice can be judged without touching the mouse. */
export const KEYS: Record<string, Partial<Pick>> = { m: { gender: "masculine" }, f: { gender: "feminine" }, a: { gender: "androgynous" }, u: { gender: "unsure" }, "1": { age: "child" }, "2": { age: "teen" }, "3": { age: "young" }, "4": { age: "mid" }, "5": { age: "old" }, "0": { age: "unsure" } };
