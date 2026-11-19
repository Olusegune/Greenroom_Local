// The listening pass: the owner plays the scene line by line and records what they HEAR. Greenroom never judges a performance itself;
// every verdict here is the owner's, kept with the line (and the exact take) it was given for. Verdicts become a to-do list and a
// written report. They are the by-ear findings the project's rules require before anything is claimed about how a voice sounds.

import type { Character, Line, Project, Take } from "./types";

export type Verdict = "good" | "voice" | "delivery" | "glitch";

export interface VerdictInfo {
  id: Verdict;
  label: string;
  /** The key that records it while listening. */
  key: string;
  /** What it means, shown on the button. */
  hint: string;
  /** What to do about it, written for the to-do list. */
  todo: string;
}

export const VERDICTS: VerdictInfo[] = [
  { id: "good", label: "Good", key: "1", hint: "It sounds right", todo: "Nothing to do." },
  { id: "voice", label: "Wrong voice", key: "2", hint: "This voice does not fit the character", todo: "Choose another voice for this character (Cast)." },
  { id: "delivery", label: "Wrong delivery", key: "3", hint: "Right voice, but the feeling, pace or manner is off", todo: "Change the direction on this line, then make another take (Perform)." },
  { id: "glitch", label: "Glitch or repeat", key: "4", hint: "A repeated word, a cut-off, a click or a strange sound", todo: "Make another take of this line (Perform)." },
];

export const verdictInfo = (v: Verdict): VerdictInfo => VERDICTS.find((x) => x.id === v)!;
export const isVerdict = (v: unknown): v is Verdict => typeof v === "string" && VERDICTS.some((x) => x.id === v);

/** What the owner said about one take of a line. */
export interface Listened {
  verdict: Verdict;
  note?: string;
  /** The take that was heard. A newer take is a different thing to listen to, so the verdict does not carry over. */
  takeId: string;
  at: string;
}

export const MAX_NOTE = 300;

/** The take a line is played with: the chosen one, else the newest. */
export const takeToHear = (line: Pick<Line, "takes" | "chosen">): Take | undefined => line.takes.find((t) => t.id === line.chosen) ?? line.takes[line.takes.length - 1];

/** The verdict for the take that would be played now, or undefined when this take has not been heard (or the line has no take). */
export function heard(line: Pick<Line, "takes" | "chosen"> & { listened?: Listened }): Listened | undefined {
  const t = takeToHear(line);
  const l = line.listened;
  return t && l && l.takeId === t.id && isVerdict(l.verdict) ? l : undefined;
}

/** A line with the owner's verdict recorded. Choosing the same verdict again takes it back. The note is kept short and plain. */
export function withVerdict<L extends Pick<Line, "takes" | "chosen"> & { listened?: Listened }>(line: L, verdict: Verdict, now: string, note?: string): L {
  const t = takeToHear(line);
  if (!t) return line;
  const current = heard(line);
  if (current && current.verdict === verdict && note === undefined) {
    const { listened: _gone, ...rest } = line;
    void _gone;
    return rest as L;
  }
  const clean = (note ?? current?.note ?? "").replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  return { ...line, listened: { verdict, ...(clean ? { note: clean } : {}), takeId: t.id, at: now } };
}

/** Adds or changes the note on a line already heard. */
export function withNote<L extends Pick<Line, "takes" | "chosen"> & { listened?: Listened }>(line: L, note: string): L {
  const cur = heard(line);
  if (!cur) return line;
  const clean = note.replace(/[\r\n]+/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_NOTE);
  const { note: _old, ...rest } = cur;
  void _old;
  return { ...line, listened: { ...rest, ...(clean ? { note: clean } : {}) } };
}

export type QueueFilter = "all" | "unheard" | "flagged";

/** The indexes of the lines to listen to. Lines with no take are never in the queue: there is nothing to hear. */
export function queue(lines: (Pick<Line, "takes" | "chosen"> & { listened?: Listened })[], filter: QueueFilter): number[] {
  const out: number[] = [];
  lines.forEach((l, i) => {
    if (!takeToHear(l)) return;
    const h = heard(l);
    if (filter === "unheard" && h) return;
    if (filter === "flagged" && (!h || h.verdict === "good")) return;
    out.push(i);
  });
  return out;
}

export interface Summary {
  lines: number;
  withTake: number;
  heard: number;
  unheard: number;
  good: number;
  voice: number;
  delivery: number;
  glitch: number;
}

