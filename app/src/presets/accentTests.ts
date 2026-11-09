// A listening test for every accent and language the preset library advertises, and the record of who listened. Greenroom
// cannot judge an accent. The only way a label can go up from "unverified" is a recorded review by a person; the rules
// below say how many people and who. Nothing in this file listens to audio or decides how good a voice sounds.

import type { Engine } from "../engines";
import type { AccentQuality, VoicePreset } from "./schema";

export const CRITERIA = [
  { id: "intelligible", label: "Easy to understand", required: true },
  { id: "pronunciation", label: "Pronunciation of the sounds and stress matches the accent", required: true },
  { id: "rhythm", label: "Rhythm and intonation sound natural for the accent", required: false },
  { id: "no_caricature", label: "Respectful and not a caricature", required: true },
  { id: "consistent", label: "Consistent across the test phrases", required: false },
  { id: "names", label: "Names and everyday words are said the way a speaker would say them", required: false },
] as const;
export type CriterionId = (typeof CRITERIA)[number]["id"];
export type Rating = "pass" | "fail" | "unsure";

export interface AccentTest {
  id: string;
  /** What is being tested, as advertised on the presets. */
  language: string;
  accent: string;
  phrases: string[];
  /** The wording of the phrases must itself be checked by the reviewer (not an English test sentence). */
  phrasesNeedReview: boolean;
  /** Presets that advertise this accent. */
  presetIds: string[];
  note: string;
}

const ENGLISH_PHRASES = [
  "Three red buses went past the water tower at half past nine.",
  "Could you spell your surname for me, please?",
  "I'd like a cup of tea, a bottle of water and a bag of rice.",
  "She sells thirty-three thick thistles, though she thinks that's rather rough.",
];
const SPANISH_PHRASES = ["Buenos días, ¿cómo está usted?", "Quiero un café con leche y un vaso de agua, por favor.", "Mañana vamos a la playa con mis hermanos y mis primos."];
const PIDGIN_PHRASES = ["How you dey? I don dey wait for you since morning.", "Abeg, make you help me carry this load."];

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const SKIP_ACCENTS = new Set(["Neutral", "Invented"]);

/** One test per distinct advertised language and accent. Neutral and invented accents make no accent claim, so they have none. */
export function buildAccentTests(presets: VoicePreset[]): AccentTest[] {
  const by = new Map<string, AccentTest>();
  for (const p of presets) {
    if (SKIP_ACCENTS.has(p.accent.label)) continue;
    const id = `${slug(p.language)}.${slug(p.accent.label)}`;
    const t = by.get(id);
    if (t) { t.presetIds.push(p.id); continue; }
    const pidgin = /pidgin/i.test(p.language);
    const spanish = /spanish/i.test(p.language);
    by.set(id, {
      id, language: p.language, accent: p.accent.label,
      phrases: pidgin ? PIDGIN_PHRASES : spanish ? SPANISH_PHRASES : ENGLISH_PHRASES,
      phrasesNeedReview: pidgin || spanish,
      presetIds: [p.id],
      note: pidgin ? "Pidgin varies by region and speaker. The reviewer should replace these phrases with ones they would say." : spanish ? "Latin American Spanish is not one accent. Say which country or region you are judging in the comment." : "A single speaker does not represent a whole population. Judge this voice against the accent as the reviewer knows it.",
    });
  }
  return [...by.values()].sort((a, b) => a.id.localeCompare(b.id));
}

// ---- reviews ----------------------------------------------------------------------------------------------------

export type Relation = "native_speaker" | "community_member" | "other";
export type Verdict = "supported" | "partly" | "not_supported";

export interface AccentReview {
  id: string;
  testId: string;
  engine: Engine;
  voiceName: string;
  reviewer: { name: string; relation: Relation };
  date: string;
  ratings: Partial<Record<CriterionId, Rating>>;
  verdict: Verdict;
  comment: string;
  /** From a file rather than made on this computer. Greenroom cannot check who wrote it, so it counts for less. */
  imported: boolean;
}

const RELATIONS: Relation[] = ["native_speaker", "community_member", "other"];
const VERDICTS: Verdict[] = ["supported", "partly", "not_supported"];
const text = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max) : "");
const ENGINE_NAMES = new Set(["elevenlabs", "voicekiller", "inworld", "kie", "piper", "local", "chatterbox", "wazobia"]);

