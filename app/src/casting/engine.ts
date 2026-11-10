// The Casting Integrity Engine: the one place that decides whether a voice fits a character.
// Every screen, the auto-caster, the presets, the agent and the generation guard call this. There are no other matching rules.
//
// Hard requirements (language, vocal presentation, vocal age, a required accent, consent, licence, availability) are never relaxed.
// An UNKNOWN fact is not proof of a fit: it makes the result UNKNOWN_METADATA, and a stated-but-unconfirmed fact makes it NEEDS_AUDITION.
// Soft preferences (texture, pitch, style, favourites) only order voices that already have the same status.

import { AGE_ORDER, DEFAULT_WEIGHTS, STATUS_ORDER, type Fact, type MatchContext, type MatchResult, type MatchStatus, type Outcome, type Reason, type Requirements, type VocalAge, type VoiceProfile, type Weights } from "./types";
import { accentRelation, langKey } from "./lang";
import { ageWord } from "./requirements";

const verified = (f: Fact<unknown>) => f.status === "verified";
const word = (g: string) => (g === "masculine" ? "a masculine voice" : g === "feminine" ? "a feminine voice" : "an androgynous voice");
const lead = (p: VoiceProfile) => p.name;

/** The outcome of a stated fact that agrees with the requirement: proof if verified, otherwise only a claim. */
const agree = (f: Fact<unknown>): Outcome => (verified(f) ? "match" : "unverified");

function checkGender(req: Requirements, p: VoiceProfile, out: Reason[]) {
  const r = req.gender;
  if (!r) return;
  const hard = r.strictness === "required";
  const level = hard ? "hard" : "soft";
  const have = p.gender;
  if (have.value === null) return void out.push({ attribute: "gender", level, outcome: "unknown", text: `${lead(p)} has no recorded vocal presentation, so it cannot be shown to be ${word(r.value)} (needed: ${r.origin}). Listen and record it.${have.note ? " " + have.note : ""}` });
  if (have.value === r.value) return void out.push({ attribute: "gender", level, outcome: agree(have), text: `${lead(p)} is recorded as ${word(have.value)}${verified(have) ? " (confirmed by listening)" : " (stated, not yet confirmed by listening)"}.` });
  if (have.value === "androgynous") return void out.push({ attribute: "gender", level, outcome: verified(have) ? "limitation" : "unverified", text: `${lead(p)} is recorded as androgynous; ${r.origin} calls for ${word(r.value)}.` });
  out.push({ attribute: "gender", level, outcome: "mismatch", text: `${lead(p)} is recorded as ${word(have.value)}; ${r.origin} calls for ${word(r.value)}.` });
}

function checkAge(req: Requirements, p: VoiceProfile, out: Reason[]) {
  const r = req.age;
  if (!r) return;
  const level = r.strictness === "required" ? "hard" : "soft";
  const have = p.age;
  if (have.value === null) return void out.push({ attribute: "age", level, outcome: "unknown", text: `${lead(p)} has no recorded vocal age, so it cannot be shown to sound like ${r.value.map(ageWord).join(" or ")} (${r.origin}). Listen and record it.` });
  const h = have.value as VocalAge;
  if (r.value.includes(h)) return void out.push({ attribute: "age", level, outcome: agree(have), text: `${lead(p)} is recorded as sounding like ${ageWord(h)}${verified(have) ? " (confirmed by listening)" : " (stated, not yet confirmed)"}.` });
  const gap = Math.min(...r.value.map((w) => Math.abs(AGE_ORDER.indexOf(w) - AGE_ORDER.indexOf(h))));
  const childClash = (r.value.every((w) => w === "child") && h !== "child") || (h === "child" && !r.value.includes("child"));
  if (childClash || gap >= 2) return void out.push({ attribute: "age", level, outcome: "mismatch", text: `${lead(p)} sounds like ${ageWord(h)}; ${r.origin} calls for ${r.value.map(ageWord).join(" or ")}.` });
  out.push({ attribute: "age", level, outcome: verified(have) ? "limitation" : "unverified", text: `${lead(p)} sounds like ${ageWord(h)}, one step from ${r.value.map(ageWord).join(" or ")} (${r.origin}).` });
}

