import { directionFrom } from "./directionTags";
import { DEFAULT_DIRECTION, type Character, type Line, type SoundEvent } from "./types";

export const SAMPLE_SCRIPT = `# Scene 1: The Late Delivery
ADA (annoyed): You said ten o'clock. It is nearly noon.
TUNDE (out of breath): I know, I know. The traffic on the bridge was impossible.
ADA: [sighs] Every time. Every single time.
TUNDE: [laughs] Come on, Ada. Did you at least save me some jollof?

# Scene 2: The Kitchen
ADA (whispering): Keep your voice down. Mama is asleep.
TUNDE: [gasps] Is that the last of the plantain?
ADA: [laughs] Take it. Just take it and go.
`;

export interface Parsed {
  scenes: string[];
  characters: Character[];
  lines: Line[];
}

export type IdGen = () => string;

export const NARRATOR = "Narrator";

export const uid: IdGen = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-3);

const SCENE = /^\s*(?:#+\s*(.+?)|((?:INT|EXT|INT\/EXT)\.\s*.+))\s*$/i;
// NAME: text, or NAME (direction): text. The colon must not be the start of "://".
const SPEAKER = /^\s*([^\s:()[\]#][^:()[\]]{0,38}?)\s*(?:\(([^)]{1,60})\))?\s*:(?!\/\/)\s*(.*)$/u;

// ---- the common "markdown screenplay" shape written by people and by AI tools --------------------------------------------------
//   **NAME:** (direction) words       **NAME** (direction): words       **SCENE 2 - TITLE**       ---       *italic stage line*
//   [PAUSE: 2 seconds]                [SFX: a door creaks open. Distant thunder.]
// They are read into the app's own shape: NAME (direction): words, # scene headings, a pause after the line before, and sound events.

const MD_SPEAKER = /^\s*(?:\*\*|__)\s*([^*_:()[\]#\s][^*_:()[\]]{0,38}?)\s*(?::\s*(?:\*\*|__)|(?:\*\*|__)\s*:)\s*(.*)$/u;
const MD_SCENE = /^\s*(?:\*\*|__)\s*((?:SCENE|ACT|CHAPTER|PART|EPISODE)(?![A-Za-z])[^*_]*?)\s*(?:\*\*|__)\s*$/i;
const MD_RULE = /^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/;
const MD_BOLD_ONLY = /^\s*(?:\*\*|__)[^*_]*(?:\*\*|__)\s*$/;
const MD_ITALIC_ONLY = /^\s*[*_][^*_\s][^*_]*[*_]\s*$/;
const CUE_TOKEN = /^\s*\[\s*(SFX|SOUND|FX|PAUSE|BEAT)\s*:\s*(.+?)\s*\]\s*$/i;
const LEADING_DIRECTION = /^\(([^()]{1,120})\)\s*(.*)$/u;
const MAX_PAUSE_SECONDS = 10;

/** Removes **bold** and *italic* marks from words that will be spoken. */
const plainWords = (t: string): string => t.replace(/\*\*(.+?)\*\*/g, "$1").replace(/__(.+?)__/g, "$1").replace(/(^|[\s(])\*([^*\s][^*]*?)\*(?=[\s).,;:!?]|$)/g, "$1$2");

/** Rewrites one row of the markdown shape into the app's own shape; any other row comes back unchanged. */
export function normalizeScriptRow(row: string): string {
  const md = MD_SPEAKER.exec(row);
  if (md) {
    const name = md[1]!.trim();
    const rest = (md[2] ?? "").trim();
    const lead = LEADING_DIRECTION.exec(rest);
    return lead ? `${name} (${lead[1]!.trim()}): ${lead[2]!.trim()}` : `${name}: ${rest}`;
  }
  const scene = MD_SCENE.exec(row);
  if (scene) return `# ${scene[1]!.trim()}`;
  return row;
}

/** Seconds named in a pause cue: "2 seconds", "1.5s", "a beat". Never more than ten. */
export function pauseSeconds(text: string): number {
  const m = /([0-9]+(?:\.[0-9]+)?)\s*(?:s|sec|secs|second|seconds)?/i.exec(text);
  const n = m ? Number(m[1]) : /beat/i.test(text) ? 0.6 : 1;
  return Math.min(MAX_PAUSE_SECONDS, Math.max(0, Math.round(n * 10) / 10));
}

/** A sound cue's length: about two seconds for each sentence, between two and eight. A sound that plays BEFORE a line is held to four, so a scene does not open on a long wait. */
export function cueSeconds(text: string, placement: "before" | "after" = "after"): number {
  const sentences = text.split(/[.!?]+/).filter((x) => x.trim()).length;
  return Math.min(placement === "before" ? 4 : 8, Math.max(2, sentences * 2));
}

function key(s: string): string {
  return s.trim().toLocaleLowerCase();
}

function slug(s: string): string {
  return key(s).replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").slice(0, 24) || "x";
}

/**
 * Reads `NAME: line` scripts. A line with no speaker directly under a speaker continues it; text after a blank line
 * with no speaker is treated as stage direction and ignored. Existing characters keep their voices, and a line whose
 * speaker and words are unchanged keeps its id, takes and direction, so editing the script never throws work away.
 */
export function parseScript(text: string, prevChars: Character[], prevLines: Line[], id: IdGen = uid): Parsed {
  const scenes: string[] = [];
  const raw: { speaker: string; hint: string; text: string; scene: number; pause: number; sounds: { prompt: string; placement: "before" | "after" }[] }[] = [];
  let before: string[] = [];
  let last: (typeof raw)[number] | null = null;
  const rows = text.replace(/\r\n?/g, "\n").split("\n").map(normalizeScriptRow);
  const hasSpeaker = rows.some((r) => !SCENE.test(r) && (SPEAKER.exec(r)?.[3] ?? "").trim() !== "" && SPEAKER.test(r));

  const pushScene = (name: string) => {
    // a heading straight after another heading (a title, then "SCENE 1") replaces it instead of leaving an empty scene
    if (scenes.length > 0 && !raw.some((r) => r.scene === scenes.length - 1)) scenes[scenes.length - 1] = name;
    else scenes.push(name);
  };
  for (const row of rows) {
    if (!row.trim()) {
      last = null;
      continue;
    }
    if (MD_RULE.test(row) || MD_ITALIC_ONLY.test(row) || (MD_BOLD_ONLY.test(row) && !SPEAKER.test(row))) {
      last = null;
      continue;
    }
    const cue = CUE_TOKEN.exec(row);
    if (cue) {
      const kind = cue[1]!.toUpperCase();
      const prev = raw[raw.length - 1];
      if (kind === "PAUSE" || kind === "BEAT") {
        if (prev) prev.pause = Math.min(MAX_PAUSE_SECONDS, prev.pause + pauseSeconds(cue[2]!));
      } else if (prev && prev.scene === Math.max(0, scenes.length - 1)) prev.sounds.push({ prompt: plainWords(cue[2]!).slice(0, 300), placement: "after" });
      else before.push(plainWords(cue[2]!).slice(0, 300));
      last = null;
      continue;
    }
    const sc = SCENE.exec(row);
    if (sc) {
      pushScene((sc[1] ?? sc[2] ?? "").trim());
      last = null;
      continue;
    }
    const m = SPEAKER.exec(row);
    if (m && m[1] && m[3]?.trim()) {
      if (scenes.length === 0) scenes.push("Scene 1");
      let hint = (m[2] ?? "").trim();
      let words = m[3].trim();
      const lead = hint ? null : LEADING_DIRECTION.exec(words);
      if (lead && lead[2]!.trim()) {
        hint = lead[1]!.trim();
        words = lead[2]!.trim();
      }
      last = { speaker: m[1].trim(), hint, text: plainWords(words), scene: scenes.length - 1, pause: 0, sounds: before.map((prompt) => ({ prompt, placement: "before" as const })) };
      before = [];
      raw.push(last);
    } else if (last) {
      last.text += " " + plainWords(row.trim());
    } else if (!hasSpeaker) {
      // Plain text with no NAME: anywhere is read as one narrator, one paragraph per line.
      if (scenes.length === 0) scenes.push("Scene 1");
      last = { speaker: NARRATOR, hint: "", text: row.trim(), scene: scenes.length - 1, pause: 0, sounds: [] };
      raw.push(last);
    }
  }
  if (scenes.length === 0) scenes.push("Scene 1");

  const characters = prevChars.map((c) => ({ ...c }));
  const used = new Set(characters.map((c) => c.id));
  const charFor = (name: string): Character => {
    const found = characters.find((c) => key(c.name) === key(name));
    if (found) return found;
    let cid = `c-${slug(name)}`;
    for (let n = 2; used.has(cid); n++) cid = `c-${slug(name)}-${n}`;
    used.add(cid);
    const c: Character = { id: cid, name: name.trim(), language: "English" };
    characters.push(c);
    return c;
  };

  const pool = [...prevLines];
  const eventsFor = (r: (typeof raw)[number], have: SoundEvent[]): SoundEvent[] =>
    r.sounds
      .filter((s) => !have.some((e) => e.prompt === s.prompt && e.placement === s.placement))
      .map((s) => ({ id: `e-${id()}`, prompt: s.prompt, placement: s.placement, seconds: cueSeconds(s.prompt, s.placement) }));
  const lines: Line[] = raw.map((r) => {
    const c = charFor(r.speaker);
    const at = pool.findIndex((l) => l.characterId === c.id && l.text === r.text);
    if (at >= 0) {
      const [old] = pool.splice(at, 1);
      const added = eventsFor(r, old!.events ?? []);
      // a pause written in the script is applied once; a pause the owner has since set on the line is theirs
      const untouched = !old!.direction.pauseAfter || old!.direction.pauseAfter === DEFAULT_DIRECTION.pauseAfter;
      const direction = r.pause > 0 && untouched ? { ...old!.direction, pauseAfter: r.pause } : old!.direction;
      return { ...old!, scene: r.scene, direction, events: added.length ? [...(old!.events ?? []), ...added] : old!.events };
    }
    return { id: `l-${id()}`, characterId: c.id, scene: r.scene, text: r.text, direction: { ...DEFAULT_DIRECTION, ...directionFrom(r.hint), ...(r.pause > 0 ? { pauseAfter: r.pause } : {}) }, takes: [], events: eventsFor(r, []) };
  });
  return { scenes, characters, lines };
}
