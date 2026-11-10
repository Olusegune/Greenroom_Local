// Builds the matcher's view of a voice from what the library says about it, with the SOURCE of every fact.
//
// Rules that matter here:
//  - A name is never evidence. Greenroom's table of Piper first names is a guess; it is kept as a note and never used to match.
//  - Words found in a free-text description are never evidence either.
//  - Only a person listening ("owner_listening") makes a gender, age or accent "verified". Documentation and provider labels
//    make a fact "unverified": plausible and worth a listen, but not proof.
//  - A route fact (Piper voices are single-language; Greenroom sends English to Kokoro, Chatterbox and Qwen) is "verified" because
//    it is how the code works, not because anyone judged a sound.

import { ENGINES } from "../engines";
import { pipergender } from "../avatarLibrary";
import type { VoiceEntry } from "../types";
import { langKey } from "./lang";
import { unknownFact, type Fact, type FactSource, type MetaRevision, type VoiceAttribute, type VoiceMeta, type VoiceProfile, type VocalAge, type VocalGender } from "./types";

const AGES: VocalAge[] = ["child", "teen", "young", "mid", "old"];
const CLOUD = new Set(["elevenlabs", "inworld", "voicekiller", "kie"]);

const fact = <T>(value: T, status: Fact<T>["status"], source: FactSource, confidence: Fact<T>["confidence"], note?: string): Fact<T> => ({ value, status, source, confidence, ...(note ? { note } : {}) });

const genderOfWord = (g: string): VocalGender | null => {
  const t = g.trim().toLowerCase();
  if (/^(f|female|woman|feminine)$/.test(t)) return "feminine";
  if (/^(m|male|man|masculine)$/.test(t)) return "masculine";
  if (/^(neutral|nonbinary|non-binary|androgynous)$/.test(t)) return "androgynous";
  return null;
};

/** The speaker number or language variant carried in the voice id: "file@7" (Piper speaker 7) or "ife@yo" (Wazobia voice ife in Yoruba). */
export function speakerOf(v: Pick<VoiceEntry, "id" | "provider" | "meta">): string | null {
  const ok = (s: string | null | undefined) => (typeof s === "string" && /^[A-Za-z0-9_-]{1,40}$/.test(s) ? s : null);
  if (v.meta?.speakerId !== undefined) return ok(v.meta.speakerId);
  const at = v.id.indexOf("@");
  return at > 0 && (v.provider === "piper" || v.provider === "wazobia") ? ok(v.id.slice(at + 1)) : null;
}

const isL2 = (v: Pick<VoiceEntry, "id">) => v.id.includes("l2arctic");

function derivedGender(v: VoiceEntry): Fact<VocalGender> {
  const stated = genderOfWord(v.gender ?? "");
  if (v.provider === "piper") {
    if (isL2(v) && stated) return fact(stated, "unverified", "corpus_documentation", "medium", "The L2-ARCTIC corpus documents each speaker's gender; the speaker number has not been checked against the model, and nobody has listened.");
    const guess = pipergender(v.id);
    return unknownFact(guess ? `A name table suggests ${guess === "m" ? "masculine" : "feminine"}. Names are not evidence, so this is not used. Listen and confirm.` : undefined);
  }
  if (!stated) return unknownFact();
  if (v.provider === "kokoro") return fact(stated, "unverified", "engine_documentation", "medium", "Kokoro's voice list states it; nobody has listened.");
  if (v.provider === "qwen") return fact(stated, "unverified", "engine_documentation", "low", "From the written description Greenroom sends; the model may not follow it.");
  if (CLOUD.has(v.provider)) return fact(stated, "unverified", "provider_label", "medium", "The provider's label; nobody has listened.");
  return fact(stated, "unverified", "owner_entered", "low");
}

function derivedAge(v: VoiceEntry): Fact<VocalAge> {
  if (v.age && AGES.includes(v.age)) return fact(v.age, "unverified", CLOUD.has(v.provider) ? "provider_label" : "owner_entered", "low", "Stated, not confirmed by listening.");
  return unknownFact();
}

