import type { Engine } from "./engines";
import type { PerformancePlan } from "./performance";
import type { VoiceDna } from "./voiceDna";
import type { ConvertReport } from "./convertReport";
import type { BeatMode, BeatSetting } from "./beats";
import type { Reaction } from "./reactions";
import type { AgentRun } from "./agent/graph";
import type { CastingSpec, CharacterCasting, TakeCast, VoiceMeta } from "./casting/types";

export interface Character {
  id: string;
  name: string;
  voiceId?: string;
  /** Free label such as "English", "Yoruba" or "Taglish": a reminder and a voice-search filter, not a switch sent to the model. */
  language: string;
  /** What the script (or the owner) says about this character. Used only to choose its picture and a fitting voice; never sent anywhere unless the owner asks an AI to read the script. */
  about?: string;
  /** Who the character is, as stated. Gender is never guessed from a name. */
  look?: { gender?: "m" | "f"; age?: "child" | "teen" | "young" | "mid" | "old"; heritage?: "black" | "white" | "east_asian" | "south_asian" | "middle_eastern" | "latino" | "indigenous" };
  /** Which avatar shows for this character: a built-in id or a custom one ("custom:..."). Separate from the voice: changing one never changes the other. Absent on older projects. */
  avatarId?: string;
  /** The character's recurring profile: timbre, tendencies, preferred presets, pronunciations, approved reference takes. Absent until the owner fills it in. */
  dna?: VoiceDna;
  /** Sound clips already made for this character (a laugh, a sigh) that can be reused on other lines at no cost. */
  reactions?: Reaction[];
  /** What this character's casting calls for, as stated (vocal gender, age, language, accent and how firmly). Absent until the owner states something. */
  cast?: CastingSpec;
  /** The owner's approved voice for this character and the history of changes. Once approved, only the owner, confirming, can change the voice. */
  casting?: CharacterCasting;
}

/** What produced a piece of audio, kept with it so a studio can answer "where did this come from?". */
export interface Provenance {
  engine: Engine;
  voiceName: string;
  /** The ElevenLabs output format that was asked for, when one applies. */
  quality?: string;
  speed: number;
  instructions?: string;
  /** Cloud model that spoke the line, such as inworld-tts-2, when the engine has more than one. */
  modelId?: string;
  /** A take made phrase by phrase and joined: how many requests it took. */
  assembled?: number;
  /** Where each phrase sits in the joined take, in seconds, so one phrase can be remade without touching the rest. */
  parts?: { text: string; start: number; end: number; pause: number }[];
  /** The phrase (counting from 1) that was remade to produce this take, and the take it was made from. */
  remade?: { phrase: number; from: string };
  /** For a take made by re-voicing a recording: how the result compares with the recording (timing, pauses, liveliness) and its phrase timings. */
  convert?: ConvertReport;
  /** Things worth a second listen, found by measuring the take (for example a short line that came back far too long). Hints, not proof. */
  check?: string[];
  /** The interpretation this take was made as (restrained, expressive, intense), when it was one of a set. */
  variation?: string;
  /** Inworld: the steering sentences and non-verbal tags that were sent, and what could not be. */
  steering?: string[];
  nonverbal?: string[];
  notSent?: string[];
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
  model: "eleven_v4" | "eleven_v3" | "voicekiller" | "inworld" | "kie" | "piper" | "local" | "chatterbox" | "kokoro" | "qwen" | "wazobia";
  ext: "mp3" | "wav";
  voiceId: string;
  /** The character and exact voice this take was made for. Absent on takes made before 0.13. */
  cast?: TakeCast;
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
  model?: "eleven_text_to_sound_v2" | "eleven_text_to_sound_v3";
  loop?: boolean;
  promptInfluence?: number;
  take?: { id: string; ext: "mp3" | "wav"; seconds: number; sha256?: string; prompt?: string; /** Automatic checks made when the clip was created. */ qa?: { peakDb: number; lufs: number | null; issues: string[] } };
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
  /** Where the voice sits in the stereo mix, -1 (left) to 1 (right). Absent or 0 is the centre. Applies to the mix and stems, not to the untouched line files. */
  pan?: number;
  /** How far away the voice sounds, 0 (close) to 1 (far): quieter and duller. Absent or 0 is as recorded. */
  distance?: number;
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
  /** The director's performance plan for this line: objective, subtext, emotional arc, physical state and voice qualities. Absent on older projects and on lines nobody has planned. */
  performance?: PerformancePlan;
  /** Acting inside the line: an emotion, intention, emphasis, pace or pause for individual phrases. Absent unless the owner sets one. */
  beats?: BeatSetting[];
  /** The director's own words for this line ("begins politely, clears his throat, pauses..."). Compiled for each voice when a take is made (performanceCompiler.ts); the saved text is never changed. */
  acting?: string;
  /** How beats reach a voice: written cues in one request (default), or each phrase made separately and joined. */
  beatMode?: BeatMode;
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
  /** A technical QA report (.md): level, clipping, silence, length and sample rate of every file in the mix. */
  qa?: boolean;
  /** A Cinematic Performance Manifest (.json): who spoke each line, with which voice and model, and how it was directed. */
  performance: boolean;
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

export const DEFAULT_EXPORT: ExportCfg = { rate: 48000, bits: 24, target: "off", ceiling: -1, fps: 24, whole: true, scenes: false, lines: true, stems: false, markersInWav: true, labels: false, cueSheet: true, performance: false, qa: false, otio: false, matchPicture: true, report: true, manifest: true };

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
  /** The Agent Studio production run: plan, progress, approvals and audit log. Absent on projects made before it. */
  agent?: AgentRun;
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
  /** How old the voice sounds, used only to choose a matching picture. Absent means not stated. */
  age?: "child" | "teen" | "young" | "mid" | "old";
  /** The look of the person the voice is meant to be, used only to choose a matching picture. Absent means not stated. */
  heritage?: "black" | "white" | "east_asian" | "south_asian" | "middle_eastern" | "latino" | "indigenous";
  notes: string;
  previewUrl?: string;
  /** A real picture for this voice (a small square JPEG as a data address), shown instead of the drawn face. */
  portrait?: string;
  createdAt: string;
  consent?: Consent;
  licence?: LicenceUse;
  licenceNote?: string;
  licenceChecked?: string;
  /** What the owner has recorded about this voice (gender, age, languages, accent), with where each fact came from. Overrides what is derived. */
  meta?: VoiceMeta;
}

export interface VoiceInfo {
  id: string;
  name: string;
  owner?: string | null;
  accent: string;
  language: string;
  gender: string;
  /** ElevenLabs age label: young, middle_aged or old. */
  age?: string;
  description: string;
  category: string;
  previewUrl?: string | null;
}

export const DEFAULT_DIRECTION: Direction = { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 };

export function newProject(id: string, name: string, now: string): Project {
  return { version: 1, id, name, script: "", scenes: ["Scene 1"], characters: [], lines: [], bed: { prompt: "", volume: 0.25 }, gap: 0.4, pronunciations: [], createdAt: now, updatedAt: now };
}
