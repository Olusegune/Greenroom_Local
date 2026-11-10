// The Casting Integrity table: for one character and one voice, what the character REQUIRES against what the voice can be SHOWN to
// deliver, one row per thing, plus the voice's identity and lock. It adds no rules: every row is read from the match engine's own
// reasons, so the table can never say "meets" where the engine says "listen first".

import type { Character, VoiceEntry } from "../types";
import { evaluate } from "./engine";
import { describeRequirements, requirementsOf, ageWord } from "./requirements";
import { STATUS_LABEL, type MatchContext, type MatchResult, type MatchStatus, type Reason, type Requirements, type VoiceProfile } from "./types";
import { profileOf } from "./voiceProfile";

/** verified: proven. claimed: stated, not confirmed by listening. unknown: nobody has said. conflict: contradicts the requirement. limit: close but not exact. none: nothing was required. */
export type RowState = "verified" | "claimed" | "unknown" | "conflict" | "limit" | "none";

export interface IntegrityRow {
  id: "gender" | "age" | "language" | "accent" | "licence" | "availability" | "identity";
  label: string;
  /** What the character requires, in words ("Needs a masculine voice"), or "Not required". */
  required: string;
  /** What the voice is recorded as ("Masculine, stated by the provider"), or "Unknown". */
  has: string;
  state: RowState;
  /** The engine's own sentence for this row. */
  why: string;
}

export interface Integrity {
  voiceId: string;
  voiceName: string;
  status: MatchStatus;
  statusLabel: string;
  rows: IntegrityRow[];
  locked: boolean;
  /** One honest sentence for the footer. Never says "meets" unless everything required is proven. */
  summary: string;
}

const STATE_OF: Record<string, RowState> = { match: "verified", unverified: "claimed", unknown: "unknown", mismatch: "conflict", limitation: "limit", info: "none" };

const genderWord = (g: string | null) => (g === "masculine" ? "Masculine" : g === "feminine" ? "Feminine" : g === "androgynous" ? "Androgynous" : "Unknown");
const sourceWord = (s: string) => ({ owner_listening: "you confirmed by listening", owner_entered: "entered by you, not confirmed", provider_label: "the provider's label", model_config: "fixed by how the voice works", engine_documentation: "the engine's documentation", corpus_documentation: "the corpus documentation", name_table: "a guess from the name", description_text: "a guess from the description", none: "" } as Record<string, string>)[s] ?? "";
const describe = (v: string, status: string, source: string) => (v === "Unknown" ? "Unknown" : status === "verified" ? `${v} (confirmed)` : `${v} (claimed${sourceWord(source) ? ": " + sourceWord(source) : ""})`);

function rowFrom(reasons: Reason[], attr: Reason["attribute"], fallback: RowState = "none"): { state: RowState; why: string } {
  const rs = reasons.filter((r) => r.attribute === attr);
  if (!rs.length) return { state: fallback, why: "" };
  // the most serious outcome decides the row
  const order = ["mismatch", "unknown", "unverified", "limitation", "match", "info"];
  const worst = [...rs].sort((a, b) => order.indexOf(a.outcome) - order.indexOf(b.outcome))[0]!;
  return { state: STATE_OF[worst.outcome] ?? "none", why: worst.text };
}

function summaryFor(status: MatchStatus, locked: boolean, rows: IntegrityRow[], name: string): string {
  const lock = locked ? " Casting stays locked unless you change it." : "";
  const weak = rows.filter((r) => r.state === "claimed" || r.state === "unknown").map((r) => r.label.toLowerCase());
  switch (status) {
    case "VERIFIED_MATCH": return `Everything required is confirmed for ${name}.${lock}`;
    case "COMPATIBLE_WITH_LIMITATIONS": return `${name} fits what is stated, with limits noted above.${lock}`;
    case "NEEDS_AUDITION": return `${name} matches what is stated, but ${weak.join(" and ") || "some of it"} has not been confirmed by listening.${lock}`;
    case "UNKNOWN_METADATA": return `Not enough is known about ${name} to say it fits: ${weak.join(", ") || "something required"} is unknown. Listen and record it.${lock}`;
    case "INCOMPATIBLE": return `${name} does not fit: a stated requirement is contradicted.${lock}`;
    case "UNAVAILABLE": return `${name} cannot be used right now.${lock}`;
  }
}

