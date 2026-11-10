// Reading what a script SAYS about a character. Only explicit statements become requirements, each with the words it came from.
// Everything else is a question for the owner or, at most, a creative suggestion that is never applied. Nothing is inferred from a
// name, a nationality, a picture or a cultural background: "Nigerian" is a nationality and does NOT mean a Nigerian accent, a language
// or a gender; the agent asks.

import type { CastingSpec, VocalAge } from "./types";

export interface StatedFact { field: "gender" | "age" | "language" | "accent" | "nationality"; value: string; quote: string }

export interface Extraction {
  /** The requirements the text states outright. */
  spec: Partial<CastingSpec>;
  stated: StatedFact[];
  /** What the text leaves open and matters for casting. The agent asks; it never fills these in. */
  questions: string[];
  /** Creative ideas that are NOT stated. Offered as options, never applied. */
  suggestions: string[];
}

const NATIONALITY = ["Nigerian", "British", "English", "Scottish", "Irish", "American", "Canadian", "Australian", "Indian", "Pakistani", "Ghanaian", "Kenyan", "South African", "Jamaican", "French", "German", "Spanish", "Mexican", "Chinese", "Japanese", "Korean", "Brazilian", "Russian", "Italian", "Egyptian"];
const LANGUAGES = ["Yoruba", "Hausa", "Igbo", "Pidgin", "Swahili", "French", "Spanish", "German", "Portuguese", "Arabic", "Hindi", "Mandarin", "Chinese", "Japanese", "Korean", "Russian", "Italian", "Zulu", "Twi"];
const MASC = /\b(man|men|boy|male|gentleman|grandfather|grandpa|father|dad|uncle|brother|son|husband|king|prince|sir|mr|he|his|him)\b/i;
const FEM = /\b(woman|women|girl|female|lady|grandmother|grandma|granny|mother|mum|mom|aunt|auntie|sister|daughter|wife|queen|princess|madam|mrs|ms|she|her|hers)\b/i;

const ageBand = (n: number): VocalAge => (n < 13 ? "child" : n < 20 ? "teen" : n < 36 ? "young" : n < 60 ? "mid" : "old");

/** Reads one character's description. `name` is used only to say who the questions are about. */
export function extractStated(name: string, text: string | undefined): Extraction {
  const t = (text ?? "").replace(/\s+/g, " ").trim();
  const out: Extraction = { spec: {}, stated: [], questions: [], suggestions: [] };
  if (!t) { out.questions.push(`${name}: the script says nothing about their voice. What vocal gender, age, language and accent should they have?`); return out; }

  // age: an explicit number, a decade, or an age word. A kinship word alone ("grandfather") is NOT an age.
  const num = /\b(\d{1,2})\s*(?:-|\s)?(?:years?[- ]old|yo|y\/o)\b/i.exec(t);
  const decade = /\b(?:in (?:his|her|their) |aged? )?(\d)0'?s\b/i.exec(t);
  const word = /\b(elderly|old man|old woman|aged|senior|middle-aged|teenage|teenager|teen|young adult|toddler|child|boy|girl|little (?:boy|girl))\b/i.exec(t);
  if (num) { out.stated.push({ field: "age", value: ageBand(Number(num[1])), quote: num[0] }); }
  else if (decade) { out.stated.push({ field: "age", value: ageBand(Number(decade[1]) * 10), quote: decade[0] }); }
  else if (word) {
    const w = word[1]!.toLowerCase();
    const band: VocalAge = /middle/.test(w) ? "mid" : /elderly|old|aged|senior/.test(w) ? "old" : /teen/.test(w) ? "teen" : /young adult/.test(w) ? "young" : /toddler|child|little|boy|girl/.test(w) ? "child" : "mid";
    out.stated.push({ field: "age", value: band, quote: word[0] });
  }

  // gender: explicit gendered words or kinship terms; pronouns only when they all agree.
  const m = MASC.exec(t);
  const f = FEM.exec(t);
  if (m && !f) out.stated.push({ field: "gender", value: "masculine", quote: m[0] });
  else if (f && !m) out.stated.push({ field: "gender", value: "feminine", quote: f[0] });
  else if (m && f) out.questions.push(`${name}: the description mentions both masculine and feminine words. Which vocal presentation should they have?`);

  // language: "Yoruba-speaking", "speaks Yoruba", "in Yoruba".
  for (const L of LANGUAGES) {
    const r = new RegExp(`\\b(?:${L}[- ]speaking|speaks? (?:in )?${L}|speaking (?:in )?${L}|in ${L}\\b)`, "i").exec(t);
    if (r) { out.stated.push({ field: "language", value: L, quote: r[0] }); break; }
  }
  // accent: "with a Nigerian accent", "Nigerian-accented", "a British accent".
  const acc = /\b(?:with an? )?([A-Z][a-z]+(?: [A-Z][a-z]+)?)[- ](?:accented|accent)\b|\bwith an? ([A-Z][a-z]+(?: [A-Z][a-z]+)?) accent\b/.exec(t);
  if (acc) out.stated.push({ field: "accent", value: (acc[1] ?? acc[2])!, quote: acc[0] });
  // nationality is recorded and QUESTIONED, never turned into an accent.
  for (const n of NATIONALITY) {
    if (new RegExp(`\\b${n}\\b`).test(t)) { out.stated.push({ field: "nationality", value: n, quote: n }); break; }
  }

  const has = (f2: StatedFact["field"]) => out.stated.some((s) => s.field === f2);
  const nat = out.stated.find((s) => s.field === "nationality");
  if (nat && !has("accent") && !has("language")) out.questions.push(`${name} is described as ${nat.value}. That does not say how they sound: should they speak with ${nat.value} English, another accent, or another language?`);
  if (!has("gender")) out.questions.push(`${name}: no vocal gender is stated. Should the voice be masculine, feminine, or does it not matter?`);
  if (!has("age")) out.questions.push(`${name}: no age is stated. How old should they sound?`);
  if (!has("gender") && !has("age")) out.suggestions.push(`${name}: a varied cast usually works well, so consider a voice that differs in pitch or pace from the others. This is an idea, not something stated about them.`);

  for (const s of out.stated) {
    if (s.field === "gender") out.spec.vocalGender = s.value as "masculine" | "feminine";
    if (s.field === "age") out.spec.vocalAge = [s.value as VocalAge];
    if (s.field === "language") { out.spec.language = s.value; out.spec.languageStrictness = "required"; }
    if (s.field === "accent") { out.spec.accent = s.value; out.spec.accentStrictness = "preferred"; }
    if (s.field === "nationality") out.spec.nationality = s.value;
  }
  if (out.stated.length) out.spec.notes = "From the script: " + out.stated.map((s) => `${s.field} "${s.quote}"`).join("; ");
  return { ...out, spec: out.stated.length ? { version: 1, ...out.spec } : out.spec };
}
