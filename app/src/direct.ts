import type { Direction, Line } from "./types";

// Delivery and body sounds are written into the text as [tags], which is how Eleven v3 and v4 take direction.
// Owner listening (2026-10-26): laugh, sigh, crying, whisper, gasp, cough and out-of-breath all sounded right on v4.
// The rest are unverified until heard; the UI marks them.

export interface Choice {
  tag: string;
  label: string;
  verified: boolean;
}

export const EMOTIONS: Choice[] = [
  { tag: "excited", label: "Excited", verified: false },
  { tag: "happy", label: "Happy", verified: false },
  { tag: "sad", label: "Sad", verified: false },
  { tag: "angry", label: "Angry", verified: false },
  { tag: "annoyed", label: "Annoyed", verified: false },
  { tag: "scared", label: "Scared", verified: false },
  { tag: "nervous", label: "Nervous", verified: false },
  { tag: "tender", label: "Tender", verified: false },
  { tag: "sarcastic", label: "Sarcastic", verified: false },
  { tag: "tired", label: "Tired", verified: false },
  { tag: "whispers", label: "Whisper", verified: true },
  { tag: "shouting", label: "Shouting", verified: false },
];

export const SOUNDS: Choice[] = [
  { tag: "laughs", label: "Laugh", verified: true },
  { tag: "sighs", label: "Sigh", verified: true },
  { tag: "crying", label: "Crying", verified: true },
  { tag: "gasps", label: "Gasp", verified: true },
  { tag: "coughs", label: "Cough", verified: true },
  { tag: "out of breath", label: "Out of breath", verified: true },
  { tag: "grunts", label: "Grunt", verified: false },
  { tag: "straining", label: "Strain", verified: false },
  { tag: "panting", label: "Pant", verified: false },
  { tag: "breathing heavily", label: "Heavy breathing", verified: false },
  { tag: "winces", label: "Wince", verified: false },
  { tag: "giggles", label: "Giggle", verified: false },
  { tag: "chuckles", label: "Chuckle", verified: false },
  { tag: "clears throat", label: "Clear throat", verified: false },
  { tag: "sniffles", label: "Sniffle", verified: false },
  { tag: "groans", label: "Groan", verified: false },
  { tag: "exhales", label: "Exhale", verified: false },
  { tag: "gulps", label: "Gulp", verified: false },
  { tag: "yawns", label: "Yawn", verified: false },
];

const tag = (t: string) => `[${t}]`;

/** A note becomes part of a [tag], so it cannot contain brackets or run on. */
export function cleanNote(n: string | undefined): string {
  return (n ?? "").replace(/[\[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 140);
}

/** What is sent to the voice model: chosen emotion and sounds first, then the line, skipping tags already written inline. */
export function composeText(line: Pick<Line, "text" | "direction">): string {
  const d: Direction = line.direction;
  const have = (t: string) => line.text.toLowerCase().includes(tag(t));
  const lead = [d.emotion, ...d.sounds, cleanNote(d.note)].map((t) => (t ?? "").trim().toLowerCase()).filter((t) => t && !have(t)).map(tag);
  return [...lead, line.text.trim()].join(" ").trim();
}

export function countChars(lines: Pick<Line, "text" | "direction">[]): number {
  return lines.reduce((n, l) => n + composeText(l).length, 0);
}

export function toggleIn(list: string[], t: string): string[] {
  return list.includes(t) ? list.filter((x) => x !== t) : [...list, t];
}

export function chosenTake(line: Line) {
  return line.takes.find((t) => t.id === line.chosen) ?? line.takes[line.takes.length - 1];
}

// ---- VoiceKiller has no inline sound tags: delivery and pace travel as an `instructions` sentence. ----

const VK_STYLE: Record<string, string> = {
  whispers: "whispering softly",
  shouting: "loud, as if shouting",
  excited: "excited and energetic",
  happy: "warm and happy",
  sad: "sad and subdued",
  angry: "angry",
  annoyed: "annoyed",
  scared: "frightened",
  nervous: "nervous",
  tender: "tender and gentle",
  tired: "tired and low on energy",
  sarcastic: "sarcastic",
};

export function vkInstructions(emotion: string, speed: number, note = ""): string | undefined {
  const parts: string[] = [];
  const e = emotion.trim().toLowerCase();
  const phrase = VK_STYLE[e];
  if (phrase) parts.push(`Speak in a tone that is ${phrase}.`);
  else if (e) parts.push(`Speak in a tone that is ${e.replace(/[^\p{L} -]/gu, "").slice(0, 40)}.`);
  const n = cleanNote(note);
  if (n) parts.push(`Direction: ${n}.`);
  if (speed >= 1.15) parts.push("Speak faster than normal.");
  else if (speed <= 0.85) parts.push("Speak slower than normal.");
  return parts.length ? parts.join(" ") : undefined;
}

/** The words only: VoiceKiller would read a [tag] aloud. */
export function stripTags(text: string): string {
  return text.replace(/\[[^\]]*\]/g, " ").replace(/\s+/g, " ").trim();
}

/** Sounds this line asks for that VoiceKiller cannot make, so the owner is told before paying. */
export function vkUnsupported(line: Pick<Line, "text" | "direction">): string[] {
  const inline = [...line.text.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]!.toLowerCase());
  return [...new Set([...line.direction.sounds, ...inline.filter((t) => SOUNDS.some((s) => s.tag === t))])];
}

