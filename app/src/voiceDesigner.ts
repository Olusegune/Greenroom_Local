// Designing a voice from a description, on either engine. Shared by the script-screen dialog and Voices, Design a voice.
//   ElevenLabs: cloud, uses credits, and keeping a voice needs a free slot on the account.
//   Qwen3-TTS : on this PC, free, nothing is sent anywhere. A kept voice copies its own preview clip (needs the Base model for a
//               perfectly steady voice, see docs/QWEN_STABILITY.md).

import { api, type DesignPreview } from "./api";
import type { VoiceEntry } from "./types";

export type DesignEngine = "elevenlabs" | "qwen";

/** The sentence a Qwen preview says when the owner gave none. */
export const QWEN_SAMPLE = "Good evening. I do hope you are well, and I am glad that you could come.";

export const qwenSampleFor = (sample: string): string => { const t = sample.trim(); return t.length >= 20 ? t.slice(0, 300) : QWEN_SAMPLE; };

/** Which engine to start on: the one the owner can use right now, preferring the cloud designer when its key is set. */
export const defaultEngine = (hasElevenKey: boolean): DesignEngine => (hasElevenKey ? "elevenlabs" : "qwen");

/** The account has no free custom-voice slot (ElevenLabs answers "reached your maximum amount of custom voices (4 / 3)"). */
export const isSlotLimit = (message: string): boolean => /maximum amount of custom voices|custom voice limit|voice slots|voice limit/i.test(message);

export interface Made { p: DesignPreview; mime: string }

export async function makePreviews(engine: DesignEngine, description: string, sample: string): Promise<Made[]> {
  if (engine === "qwen") return (await api.qwenDesignPreview(description, qwenSampleFor(sample))).map((p) => ({ p, mime: "audio/wav" }));
  return (await api.voiceDesign(description, sample.trim().length >= 100 ? sample.trim() : undefined)).map((p) => ({ p, mime: "audio/mpeg" }));
}

/** Keeps a preview as a voice and returns the library entry for it. The gender and age are not claimed: nobody has listened yet. */
export async function keepPreview(engine: DesignEngine, generatedId: string, name: string, description: string, accent: string): Promise<VoiceEntry> {
  const id = engine === "qwen" ? await api.qwenDesignSave(generatedId) : await api.voiceDesignSave(generatedId, name, description);
  return {
    id, name, provider: engine === "qwen" ? "qwen" : "elevenlabs", source: "designed", language: "", accent, gender: "", notes: description.slice(0, 160), createdAt: new Date().toISOString(),
    consent: { speaker: "No real person: designed from a description", basis: "designed", reference: description.slice(0, 120), date: new Date().toISOString().slice(0, 10) },
  };
}

/** Words for a failure that the owner can act on. */
export function designFailure(engine: DesignEngine, message: string, stage: "make" | "keep"): { text: string; offerLocal: boolean } {
  if (engine === "elevenlabs" && isSlotLimit(message)) {
    return { text: "Your ElevenLabs account is full: it has no free custom-voice slot, so it cannot keep another designed voice. You can delete one you no longer use on elevenlabs.io, upgrade the plan, or design this voice on this PC for free instead. The preview is safe in your local Design Vault.", offerLocal: true };
  }
  if (engine === "elevenlabs") return { text: `ElevenLabs could not ${stage === "keep" ? "save this voice" : "make the previews"}. ${message}`, offerLocal: true };
  return { text: `The voice could not be ${stage === "keep" ? "kept" : "designed on this PC"}. ${message}`, offerLocal: false };
}
