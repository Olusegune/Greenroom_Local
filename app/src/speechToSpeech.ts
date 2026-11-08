import { encodeWav, toBase64 } from "./audio";
import type { Take, VoiceEntry } from "./types";

export const MIN_SECONDS = 0.5;
export const MAX_SECONDS = 300;

/** What is wrong with a recording before it is sent, if anything. */
export function checkRecording(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < MIN_SECONDS) return "That recording is too short. Record at least half a second.";
  if (seconds > MAX_SECONDS) return "That recording is too long. Re-voice one line at a time, up to 5 minutes.";
  return null;
}

/** The file type to tell the converter about a voice sample, from what the browser says it is. Anything unknown is sent as WAV. */
export function sampleExt(mime: string): "wav" | "mp3" | "flac" | "ogg" {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("flac")) return "flac";
  if (m.includes("ogg")) return "ogg";
  return "wav";
}

/** A take made by re-voicing a human performance. It says so in its own record, so the production report can tell it from text-to-speech. */
export function convertedTake(args: { id: string; at: string; voice: Pick<VoiceEntry, "id" | "name" | "provider">; seconds: number; sha256: string; appVersion: string; source: string; emotion: string; note: string }): Take {
  return {
    id: args.id,
    at: args.at,
    model: "chatterbox",
    ext: "wav",
    voiceId: args.voice.id,
    sent: `(speech to speech: ${args.source}, re-voiced as ${args.voice.name})`,
    seconds: args.seconds,
    provenance: {
      engine: "chatterbox",
      voiceName: args.voice.name,
      speed: 1,
      instructions: `Speech to speech with Chatterbox voice conversion. The timing and delivery come from a human recording (${args.source}); the voice comes from ${args.voice.name} (${args.voice.provider}). A real person performed this line.`,
      chars: 0,
      sha256: args.sha256,
      appVersion: args.appVersion,
      emotion: args.emotion,
      sounds: [],
      note: args.note,
      pronunciations: 0,
    },
  };
}

/** Decodes any recording the browser can play to a mono 16-bit WAV, which the converter can always read. */
export async function decodeToWav(data: ArrayBuffer): Promise<{ b64: string; seconds: number; samples: Float32Array; rate: number }> {
  const ctx = new AudioContext();
  try {
    const buf = await ctx.decodeAudioData(data.slice(0));
    const mono = new Float32Array(buf.length);
    for (let c = 0; c < buf.numberOfChannels; c++) { const ch = buf.getChannelData(c); for (let i = 0; i < buf.length; i++) mono[i]! += ch[i]! / buf.numberOfChannels; }
    return { b64: toBase64(encodeWav([mono], buf.sampleRate)), seconds: buf.duration, samples: mono, rate: buf.sampleRate };
  } finally { void ctx.close(); }
}
