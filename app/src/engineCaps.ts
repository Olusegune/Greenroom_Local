// What each voice engine can actually be given. Taken from each engine's own notes in this code base and the provider
// documentation recorded in DECISIONS.md. It says what an engine ACCEPTS, never how good it sounds: quality is only
// ever the owner's judgement by ear. The router below uses it to suggest an engine; it never switches one silently.

import { ENGINE_ORDER, ENGINES, type Engine, type InworldModel } from "./engines";

export interface EngineCaps {
  /** Acts on written delivery direction (a bracketed instruction, a tag or an instruction field). */
  words: boolean;
  /** Plays laughs, sighs, coughs and breaths from tags written into the text. */
  nonverbal: boolean;
  /** Follows a speed setting. */
  speed: boolean;
  /** Can make a voice from a recording inside Greenroom. */
  cloning: boolean;
  /** Needs no payment. */
  free: boolean;
  /** Sends text to a company. Local engines never do. */
  cloud: boolean;
  note: string;
}

export const CAPS: Record<Engine, EngineCaps> = {
  elevenlabs: { words: true, nonverbal: true, speed: true, cloning: true, free: false, cloud: true, note: "Direction and sounds as tags." },
  inworld: { words: true, nonverbal: true, speed: true, cloning: true, free: false, cloud: true, note: "Written direction on TTS 2 only; five non-verbal tags on both models." },
  voicekiller: { words: true, nonverbal: false, speed: true, cloning: false, free: false, cloud: true, note: "Direction as an instruction sentence; no sound tags." },
  kie: { words: false, nonverbal: false, speed: true, cloning: false, free: false, cloud: true, note: "Preset voices; direction and sound tags are not used." },
  piper: { words: false, nonverbal: false, speed: true, cloning: false, free: true, cloud: false, note: "Plain speech on this PC." },
  chatterbox: { words: false, nonverbal: false, speed: false, cloning: false, free: true, cloud: false, note: "Default voice only; acting and cloning are not connected yet." },
  kokoro: { words: false, nonverbal: false, speed: true, cloning: false, free: true, cloud: false, note: "Plain English speech on this PC from a fixed set of voices; no acting or cloning." },
  qwen: { words: false, nonverbal: false, speed: false, cloning: false, free: true, cloud: false, note: "Plain English speech on this PC from described voices; per-line direction and cloning are not connected, and a voice can drift between lines." },
  wazobia: { words: false, nonverbal: false, speed: false, cloning: false, free: true, cloud: false, note: "Nigerian English, Yoruba, Hausa and Igbo on this PC; research licence." },
  local: { words: false, nonverbal: false, speed: true, cloning: false, free: true, cloud: false, note: "Your own speech server on this PC." },
};

/** Whether a voice from this engine acts on written words right now. Inworld depends on its model. */
export function actsOnWords(engine: Engine, inworldModel?: InworldModel): boolean {
  if (engine === "inworld") return (inworldModel ?? "inworld-tts-2") === "inworld-tts-2";
  return CAPS[engine].words;
}

export interface Need {
  /** The line has written direction, an emotion or a performance plan to act on. */
  words?: boolean;
  /** Greenroom sound names the line asks for, such as "laughs". */
  sounds?: string[];
  cloning?: boolean;
  /** The text must stay on this computer. Cloud engines are ruled out, never "downgraded to". */
  private?: boolean;
  freeOnly?: boolean;
}

export interface Suggestion {
  engine: Engine;
  ok: boolean;
  /** Why it fits, or what it cannot do for this request. */
  reasons: string[];
}

const SOUND_NAMES = new Set(["laughs", "sighs", "coughs", "clears throat", "out of breath", "breathing heavily", "panting"]);

/** Which of the ready engines can do what a line asks. Local engines come first among those that can. Nothing is chosen for you. */
export function suggestEngines(need: Need, ready: Engine[], inworldModel?: InworldModel): Suggestion[] {
  const out: Suggestion[] = [];
  for (const e of ENGINE_ORDER.filter((x) => ready.includes(x))) {
    const c = CAPS[e];
    const why: string[] = [];
    const miss: string[] = [];
    if (need.private && c.cloud) miss.push("sends text to a company");
    if (need.freeOnly && !c.free) miss.push("costs money");
    if (need.words) (actsOnWords(e, inworldModel) ? why : miss).push(actsOnWords(e, inworldModel) ? "acts on written direction" : "cannot act on written direction");
    const sounds = need.sounds ?? [];
    if (sounds.length) {
      const can = c.nonverbal && (e === "inworld" ? sounds.every((s) => SOUND_NAMES.has(s)) : true);
      (can ? why : miss).push(can ? "plays the sounds" : e === "inworld" && c.nonverbal ? "cannot play every sound asked for" : "cannot play sounds");
    }
    if (need.cloning) (c.cloning ? why : miss).push(c.cloning ? "can clone a voice" : "cannot clone a voice here");
    out.push({ engine: e, ok: miss.length === 0, reasons: miss.length ? miss : why.length ? why : ["fits"] });
  }
  const rank = (s: Suggestion) => (s.ok ? 0 : 2) + (CAPS[s.engine].cloud ? 1 : 0);
  return out.sort((a, b) => rank(a) - rank(b));
}

export const engineLabel = (e: Engine): string => ENGINES[e].label;