// ---- Presets, the insert menu and pronunciations --------------------------------------------------------------

export interface Preset {
  id: string;
  label: string;
  emotion: string;
  sounds: string[];
  note: string;
  speed?: number;
}

/** One-click starting points for common physical situations. They fill the chips and the note; the owner can change any of it. */
export const PRESETS: Preset[] = [
  { id: "lifting", label: "Lifting something heavy", emotion: "", sounds: ["grunts", "straining"], note: "effort, as if lifting something very heavy", speed: 0.9 },
  { id: "running", label: "Running, out of breath", emotion: "", sounds: ["panting", "out of breath"], note: "breathless, gasping between phrases", speed: 1.1 },
  { id: "crying", label: "Crying while talking", emotion: "", sounds: ["crying"], note: "voice breaking, trying to speak through tears" },
  { id: "laugh", label: "Trying not to laugh", emotion: "", sounds: ["giggles"], note: "holding back laughter, voice wobbling" },
  { id: "fear", label: "Whispering in fear", emotion: "whispers", sounds: [], note: "terrified, barely audible, tense" },
  { id: "tired", label: "Exhausted", emotion: "tired", sounds: ["exhales"], note: "worn out, slow and heavy", speed: 0.9 },
  { id: "pain", label: "In pain", emotion: "", sounds: ["groans", "winces"], note: "pained, through gritted teeth" },
  { id: "eating", label: "Talking with food in mouth", emotion: "", sounds: [], note: "talking with their mouth full" },
];

export function applyPreset(d: Direction, p: Preset): Direction {
  return { ...d, emotion: p.emotion || d.emotion, sounds: [...new Set([...d.sounds, ...p.sounds])], note: p.note, speed: p.speed ?? d.speed };
}

export interface InsertGroup {
  title: string;
  tags: Choice[];
}

const known = (t: string) => [...SOUNDS, ...EMOTIONS].some((c) => c.tag === t && c.verified);
const ins = (...tags: string[]): Choice[] => tags.map((t) => ({ tag: t, label: t, verified: known(t) }));

/** Tags that can be dropped into the words at the cursor. Unverified ones are marked until the owner has heard them. */
export const INSERT_GROUPS: InsertGroup[] = [
  { title: "Reactions", tags: ins("laughs", "giggles", "chuckles", "sighs", "gasps", "groans", "scoffs", "gulps") },
  { title: "Effort and body", tags: ins("grunts", "straining", "panting", "breathing heavily", "out of breath", "winces", "exhales sharply", "coughs", "clears throat", "sniffles", "sneezes", "yawns") },
  { title: "Voice", tags: ins("whispers", "shouting", "crying", "voice breaking", "trembling", "mumbling", "slurring", "sarcastic") },
  { title: "Beats", tags: ins("short pause", "long pause") },
];