function checkLanguage(req: Requirements, p: VoiceProfile, out: Reason[]) {
  const r = req.language;
  if (!r) return;
  const level = r.strictness === "required" ? "hard" : "soft";
  const want = langKey(r.value);
  const have = p.languages;
  if (have.value === null) return void out.push({ attribute: "languages", level, outcome: "unknown", text: `Greenroom does not know which languages ${lead(p)} speaks, so it cannot be shown to speak ${r.value}.` });
  if (have.value.includes(want)) return void out.push({ attribute: "languages", level, outcome: agree(have), text: `${lead(p)} speaks ${r.value}${verified(have) ? "" : " (stated; nobody has listened to it speak that language)"}.` });
  if (p.mayBeMultilingual && !verified(have)) return void out.push({ attribute: "languages", level, outcome: "unknown", text: `${lead(p)} is labelled ${have.value.join(", ")}. Some voices from this provider can speak other languages, but Greenroom has not verified that it speaks ${r.value}. Audition it in ${r.value} first.` });
  out.push({ attribute: "languages", level, outcome: "mismatch", text: `${lead(p)} speaks ${have.value.join(", ")} only; ${r.origin} needs ${r.value}.` });
}

function checkAccent(req: Requirements, p: VoiceProfile, out: Reason[]) {
  const r = req.accent;
  if (!r) return;
  const hard = r.strictness === "required";
  const level = hard ? "hard" : "soft";
  const rel = accentRelation(r.value, p.accent.value);
  if (rel === "unknown") return void out.push({ attribute: "accent", level, outcome: hard ? "unknown" : "info", text: `${lead(p)} has no recorded accent, so a ${r.value} accent cannot be shown.` });
  if (rel === "same") return void out.push({ attribute: "accent", level, outcome: agree(p.accent), text: `${lead(p)}'s accent is recorded as ${p.accent.value}${verified(p.accent) ? "" : " (a label; nobody has listened to how convincing it is)"}.` });
  if (rel === "related") return void out.push({ attribute: "accent", level, outcome: hard ? (verified(p.accent) ? "limitation" : "unverified") : "limitation", text: `${lead(p)}'s accent is ${p.accent.value}, related to but not the same as ${r.value}.` });
  out.push({ attribute: "accent", level, outcome: hard ? "mismatch" : "limitation", text: `${lead(p)}'s accent is ${p.accent.value}, not ${r.value}.` });
}

