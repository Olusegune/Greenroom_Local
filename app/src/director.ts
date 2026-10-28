// The AI Director: reads the script and proposes emotion, sounds, a note, speed and pause for each line. It only
// suggests. Nothing changes until the owner reviews and applies it, and anything the model sends back is checked
// against the allowed lists before it is used.

import { cleanNote, EMOTIONS, SOUNDS } from "./direct";
import type { Direction, Line, Project } from "./types";

export interface Suggestion {
  id: string;
  emotion: string;
  sounds: string[];
  note: string;
  speed: number;
  pauseAfter: number;
}

export interface DirectorResult {
  suggestions: Suggestion[];
  atmosphere: string;
}

const EMOTION_TAGS = EMOTIONS.map((e) => e.tag);
const SOUND_TAGS = SOUNDS.map((s) => s.tag);

export function systemPrompt(): string {
  return [
    "You are a film sound director preparing a voice performance for a cast of voice actors.",
    "You are given a script and a numbered list of its spoken lines. For each line decide how it should be performed.",
    "Reply with ONLY a JSON object, no other text, in this exact shape:",
    '{"lines":[{"id":"<line id>","emotion":"","sounds":[],"note":"","speed":1,"pauseAfter":0.4}],"atmosphere":""}',
    `"emotion" must be one of: ${EMOTION_TAGS.join(", ")}, or empty.`,
    `"sounds" is a list of zero to three from: ${SOUND_TAGS.join(", ")}. Only add a sound the script action or the words clearly call for (a laugh, a lift, a run). Do not add sounds to every line.`,
    '"note" is a short plain-English direction under 90 characters for HOW to say the line, for example "tired, as if carrying a heavy box up the stairs". Leave it empty when the line needs nothing.',
    '"speed" is between 0.8 and 1.15 (1 is normal). "pauseAfter" is silence in seconds after the line, 0 to 2.',
    '"atmosphere" is one short phrase for quiet background sound under the whole scene, such as "soft rain on a window", or empty.',
    "Never change, translate or repeat the dialogue. Include every line id exactly once. Keep it natural and restrained: most lines need little.",
  ].join("\n");
}

export function userPrompt(p: Pick<Project, "script" | "lines" | "characters">): string {
  const who = (l: Line) => p.characters.find((c) => c.id === l.characterId)?.name ?? "?";
  const lines = p.lines.map((l) => `${l.id} | ${who(l)} | ${l.text}`).join("\n");
  return `SCRIPT (including action and stage directions):\n${p.script.trim().slice(0, 30000)}\n\nSPOKEN LINES (id | speaker | words):\n${lines}`;
}

const clamp = (n: unknown, lo: number, hi: number, step: number, fallback: number) => {
  const v = typeof n === "number" && Number.isFinite(n) ? n : fallback;
  return Number((Math.round(Math.min(hi, Math.max(lo, v)) / step) * step).toFixed(2));
};

/** Pull the JSON out of whatever the model said (it may add words or a code fence), and keep only what is allowed. */
export function parseDirector(reply: string, validIds: string[]): DirectorResult {
  const a = reply.indexOf("{");
  const b = reply.lastIndexOf("}");
  if (a < 0 || b <= a) throw new Error("The director's answer was not in a form Greenroom could read. Try again.");
  let raw: unknown;
  try {
    raw = JSON.parse(reply.slice(a, b + 1));
  } catch {
    throw new Error("The director's answer was not in a form Greenroom could read. Try again.");
  }
  const lines = (raw as { lines?: unknown }).lines;
  if (!Array.isArray(lines)) throw new Error("The director's answer had no lines in it. Try again.");
  const valid = new Set(validIds);
  const seen = new Set<string>();
  const suggestions: Suggestion[] = [];
  for (const item of lines) {
    const o = item as Record<string, unknown>;
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (!valid.has(id) || seen.has(id)) continue;
    seen.add(id);
    const emotion = typeof o.emotion === "string" && EMOTION_TAGS.includes(o.emotion.trim().toLowerCase()) ? o.emotion.trim().toLowerCase() : "";
    const sounds = Array.isArray(o.sounds) ? [...new Set(o.sounds.filter((s): s is string => typeof s === "string").map((s) => s.trim().toLowerCase()).filter((s) => SOUND_TAGS.includes(s)))].slice(0, 3) : [];
    suggestions.push({
      id,
      emotion,
      sounds,
      note: cleanNote(typeof o.note === "string" ? o.note : "").slice(0, 100),
      speed: clamp(o.speed, 0.8, 1.15, 0.05, 1),
      pauseAfter: clamp(o.pauseAfter, 0, 2, 0.1, 0.4),
    });
  }
  if (suggestions.length === 0) throw new Error("The director did not suggest anything for these lines. Try again.");
  const atmosphere = typeof (raw as { atmosphere?: unknown }).atmosphere === "string" ? cleanNote((raw as { atmosphere: string }).atmosphere).slice(0, 120) : "";
  return { suggestions, atmosphere };
}

/** A line the owner has already directed by hand. The Director leaves these alone unless asked. */
export function isDirected(d: Direction): boolean {
  return !!(d.emotion || (d.note ?? "").trim() || d.sounds.length);
}

export function applySuggestion(d: Direction, s: Suggestion): Direction {
  return { ...d, emotion: s.emotion, sounds: s.sounds, note: s.note, speed: s.speed, pauseAfter: s.pauseAfter };
}

export function describe(s: { emotion: string; sounds: string[]; note: string }): string {
  return [s.emotion, ...s.sounds, s.note && `“${s.note}”`].filter(Boolean).join(" · ") || "no change needed";
}
