// Turning an imported file's text (a screenplay, a Fountain file, a Word or PDF export, or a script already written as NAME: line)
// into the app's own script format, and finding who each character is from the script's own descriptions.
//
// The text is untrusted: every pattern here is anchored and bounded, lines are capped, and nothing is evaluated or fetched.

import { extractStated } from "./casting/extract";
import { type Heritage, type VoiceAge } from "./avatarLibrary";
import { parseScript } from "./script";

export interface ImportedCharacter {
  name: string;
  lines: number;
  /** What the script says about this character, from its own action lines (at most 300 characters). */
  about: string;
  gender?: "m" | "f";
  age?: VoiceAge;
  heritage?: Heritage;
}

export interface Converted {
  /** What was recognised: a script already in NAME: line form, a screenplay or Fountain file, or plain prose. */
  kind: "app" | "screenplay" | "plain";
  /** The script in the app's own format: `# Scene` headings and `NAME (direction): line`. */
  text: string;
  scenes: number;
  lines: number;
  characters: ImportedCharacter[];
  warnings: string[];
}

export const MAX_LINES = 60_000;
const MAX_LINE_CHARS = 4000;
const MAX_NAME_CHARS = 38;

const BLANK = /^\s*$/;
const PAGE_NUMBER = /^\s*(?:\d{1,3}\.?|-\s*\d{1,3}\s*-|page \d{1,3}(?: of \d{1,3})?)\s*$/i;
const CONTINUED = /^\s*\(?(?:continued|cont['’]d)\)?:?\s*$/i;
const SCENE_HEADING = /^\s*(?:(?:INT|EXT|EST|INT\.?\/EXT|EXT\.?\/INT|I\/E)[. ].*|\.[A-Za-z0-9].*)$/i;
const TRANSITION = /^\s*(?:[A-Z][A-Z .]{0,30}TO:|FADE (?:IN|OUT)[:.]?|FADE TO BLACK\.?|CUT TO BLACK\.?|THE END\.?|SMASH CUT:?|DISSOLVE:?)\s*$/;
const PARENTHETICAL = /^\s*\(([^()]{1,120})\)\s*$/;
// NAME: line, as the app reads it
const COLON_SPEAKER = /^\s*([^\s:()[\]#][^:()[\]]{0,38}?)\s*(?:\(([^)]{1,60})\))?\s*:(?!\/\/)\s*\S/u;
// a character cue: capital letters, digits, spaces, dots, apostrophes and dashes only, with an optional (extension) and ^ for dual dialogue
const CUE = /^\s*([A-Z0-9][A-Z0-9 .'’-]{0,37}?)\s*(?:\(([^()]{1,40})\))?\s*\^?\s*$/;

const titleCase = (s: string): string => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'’.-])([a-zà-ÿ])/g, (_, a: string, b: string) => a + b.toUpperCase()) : s);

const cleanName = (raw: string): string => titleCase(raw.replace(/\s+/g, " ").trim());

function tidy(lines: string[]): string[] {
  const out: string[] = [];
  for (const l of lines.slice(0, MAX_LINES)) {
    const s = l.length > MAX_LINE_CHARS ? l.slice(0, MAX_LINE_CHARS) : l;
    if (PAGE_NUMBER.test(s) || CONTINUED.test(s)) continue;
    out.push(s.replace(/\s+$/, ""));
  }
  return out;
}

const looksLikeCue = (line: string): { name: string; ext: string } | null => {
  const t = line.trim();
  if (!t || t.length > MAX_NAME_CHARS + 12 || SCENE_HEADING.test(line) || TRANSITION.test(line) || PARENTHETICAL.test(line)) return null;
  const m = CUE.exec(t);
  if (!m || !/[A-Z]/.test(m[1]!)) return null;
  const name = m[1]!.trim();
  if (name.length > MAX_NAME_CHARS || /^\d+$/.test(name)) return null;
  return { name, ext: (m[2] ?? "").trim() };
};

const extensionHint = (ext: string): string => {
  const e = ext.toUpperCase().replace(/’/g, "'");
  if (!e || e === "CONT'D" || e === "CONT" || e === "CONTINUING") return "";
  if (e === "V.O." || e === "VO") return "voice over";
  if (e === "O.S." || e === "OS" || e === "O.C." || e === "OC") return "off screen";
  return ext.toLowerCase();
};

/** The sentences of the script's own action lines that mention a character, joined and capped. */
function aboutFor(name: string, actions: string[]): string {
  const key = name.toLowerCase();
  const hits: string[] = [];
  for (const para of actions) {
    const at = para.toLowerCase().indexOf(key);
    if (at < 0) continue;
    // the sentence that holds the name, and the one after it (which usually carries "She is...")
    const sentences = para.split(/(?<=[.!?])\s+/);
    const i = sentences.findIndex((s) => s.toLowerCase().includes(key));
    if (i < 0) continue;
    hits.push([sentences[i], sentences[i + 1]].filter((x): x is string => !!x && !x.toLowerCase().includes("int.") && x.length < 300).join(" "));
    if (hits.join(" ").length > 300) break;
  }
  return hits.join(" ").replace(/\s+/g, " ").trim().slice(0, 300);
}

/** Reads a screenplay or Fountain text: scene headings, character cues, dialogue, parentheticals and action. */
function fromScreenplay(lines: string[]): { text: string; actions: string[]; cues: number } | null {
  const out: string[] = [];
  const actions: string[] = [];
  let cues = 0;
  let i = 0;
  let action: string[] = [];
  const flushAction = () => {
    if (action.length) actions.push(action.join(" ").replace(/\s+/g, " ").trim());
    action = [];
  };
  while (i < lines.length) {
    const line = lines[i]!;
    if (BLANK.test(line)) {
      flushAction();
      i++;
      continue;
    }
    if (SCENE_HEADING.test(line)) {
      flushAction();
      out.push("", "# " + line.trim().replace(/^\./, ""));
      i++;
      continue;
    }
    if (TRANSITION.test(line)) {
      flushAction();
      i++;
      continue;
    }
    const cue = looksLikeCue(line);
    const next = lines[i + 1];
    // a cue is a short capitals line followed by something to say (not a heading, not another cue-looking line)
    if (cue && next !== undefined && !BLANK.test(next) && !SCENE_HEADING.test(next) && !TRANSITION.test(next) && !(looksLikeCue(next) && !PARENTHETICAL.test(next) && next.trim().length < 20 && !/[a-z]/.test(next))) {
      flushAction();
      cues++;
      const hints: string[] = [];
      const h0 = extensionHint(cue.ext);
      if (h0) hints.push(h0);
      const said: string[] = [];
      let j = i + 1;
      while (j < lines.length && !BLANK.test(lines[j]!) && !SCENE_HEADING.test(lines[j]!) && !TRANSITION.test(lines[j]!)) {
        const pm = PARENTHETICAL.exec(lines[j]!);
        if (pm) {
          if (said.length === 0 && hints.length < 2) hints.push(pm[1]!.trim());
          else said.push(`[${pm[1]!.trim()}]`);
        } else if (said.length > 0 && looksLikeCue(lines[j]!) && !/[a-z]/.test(lines[j]!) && lines[j + 1] !== undefined && !BLANK.test(lines[j + 1]!)) {
          break; // a new cue with no blank line before it (common in text taken from a PDF)
        } else {
          said.push(lines[j]!.trim());
        }
        j++;
      }
      const spoken = said.join(" ").replace(/\s+/g, " ").trim();
      if (spoken) out.push(`${cleanName(cue.name)}${hints.length ? ` (${hints.join(", ").slice(0, 60)})` : ""}: ${spoken}`);
      i = j;
      continue;
    }
    // title page lines (Title: ... ) and everything else before the first scene are ignored; action is kept for descriptions
    action.push(line.trim());
    i++;
  }
  flushAction();
  if (cues === 0) return null;
  return { text: out.join("\n").replace(/^\n+/, ""), actions, cues };
}

/** Prose from a Word or PDF export is hard-wrapped; join each paragraph into one line so the app reads it as one narrator paragraph. */
function proseParagraphs(lines: string[]): string {
  const paras: string[] = [];
  let cur: string[] = [];
  for (const l of lines) {
    if (BLANK.test(l)) {
      if (cur.length) paras.push(cur.join(" ").replace(/\s+/g, " ").trim());
      cur = [];
    } else cur.push(l.trim());
  }
  if (cur.length) paras.push(cur.join(" ").replace(/\s+/g, " ").trim());
  // the app starts a new narrator line at each blank line
  return paras.join("\n\n");
}

/** Converts imported text to the app's script format and describes what was found. */
export function convertScript(raw: string): Converted {
  const warnings: string[] = [];
  const all = tidy((typeof raw === "string" ? raw : "").replace(/\r\n?/g, "\n").split("\n"));
  if (all.length >= MAX_LINES) warnings.push(`Only the first ${MAX_LINES.toLocaleString()} lines were read.`);
  const nonBlank = all.filter((l) => !BLANK.test(l));
  const colon = nonBlank.filter((l) => COLON_SPEAKER.test(l) && !SCENE_HEADING.test(l)).length;
  let kind: Converted["kind"];
  let text: string;
  let actions: string[] = [];
  if (colon >= 4 || (colon >= 2 && colon * 4 >= nonBlank.length)) {
    kind = "app";
    text = all.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  } else {
    const sp = fromScreenplay(all);
    if (sp && sp.cues >= 2) {
      kind = "screenplay";
      text = sp.text;
      actions = sp.actions;
    } else {
      kind = "plain";
      text = proseParagraphs(all);
      if (text) warnings.push("No speakers were found, so this is read as one narrator. If it is a script, check that each speaker's name is on its own line in capitals, or written as NAME: line.");
    }
  }
  const parsed = parseScript(text, [], [], () => "x");
  const counts = new Map<string, number>();
  for (const l of parsed.lines) counts.set(l.characterId, (counts.get(l.characterId) ?? 0) + 1);
  const characters: ImportedCharacter[] = parsed.characters
    .filter((c) => counts.has(c.id))
    .map((c) => {
      const about = kind === "screenplay" ? aboutFor(c.name, actions) : "";
      // Only what the text states outright (casting/extract.ts). A nationality or an accent is NEVER turned into a heritage.
      const ex = about ? extractStated(c.name, about) : undefined;
      const g = ex?.spec.vocalGender === "masculine" ? ("m" as const) : ex?.spec.vocalGender === "feminine" ? ("f" as const) : undefined;
      const age = ex?.spec.vocalAge?.[0];
      return { name: c.name, lines: counts.get(c.id) ?? 0, about, gender: g, age };
    });
  if (characters.length > 60) warnings.push(`${characters.length} different speakers were found, which is a lot. Check that names were read correctly.`);
  if (parsed.lines.length === 0) warnings.push("No lines of dialogue were found in this file.");
  return { kind, text, scenes: parsed.scenes.length, lines: parsed.lines.length, characters, warnings };
}

/** The script text after an import: replaces the current script, or adds to the end of it. */
export function mergeScript(existing: string, imported: string, mode: "replace" | "append"): string {
  if (mode === "replace" || !existing.trim()) return imported;
  return existing.replace(/\s+$/, "") + "\n\n" + imported;
}