/** Judges one voice against a character's requirements. Always returns reasons. */
export function evaluate(req: Requirements, p: VoiceProfile, ctx: MatchContext = {}): MatchResult {
  const reasons: Reason[] = [];

  // Eligibility first: consent and licence are never traded for a better fit.
  if (!p.consentOk) reasons.push({ attribute: "consent", level: "hard", outcome: "mismatch", text: `${lead(p)} is a cloned voice with no consent record, so it cannot be used.` });
  if (ctx.commercial) {
    if (p.commercial.status === "forbidden") reasons.push({ attribute: "licence", level: "hard", outcome: "mismatch", text: `${lead(p)} is not licensed for commercial use. ${p.commercial.note}` });
    else if (p.commercial.status === "unknown") reasons.push({ attribute: "licence", level: "hard", outcome: "unknown", text: `${lead(p)} has no recorded licence, so commercial use cannot be confirmed.` });
  }

  checkGender(req, p, reasons);
  checkAge(req, p, reasons);
  checkLanguage(req, p, reasons);
  checkAccent(req, p, reasons);

  // Availability: a voice that cannot be used right now is reported, never swapped for another one.
  const avail = ctx.available?.(p.voiceId) ?? { ok: true };
  const localOnlyBlock = ctx.localOnly === true && !["piper", "kokoro", "chatterbox", "qwen", "wazobia", "local"].includes(p.provider);
  if (!avail.ok || localOnlyBlock) reasons.push({ attribute: "availability", level: "hard", outcome: "unknown", text: localOnlyBlock ? `${lead(p)} is a cloud voice and this production is local-only.` : `${lead(p)} cannot be used right now: ${avail.why ?? "its engine or files are not available"}.` });

  if (req.empty) reasons.push({ attribute: "requirements", level: "info", outcome: "info", text: "No casting requirements are stated for this character, so nothing about this voice could be checked. Add what you know (vocal gender, age, language, accent) to get a verified match." });

  // A preference that is not met is a limit, not a ruling. An unknown preference says nothing.
  for (const r of reasons) {
    if (r.level === "soft" && r.outcome === "mismatch") r.outcome = "limitation";
    if (r.level === "soft" && r.outcome === "unknown") r.outcome = "info";
  }

  const hard = reasons.filter((r) => r.level === "hard");
  const has = (o: Outcome) => hard.some((r) => r.outcome === o);
  const unavailable = reasons.some((r) => r.attribute === "availability");
  const unknownHard = hard.some((r) => r.outcome === "unknown" && r.attribute !== "availability");

  let status: MatchStatus;
  if (has("mismatch")) status = "INCOMPATIBLE";
  else if (unavailable) status = "UNAVAILABLE";
  else if (unknownHard) status = "UNKNOWN_METADATA";
  else if (has("unverified")) status = "NEEDS_AUDITION";
  else if (req.empty || has("limitation") || reasons.some((r) => r.level === "soft" && r.outcome === "limitation")) status = "COMPATIBLE_WITH_LIMITATIONS";
  else status = "VERIFIED_MATCH";

  // A match is "verified" only when something was actually required and proven. Soft limitations still keep it honest.
  const w: Weights = { ...DEFAULT_WEIGHTS, ...ctx.weights };
  let score = hard.filter((r) => r.outcome === "match").length * 3 + hard.filter((r) => r.outcome === "unverified").length;
  score += reasons.filter((r) => r.level === "soft" && (r.outcome === "match" || r.outcome === "unverified")).length * 4;
  if (req.pitch && p.pitch.value) score += p.pitch.value === req.pitch.value ? w.pitch : 0;
  if (req.texture && p.texture.value) {
    const a = new Set(req.texture.value.toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 2));
    const b = p.texture.value.toLowerCase().split(/[^a-z]+/).filter((x) => x.length > 2);
    if (b.some((t) => a.has(t))) score += w.texture;
  }
  if (ctx.favorites?.has(p.voiceId)) score += w.favorite;
  if (ctx.previous?.has(p.voiceId)) score += w.previous;
  if (["piper", "kokoro", "chatterbox", "qwen", "wazobia", "local"].includes(p.provider)) score += w.local;

  return { voiceId: p.voiceId, status, score, reasons };
}

/** Every voice judged and ordered: best status first, then the soft score, then the name. Nothing is dropped, so the owner can see why a voice was ruled out. */
export function rank(req: Requirements, voices: VoiceProfile[], ctx: MatchContext = {}): MatchResult[] {
  const byId = new Map(voices.map((v) => [v.voiceId, v]));
  return voices
    .map((v) => evaluate(req, v, ctx))
    .sort((a, b) => STATUS_ORDER.indexOf(a.status) - STATUS_ORDER.indexOf(b.status) || b.score - a.score || (byId.get(a.voiceId)?.name ?? "").localeCompare(byId.get(b.voiceId)?.name ?? ""));
}

/** The statuses that may be offered as a choice at all. INCOMPATIBLE voices are shown only as "ruled out". */
export const OFFERABLE: MatchStatus[] = ["VERIFIED_MATCH", "COMPATIBLE_WITH_LIMITATIONS", "NEEDS_AUDITION", "UNKNOWN_METADATA"];

/** One line a person can read: the status and the first reason that decided it. */
export function summaryOf(m: MatchResult): string {
  const decisive = m.reasons.find((r) => r.level === "hard" && r.outcome === "mismatch") ?? m.reasons.find((r) => r.level === "hard" && r.outcome === "unknown") ?? m.reasons.find((r) => r.level === "hard" && r.outcome === "unverified") ?? m.reasons.find((r) => r.outcome === "limitation") ?? m.reasons[0];
  return decisive ? decisive.text : "All stated requirements are confirmed.";
}
