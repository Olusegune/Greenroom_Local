// What a character's casting calls for, read ONLY from what was stated. Nothing is inferred from a name, a picture, a nationality
// or a cultural background: those can sit in the owner's notes, and the matcher ignores them.

import type { Character } from "../types";
import { langKey } from "./lang";
import type { CastingSpec, Requirements, VocalAge } from "./types";

const KNOWN_LANGUAGES = new Set(["english", "spanish", "french", "german", "portuguese", "italian", "dutch", "polish", "russian", "turkish", "arabic", "hindi", "chinese", "japanese", "korean", "yoruba", "hausa", "igbo", "swahili", "pidgin", "ukrainian", "swedish", "greek", "hebrew", "vietnamese", "thai", "indonesian", "persian", "nepali", "urdu", "malayalam", "telugu"]);

const AGE_WORD: Record<VocalAge, string> = { child: "a child", teen: "a teenager", young: "a young adult", mid: "an adult", old: "an older person" };
export const ageWord = (a: VocalAge) => AGE_WORD[a];

/** Requirements from a character: its explicit casting spec first, then the gender and age the owner stated in its look. */
export function requirementsOf(c: Pick<Character, "cast" | "look" | "language">): Requirements {
  const s: CastingSpec | undefined = c.cast;
  const r: Requirements = { empty: true };

  if (s?.vocalGender === "masculine" || s?.vocalGender === "feminine") r.gender = { value: s.vocalGender, strictness: "required", origin: "the casting requirements" };
  else if (!s?.vocalGender && c.look?.gender) r.gender = { value: c.look.gender === "m" ? "masculine" : "feminine", strictness: "required", origin: "the character's stated gender" };

  if (s?.vocalAge?.length) r.age = { value: s.vocalAge, strictness: "required", origin: "the casting requirements" };
  else if (!s?.vocalAge && c.look?.age) r.age = { value: [c.look.age], strictness: "required", origin: "the character's stated age" };

  const lang = s?.language?.trim() || (c.language ?? "").trim();
  if (lang && s?.languageStrictness !== "ignore") {
    const key = langKey(lang);
    const known = KNOWN_LANGUAGES.has(key);
    // New characters are created with the label "English". That default is not something anyone stated, and a free label Greenroom
    // does not recognise ("Taglish") cannot be matched against a voice. Both are preferences. A language the owner SET (the casting
    // requirements, or any other known language on the character) is a rule.
    const stated = !!s?.language?.trim();
    const firm = known && (stated || key !== "english") && s?.languageStrictness !== "preferred";
    r.language = { value: lang, strictness: firm ? "required" : "preferred", origin: stated ? "the casting requirements" : "the character's language" };
  }

  if (s?.accent?.trim() && s.accentStrictness !== "ignore") r.accent = { value: s.accent.trim(), strictness: s.accentStrictness === "required" ? "required" : "preferred", origin: "the casting requirements" };
  if (s?.pitch) r.pitch = { value: s.pitch, strictness: "preferred", origin: "the casting requirements" };
  if (s?.texture?.trim()) r.texture = { value: s.texture.trim(), strictness: "preferred", origin: "the casting requirements" };

  // "Empty" means nothing is REQUIRED, so nothing can be proven. Preferences alone only order voices.
  r.empty = ![r.gender, r.age, r.language, r.accent].some((x) => x?.strictness === "required");
  return r;
}

/** A character's required language normalised, or "" when none. Exposed for the agent and the screens. */
export const requiredLanguage = (r: Requirements): string => (r.language?.strictness === "required" ? langKey(r.language.value) : "");

/** Plain-words list of what is required, for the screen. */
export function describeRequirements(r: Requirements): string[] {
  const out: string[] = [];
  if (r.gender) out.push(`${r.gender.strictness === "required" ? "Needs" : "Prefers"} a ${r.gender.value} voice (${r.gender.origin})`);
  if (r.age) out.push(`${r.age.strictness === "required" ? "Needs" : "Prefers"} a voice that sounds like ${r.age.value.map(ageWord).join(" or ")} (${r.age.origin})`);
  if (r.language) out.push(`${r.language.strictness === "required" ? "Needs" : "Prefers"} ${r.language.value} (${r.language.origin})`);
  if (r.accent) out.push(`${r.accent.strictness === "required" ? "Needs" : "Prefers"} a ${r.accent.value} accent`);
  if (r.pitch) out.push(`Prefers a ${r.pitch.value} pitch`);
  if (r.texture) out.push(`Prefers a ${r.texture.value} texture`);
  return out;
}
