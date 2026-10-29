import type { Engine } from "./engines";

export interface Character {
  id: string;
  name: string;
  voiceId?: string;
  /** Free label such as "English", "Yoruba" or "Taglish": a reminder and a voice-search filter, not a switch sent to the model. */
  language: string;
}

/** What produced a piece of audio, kept with it so a studio can answer "where did this come from?". */
export interface Provenance {
  engine: Engine;
  voiceName: string;
  /** The ElevenLabs output format that was asked for, when one applies. */
  quality?: string;
  speed: number;
  instructions?: string;
  /** Characters sent to the engine. */
  chars: number;
  /** SHA-256 of the audio file as saved, so a changed file can be spotted. */
  sha256: string;
  appVersion: string;
  emotion: string;
  sounds: string[];
  note: string;
  pronunciations: number;
}

export interface Take {
  id: string;
  at: string;
  model: "eleven_v4" | "eleven_v3" | "voicekiller" | "kie" | "piper" | "local" | "chatterbox";
  ext: "mp3" | "wav";
  voiceId: string;
  /** Exactly what was sent, tags included, so a take can always be explained. */
  sent: string;
  seconds: number;
  provenance?: Provenance;
}

export interface SoundEvent {
  id: string;
  prompt: string;
  placement: "before" | "after";
  seconds: number;
  take?: { id: string; ext: "mp3" | "wav"; seconds: number; sha256?: string; prompt?: string };
}

export interface Direction {
  emotion: string;
  /** The director's note in plain words, such as "tired, as if lifting something heavy". */
  note: string;
  sounds: string[];
  speed: number;
  pauseAfter: number;
  /** Level of this line in the mix, in dB. Older projects have none, which means 0. */
  gain?: number;
}

export interface Line {
  id: string;
  characterId: string;
  scene: number;
  text: string;
  direction: Direction;
  takes: Take[];
  chosen?: string;
  events: SoundEvent[];
  /** Seconds from the start of the picture at which this line starts speaking. Without one, the line follows the one before it. */
  cue?: number;
  /** Seconds the line fades in and out at its edges. Defaults are a few milliseconds, just enough to avoid clicks. */
  fadeIn?: number;
  fadeOut?: number;
}

export interface Pronunciation {
  from: string;
  to: string;
}

export interface Bed {
  prompt: string;
  volume: number;
  take?: { id: string; ext: "mp3" | "wav"; seconds: number; sha256?: string };
}

export interface ExportCfg {
  rate: 44100 | 48000 | 96000;
  bits: 16 | 24 | 32;
  /** A loudness target id from loudness.ts, or off. */
  target: string;
  /** True-peak ceiling in dBTP. */
  ceiling: number;
  fps: number;
  whole: boolean;
  scenes: boolean;
  lines: boolean;
  stems: boolean;
  markersInWav: boolean;
  labels: boolean;
  cueSheet: boolean;
  otio: boolean;
  /** A CMX 3600 cut list (.edl). */
  edl?: boolean;
  /** With a picture: make the mix exactly as long as the picture. */
  matchPicture: boolean;
  /** A production report and a rights register. */
  report: boolean;
  /** A list of the SHA-256 of every exported file. */
  manifest: boolean;
}

export const DEFAULT_EXPORT: ExportCfg = { rate: 48000, bits: 24, target: "off", ceiling: -1, fps: 24, whole: true, scenes: false, lines: true, stems: false, markersInWav: true, labels: false, cueSheet: true, otio: false, matchPicture: true, report: true, manifest: true };

/** How music and atmosphere dip under dialogue. */
export interface MixCfg {
  duck: boolean;
  /** Also dip the atmosphere (music always does when ducking is on and the clip allows it). */
  duckAtmosphere: boolean;
  /** How far the music drops, in dB (negative). */
  amountDb: number;
  /** Seconds the dip begins before a line starts. */
  attack: number;
  /** Seconds the dip is held after a line ends. */
  hold: number;
  /** Seconds the music takes to come back. */
  release: number;
}

