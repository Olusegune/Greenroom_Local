import { PIPER_ROLES, type PiperRole } from "./castcall";
import { evaluate } from "./casting/engine";
import { planCasting, wantsNarration, type Proposal } from "./casting/autocast";
import { requirementsOf } from "./casting/requirements";
import { profileOf } from "./casting/voiceProfile";
import type { Character, VoiceEntry } from "./types";

export { wantsNarration };

/**
 * What auto-casting can do. It decides nothing it cannot prove: `assign` holds only voices PROVEN to fit what the character
 * requires (and only for characters with no voice). Everything else is a proposal for the owner, with reasons. The matching
 * rules live in `casting/engine.ts`; nothing here ranks a voice by itself.
 */
export interface CastPlan {
  /** Character id to library voice id: voices that are a VERIFIED_MATCH for a stated requirement. */
  assign: Record<string, string>;
  /** Characters with candidates for the owner to choose from, best first, each with its reasons. */
  proposals: Proposal[];
  /** Characters no voice in the library can serve, with why. */
  none: { characterId: string; why: string }[];
  /** Voices from the Casting call that could serve characters the library cannot (never one that conflicts with a stated requirement). */
  suggestions: { characterId: string; role: PiperRole }[];
}

const roleVoice = (r: PiperRole): VoiceEntry => ({ id: r.key, name: r.name, provider: "piper", source: "library", language: r.language, accent: r.accent, gender: "", notes: r.use, createdAt: "" });

export function planCast(characters: Character[], library: VoiceEntry[], options: { roles?: PiperRole[] } = {}): CastPlan {
  const roles = options.roles ?? PIPER_ROLES;
  const base = planCasting(characters, library);
  const plan: CastPlan = { assign: base.assign, proposals: base.proposals, none: base.none, suggestions: [] };
  const used = new Set(library.map((v) => v.id));
  const lacking = new Set([...base.none.map((n) => n.characterId), ...base.proposals.filter((p) => p.shared).map((p) => p.characterId)]);
  for (const c of characters) {
    if (!lacking.has(c.id)) continue;
    const req = requirementsOf(c);
    const fresh = roles.find((r) => !used.has(r.key) && evaluate(req, profileOf(roleVoice(r))).status !== "INCOMPATIBLE");
    if (fresh) { plan.suggestions.push({ characterId: c.id, role: fresh }); used.add(fresh.key); }
  }
  return plan;
}

export function describePlan(plan: CastPlan, characters: Character[], library: VoiceEntry[]): string[] {
  return Object.entries(plan.assign).map(([cid, vid]) => `${characters.find((c) => c.id === cid)?.name ?? cid}: ${library.find((v) => v.id === vid)?.name ?? vid}`);
}
