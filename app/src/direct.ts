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

/** Extra human expressions, grouped for the picker. They are sent as [tags] like the core sounds. Only ElevenLabs v3 and v4 act on
 *  tags, and none of these has been listened to yet, so all are marked unverified. The AI director only uses the core SOUNDS. */
export interface SoundGroup { name: string; sounds: Choice[] }
const u = (tag: string, label: string): Choice => ({ tag, label, verified: false });
export const MORE_SOUNDS: SoundGroup[] = [
  { name: "Laughter", sounds: [u("belly laugh", "Belly laugh"), u("laughs hysterically", "Hysterical laugh"), u("laughs nervously", "Nervous laugh"), u("snickers", "Snicker"), u("cackles", "Cackle"), u("evil laugh", "Evil laugh"), u("laughs softly", "Soft laugh"), u("snorts", "Snort"), u("scoffs", "Scoff"), u("chortles", "Chortle")] },
  { name: "Crying and distress", sounds: [u("sobs", "Sob"), u("weeps", "Weep"), u("whimpers", "Whimper"), u("wails", "Wail"), u("sniffs", "Sniff"), u("voice cracks", "Voice cracks"), u("trembling voice", "Trembling voice"), u("choked up", "Choked up"), u("screams", "Scream"), u("shrieks", "Shriek")] },
  { name: "Breath", sounds: [u("deep breath", "Deep breath"), u("sharp inhale", "Sharp inhale"), u("long exhale", "Long exhale"), u("shaky breath", "Shaky breath"), u("sighs heavily", "Heavy sigh"), u("sighs with relief", "Relief sigh"), u("gasps in shock", "Shocked gasp"), u("holds breath", "Hold breath"), u("hyperventilating", "Hyperventilate"), u("wheezes", "Wheeze")] },
  { name: "Throat and mouth", sounds: [u("hums", "Hum"), u("hmm", "Hmm"), u("mm-hmm", "Mm-hmm"), u("uh-oh", "Uh-oh"), u("ahem", "Ahem"), u("sneezes", "Sneeze"), u("hiccups", "Hiccup"), u("burps", "Burp"), u("swallows", "Swallow"), u("licks lips", "Lick lips"), u("smacks lips", "Smack lips"), u("whistles", "Whistle"), u("kisses", "Kiss"), u("blows a raspberry", "Raspberry"), u("tuts", "Tut"), u("tongue click", "Tongue click"), u("shushes", "Shush")] },
  { name: "Reactions", sounds: [u("scoffs in disbelief", "Disbelief"), u("sighs in annoyance", "Annoyed sigh"), u("groans in pain", "Pain groan"), u("moans", "Moan"), u("yelps", "Yelp"), u("gags", "Gag"), u("shudders", "Shudder"), u("growls", "Growl"), u("hisses", "Hiss"), u("mutters", "Mutter"), u("stammers", "Stammer"), u("trails off", "Trail off"), u("cheers", "Cheer"), u("sings", "Sing"), u("hums a tune", "Hum a tune")] },
  { name: "Delivery", sounds: [u("whispering urgently", "Urgent whisper"), u("under their breath", "Under breath"), u("shouting angrily", "Angry shout"), u("calling out", "Call out"), u("speaking slowly", "Slow"), u("speaking quickly", "Fast"), u("deadpan", "Deadpan"), u("sleepy", "Sleepy"), u("drunk", "Drunk"), u("smiling while speaking", "Smiling"), u("through gritted teeth", "Gritted teeth"), u("muffled", "Muffled")] },
];
export const ALL_SOUND_TAGS: Choice[] = [...SOUNDS, ...MORE_SOUNDS.flatMap((g) => g.sounds)];

const tag = (t: string) => `[${t}]`;

export const NOTE_MAX = 400;

