import { DEFAULT_DIRECTION, type Character, type Line } from "./types";

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
  const raw: { speaker: string; hint: string; text: string; scene: number }[] = [];
  let last: (typeof raw)[number] | null = null;
  const rows = text.replace(/\r\n?/g, "\n").split("\n");
  const hasSpeaker = rows.some((r) => !SCENE.test(r) && (SPEAKER.exec(r)?.[3] ?? "").trim() !== "" && SPEAKER.test(r));

  for (const row of rows) {
    if (!row.trim()) {
      last = null;
      continue;
    }
    const sc = SCENE.exec(row);
    if (sc && !SPEAKER.test(row.replace(/^\s*#+\s*/, "X:"))) {
      scenes.push((sc[1] ?? sc[2] ?? "").trim());
      last = null;
      continue;
    }
    if (sc) {
      scenes.push((sc[1] ?? sc[2] ?? "").trim());
      last = null;
      continue;
    }
    const m = SPEAKER.exec(row);
    if (m && m[1] && m[3]?.trim()) {
      if (scenes.length === 0) scenes.push("Scene 1");
      last = { speaker: m[1].trim(), hint: (m[2] ?? "").trim(), text: m[3].trim(), scene: scenes.length - 1 };
      raw.push(last);
    } else if (last) {
      last.text += " " + row.trim();
    } else if (!hasSpeaker) {
      // Plain text with no NAME: anywhere is read as one narrator, one paragraph per line.
      if (scenes.length === 0) scenes.push("Scene 1");
      last = { speaker: NARRATOR, hint: "", text: row.trim(), scene: scenes.length - 1 };
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
  const lines: Line[] = raw.map((r) => {
    const c = charFor(r.speaker);
    const at = pool.findIndex((l) => l.characterId === c.id && l.text === r.text);
    if (at >= 0) {
      const [old] = pool.splice(at, 1);
      return { ...old!, scene: r.scene };
    }
    return { id: `l-${id()}`, characterId: c.id, scene: r.scene, text: r.text, direction: { ...DEFAULT_DIRECTION, emotion: r.hint }, takes: [], events: [] };
  });
  return { scenes, characters, lines };
}