export const DEFAULT_MIX: MixCfg = { duck: true, duckAtmosphere: false, amountDb: -12, attack: 0.15, hold: 0.25, release: 0.7 };

/** A piece of music (or any long sound) the owner brought in. The file is copied into the project and never changed. */
export interface MusicClip {
  id: string;
  name: string;
  take: { id: string; ext: string; seconds: number; sha256?: string; bytes?: number };
  /** Where it starts in the mix, in seconds. */
  start: number;
  gainDb: number;
  fadeIn: number;
  fadeOut: number;
  /** Seconds skipped at the start of the file. */
  trimIn: number;
  /** Seconds of the file that play. */
  length: number;
  /** Dip under dialogue. */
  duck: boolean;
  /** Where it came from and the licence, for the production report. */
  source: string;
}

/** A video the sound is being made for. The file stays where it is; only its path and facts are kept. */
export interface Picture {
  path: string;
  name: string;
  /** Frame rate as a fraction, for example 24000 / 1001 for 23.976. */
  fpsNum: number;
  fpsDen: number;
  /** True when the frame rate was read from the file, false when the owner chose it. */
  fpsKnown: boolean;
  duration: number;
  width: number;
  height: number;
  /** Frame number shown at the first frame (non-drop), for example 01:00:00:00 at 24 fps is 86400. */
  startFrame: number;
}

export interface Project {
  version: 1;
  id: string;
  name: string;
  script: string;
  scenes: string[];
  characters: Character[];
  lines: Line[];
  bed: Bed;
  gap: number;
  /** Written form to spoken form, applied to the words sent to a voice, never to the script itself. */
  pronunciations: Pronunciation[];
  export?: Partial<ExportCfg>;
  /** Spend limit for this project, in the currency set in Studio. */
  budget?: number;
  picture?: Picture;
  music?: MusicClip[];
  mix?: Partial<MixCfg>;
  ledger?: LedgerEntry[];
  createdAt: string;
  updatedAt: string;
}

export type ConsentBasis = "self" | "permission" | "licence" | "designed" | "other";

/** Who agreed to this voice being used, and on what basis. Required when a voice is cloned. */
export interface Consent {
  speaker: string;
  basis: ConsentBasis;
  /** A contract, email or release reference, if there is one. */
  reference: string;
  date: string;
}

export type LicenceUse = "unknown" | "commercial" | "personal";

export interface LedgerEntry {
  at: string;
  kind: "speech" | "sound" | "director" | "design" | "sample" | "music";
  engine: string;
  chars: number;
  /** Estimated cost from the prices the owner entered. Zero when no price is set. */
  cost: number;
  note?: string;
}

export interface VoiceEntry {
  /** The voice id: an ElevenLabs or Kie id, a VoiceKiller or local-server voice name, or a Piper voice key. */
  id: string;
  name: string;
  provider: Engine;
  /** A voice cloned on voicekiller.com uses their clone endpoint. */
  vkClone?: boolean;
  source: "designed" | "cloned" | "library" | "account";
  language: string;
  accent: string;
  gender: string;
  notes: string;
  previewUrl?: string;
  createdAt: string;
  consent?: Consent;
  licence?: LicenceUse;
  licenceNote?: string;
  licenceChecked?: string;
}

export interface VoiceInfo {
  id: string;
  name: string;
  owner?: string | null;
  accent: string;
  language: string;
  gender: string;
  description: string;
  category: string;
  previewUrl?: string | null;
}

export const DEFAULT_DIRECTION: Direction = { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 };

export function newProject(id: string, name: string, now: string): Project {
  return { version: 1, id, name, script: "", scenes: ["Scene 1"], characters: [], lines: [], bed: { prompt: "", volume: 0.25 }, gap: 0.4, pronunciations: [], createdAt: now, updatedAt: now };
}