/** A review read from saved or imported data. Returns null unless it is complete and sensible. */
export function readReview(raw: unknown, imported = false): AccentReview | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const rv = (o.reviewer ?? {}) as Record<string, unknown>;
  const name = text(rv.name, 60);
  const testId = text(o.testId, 120);
  if (!name || !testId || !RELATIONS.includes(rv.relation as Relation) || !VERDICTS.includes(o.verdict as Verdict) || !ENGINE_NAMES.has(String(o.engine))) return null;
  const ratings: AccentReview["ratings"] = {};
  const r = (o.ratings ?? {}) as Record<string, unknown>;
  for (const c of CRITERIA) if (r[c.id] === "pass" || r[c.id] === "fail" || r[c.id] === "unsure") ratings[c.id] = r[c.id] as Rating;
  return { id: text(o.id, 40) || `${testId}:${name}:${text(o.date, 40)}`, testId, engine: o.engine as Engine, voiceName: text(o.voiceName, 80), reviewer: { name, relation: rv.relation as Relation }, date: text(o.date, 40), ratings, verdict: o.verdict as Verdict, comment: text(o.comment, 600), imported };
}

/** The ratings that make a review count as support: every required criterion passed, none failed. */
export function isSupportive(r: AccentReview): boolean {
  if (r.verdict !== "supported") return false;
  if (Object.values(r.ratings).includes("fail")) return false;
  return CRITERIA.filter((c) => c.required).every((c) => r.ratings[c.id] === "pass");
}

/**
 * The label a test has earned for one engine and voice, from the reviews alone.
 *   native_reviewed     a native speaker, on this computer, gave a supportive review and nobody newer from the same group said otherwise
 *   community_reviewed  two people (native speakers or community members, files included) gave supportive reviews
 *   unsupported         a native speaker, newest on this voice, found it not supported
 * Anything else keeps the label the preset shipped with. A review for one voice never raises the label for another.
 */
export function earnedQuality(reviews: AccentReview[], testId: string, engine: Engine, voiceName: string, base: AccentQuality): { quality: AccentQuality; because: string } {
  const mine = reviews.filter((r) => r.testId === testId && r.engine === engine && r.voiceName === voiceName).sort((a, b) => a.date.localeCompare(b.date));
  if (!mine.length) return { quality: base, because: "no review of this voice yet" };
  const native = mine.filter((r) => r.reviewer.relation === "native_speaker" && !r.imported);
  const newestNative = native[native.length - 1];
  if (newestNative?.verdict === "not_supported") return { quality: "unsupported", because: `${newestNative.reviewer.name} (native speaker) found it not supported` };
  if (newestNative && isSupportive(newestNative)) return { quality: "native_reviewed", because: `reviewed by ${newestNative.reviewer.name}, a native speaker` };
  const community = mine.filter((r) => (r.reviewer.relation === "native_speaker" || r.reviewer.relation === "community_member") && isSupportive(r));
  const people = new Set(community.map((r) => r.reviewer.name.toLowerCase()));
  if (people.size >= 2) return { quality: "community_reviewed", because: `${people.size} reviewers found it supported` };
  return { quality: base, because: "reviewed, but not enough to raise the label" };
}

// ---- keeping and sharing reviews ---------------------------------------------------------------------------------

export const REVIEWS_KEY = "greenroom-accent-reviews";
export const REVIEW_FILE = "greenroom.accent-reviews";
const MAX_REVIEWS = 500;
type Store = Pick<Storage, "getItem" | "setItem">;

export function loadReviews(store: Store | null | undefined): AccentReview[] {
  try {
    const raw = store?.getItem(REVIEWS_KEY);
    if (!raw) return [];
    const a = JSON.parse(raw) as unknown;
    return (Array.isArray(a) ? a : []).slice(0, MAX_REVIEWS).map((x) => readReview(x, (x as { imported?: unknown })?.imported === true)).filter((x): x is AccentReview => !!x);
  } catch { return []; }
}
export function saveReviews(store: Store | null | undefined, list: AccentReview[]): boolean {
  try { if (!store) return false; store.setItem(REVIEWS_KEY, JSON.stringify(list.slice(-MAX_REVIEWS))); return true; } catch { return false; }
}
export const addReview = (list: AccentReview[], r: AccentReview): AccentReview[] => [...list.filter((x) => x.id !== r.id), r].slice(-MAX_REVIEWS);

export function exportReviews(list: AccentReview[]): string { return JSON.stringify({ format: REVIEW_FILE, schema: 1, reviews: list.filter((r) => !r.imported) }, null, 2); }

/** Reviews from a file always count as imported: Greenroom cannot confirm who wrote them, so they can raise a label to "community reviewed" at most. */
export function importReviews(json: string): { reviews: AccentReview[]; skipped: number } {
  try {
    const d = JSON.parse(json) as { format?: unknown; reviews?: unknown };
    if (d?.format !== REVIEW_FILE || !Array.isArray(d.reviews)) return { reviews: [], skipped: 1 };
    const ok = d.reviews.slice(0, MAX_REVIEWS).map((x) => readReview(x, true)).filter((x): x is AccentReview => !!x);
    return { reviews: ok, skipped: Math.min(d.reviews.length, MAX_REVIEWS) - ok.length };
  } catch { return { reviews: [], skipped: 1 }; }
}
