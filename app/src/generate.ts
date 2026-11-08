// Making one take: pick the engine from the voice, shape the text for it, save the audio, remember its length.

import { api, type Provider } from "./api";
import { applyPronunciations, composeText, stripTags, vkInstructions } from "./direct";
import { ENGINES, providerFor, type ElevenModel, type InworldModel } from "./engines";
import { DEFAULT_INWORLD_MODEL, inworldPlan } from "./inworld";
import { applyVariation, type VariationId } from "./acting";
import { effectiveLine } from "./performance";
import { fromBase64 } from "./audio";
import { remember } from "./media";
import { uid } from "./script";
import { sha256Hex } from "./trust";
import { APP_VERSION } from "./version";
import type { Line, Pronunciation, Take, VoiceEntry } from "./types";

export type Model = ElevenModel;

/** What is sent for this line and voice. Engines without tags get the plain words, plus delivery in words where they take it. */
export interface PlanOptions {
  inworldModel?: InworldModel;
  /** Make the line as one of four interpretations. The saved line is not changed. */
  variation?: VariationId;
}

export interface Plan {
  provider: Provider;
  text: string;
  instructions?: string;
  model: Take["model"];
  /** Cloud model id for engines that have several, such as inworld-tts-2. */
  modelId?: string;
  steering?: string[];
  nonverbal?: string[];
  /** What the line asked for that this voice could not be given. Shown before paying. */
  notSent?: string[];
}

export function plan(saved: Line, voice: VoiceEntry, model: Model, dict: Pronunciation[] = [], opts: PlanOptions = {}): Plan {
  // The performance plan (if any) is compiled into the direction here; the saved line is never changed.
  const line = effectiveLine(opts.variation ? applyVariation(saved, opts.variation) : saved);
  const e = voice.provider;
  const provider = providerFor(e, model, voice.vkClone);
  if (e === "inworld") {
    const modelId = opts.inworldModel ?? DEFAULT_INWORLD_MODEL;
    const w = inworldPlan({ text: applyPronunciations(line.text, dict), direction: line.direction }, modelId);
    return { provider, text: w.text, model: "inworld", modelId, steering: w.steering, nonverbal: w.nonverbal, notSent: w.notSent };
  }
  if (ENGINES[e].tags) return { provider, text: applyPronunciations(composeText(line), dict), model };
  const instructions = e === "voicekiller" ? vkInstructions(line.direction.emotion, line.direction.speed, line.direction.note) : undefined;
  return { provider, text: applyPronunciations(stripTags(line.text), dict), instructions, model: e as Take["model"] };
}

export async function makeTake(projectId: string, saved: Line, voice: VoiceEntry, model: Model, dict: Pronunciation[] = [], quality?: string, opts: PlanOptions = {}): Promise<Take> {
  const line = effectiveLine(opts.variation ? applyVariation(saved, opts.variation) : saved);
  const p = plan(saved, voice, model, dict, opts);
  const out = await api.runClip({ provider: p.provider, text: p.text, voice: voice.id, speed: line.direction.speed, instructions: p.instructions, quality, model: p.modelId });
  const id = "t-" + uid();
  const ext = out.mime === "audio/wav" ? "wav" : "mp3";
  await api.takeWrite(projectId, id, ext, out.audioB64);
  const seconds = await remember(id, out);
  const sha256 = await sha256Hex(fromBase64(out.audioB64));
  return {
    id,
    at: new Date().toISOString(),
    model: p.model,
    ext,
    voiceId: voice.id,
    sent: p.instructions ? `${p.text}  (instructions: ${p.instructions})` : p.text,
    seconds,
    provenance: {
      engine: voice.provider,
      voiceName: voice.name,
      quality: voice.provider === "elevenlabs" ? quality : undefined,
      speed: voice.provider === "chatterbox" || voice.provider === "wazobia" ? 1 : line.direction.speed,
      instructions: p.instructions,
      modelId: p.modelId,
      variation: opts.variation,
      steering: p.steering?.length ? p.steering : undefined,
      nonverbal: p.nonverbal?.length ? p.nonverbal : undefined,
      notSent: p.notSent?.length ? p.notSent : undefined,
      chars: p.text.length,
      sha256,
      appVersion: APP_VERSION,
      emotion: line.direction.emotion,
      sounds: line.direction.sounds,
      note: line.direction.note ?? "",
      pronunciations: dict.length,
    },
  };
}

/** A sound clip (laugh, sneeze, door) made by the sound-effects model, kept like any other take. */
export async function makeSound(projectId: string, prompt: string, seconds: number, quality?: string, provider: "eleven-sfx" | "kie-sfx" | "local-sfx" = "eleven-sfx", options: { loop?: boolean; promptInfluence?: number; sfxModel?: "eleven_text_to_sound_v2" | "eleven_text_to_sound_v3" } = {}) {
  const out = await api.runClip({ provider, text: prompt, seconds, quality, ...options });
  const id = "s-" + uid();
  const ext = out.mime === "audio/wav" ? "wav" : "mp3";
  await api.takeWrite(projectId, id, ext, out.audioB64);
  const real = await remember(id, out);
  const sha256 = await sha256Hex(fromBase64(out.audioB64));
  return { id, ext, seconds: real, sha256, prompt, ...options } as const;
}

export function modelLabel(m: Take["model"]): string {
  return m === "eleven_v4" ? "Eleven v4" : m === "eleven_v3" ? "Eleven v3" : m === "voicekiller" ? "VoiceKiller" : m === "inworld" ? "Inworld" : m === "kie" ? "Kie" : m === "piper" ? "Piper" : m === "chatterbox" ? "Chatterbox" : m === "wazobia" ? "WazobiaVoice" : "Local";
}
