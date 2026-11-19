// Draft casting: when the owner switches it on for a run, the agent may choose a voice for each character that has none, so takes can be
// made and the owner can LISTEN. It is only a draft: nothing is approved, nothing is called verified, nothing the owner chose or approved
// is touched, and the owner's own choice replaces it (see assignVoice, by "draft").
//
// How it chooses, in order: a voice that conflicts with something stated is never used; the best-ranked voice by what is STATED about the
// character (gender, age, language, accent); a voice nobody else got when one is as good; a voice on this PC before a cloud voice, and a
// cloud voice only when the owner allowed cloud work. A character with nothing stated still gets a voice, so the run can go on, but it is
// recorded as a placeholder and says so everywhere it is shown.

import type { Character, VoiceEntry } from "../types";
import { planCasting } from "./autocast";
import { describeRequirements, requirementsOf } from "./requirements";
import type { MatchContext, MatchStatus } from "./types";

export const LOCAL_ENGINES = ["piper", "chatterbox", "kokoro", "qwen", "wazobia", "local"];
/** Engines that make a line in a second or two. Drafts prefer them: the slow ones (Qwen, Chatterbox, WazobiaVoice) take about a minute a line. */
const QUICK = ["piper", "kokoro", "local"];

export interface DraftPick {
  characterId: string;
  voiceId: string;
  status: MatchStatus;
  placeholder: boolean;
  basis: string[];
}

export interface DraftPlan {
  picks: DraftPick[];
  /** Characters no allowed voice can serve at all, with the reason. */
  none: { characterId: string; why: string }[];
}

/**
 * What the voice's own label says about its gender, against the gender that is required. A label is only a claim (the engine does not
 * treat it as proof), but for a DRAFT it is the best information there is: a voice labelled the other gender is skipped, and one labelled
 * the right gender is preferred. 1 = label agrees, 0 = no label, -1 = label disagrees.
 */
function claim(required: "masculine" | "feminine" | undefined, v: VoiceEntry): number {
  if (!required) return 0;
  const g = /^f/i.test(v.gender ?? "") ? "feminine" : /^m/i.test(v.gender ?? "") ? "masculine" : "";
  return !g ? 0 : g === required ? 1 : -1;
}

const tier = (s: MatchStatus): number => (s === "VERIFIED_MATCH" || s === "COMPATIBLE_WITH_LIMITATIONS" ? 0 : 1);
const RANK: MatchStatus[] = ["VERIFIED_MATCH", "COMPATIBLE_WITH_LIMITATIONS", "NEEDS_AUDITION", "UNKNOWN_METADATA"];

/** Which characters get which draft voice. Characters that already have a voice or an approval are never in the result. */
export function planDraftCasting(characters: Character[], library: VoiceEntry[], context: MatchContext = {}, opts: { allowCloud: boolean }): DraftPlan {
  const allowed = library.filter((v) => opts.allowCloud || LOCAL_ENGINES.includes(v.provider));
  const plan = planCasting(characters, allowed, context);
  const byId = new Map(allowed.map((v) => [v.id, v]));
  const byChar = new Map(characters.map((c) => [c.id, c]));
  // voices already in use, or about to be given to a character the plain auto-caster can prove a fit for
  const used = new Set<string>([...characters.filter((c) => c.voiceId).map((c) => c.voiceId!), ...Object.values(plan.assign)]);
  const out: DraftPlan = { picks: [], none: [...plan.none] };
  for (const pr of plan.proposals) {
    const c = byChar.get(pr.characterId)!;
    const req = requirementsOf(c);
    // candidates arrive best first; keep that order but prefer, among equals, a voice on this PC and one nobody has yet
    const need = req.gender?.value === "masculine" || req.gender?.value === "feminine" ? req.gender.value : undefined;
    const cands = pr.candidates
      .filter((m) => RANK.includes(m.status) && byId.has(m.voiceId) && claim(need, byId.get(m.voiceId)!) >= 0)
      .map((m, i) => ({ m, i, local: LOCAL_ENGINES.includes(byId.get(m.voiceId)!.provider), quick: QUICK.includes(byId.get(m.voiceId)!.provider), said: claim(need, byId.get(m.voiceId)!) }))
      // a proven or compatible voice comes first; below that the engine's own wording ("needs an audition" vs "unknown") is too fine a difference
      // to outweigh what the voice's label says, how fast the engine is and whether another character has the voice
      .sort((a, b) => tier(a.m.status) - tier(b.m.status) || b.said - a.said || Number(b.local) - Number(a.local) || Number(b.quick) - Number(a.quick) || Number(used.has(a.m.voiceId)) - Number(used.has(b.m.voiceId)) || a.i - b.i);
    const best = cands[0];
    if (!best) { out.none.push({ characterId: c.id, why: "No allowed voice fits what is stated." }); continue; }
    used.add(best.m.voiceId);
    out.picks.push({
      characterId: c.id,
      voiceId: best.m.voiceId,
      status: best.m.status,
      placeholder: req.empty,
      basis: req.empty ? ["Nothing is stated about this character's voice, so this is only a placeholder that keeps the voices distinct"] : describeRequirements(req),
    });
  }
  return out;
}
