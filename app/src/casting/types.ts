// Casting integrity: the shared vocabulary. A voice is described by FACTS, each carrying its status and where it came from.
// Nothing here guesses: a fact nobody has stated is "unknown", and an unknown fact is never evidence that a voice fits.

/** verified = confirmed by the owner listening, or stated outright by the voice's own documentation. unverified = stated by a provider or typed in, not confirmed. unknown = nobody has said. not_applicable = the question does not apply to this voice. */
export type FactStatus = "verified" | "unverified" | "unknown" | "not_applicable";

export type FactSource =
  | "owner_listening" // the owner listened and confirmed
  | "owner_entered" // the owner typed it, without a confirming listen
  | "provider_label" // a cloud provider's own label for the voice
  | "model_config" // the model file or Greenroom's route fixes it (for example Piper's language, or the language Greenroom sends)
  | "engine_documentation" // the engine's own documentation says so
  | "corpus_documentation" // the recording corpus documents it (L2-ARCTIC speakers)
  | "name_table" // a table keyed on the voice's name: a guess, never evidence
  | "description_text" // words found in free text: a guess, never evidence
  | "none";

export interface Fact<T> {
  value: T | null;
  status: FactStatus;
  source: FactSource;
  confidence: "high" | "medium" | "low" | "none";
  /** ISO date this fact was last checked by a person or a document, when it was. */
  checkedAt?: string;
  note?: string;
}

export type VocalGender = "masculine" | "feminine" | "androgynous";
/** The age a voice SOUNDS (or a character is meant to sound). Not a claim about the person who recorded it. */
export type VocalAge = "child" | "teen" | "young" | "mid" | "old";
export const AGE_ORDER: VocalAge[] = ["child", "teen", "young", "mid", "old"];
export type Pitch = "low" | "mid" | "high";

export const unknownFact = <T>(note?: string): Fact<T> => ({ value: null, status: "unknown", source: "none", confidence: "none", ...(note ? { note } : {}) });

/** One saved change to a voice's metadata, kept so evidence is never lost when a value is corrected. */
export interface MetaRevision {
  at: string;
  by: "owner" | "app";
  /** What changed, in words. */
  summary: string;
  /** The fact as it was before, per attribute, so the change can be read back or undone by hand. */
  before: Partial<Record<VoiceAttribute, Fact<unknown>>>;
  evidence?: string;
}

export type VoiceAttribute = "gender" | "age" | "languages" | "accent" | "pitch" | "texture";

/** What the owner has recorded about a voice, stored with the voice in the library. Overrides what is derived from the voice's own fields. */
export interface VoiceMeta {
  version: 1;
  gender?: Fact<VocalGender>;
  age?: Fact<VocalAge>;
  languages?: Fact<string[]>;
  accent?: Fact<string>;
  pitch?: Fact<Pitch>;
  texture?: Fact<string>;
  /** The speaker number inside a multi-speaker model, when it has one. */
  speakerId?: string | null;
  /** Whether the voice may be used in a commercial project. */
  commercial?: { status: "allowed" | "forbidden" | "unknown"; note?: string };
  revisions: MetaRevision[];
}

/** Everything the matcher knows about one voice, with provenance. Built by `profileOf`; never stored. */
export interface VoiceProfile {
  voiceId: string;
  provider: string;
  name: string;
  /** Model or checkpoint identity when the voice depends on one (for example a Qwen checkpoint), else null. */
  modelId: string | null;
  /** The speaker inside a multi-speaker voice file, or the language variant of a Wazobia voice. Null when the voice has none. */
  speakerId: string | null;
  gender: Fact<VocalGender>;
  age: Fact<VocalAge>;
  languages: Fact<string[]>;
  accent: Fact<string>;
  pitch: Fact<Pitch>;
  texture: Fact<string>;
  /** Whether the voice's route can speak languages other than the ones it states (some cloud voices are multilingual). */
  mayBeMultilingual: boolean;
  commercial: { status: "allowed" | "forbidden" | "unknown"; note: string };
  /** A cloned voice with no consent record may not be used. */
  consentOk: boolean;
  revisions: MetaRevision[];
}

// ---- What a character needs ------------------------------------------------------------------------------

export type Strictness = "required" | "preferred" | "ignore";