export function summarise(lines: (Pick<Line, "takes" | "chosen"> & { listened?: Listened })[]): Summary {
  const s: Summary = { lines: lines.length, withTake: 0, heard: 0, unheard: 0, good: 0, voice: 0, delivery: 0, glitch: 0 };
  for (const l of lines) {
    if (!takeToHear(l)) continue;
    s.withTake++;
    const h = heard(l);
    if (!h) { s.unheard++; continue; }
    s.heard++;
    s[h.verdict]++;
  }
  return s;
}

/** The next line after `from` (wrapping round) that has a take and has not been heard; -1 when everything has been heard. */
export function nextUnheard(lines: (Pick<Line, "takes" | "chosen"> & { listened?: Listened })[], from: number): number {
  const n = lines.length;
  for (let k = 1; k <= n; k++) {
    const i = (from + k) % n;
    const l = lines[i]!;
    if (takeToHear(l) && !heard(l)) return i;
  }
  return -1;
}

export interface TodoItem {
  index: number;
  lineNumber: number;
  character: string;
  characterId: string;
  text: string;
  verdict: Exclude<Verdict, "good">;
  note?: string;
  todo: string;
}

/** What still needs doing, in script order. Only the owner's own verdicts on the take that would be played now count. */
export function todoList(lines: Line[], characters: Pick<Character, "id" | "name">[]): TodoItem[] {
  const name = new Map(characters.map((c) => [c.id, c.name]));
  const out: TodoItem[] = [];
  lines.forEach((l, i) => {
    const h = heard(l);
    if (!h || h.verdict === "good") return;
    out.push({ index: i, lineNumber: i + 1, character: name.get(l.characterId) ?? "?", characterId: l.characterId, text: l.text, verdict: h.verdict, ...(h.note ? { note: h.note } : {}), todo: verdictInfo(h.verdict).todo });
  });
  return out;
}

/** Characters whose voice was marked wrong at least once, with how many lines, so a voice change is one decision, not many. */
export function voiceComplaints(items: TodoItem[]): { characterId: string; character: string; lines: number }[] {
  const by = new Map<string, { characterId: string; character: string; lines: number }>();
  for (const it of items) {
    if (it.verdict !== "voice") continue;
    const cur = by.get(it.characterId) ?? { characterId: it.characterId, character: it.character, lines: 0 };
    cur.lines++;
    by.set(it.characterId, cur);
  }
  return [...by.values()];
}

const short = (t: string, n = 90) => (t.length > n ? t.slice(0, n - 1).trimEnd() + "…" : t);

/** The listening notes as Markdown: the owner's words and verdicts, nothing added about how anything sounds. */
export function reportMarkdown(project: Pick<Project, "name" | "lines" | "characters">, opts: { now: string; appVersion: string }): string {
  const s = summarise(project.lines);
  const todo = todoList(project.lines, project.characters);
  const L: string[] = [];
  L.push(`# Listening notes: ${project.name}`, "");
  L.push(`Written ${opts.now} by Greenroom ${opts.appVersion} from the owner's own verdicts. Greenroom does not judge how anything sounds.`, "");
  L.push("## Summary", "");
  L.push(`- Lines with a take: ${s.withTake} of ${s.lines}`);
  L.push(`- Heard: ${s.heard}, not heard yet: ${s.unheard}`);
  L.push(`- Good: ${s.good}`);
  L.push(`- Wrong voice: ${s.voice}`);
  L.push(`- Wrong delivery: ${s.delivery}`);
  L.push(`- Glitch or repeat: ${s.glitch}`, "");
  const vc = voiceComplaints(todo);
  if (vc.length) {
    L.push("## Voices to reconsider", "");
    for (const v of vc) L.push(`- **${v.character}**: wrong voice on ${v.lines} line${v.lines === 1 ? "" : "s"}.`);
    L.push("");
  }
  if (todo.length) {
    L.push("## To do", "");
    for (const t of todo) {
      L.push(`- Line ${t.lineNumber} (${t.character}) "${short(t.text)}": **${verdictInfo(t.verdict).label}**${t.note ? ` ("${t.note}")` : ""}. ${t.todo}`);
    }
    L.push("");
  } else if (s.heard > 0) {
    L.push("## To do", "", "Nothing: every line heard so far was marked good.", "");
  }
  const goods = project.lines.map((l, i) => ({ l, i })).filter(({ l }) => heard(l)?.verdict === "good");
  if (goods.length) {
    L.push("## Marked good", "", goods.map(({ i }) => String(i + 1)).join(", "), "");
  }
  return L.join("\n");
}
