// Foley planning: sound ideas read from the stage directions of a script (the lines that are not spoken: "(The door
// slams.)", "Rain hammers the window."). Each idea is anchored to the spoken line it comes before. It only SUGGESTS a
// sound prompt and a length; making the sound is a separate, confirmed, paid step like any other sound clip.

import type { Line } from "./types";

export interface FoleyIdea {
  id: string;
  /** The spoken line the sound belongs next to. */
  lineId: string;
  placement: "before" | "after";
  prompt: string;
  seconds: number;
  /** The stage direction it came from. */
  source: string;
}

const SCENE = /^\s*(?:#+\s*(.+?)|((?:INT|EXT|INT\/EXT)\.\s*.+))\s*$/i;
const SPEAKER = /^\s*([^\s:()[\]#][^:()[\]]{0,38}?)\s*(?:\(([^)]{1,60})\))?\s*:(?!\/\/)\s*(.*)$/u;

/** Words in a stage direction and the sound they call for. The first match in a sentence wins; each sound is suggested once per direction. */
const SOUNDS: { re: RegExp; prompt: string; seconds: number }[] = [
  { re: /\bdoor\b.{0,20}\b(slam|slams|slammed|bang|bangs)\b|\b(slam|slams|slammed)\b.{0,20}\bdoor\b/i, prompt: "A heavy door slamming shut", seconds: 2 },
  { re: /\bdoor\b.{0,20}\b(creak|creaks|opens|open)\b|\b(opens|open)\b.{0,12}\bdoor\b/i, prompt: "A wooden door creaking open", seconds: 3 },
  { re: /\bknock(s|ing|ed)?\b/i, prompt: "Three firm knocks on a wooden door", seconds: 2 },
  { re: /\bfootsteps?\b|\bwalks?\b|\bpaces?\b|\bstrides?\b/i, prompt: "Slow footsteps on a wooden floor", seconds: 4 },
  { re: /\brun(s|ning)?\b|\bsprints?\b|\bracing\b/i, prompt: "Fast running footsteps", seconds: 4 },
  { re: /\brain\b|\bdrizzle\b|\bstorm\b/i, prompt: "Steady rain against a window", seconds: 8 },
  { re: /\bthunder\b/i, prompt: "A low roll of distant thunder", seconds: 5 },
  { re: /\bwind\b|\bgale\b/i, prompt: "Wind moving through trees", seconds: 6 },
  { re: /\bglass\b.{0,20}\b(shatter|shatters|breaks|smash|smashes)\b|\b(shatter|shatters|smash|smashes)\b/i, prompt: "Glass shattering on a hard floor", seconds: 2 },
  { re: /\bphone\b.{0,16}\b(ring|rings|buzz|buzzes)\b|\b(ring|rings)\b.{0,10}\bphone\b/i, prompt: "A telephone ringing", seconds: 4 },
  { re: /\bclock\b|\btick(s|ing)?\b/i, prompt: "A slow clock ticking in a quiet room", seconds: 5 },
  { re: /\bbell\b/i, prompt: "A single bell chime", seconds: 3 },
  { re: /\bcrate\b|\bbox\b.{0,14}\b(drop|drops|dropped|slam|thud)\b|\bthud\b/i, prompt: "A heavy wooden crate set down with a thud", seconds: 2 },
  { re: /\bpaper\b|\bpages?\b|\bledger\b/i, prompt: "Pages of a heavy book turning", seconds: 3 },
  { re: /\bfire\b|\bcrackl/i, prompt: "A fire crackling softly", seconds: 6 },
  { re: /\bengine\b|\bcar\b.{0,12}\b(starts|pulls)\b/i, prompt: "A car engine starting and idling", seconds: 5 },
  { re: /\bgun\b|\bshot\b|\bgunshot\b/i, prompt: "A single distant gunshot", seconds: 2 },
  { re: /\bwater\b.{0,14}\b(drip|drips)\b|\bdrip(s|ping)?\b/i, prompt: "Water dripping in an empty room", seconds: 4 },
];

const ACTION = /^[\s(\[]*[^:]*[\])]?\s*$/;

/** Sound ideas for a script, each anchored to the spoken line that follows its stage direction (or to the last line, after it). */
export function foleyPlan(script: string, lines: Pick<Line, "id">[]): FoleyIdea[] {
  const rows = script.replace(/\r\n?/g, "\n").split("\n");
  const hasSpeaker = rows.some((r) => !SCENE.test(r) && SPEAKER.test(r) && (SPEAKER.exec(r)?.[3] ?? "").trim() !== "");
  if (!hasSpeaker || lines.length === 0) return [];
  const out: FoleyIdea[] = [];
  let spoken = 0;
  let prevBlank = true;
  let inDialogue = false;
  for (const row of rows) {
    if (!row.trim()) {
      prevBlank = true;
      inDialogue = false;
      continue;
    }
    const m = SPEAKER.exec(row);
    if (SCENE.test(row)) {
      prevBlank = true;
      inDialogue = false;
      continue;
    }
    if (m && m[1] && m[3]?.trim()) {
      spoken++;
      inDialogue = true;
      prevBlank = false;
      continue;
    }
    // A row that is not a speaker line and does not continue one is a stage direction.
    const action = !inDialogue || prevBlank;
    prevBlank = false;
    if (!action || !ACTION.test(row)) continue;
    const text = row.trim().replace(/^[(\[]|[)\]]$/g, "").trim();
    const hit = SOUNDS.filter((s) => s.re.test(text));
    const anchor = lines[Math.min(spoken, lines.length - 1)];
    if (!anchor) continue;
    const after = spoken >= lines.length;
    for (const h of hit.slice(0, 2)) out.push({ id: `${anchor.id}:${h.prompt.toLowerCase().replace(/[^a-z]+/g, "-").slice(0, 30)}:${out.length}`, lineId: anchor.id, placement: after ? "after" : "before", prompt: h.prompt, seconds: h.seconds, source: text.slice(0, 120) });
  }
  // A sound idea repeated for the same line is shown once.
  const seen = new Set<string>();
  return out.filter((i) => (seen.has(i.lineId + i.prompt) ? false : (seen.add(i.lineId + i.prompt), true)));
}
