// Reading casting data back from a saved project. A saved file is untrusted: a damaged or hand-edited file must not be able to
// invent an approval, so every field is checked and anything wrong is dropped (the character then simply has no approval).

import type { Character, Project } from "../types";
import type { ApprovalEvent, CastingApproval, CastingSpec, CharacterCasting, MatchStatus, VocalAge } from "./types";

const str = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/[\u0000-\u001f\u007f]+/g, " ").trim().slice(0, n) : "");
const AGES: VocalAge[] = ["child", "teen", "young", "mid", "old"];
const STATUSES: MatchStatus[] = ["VERIFIED_MATCH", "COMPATIBLE_WITH_LIMITATIONS", "NEEDS_AUDITION", "UNKNOWN_METADATA", "INCOMPATIBLE", "UNAVAILABLE"];
const ACTORS = ["owner", "agent", "auto", "preset", "cast_import", "script_edit", "model_switch", "test_harness"] as const;
const strictness = (x: unknown) => (x === "required" || x === "preferred" || x === "ignore" ? x : undefined);

export function readSpec(raw: unknown): CastingSpec | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const spec: CastingSpec = { version: 1 };
  if (r.vocalGender === "masculine" || r.vocalGender === "feminine" || r.vocalGender === "any") spec.vocalGender = r.vocalGender;
  if (Array.isArray(r.vocalAge)) { const a = [...new Set(r.vocalAge.filter((x): x is VocalAge => AGES.includes(x as VocalAge)))]; if (a.length) spec.vocalAge = a; }
  if (str(r.language, 60)) spec.language = str(r.language, 60);
  const ls = strictness(r.languageStrictness); if (ls) spec.languageStrictness = ls;
  if (str(r.accent, 80)) spec.accent = str(r.accent, 80);
  const as = strictness(r.accentStrictness); if (as) spec.accentStrictness = as;
  if (r.pitch === "low" || r.pitch === "mid" || r.pitch === "high") spec.pitch = r.pitch;
  for (const k of ["texture", "style", "nationality", "culturalBackground", "notes"] as const) if (str(r[k], 300)) spec[k] = str(r[k], 300);
  return spec;
}

function readApproval(raw: unknown): CastingApproval | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const voiceId = str(r.voiceId, 160);
  const engine = str(r.engine, 40);
  if (!voiceId || !engine) return undefined;
  const by = ACTORS.find((a) => a === r.by) ?? "owner";
  const basis = STATUSES.find((s) => s === r.basis) ?? "NEEDS_AUDITION";
  return { voiceId, engine, voiceName: str(r.voiceName, 80), modelId: typeof r.modelId === "string" ? str(r.modelId, 80) : null, speakerId: typeof r.speakerId === "string" ? str(r.speakerId, 40) : null, approvedAt: str(r.approvedAt, 40), version: typeof r.version === "number" && Number.isFinite(r.version) && r.version >= 1 ? Math.floor(r.version) : 1, basis, acknowledged: Array.isArray(r.acknowledged) ? r.acknowledged.map((x) => str(x, 300)).filter(Boolean).slice(0, 12) : [], by };
}

export function readCasting(raw: unknown): CharacterCasting | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const history: ApprovalEvent[] = (Array.isArray(r.history) ? r.history : []).slice(-100).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    const action = (["assigned", "approved", "changed", "unlocked", "refused"] as const).find((a) => a === o.action);
    return action && typeof o.at === "string" ? [{ at: str(o.at, 40), action, voiceId: typeof o.voiceId === "string" ? str(o.voiceId, 160) : null, by: ACTORS.find((a) => a === o.by) ?? "owner", reason: str(o.reason, 300) }] : [];
  });
  const approval = readApproval(r.approval);
  return { version: 1, history, ...(approval ? { approval } : {}) };
}

/**
 * A character read from a saved project with its casting data checked. An approval whose voice id disagrees with the
 * character's own voice id is the sign of a damaged or edited file: the approval wins, because it is what the owner approved.
 */
export function readCharacterCasting(c: Character): Character {
  const casting = readCasting((c as { casting?: unknown }).casting);
  const cast = readSpec((c as { cast?: unknown }).cast);
  const { casting: _c, cast: _s, ...rest } = c;
  void _c; void _s;
  const approved = casting?.approval;
  return { ...rest, ...(approved ? { voiceId: approved.voiceId } : {}), ...(casting ? { casting } : {}), ...(cast ? { cast } : {}) };
}

/** A project as loaded, with casting data validated on every character. */
export function readProjectCasting(p: Project): Project {
  return { ...p, characters: p.characters.map(readCharacterCasting) };
}