/** Put `[tag] ` into the text at the caret, with sensible spacing. Returns the new text and where the caret should go. */
export function insertAt(text: string, caret: number, t: string): { text: string; caret: number } {
  const at = Math.max(0, Math.min(caret, text.length));
  const before = text.slice(0, at);
  const after = text.slice(at);
  const lead = before && !/\s$/.test(before) ? " " : "";
  const piece = `${lead}[${t}] `;
  const tail = after.replace(/^\s+/, "");
  return { text: before + piece + tail, caret: (before + piece).length };
}

/** Swap written forms for how they should be spoken, outside any [tag]. Case-insensitive on whole words. */
export function applyPronunciations(text: string, dict: { from: string; to: string }[]): string {
  const rules = dict.filter((r) => r.from.trim() && r.to.trim());
  if (!rules.length) return text;
  return text
    .split(/(\[[^\]]*\])/)
    .map((chunk, i) => {
      if (i % 2 === 1) return chunk;
      let out = chunk;
      for (const r of rules) {
        const from = r.from.trim();
        const esc = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const wordy = /^[\p{L}\p{N}]/u.test(from) && /[\p{L}\p{N}]$/u.test(from);
        const to = r.to.trim();
        out = out.replace(new RegExp(wordy ? `(?<![\\p{L}\\p{N}])${esc}(?![\\p{L}\\p{N}])` : esc, "giu"), () => to);
      }
      return out;
    })
    .join("");
}

// ---- Visual line editor: words and [sound] pills, so sounds can be placed by clicking between words ----

export interface Tok {
  kind: "word" | "tag";
  text: string;
}

/** Split a line into words and [tags]. Whitespace is not kept: tokens are joined with single spaces. */
export function tokenize(text: string): Tok[] {
  const out: Tok[] = [];
  for (const m of text.matchAll(/\[[^\][]*\]|[^\s[]+|\[/g)) {
    const s = m[0];
    if (s.length > 1 && s.startsWith("[") && s.endsWith("]")) {
      const inner = s.slice(1, -1).trim();
      if (inner) out.push({ kind: "tag", text: inner });
    } else out.push({ kind: "word", text: s });
  }
  return out;
}

export function joinTokens(t: Tok[]): string {
  return t.map((x) => (x.kind === "tag" ? `[${x.text}]` : x.text)).join(" ");
}

/** `gap` is a position between tokens: 0 is before the first, t.length is after the last. */
export function insertTok(t: Tok[], gap: number, tagText: string): Tok[] {
  const g = Math.max(0, Math.min(gap, t.length));
  const clean = tagText.replace(/[[\]\r\n]+/g, " ").trim();
  if (!clean) return t;
  return [...t.slice(0, g), { kind: "tag", text: clean }, ...t.slice(g)];
}

export function removeTok(t: Tok[], i: number): Tok[] {
  return t.filter((_, j) => j !== i);
}

/** Move the token at `from` to a gap, numbered against the list as it is before the move. */
export function moveTok(t: Tok[], from: number, gap: number): Tok[] {
  if (from < 0 || from >= t.length || gap === from || gap === from + 1) return t;
  const item = t[from]!;
  const rest = removeTok(t, from);
  const at = gap > from ? gap - 1 : gap;
  return [...rest.slice(0, at), item, ...rest.slice(at)];
}

export type TagGroup = "Reactions" | "Effort and body" | "Voice" | "Beats" | "Other";

export function tagGroup(tag: string): TagGroup {
  const t = tag.trim().toLowerCase();
  for (const g of INSERT_GROUPS) if (g.tags.some((c) => c.tag === t)) return g.title as TagGroup;
  return "Other";
}