/** The table for a character and a voice. `voice` may be the approved voice, the chosen voice, or any candidate. */
export function integrityOf(character: Character, voice: VoiceEntry, ctx: MatchContext = {}): Integrity {
  const req: Requirements = requirementsOf(character);
  const p: VoiceProfile = profileOf(voice);
  const m: MatchResult = evaluate(req, p, ctx);
  const rs = m.reasons;
  const approval = character.casting?.approval;
  const locked = approval?.voiceId === voice.id;
  const mk = (id: IntegrityRow["id"], label: string, required: string, has: string, attr: Reason["attribute"], fallback: RowState = "none"): IntegrityRow => ({ id, label, required, has, ...rowFrom(rs, attr, fallback) });

  const rows: IntegrityRow[] = [
    mk("gender", "Vocal presentation", req.gender ? `${genderWord(req.gender.value)}${req.gender.strictness === "preferred" ? " (preferred)" : ""}` : "Not required", describe(genderWord(p.gender.value), p.gender.status, p.gender.source), "gender"),
    mk("age", "Sounds like", req.age ? req.age.value.map(ageWord).join(" or ") : "Not required", p.age.value ? describe(ageWord(p.age.value), p.age.status, p.age.source) : "Unknown", "age"),
    mk("language", "Language", req.language ? `${req.language.value}${req.language.strictness === "preferred" ? " (preferred)" : ""}` : "Not required", p.languages.value?.length ? describe(p.languages.value.join(", "), p.languages.status, p.languages.source) : "Unknown", "languages"),
    mk("accent", "Accent", req.accent ? `${req.accent.value}${req.accent.strictness === "preferred" ? " (preferred)" : ""}` : "Not required", p.accent.value ? describe(p.accent.value, p.accent.status, p.accent.source) : "Unknown", "accent"),
  ];
  // Only rows that matter appear: licence and consent when something is wrong or a commercial project asks, availability when it is not.
  const lic = rowFrom(rs, "licence");
  const con = rowFrom(rs, "consent");
  if (con.state !== "none") rows.push({ id: "licence", label: "Consent", required: "A consent record for a cloned voice", has: p.consentOk ? "Recorded" : "Missing", ...con });
  else if (lic.state !== "none") rows.push({ id: "licence", label: "Licence", required: "Commercial use", has: p.commercial.status === "allowed" ? "Allowed" : p.commercial.status === "forbidden" ? "Not allowed" : "Unknown", ...lic });
  const av = rowFrom(rs, "availability");
  if (av.state !== "none") rows.push({ id: "availability", label: "Available", required: "Ready to use", has: "Not right now", ...av });
  rows.push({ id: "identity", label: "Voice identity", required: locked ? "Approved voice" : "Approve to lock", has: approval && approval.voiceId === voice.id ? `Approved speaker ${approval.speakerId ?? approval.voiceName} (version ${approval.version})` : character.voiceId === voice.id ? "Chosen, not approved" : "Not chosen", state: locked ? "verified" : "none", why: locked ? "Locked. Only you can change it." : "" });

  const status = m.status;
  return { voiceId: voice.id, voiceName: voice.name, status, statusLabel: approval && approval.voiceId === voice.id && status !== "INCOMPATIBLE" ? `${STATUS_LABEL[status]} · approved` : STATUS_LABEL[status], rows, locked, summary: summaryFor(status, locked, rows, voice.name) };
}

export { describeRequirements };