function derivedLanguages(v: VoiceEntry): { f: Fact<string[]>; multilingual: boolean } {
  const label = langKey(v.language);
  const route = (lang: string, note: string): Fact<string[]> => fact([lang], "verified", "model_config", "high", note);
  switch (v.provider) {
    case "piper":
      return { f: label ? route(label, "A Piper voice file is made for one language.") : unknownFact(), multilingual: false };
    case "kokoro":
      return { f: route("english", "Greenroom sends this Kokoro voice English only."), multilingual: false };
    case "chatterbox":
      return { f: route("english", "Greenroom sends the Chatterbox default voice English only."), multilingual: false };
    case "qwen":
      return { f: route("english", "Greenroom sends Qwen3-TTS English only."), multilingual: false };
    case "wazobia": {
      const lang = langKey(speakerOf(v) ?? "");
      return { f: lang ? fact([lang], "unverified", "model_config", "medium", "The model accepts this language; nobody has listened to how it speaks it.") : unknownFact(), multilingual: false };
    }
    case "local":
      return { f: unknownFact("Your own speech server: Greenroom does not know what it speaks."), multilingual: true };
    default:
      return { f: label ? fact([label], "unverified", "provider_label", "medium", "The provider's language label. Many cloud voices can speak other languages; that has not been checked.") : unknownFact(), multilingual: true };
  }
}

function derivedAccent(v: VoiceEntry): Fact<string> {
  const a = (v.accent ?? "").trim();
  if (!a) return unknownFact();
  if (isL2(v)) return fact(a, "unverified", "corpus_documentation", "medium", "The corpus documents each speaker's first language; nobody has listened to the accent.");
  if (v.provider === "piper" || v.provider === "kokoro" || v.provider === "wazobia") return fact(a, "unverified", "model_config", "medium", "From the voice's dataset or locale; whether it sounds convincing is for a listener to say.");
  if (CLOUD.has(v.provider)) return fact(a, "unverified", "provider_label", "medium", "The provider's label; nobody has listened.");
  return fact(a, "unverified", "owner_entered", "low");
}

function commercialOf(v: VoiceEntry): VoiceProfile["commercial"] {
  const own = v.meta?.commercial;
  if (own && own.status !== "unknown") return { status: own.status, note: own.note ?? "" };
  if (isL2(v)) return { status: "forbidden", note: "The L2-ARCTIC corpus is CC BY-NC 4.0: non-commercial use only." };
  if (v.provider === "wazobia") return { status: "forbidden", note: ENGINES.wazobia.blurb };
  if (v.licence === "commercial") return { status: "allowed", note: v.licenceNote ?? "The owner recorded a commercial licence." };
  if (v.licence === "personal") return { status: "forbidden", note: v.licenceNote ?? "The owner recorded personal use only." };
  return { status: "unknown", note: "No licence is recorded for this voice." };
}

/** A voice as the matcher sees it. The owner's recorded metadata (`meta`) overrides what is derived. */
export function profileOf(v: VoiceEntry): VoiceProfile {
  const m = v.meta;
  const langs = derivedLanguages(v);
  const modelId = v.provider === "qwen" ? "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign" : null;
  return {
    voiceId: v.id,
    provider: v.provider,
    name: v.name,
    modelId,
    speakerId: speakerOf(v),
    gender: m?.gender ?? derivedGender(v),
    age: m?.age ?? derivedAge(v),
    languages: m?.languages ?? langs.f,
    accent: m?.accent ?? derivedAccent(v),
    pitch: m?.pitch ?? unknownFact(),
    texture: m?.texture ?? unknownFact(),
    mayBeMultilingual: langs.multilingual,
    commercial: commercialOf(v),
    consentOk: v.source !== "cloned" || !!v.consent,
    revisions: m?.revisions ?? [],
  };
}

// ---- Changing what is recorded about a voice -------------------------------------------------------------------

export interface MetaChange {
  gender?: VocalGender | null;
  age?: VocalAge | null;
  languages?: string[] | null;
  accent?: string | null;
  pitch?: "low" | "mid" | "high" | null;
  texture?: string | null;
  /** Did the owner listen to the voice before saying this? Only then is the fact "verified". */
  listened: boolean;
  evidence?: string;
  commercial?: VoiceMeta["commercial"];
}

const ATTRS: VoiceAttribute[] = ["gender", "age", "languages", "accent", "pitch", "texture"];

/**
 * Records what the owner says about a voice. Each changed attribute becomes a new fact (verified only when the owner listened)
 * and the old fact is kept in the revision list, so evidence is never lost. `null` clears an attribute back to unknown.
 * Returns a new voice; the original is not changed.
 */
