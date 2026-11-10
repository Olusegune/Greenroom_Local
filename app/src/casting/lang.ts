// Language and accent comparison for casting. Pure text handling; no guessing about people.

const CODE: Record<string, string> = { en: "english", es: "spanish", fr: "french", de: "german", pt: "portuguese", it: "italian", nl: "dutch", pl: "polish", ru: "russian", tr: "turkish", ar: "arabic", hi: "hindi", zh: "chinese", ja: "japanese", ko: "korean", yo: "yoruba", ha: "hausa", ig: "igbo", sw: "swahili", pcm: "pidgin", uk: "ukrainian", sv: "swedish", el: "greek", he: "hebrew", vi: "vietnamese", th: "thai", id: "indonesian", fa: "persian", ne: "nepali", ur: "urdu", ml: "malayalam", te: "telugu" };

/** A language as one lower-case word: "en", "en-US", "English (Nigeria)" and "english" are all "english". */
export function langKey(s: string | undefined | null): string {
  const w = (s ?? "").trim().toLowerCase().split(/[\s,(/_-]+/)[0] ?? "";
  return CODE[w] ?? w;
}

// Groups of accents that belong to one family of speech. Inside a family two accents are "related", not "the same".
const FAMILIES: Record<string, string[]> = {
  british: ["british", "england", "london", "cockney", "rp", "received pronunciation", "northern english", "welsh", "scottish"],
  american: ["american", "general american", "southern american", "new york", "midwestern"],
  nigerian: ["nigerian", "yoruba", "igbo", "hausa", "pidgin", "nigerian pidgin", "nigerian pidgin-influenced"],
  indian: ["indian", "malayali", "telugu"],
  irish: ["irish"],
  australian: ["australian"],
  jamaican: ["jamaican"],
};

/** An accent label reduced to its plain words: "Yoruba-accented English" and "Yoruba" both become "yoruba". */
const norm = (s: string) => s.trim().toLowerCase().replace(/[()]/g, " ").replace(/-accented/g, "").replace(/\s+english$/, "").replace(/\s+/g, " ").trim();

function familyOf(a: string): string | null {
  const n = norm(a);
  for (const [fam, members] of Object.entries(FAMILIES)) if (members.includes(n)) return fam;
  return null;
}

export type AccentRelation = "same" | "related" | "different" | "unknown";

/** How a wanted accent relates to a voice's accent. "Unknown" when either is empty. */
export function accentRelation(want: string | undefined | null, have: string | undefined | null): AccentRelation {
  if (!want?.trim() || !have?.trim()) return "unknown";
  const w = norm(want);
  const h = norm(have);
  if (w === h) return "same";
  const fw = familyOf(want);
  const fh = familyOf(have);
  if (fw && fh) return fw === fh ? "related" : "different";
  // At least one side is an accent Greenroom has no family for (for example "Korean"): one containing the other counts as the same.
  return w.includes(h) || h.includes(w) ? "same" : "different";
}
