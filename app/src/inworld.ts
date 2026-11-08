// Turning a Greenroom line into what Inworld can act on (docs read 2026-11-08, https://docs.inworld.ai/tts/capabilities/steering.md):
//  - inworld-tts-2 reads an English instruction in square brackets, such as "[say excitedly] How do you do.", and keeps it until changed.
//  - inworld-tts-2-flash ignores instructions, but still plays the non-verbal tags [laugh] [breathe] [sigh] [cough] [clear throat].
// Only what is documented is sent. Everything else is listed in `notSent` so the owner is told before paying, never silently dropped.
// The wording of the emotion phrases below is Greenroom's own and has not been judged by ear yet.

import { noteTags } from "./direct";
import type { InworldModel } from "./engines";
import type { Line } from "./types";

export const INWORLD_MODELS: { id: InworldModel; label: string; steering: boolean; blurb: string }[] = [
  { id: "inworld-tts-2", label: "Inworld TTS 2", steering: true, blurb: "The flagship. Follows written delivery instructions and has a delivery mode." },
  { id: "inworld-tts-2-flash", label: "Inworld TTS 2 Flash", steering: false, blurb: "The fastest and lowest cost. Plays laughs, sighs and breaths, but does not follow written instructions." },
];

export const DEFAULT_INWORLD_MODEL: InworldModel = "inworld-tts-2";
export const steers = (m: InworldModel | undefined): boolean => (m ?? DEFAULT_INWORLD_MODEL) === "inworld-tts-2";

/** Greenroom sound names that Inworld documents as non-verbal tags. Breath-like sounds are approximated by [breathe]. */
const NONVERBAL: Record<string, { tag: string; exact: boolean }> = {
  laughs: { tag: "laugh", exact: true },
  sighs: { tag: "sigh", exact: true },
  coughs: { tag: "cough", exact: true },
  "clears throat": { tag: "clear throat", exact: true },
  "out of breath": { tag: "breathe", exact: false },
  "breathing heavily": { tag: "breathe", exact: false },
  panting: { tag: "breathe", exact: false },
};

const EMOTION_STEER: Record<string, string> = {
  excited: "say excitedly",
  happy: "say happily",
  sad: "say sadly",
  angry: "say angrily",
  annoyed: "say with annoyance",
  scared: "say fearfully",
  nervous: "say nervously",
  tender: "say tenderly",
  sarcastic: "say sarcastically",
  tired: "say wearily",
  whispers: "whisper",
  shouting: "say loudly",
};

export interface InworldPlan {
  /** Exactly what is sent to Inworld. */
  text: string;
  /** The English instruction sent as a bracket, when the model follows instructions. */
  steering: string[];
  /** Non-verbal tags sent. */
  nonverbal: string[];
  /** Things the line asks for that this model or Inworld cannot do, in plain words. */
  notSent: string[];
}

const ALIAS: Record<string, string> = { laughs: "laugh", sighs: "sigh", coughs: "cough", "clears throat": "clear throat", breathes: "breathe", breathing: "breathe" };

/** The line's own `[laughs]`-style tags renamed to the ones Inworld documents. Other brackets are left exactly as written. */
export function inworldWords(text: string): string {
  return text.replace(/\[([^\]]+)\]/g, (m, t: string) => (ALIAS[t.trim().toLowerCase()] ? `[${ALIAS[t.trim().toLowerCase()]}]` : m)).replace(/\s+/g, " ").trim();
}

export function inworldPlan(line: Pick<Line, "text" | "direction">, model: InworldModel | undefined): InworldPlan {
  const steerable = steers(model);
  const d = line.direction;
  const steering: string[] = [];
  const nonverbal: string[] = [];
  const notSent: string[] = [];

  const emotion = d.emotion.trim().toLowerCase();
  const sentences = noteTags(d.note);
  if (steerable) {
    const parts = [emotion && (EMOTION_STEER[emotion] ?? `say it ${emotion.replace(/[^\p{L} -]/gu, "").slice(0, 30)}`), ...sentences].filter(Boolean) as string[];
    if (parts.length) steering.push(parts.join(". ").slice(0, 400));
  } else {
    if (emotion) notSent.push(`the ${emotion} delivery (this model does not follow written instructions)`);
    if (sentences.length) notSent.push("the written direction (this model does not follow written instructions)");
  }

  const written = new Set([...line.text.matchAll(/\[([^\]]+)\]/g)].map((m) => (ALIAS[m[1]!.trim().toLowerCase()] ?? m[1]!.trim().toLowerCase())));
  for (const s of d.sounds) {
    const n = NONVERBAL[s.trim().toLowerCase()];
    if (!n) {
      notSent.push(`${s} (Inworld has no ${s} sound; use a sound clip)`);
    } else if (!written.has(n.tag) && !nonverbal.includes(n.tag)) {
      nonverbal.push(n.tag);
      if (!n.exact) notSent.push(`${s} is sent as a plain [${n.tag}]`);
    }
  }

  const lead = [...steering.map((s) => `[${s}]`), ...nonverbal.map((t) => `[${t}]`)];
  return { text: [...lead, inworldWords(line.text)].join(" ").trim(), steering, nonverbal, notSent };
}
