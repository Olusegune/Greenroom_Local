// Reading a character sheet: the paragraph many scripts and briefs give for each character ("VENOMSPUR: Elderly, highly educated British
// male voice. Rich baritone..."). Only what the text STATES is used, by the same rules as everything else in casting (extract.ts): a
// gender, an age, a language, an accent, each with the words it came from. Nothing is guessed from a name or a nationality.
//
// Two shapes are read:
//   NAME                         (the name alone on a line, then a paragraph)
//   Elderly, highly educated...
//
//   Characters                   (a "Characters" or "Cast" heading, then one line each)
//   NAME: Elderly, highly educated...      or      NAME - Elderly...

import type { Character } from "../types";
import { extractStated } from "./extract";
import type { CastingSpec } from "./types";

const MAX_DESCRIPTION = 400;
const HEADING = /^(?:characters?|cast(?: list)?|dramatis personae|the cast)$/i;

const plain = (row: string): string => row.replace(/^[\s>#*_-]+/, "").replace(/[\s*_:]+$/, "").replace(/\s+/g, " ").trim();
const key = (s: string): string => plain(s).toUpperCase();
const clip = (s: string): string => s.replace(/\*\*|__/g, "").replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION);
const looksLikeProse = (s: string): boolean => s.split(/\s+/).length >= 3 && /[a-zA-Z]{3}/.test(s);

/** What the text says about each named character, in the text's own words. Names not found are left out. */
export function readCharacterSheet(text: string, names: string[]): Record<string, string> {
  const want = new Map(names.map((n) => [key(n), n]));
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  const out: Record<string, string> = {};
  const set = (nameKey: string, desc: string) => {
    const name = want.get(nameKey);
    const d = clip(desc);
    if (name && !out[name] && looksLikeProse(d)) out[name] = d;
  };
  let inSection = false;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const p = plain(row);
    if (!p) continue;
    if (HEADING.test(p) && !/[:.]$/.test(row.trim().replace(/[*_]+$/g, "")) ) { inSection = true; continue; }
    if (/^(?:#+\s|-{3,}$|\*{3,}$)/.test(row.trim()) || /^(?:\*\*)?(?:SCENE|ACT)\b/i.test(row.trim())) inSection = false;
    // the name alone on a line, then the first paragraph after it
    if (want.has(key(row)) && !/[.!?]$/.test(p)) {
      let j = i + 1;
      while (j < rows.length && !plain(rows[j]!)) j++;
      const para: string[] = [];
      while (j < rows.length && plain(rows[j]!) && !want.has(key(rows[j]!)) && !/^\s*\[/.test(rows[j]!)) para.push(plain(rows[j]!)), j++;
      if (para.length) set(key(row), para.join(" "));
      continue;
    }
    // "NAME: description" or "NAME - description", only under a Characters heading
    if (inSection) {
      const m = /^[\s*_]*([^:\-–—]{1,38}?)[\s*_]*(?::|\s[-–—]\s)\s*(.+)$/.exec(row);
      if (m && want.has(key(m[1]!))) set(key(m[1]!), m[2]!);
    }
  }
  return out;
}

export interface SheetFacts {
  about: string;
  spec: Partial<CastingSpec>;
  look: NonNullable<Character["look"]>;
  /** The words each stated fact came from, so the owner can see why. */
  quotes: string[];
}

/** The facts a description states. Empty fields mean the text did not say. */
export function factsFrom(name: string, about: string): SheetFacts {
  const ex = extractStated(name, about);
  const look: NonNullable<Character["look"]> = {};
  if (ex.spec.vocalGender === "masculine") look.gender = "m";
  else if (ex.spec.vocalGender === "feminine") look.gender = "f";
  const age = ex.spec.vocalAge?.[0];
  if (age) look.age = age;
  return { about, spec: ex.spec, look, quotes: ex.stated.map((s) => `${s.field}: "${s.quote}"`) };
}

/**
 * Puts what a sheet says onto the characters. A character the owner already described (about, casting requirements, look) is never
 * changed, so editing the script never overwrites the owner's own choices.
 */
export function applyCharacterSheet(characters: Character[], sheet: Record<string, string>): Character[] {
  return characters.map((c) => {
    const about = sheet[c.name];
    if (!about) return c;
    const f = factsFrom(c.name, about);
    const next: Character = { ...c };
    if (!c.about) next.about = about;
    if (!c.cast && Object.keys(f.spec).length) next.cast = { version: 1, ...f.spec };
    if (!c.look && Object.keys(f.look).length) next.look = f.look;
    return next;
  });
}