/** What the character's casting calls for. Only STATED things appear here. Nationality and cultural background are kept for the owner's notes and never used to match. */
export interface CastingSpec {
  version: 1;
  vocalGender?: "masculine" | "feminine" | "any";
  vocalAge?: VocalAge[];
  language?: string;
  languageStrictness?: Strictness;
  accent?: string;
  accentStrictness?: Strictness;
  pitch?: Pitch;
  texture?: string;
  style?: string;
  /** Notes only. Never used for matching: an ethnicity is not an accent, a language, a pitch or a gender. */
  nationality?: string;
  culturalBackground?: string;
  notes?: string;
}

export interface Requirement<T> { value: T; strictness: "required" | "preferred"; origin: string }

/** The requirements, ready to match: what was stated, how firmly, and where it was stated. */
export interface Requirements {
  gender?: Requirement<"masculine" | "feminine">;
  age?: Requirement<VocalAge[]>;
  language?: Requirement<string>;
  accent?: Requirement<string>;
  pitch?: Requirement<Pitch>;
  texture?: Requirement<string>;
  /** True when nothing was REQUIRED: there is then nothing to verify. Preferences alone only order voices. */
  empty: boolean;
}

// ---- Results -----------------------------------------------------------------------------------------------

export type MatchStatus = "VERIFIED_MATCH" | "COMPATIBLE_WITH_LIMITATIONS" | "NEEDS_AUDITION" | "UNKNOWN_METADATA" | "INCOMPATIBLE" | "UNAVAILABLE";

export type Outcome = "match" | "mismatch" | "unverified" | "unknown" | "limitation" | "info";

export interface Reason {
  attribute: VoiceAttribute | "licence" | "consent" | "availability" | "requirements";
  level: "hard" | "soft" | "info";
  outcome: Outcome;
  text: string;
}

export interface MatchResult {
  voiceId: string;
  status: MatchStatus;
  /** Soft-preference score used only to order voices of the same status. Higher is better. */
  score: number;
  reasons: Reason[];
}

/** What the matcher needs to know about the world. */
export interface MatchContext {
  /** Whether a voice can be used right now (key saved, runtime installed, voice downloaded). Default: yes. */
  available?: (voiceId: string) => { ok: boolean; why?: string };
  /** The project is commercial: noncommercial voices are not eligible. */
  commercial?: boolean;
  /** Only free local voices may be used. */
  localOnly?: boolean;
  favorites?: ReadonlySet<string>;
  /** Voices this character (or its saved cast) used before. */
  previous?: ReadonlySet<string>;
  weights?: Partial<Weights>;
}

export interface Weights { texture: number; pitch: number; style: number; favorite: number; previous: number; local: number }
export const DEFAULT_WEIGHTS: Weights = { texture: 10, pitch: 8, style: 5, favorite: 6, previous: 4, local: 0 };

export const STATUS_ORDER: MatchStatus[] = ["VERIFIED_MATCH", "COMPATIBLE_WITH_LIMITATIONS", "NEEDS_AUDITION", "UNKNOWN_METADATA", "UNAVAILABLE", "INCOMPATIBLE"];
export const STATUS_LABEL: Record<MatchStatus, string> = {
  VERIFIED_MATCH: "Verified match",
  COMPATIBLE_WITH_LIMITATIONS: "Compatible, with limits",
  NEEDS_AUDITION: "Listen first",
  UNKNOWN_METADATA: "Not enough known",
  INCOMPATIBLE: "Does not fit",
  UNAVAILABLE: "Not available",
};

// ---- Approval ---------------------------------------------------------------------------------------------

export type Actor = "owner" | "agent" | "auto" | "preset" | "cast_import" | "script_edit" | "model_switch" | "test_harness";

export interface ApprovalEvent { at: string; action: "assigned" | "approved" | "changed" | "unlocked" | "refused"; voiceId: string | null; by: Actor; reason: string }

/** The owner's approved voice for a character. Once present, nothing but the owner, confirming, may change it. */
export interface CastingApproval {
  voiceId: string;
  engine: string;
  voiceName: string;
  modelId: string | null;
  speakerId: string | null;
  approvedAt: string;
  /** Counts up each time the approved voice changes. */
  version: number;
  basis: MatchStatus;
  /** The unverified or unknown facts the owner accepted when approving, in words. */
  acknowledged: string[];
  by: Actor;
}

export interface CharacterCasting {
  version: 1;
  approval?: CastingApproval;
  history: ApprovalEvent[];
}

/** Recorded on every take, so audio can always be traced to the character and the exact voice it was made for. */
export interface TakeCast {
  characterId: string;
  voiceId: string;
  engine: string;
  modelId: string | null;
  speakerId: string | null;
  /** The approval version in force when the take was made, or null when the character was not approved. */
  castingVersion: number | null;
}