export function applyMetaChange(v: VoiceEntry, c: MetaChange, now: string): VoiceEntry {
  const base: VoiceMeta = v.meta ?? { version: 1, revisions: [] };
  const current = profileOf(v);
  const next: VoiceMeta = { ...base, revisions: [...base.revisions] };
  const before: MetaRevision["before"] = {};
  const changed: string[] = [];
  const source: FactSource = c.listened ? "owner_listening" : "owner_entered";
  for (const a of ATTRS) {
    if (!(a in c) || c[a] === undefined) continue;
    const val = c[a] as unknown;
    before[a] = current[a] as Fact<unknown>;
    changed.push(a);
    const f: Fact<unknown> = val === null || (Array.isArray(val) && val.length === 0) || val === ""
      ? unknownFact()
      : { value: val, status: c.listened ? "verified" : "unverified", source, confidence: c.listened ? "high" : "low", checkedAt: now, ...(c.evidence ? { note: c.evidence } : {}) };
    (next as unknown as Record<string, unknown>)[a] = f;
  }
  if (c.commercial) { next.commercial = c.commercial; changed.push("commercial use"); }
  if (!changed.length) return v;
  next.revisions.push({ at: now, by: "owner", summary: `${changed.join(", ")} ${c.listened ? "confirmed by listening" : "entered without listening"}`, before, ...(c.evidence ? { evidence: c.evidence } : {}) });
  if (next.revisions.length > 50) next.revisions = next.revisions.slice(-50);
  return { ...v, meta: next };
}

/** A saved voice with every recorded fact checked, so a damaged or hostile file cannot smuggle in a "verified" label. */
export function readMeta(raw: unknown): VoiceMeta | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const text = (x: unknown, n: number) => (typeof x === "string" ? x.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n) : "");
  const readFact = <T,>(x: unknown, ok: (v: unknown) => T | null): Fact<T> | undefined => {
    if (!x || typeof x !== "object") return undefined;
    const o = x as Record<string, unknown>;
    const value = o.value === null ? null : ok(o.value);
    if (o.value !== null && value === null) return undefined;
    const status = o.status === "verified" || o.status === "unverified" || o.status === "unknown" || o.status === "not_applicable" ? o.status : "unknown";
    const source: FactSource = ["owner_listening", "owner_entered", "provider_label", "model_config", "engine_documentation", "corpus_documentation", "name_table", "description_text", "none"].includes(o.source as string) ? (o.source as FactSource) : "none";
    // "Verified" is only believed when a person listened (or the route fixes it). Anything else is downgraded.
    const trusted = status === "verified" && (source === "owner_listening" || source === "model_config");
    const f: Fact<T> = { value, status: trusted ? "verified" : status === "verified" ? "unverified" : status, source, confidence: o.confidence === "high" || o.confidence === "medium" || o.confidence === "low" ? o.confidence : "none" };
    if (typeof o.checkedAt === "string") f.checkedAt = text(o.checkedAt, 40);
    if (typeof o.note === "string") f.note = text(o.note, 300);
    return f;
  };
  const gender = readFact(r.gender, (x) => (x === "masculine" || x === "feminine" || x === "androgynous" ? x : null));
  const age = readFact(r.age, (x) => (typeof x === "string" && (AGES as string[]).includes(x) ? (x as VocalAge) : null));
  const languages = readFact(r.languages, (x) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === "string").map((s) => langKey(s)).filter(Boolean).slice(0, 20) : null));
  const accent = readFact(r.accent, (x) => (typeof x === "string" ? text(x, 80) : null));
  const pitch = readFact(r.pitch, (x) => (x === "low" || x === "mid" || x === "high" ? x : null));
  const texture = readFact(r.texture, (x) => (typeof x === "string" ? text(x, 120) : null));
  const revisions: MetaRevision[] = (Array.isArray(r.revisions) ? r.revisions : []).slice(-50).flatMap((x) => {
    const o = (x ?? {}) as Record<string, unknown>;
    return typeof o.at === "string" && typeof o.summary === "string" ? [{ at: text(o.at, 40), by: o.by === "app" ? ("app" as const) : ("owner" as const), summary: text(o.summary, 200), before: {} as MetaRevision["before"], ...(typeof o.evidence === "string" ? { evidence: text(o.evidence, 300) } : {}) }] : [];
  });
  const cm = r.commercial as Record<string, unknown> | undefined;
  const commercial: VoiceMeta["commercial"] | undefined = cm && (cm.status === "allowed" || cm.status === "forbidden" || cm.status === "unknown") ? { status: cm.status as "allowed" | "forbidden" | "unknown", ...(typeof cm.note === "string" ? { note: text(cm.note, 300) } : {}) } : undefined;
  return { version: 1, ...(gender ? { gender } : {}), ...(age ? { age } : {}), ...(languages ? { languages } : {}), ...(accent ? { accent } : {}), ...(pitch ? { pitch } : {}), ...(texture ? { texture } : {}), ...(typeof r.speakerId === "string" || r.speakerId === null ? { speakerId: r.speakerId as string | null } : {}), ...(commercial ? { commercial } : {}), revisions };
}
