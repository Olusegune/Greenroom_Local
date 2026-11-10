// Auto-casting on top of the integrity engine. It never decides alone except where a voice is PROVEN to fit.
//
//  - A character that already has a voice, or an approved voice, is never touched.
//  - A voice is assigned automatically only when it is a VERIFIED_MATCH for something that was actually required.
//  - Everything else becomes a proposal: the best-ranked candidates with the reasons, for the owner to choose.
//  - Voices ruled out (INCOMPATIBLE) are listed with why, so nothing is hidden and nothing falls back silently.

import type { Character, VoiceEntry } from "../types";
import { OFFERABLE, rank } from "./engine";
import { requirementsOf } from "./requirements";
import { isLocked } from "./lock";
import { profileOf } from "./voiceProfile";
import type { MatchContext, MatchResult } from "./types";

export interface Proposal {
  characterId: string;
  candidates: MatchResult[];
  /** Voices that were ruled out, with the first reason, so the owner can see why. */
  ruledOut: { voiceId: string; why: string }[];
  /** The best candidate is also the best candidate for another character that has no better choice. */
  shared: boolean;
}

export interface CastingPlan {
  /** Character id to voice id. Only voices proven to fit, and only for characters with no voice. */
  assign: Record<string, string>;
  proposals: Proposal[];
  /** Characters nothing in the library can serve at all, with the reason. */
  none: { characterId: string; why: string }[];
}

const NARRATION = /^(narrator|narration|announcer|host|presenter|voiceover|voice over|instructor|reader|storyteller)\b/i;
export const wantsNarration = (name: string) => NARRATION.test(name.trim());
const suitsNarration = (v: Pick<VoiceEntry, "notes" | "name">) => /narrat|documentary|audiobook|announcer|presenter|lecturer/.test(`${v.notes} ${v.name}`.toLowerCase());

const needsVoice = (c: Character, library: VoiceEntry[]) => !isLocked(c) && (!c.voiceId || !library.some((v) => v.id === c.voiceId));

/** True when the character already has a voice the library holds, or an approval: such a character is left exactly as it is. */
export function isCast(c: Character, library: VoiceEntry[]): boolean {
  return !needsVoice(c, library);
}

export function planCasting(characters: Character[], library: VoiceEntry[], context: MatchContext = {}): CastingPlan {
  const plan: CastingPlan = { assign: {}, proposals: [], none: [] };
  const taken = new Set(characters.filter((c) => c.voiceId && library.some((v) => v.id === c.voiceId)).map((c) => c.voiceId!));
  const byId = new Map(library.map((v) => [v.id, v]));
  const profiles = library.map(profileOf);
  const top = new Map<string, string>();

  // Narration names first, so the storyteller gets first pick of the narration voices.
  const ordered = characters.filter((c) => needsVoice(c, library)).sort((a, b) => Number(wantsNarration(b.name)) - Number(wantsNarration(a.name)));
  for (const c of ordered) {
    const req = requirementsOf(c);
    const narration = wantsNarration(c.name);
    const ranked = rank(req, profiles, { ...context, previous: new Set(c.dna?.identity ? [c.dna.identity.voiceId] : []) });
    // Among voices with the same status, prefer one nobody has yet, and (for narrators) a narration voice. Soft only.
    const tweak = (m: MatchResult) => (taken.has(m.voiceId) ? -1 : 0) + (narration && suitsNarration(byId.get(m.voiceId)!) ? 0.5 : 0);
    const offerable = ranked.filter((m) => OFFERABLE.includes(m.status)).sort((a, b) => OFFERABLE.indexOf(a.status) - OFFERABLE.indexOf(b.status) || b.score + tweak(b) - (a.score + tweak(a)));
    const ruledOut = ranked.filter((m) => !OFFERABLE.includes(m.status)).map((m) => ({ voiceId: m.voiceId, why: m.reasons.find((r) => r.outcome === "mismatch")?.text ?? m.reasons.find((r) => r.attribute === "availability")?.text ?? "Not eligible." }));
    if (offerable.length === 0) { plan.none.push({ characterId: c.id, why: ruledOut[0]?.why ?? "The library has no voices." }); continue; }
    const best = offerable[0]!;
    if (best.status === "VERIFIED_MATCH" && !req.empty && !taken.has(best.voiceId)) {
      plan.assign[c.id] = best.voiceId;
      taken.add(best.voiceId);
      continue;
    }
    top.set(c.id, best.voiceId);
    plan.proposals.push({ characterId: c.id, candidates: offerable.slice(0, 5), ruledOut, shared: false });
  }
  const count = new Map<string, number>();
  for (const v of top.values()) count.set(v, (count.get(v) ?? 0) + 1);
  for (const p of plan.proposals) p.shared = (count.get(top.get(p.characterId) ?? "") ?? 0) > 1;
  return plan;
}