/** A written direction is free text in the owner's own words. It cannot contain brackets (they would break the [tag]). */
export function cleanNote(n: string | undefined, max = NOTE_MAX): string {
  return (n ?? "").replace(/[\[\]\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, max);
}

/** Tag-reading engines act best on short phrases, so a long direction is sent as one tag per sentence (at most four). */
export function noteTags(n: string | undefined): string[] {
  return (n ?? "")
    .replace(/[\[\]]+/g, " ")
    .split(/(?<=[.!?;])\s+/)
    .map((s) => cleanNote(s.replace(/[.;!?]+$/, ""), 160))
    .filter(Boolean)
    .slice(0, 4);
}

/** Words the voice will actually say: tags and punctuation do not count. */
export const spokenWords = (text: string): number => text.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/**
 * How much direction a line can carry. A long direction in front of a few words makes tag-reading voices read the
 * direction aloud or repeat the line (seen on a three-word line with a 280 character direction), so the allowance
 * grows with the line. This counts the characters inside the brackets.
 */
export function tagBudget(text: string): number {
  const w = spokenWords(text);
  return w <= 4 ? 60 : w <= 10 ? 100 : w <= 25 ? 150 : 240;
}

const MAX_CUE = 160;

/** One sentence cut back to at most `max` characters, at a comma or a space, without a dangling connector. */
export function shorten(s: string, max: number): string {
  const t = s.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const comma = Math.max(cut.lastIndexOf(","), cut.lastIndexOf(";"), cut.lastIndexOf(":"));
  let out = comma >= 12 ? cut.slice(0, comma) : cut.slice(0, Math.max(cut.lastIndexOf(" "), 12));
  out = out.replace(/[\s,;:.-]+$/, "").replace(/\s+(and|but|with|the|a|an|of|to|as|in|on|while|that)$/i, "");
  return out.trim();
}

/**
 * Fits sentences into a character budget. The first is shortened if it must be; the others are kept only if they fit
 * whole, because a cut-off fragment is just noise to a voice.
 */
export function fitCues(sentences: string[], budget: number): string[] {
  const out: string[] = [];
  let left = budget;
  for (const s of sentences) {
    const t = s.trim();
    if (left < 15 || !t) break;
    const cue = out.length === 0 ? shorten(t, Math.min(left, MAX_CUE)) : t.length <= Math.min(left, MAX_CUE) ? t : "";
    if (!cue) break;
    out.push(cue);
    left -= cue.length + 1;
  }
  return out;
}

function compose(line: Pick<Line, "text" | "direction">): { text: string; notes: string[]; wanted: number; lead: string[] } {
  const d: Direction = line.direction;
  const text = line.text.replace(/\s+/g, " ").trim();
  const have = (t: string) => text.toLowerCase().includes(tag(t));
  const short = [d.emotion, ...d.sounds].map((t) => (t ?? "").trim().toLowerCase()).filter((t) => t && !have(t));
  const left = tagBudget(text) - short.reduce((n, t) => n + t.length + 1, 0);
  const all = noteTags(d.note);
  const notes = fitCues(all, left).map((t) => t.toLowerCase()).filter((t) => !have(t));
  return { text, notes, wanted: all.length, lead: short };
}

/** What is sent to the voice model: chosen emotion and sounds first, then the written direction (shortened to what the line can carry), then the line, skipping tags already written inline. */
export function composeText(line: Pick<Line, "text" | "direction">): string {
  const c = compose(line);
  return [...[...c.lead, ...c.notes].map(tag), c.text].join(" ").trim();
}

/** How many of the direction's sentences a line can carry, so the owner is told when a short line gets only part of a long direction. */
export function noteFit(line: Pick<Line, "text" | "direction">): { sent: number; total: number } {
  const c = compose(line);
  return { sent: c.notes.length, total: c.wanted };
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

// ---- One-click styles: each fills the Direction box with a full, editable sentence ----

export interface StyleChoice {
  id: string;
  label: string;
  /** The sentence added to the written direction. Plain words, so every engine that reads direction can use it. */
  sentence: string;
}

export const STYLES: StyleChoice[] = [
  { id: "whisper", label: "Whisper", sentence: "Whispering close to the microphone, soft and secretive" },
  { id: "angry", label: "Angry", sentence: "Furious and sharp-edged, barely holding the rage in" },
  { id: "sad", label: "Sad", sentence: "Quiet and heartbroken, voice thick with held-back tears" },
  { id: "tired", label: "Tired", sentence: "Worn out and low on energy, slow and heavy" },
  { id: "sarcastic", label: "Sarcastic", sentence: "Dry, sarcastic and a little smug" },
  { id: "scared", label: "Scared", sentence: "Frightened and shaky, breath coming fast" },
  { id: "excited", label: "Excited", sentence: "Bright, energetic and bursting with excitement" },
  { id: "villain", label: "Villain", sentence: "Dark and menacing, calm, commanding and in no hurry" },
  { id: "warm", label: "Warm", sentence: "Warm, kind and reassuring, smiling as they speak" },
  { id: "deadpan", label: "Deadpan", sentence: "Flat and deadpan, completely unbothered" },
];

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N} ]+/gu, " ").replace(/\s+/g, " ").trim();

export function hasStyle(note: string | undefined, s: StyleChoice): boolean {
  return norm(note ?? "").includes(norm(s.sentence));
}

/** Add the style's sentence to the note, or take it out again if it is already there. Anything else written stays. */
export function toggleStyle(note: string | undefined, s: StyleChoice): string {
  const cur = (note ?? "").trim();
  if (hasStyle(cur, s)) {
    const parts = cur.split(/(?<=[.!?])\s+/).filter((p) => norm(p) !== norm(s.sentence));
    return parts.join(" ").trim();
  }
  const next = cur ? `${cur.replace(/[\s,;]+$/, "").replace(/([^.!?])$/, "$1.")} ${s.sentence}.` : `${s.sentence}.`;
  return next.slice(0, NOTE_MAX);
}

// ---- Recent directions: the last few written directions, so a good phrase can be reused on another line ----

export const HISTORY_MAX = 8;

/** Put a direction at the front of the history, without duplicates, keeping only the most recent few. */
export function pushHistory(list: string[], note: string | undefined): string[] {
  const n = cleanNote(note);
  if (!n) return list;
  return [n, ...list.filter((x) => x.toLowerCase() !== n.toLowerCase())].slice(0, HISTORY_MAX);
}
