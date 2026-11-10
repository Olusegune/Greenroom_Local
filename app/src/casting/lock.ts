// Casting approval and the guard that keeps it true.
//
// Every change to a character's voice goes through `assignVoice`. Once the owner has approved a voice, nothing else may change it:
// not the auto-caster, a preset, an imported cast, the agent, a script edit or a model switch. The owner can, by confirming.
// `castingGuard` is checked before audio is made, and `auditCasting` before it is exported, so a voice that "sounds good but
// belongs to the wrong character" is caught instead of shipped.

import { setIdentity } from "../voiceDna";
import type { Character, Line, Take, VoiceEntry } from "../types";
import { evaluate, rank, OFFERABLE } from "./engine";
import { requirementsOf } from "./requirements";
import { profileOf } from "./voiceProfile";
import type { Actor, ApprovalEvent, CastingApproval, CharacterCasting, MatchContext, MatchResult, TakeCast } from "./types";

export type AssignCode = "assigned" | "approved" | "unchanged" | "cleared" | "locked" | "needs_owner" | "incompatible" | "needs_acknowledgement" | "unavailable" | "unknown_character";

export interface AssignRequest {
  characterId: string;
  /** The voice to give the character, or null to clear it. */
  voice: VoiceEntry | null;
  by: Actor;
  /** Approve (lock) this voice for the character. Only the owner can approve. */
  approve?: boolean;
  /** The owner confirms replacing an approved voice, or one already chosen. */
  confirmChange?: boolean;
  /** The owner accepts that something about this voice is unverified or unknown. Needed to approve such a voice. */
  acknowledge?: boolean;
  /** The owner chooses a voice that conflicts with a stated requirement, knowing it does. Recorded. */
  override?: boolean;
  modelId?: string | null;
  now: string;
  context?: MatchContext;
}

export interface AssignResult {
  characters: Character[];
  ok: boolean;
  code: AssignCode;
  message: string;
  match?: MatchResult;
}

const MAX_HISTORY = 100;
const OWNERS: Actor[] = ["owner", "test_harness"];

function withHistory(c: Character, e: ApprovalEvent): CharacterCasting {
  const base = c.casting ?? { version: 1 as const, history: [] };
  return { ...base, history: [...base.history, e].slice(-MAX_HISTORY) };
}

export const isLocked = (c: Pick<Character, "casting">): boolean => !!c.casting?.approval;
export const approvedVoiceId = (c: Pick<Character, "casting">): string | undefined => c.casting?.approval?.voiceId;

/** What the owner accepted, in words, when approving a voice whose facts are not all proven. */
function acknowledgedFacts(m: MatchResult): string[] {
  return m.reasons.filter((r) => r.level === "hard" && (r.outcome === "unverified" || r.outcome === "unknown")).map((r) => r.text);
}

/**
 * The only way a character's voice changes. Returns new characters (the input is never changed) and says plainly what happened.
 * Rules: an approved voice is replaced only by the owner confirming; the auto-caster, presets, imported casts, the agent and
 * script or model changes may fill an EMPTY slot and never replace anything; approval needs the owner, and a voice whose
 * required facts are unverified needs the owner's acknowledgement; a voice that conflicts needs an explicit override.
 */
export function assignVoice(characters: Character[], req: AssignRequest): AssignResult {
  const idx = characters.findIndex((c) => c.id === req.characterId);
  const fail = (code: AssignCode, message: string, match?: MatchResult): AssignResult => ({ characters, ok: false, code, message, ...(match ? { match } : {}) });
  if (idx < 0) return fail("unknown_character", "That character is not in this project.");
  const c = characters[idx]!;
  const owner = OWNERS.includes(req.by);
  const approved = c.casting?.approval;
  const record = (e: ApprovalEvent): Character[] => characters.map((x, i) => (i === idx ? { ...x, casting: withHistory(x, e) } : x));

  if (approved) {
    if (!owner || !req.confirmChange) {
      const msg = `${c.name} has an approved voice (${approved.voiceName}). It can only be changed by you, after confirming.`;
      return { characters: record({ at: req.now, action: "refused", voiceId: req.voice?.id ?? null, by: req.by, reason: `Tried to change an approved voice (${req.by}).` }), ok: false, code: "locked", message: msg };
    }
  } else if (c.voiceId && !owner && req.voice && req.voice.id !== c.voiceId) {
    return fail("needs_owner", `${c.name} already has a voice. Only you can replace it.`);
  }

  if (!req.voice) {
    const { voiceId: _gone, ...rest } = c;
    void _gone;
    const next: Character = { ...rest, casting: withHistory(c, { at: req.now, action: approved ? "unlocked" : "assigned", voiceId: null, by: req.by, reason: "Voice cleared." }) };
    delete (next.casting as { approval?: CastingApproval }).approval;
    return { characters: characters.map((x, i) => (i === idx ? next : x)), ok: true, code: "cleared", message: `${c.name} has no voice now.` };
  }

  const profile = profileOf(req.voice);
  const match = evaluate(requirementsOf(c), profile, req.context ?? {});

  // An unavailable or incompatible voice is never given silently. The owner may override a conflict, knowingly.
  if (match.status === "INCOMPATIBLE" && !(owner && req.override)) {
    return fail("incompatible", `${req.voice.name} does not fit ${c.name}: ${match.reasons.find((r) => r.outcome === "mismatch")?.text ?? "a stated requirement is not met."}`, match);
  }
  if (match.status === "UNAVAILABLE" && !owner) return fail("unavailable", `${req.voice.name} cannot be used right now.`, match);

  if (req.approve) {
    if (!owner) return fail("needs_owner", "Only you can approve a voice.", match);
    const unproven = acknowledgedFacts(match);
    if ((match.status === "NEEDS_AUDITION" || match.status === "UNKNOWN_METADATA" || match.status === "UNAVAILABLE") && !req.acknowledge) {
      return fail("needs_acknowledgement", `${req.voice.name} is "${match.status === "NEEDS_AUDITION" ? "listen first" : match.status === "UNAVAILABLE" ? "not available" : "not enough known"}" for ${c.name}. Listen to it, then approve and accept what is unverified.`, match);
    }
    const version = (approved?.version ?? 0) + 1;
    const approval: CastingApproval = { voiceId: req.voice.id, engine: req.voice.provider, voiceName: req.voice.name, modelId: req.modelId ?? profile.modelId, speakerId: profile.speakerId, approvedAt: req.now, version, basis: match.status, acknowledged: match.status === "INCOMPATIBLE" ? ["Approved despite a conflicting requirement: " + (match.reasons.find((r) => r.outcome === "mismatch")?.text ?? "")] : unproven, by: req.by };
    const next: Character = { ...c, voiceId: req.voice.id, casting: { ...withHistory(c, { at: req.now, action: approved ? "changed" : "approved", voiceId: req.voice.id, by: req.by, reason: `Approved as "${match.status}".` }), approval }, dna: setIdentity(c.dna, req.voice, approval.modelId) };
    return { characters: characters.map((x, i) => (i === idx ? next : x)), ok: true, code: "approved", message: `${req.voice.name} is approved for ${c.name} and locked.`, match };
  }

  if (c.voiceId === req.voice.id) return { characters, ok: true, code: "unchanged", message: `${c.name} already has ${req.voice.name}.`, match };
  const next: Character = { ...c, voiceId: req.voice.id, casting: withHistory(c, { at: req.now, action: "assigned", voiceId: req.voice.id, by: req.by, reason: `Assigned as "${match.status}" (not approved).` }) };
  return { characters: characters.map((x, i) => (i === idx ? next : x)), ok: true, code: "assigned", message: `${req.voice.name} is chosen for ${c.name}. Listen, then approve it to lock it.`, match };
}

/** Takes the owner's approval away so the voice can be changed. Only the owner can. */
export function unlockVoice(characters: Character[], characterId: string, by: Actor, now: string): AssignResult {
  const c = characters.find((x) => x.id === characterId);
  if (!c) return { characters, ok: false, code: "unknown_character", message: "That character is not in this project." };
  if (!OWNERS.includes(by)) return { characters, ok: false, code: "needs_owner", message: "Only you can unlock an approved voice." };
  if (!c.casting?.approval) return { characters, ok: true, code: "unchanged", message: `${c.name} is not locked.` };
  const casting: CharacterCasting = { ...withHistory(c, { at: now, action: "unlocked", voiceId: c.casting.approval.voiceId, by, reason: "Approval removed by the owner." }) };
  delete (casting as { approval?: CastingApproval }).approval;
  return { characters: characters.map((x) => (x.id === characterId ? { ...x, casting } : x)), ok: true, code: "cleared", message: `${c.name} is unlocked. Its voice stays until you change it.` };
}

// ---- Before audio is made --------------------------------------------------------------------------------------

export type GuardCode = "ok" | "no_character" | "no_voice" | "voice_changed" | "voice_missing" | "engine_changed" | "model_changed";

export interface GuardResult {
  ok: boolean;
  code: GuardCode;
  message: string;
  /** The identity to record on the take. Present when ok. */
  cast?: TakeCast;
  /** When an approved voice is not usable: voices that fit, offered as choices. Never applied automatically. */
  alternatives: MatchResult[];
}

/**
 * Checks that the voice about to speak a line is the voice this character was approved with (or, for a character that was never
 * approved, the voice it has). Used by every path that makes audio. It never replaces anything: it refuses, and offers choices.
 */
export function castingGuard(character: Character | undefined, voice: VoiceEntry | undefined, library: VoiceEntry[], modelId: string | null = null, context: MatchContext = {}): GuardResult {
  const none: MatchResult[] = [];
  if (!character) return { ok: false, code: "no_character", message: "This line has no character.", alternatives: none };
  const approval = character.casting?.approval;
  const alternatives = (): MatchResult[] => rank(requirementsOf(character), library.map(profileOf), context).filter((m) => OFFERABLE.includes(m.status)).slice(0, 5);
  if (!voice) return { ok: false, code: approval ? "voice_missing" : "no_voice", message: approval ? `${character.name}'s approved voice (${approval.voiceName}) is not available. It was not replaced. Choose one of the voices that fit, or restore it.` : `${character.name} has no voice yet.`, alternatives: alternatives() };
  const profile = profileOf(voice);
  if (approval) {
    if (voice.id !== approval.voiceId) return { ok: false, code: "voice_changed", message: `${character.name} was approved with ${approval.voiceName}, but ${voice.name} was about to speak. Nothing was made.`, alternatives: none };
    if (voice.provider !== approval.engine) return { ok: false, code: "engine_changed", message: `${character.name}'s approved voice belongs to a different engine than ${voice.provider}. Nothing was made.`, alternatives: alternatives() };
    if (approval.modelId && modelId && approval.modelId !== modelId) return { ok: false, code: "model_changed", message: `${character.name} was approved on ${approval.modelId}; ${modelId} can sound different. Confirm the change in Casting before making audio.`, alternatives: none };
  } else if (character.voiceId && character.voiceId !== voice.id) {
    return { ok: false, code: "voice_changed", message: `${character.name}'s voice is ${character.voiceId}, but ${voice.name} was about to speak. Nothing was made.`, alternatives: none };
  }
  return { ok: true, code: "ok", message: "", alternatives: none, cast: { characterId: character.id, voiceId: voice.id, engine: voice.provider, modelId: approval?.modelId ?? modelId ?? profile.modelId, speakerId: profile.speakerId, castingVersion: approval?.version ?? null } };
}

/** Stamps a take with the identity it was made for. */
export const stamp = (take: Take, cast: TakeCast): Take => ({ ...take, cast });

// ---- Before audio is exported ------------------------------------------------------------------------------------

export interface CastingIssue { severity: "problem" | "listen"; lineId: string; characterId: string; kind: "voice_mismatch" | "unstamped" | "unapproved" | "voice_missing" | "version_changed"; text: string }

/**
 * Compares the chosen take of every line with the voice its character is approved with. A take made with some other voice,
 * or for some other character, is a problem: the audio belongs to the wrong person.
 */
export function auditCasting(characters: Character[], lines: Line[], library: VoiceEntry[]): CastingIssue[] {
  const out: CastingIssue[] = [];
  const chars = new Map(characters.map((c) => [c.id, c]));
  for (const l of lines) {
    const take = l.takes.find((t) => t.id === l.chosen);
    if (!take) continue;
    const c = chars.get(l.characterId);
    if (!c) { out.push({ severity: "problem", lineId: l.id, characterId: l.characterId, kind: "voice_mismatch", text: "This line's character is no longer in the project." }); continue; }
    const approval = c.casting?.approval;
    const want = approval?.voiceId ?? c.voiceId;
    if (take.cast && take.cast.characterId !== c.id) out.push({ severity: "problem", lineId: l.id, characterId: c.id, kind: "voice_mismatch", text: `${c.name}'s line uses a take that was made for another character.` });
    else if (want && take.voiceId !== want) out.push({ severity: "problem", lineId: l.id, characterId: c.id, kind: "voice_mismatch", text: `${c.name}'s line uses a take made with a different voice (${take.provenance?.voiceName ?? take.voiceId}) than the one ${approval ? "approved" : "chosen"} (${approval?.voiceName ?? want}).` });
    else if (approval && take.cast && take.cast.castingVersion !== null && take.cast.castingVersion !== approval.version) out.push({ severity: "listen", lineId: l.id, characterId: c.id, kind: "version_changed", text: `${c.name}'s take was made under an earlier approval of the voice.` });
    else if (approval && !take.cast) out.push({ severity: "listen", lineId: l.id, characterId: c.id, kind: "unstamped", text: `${c.name}'s take was made before voices were recorded with takes; it matches the approved voice but cannot be traced further.` });
    if (approval && !library.some((v) => v.id === approval.voiceId)) out.push({ severity: "problem", lineId: l.id, characterId: c.id, kind: "voice_missing", text: `${c.name}'s approved voice (${approval.voiceName}) is no longer in the library.` });
  }
  return out;
}
