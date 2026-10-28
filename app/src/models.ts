export type ModelKind = "runtime" | "speech" | "director" | "transcription" | "audio";
export type ModelTier = "compact" | "standard" | "studio";
export type InstallState = "available" | "queued" | "downloading" | "installed" | "error";

export interface LocalModel {
  id: string;
  name: string;
  maker: string;
  kind: ModelKind;
  tier: ModelTier;
  description: string;
  sizeGb: number;
  memoryGb: number;
  capabilities: string[];
  languages: string[];
  accents: string[];
  licence: string;
  recommended?: boolean;
  experimental?: boolean;
}

export interface InstalledModel {
  id: string;
  state: InstallState;
  progress: number;
  version?: string;
  path?: string;
  error?: string;
}

export interface HardwareProfile {
  platform: "windows" | "macos" | "linux" | "unknown";
  memoryGb: number;
  accelerator: string;
  vramGb: number;
  tier: ModelTier;
}

export const MODEL_CATALOG: LocalModel[] = [
  {
    id: "greenroom-runtime",
    name: "Greenroom AI Runtime",
    maker: "Greenroom Local",
    kind: "runtime",
    tier: "compact",
    description: "Managed local inference environment. Greenroom installs and updates it for you.",
    sizeGb: 1.2,
    memoryGb: 4,
    capabilities: ["Model isolation", "Background jobs", "CUDA", "Apple Metal", "CPU"],
    languages: [], accents: [], licence: "Greenroom components and third-party notices",
    recommended: true,
  },
  {
    id: "chatterbox-multilingual-v3",
    name: "Chatterbox Multilingual V3",
    maker: "Resemble AI",
    kind: "speech",
    tier: "standard",
    description: "Expressive multilingual acting, voice cloning and paralinguistic performance.",
    sizeGb: 3.2,
    memoryGb: 8,
    capabilities: ["Voice cloning", "Emotion", "Chuckle", "Breath", "Exertion", "23+ languages"],
    languages: ["English", "Korean", "French", "Spanish", "Swahili", "Arabic", "Hindi"],
    accents: ["Voice-reference dependent"], licence: "MIT (verify model card at install)",
    recommended: true,
  },
  {
    id: "qwen3-tts-17b",
    name: "Qwen3-TTS 1.7B",
    maker: "Qwen",
    kind: "speech",
    tier: "studio",
    description: "High-end voice design, cloning and natural-language performance direction.",
    sizeGb: 5.0,
    memoryGb: 12,
    capabilities: ["Voice design", "Voice cloning", "Natural-language direction", "Korean"],
    languages: ["English", "Korean", "Chinese", "Japanese", "German", "French", "Spanish"],
    accents: ["Reference dependent"], licence: "Shown and accepted before download",
  },
  {
    id: "wazobia-voice",
    name: "WazobiaVoice",
    maker: "Axiveri",
    kind: "speech",
    tier: "studio",
    description: "Nigerian multilingual candidate. Remains experimental until native listening review passes.",
    sizeGb: 4.3,
    memoryGb: 10,
    capabilities: ["Voice cloning", "Expressive controls", "Code-switching"],
    languages: ["Yoruba", "Igbo", "Hausa", "Nigerian Pidgin", "English"],
    accents: ["Nigerian English — not independently verified"], licence: "Axiveri Research License: non-commercial; commercial licence required",
    experimental: true,
  },
  {
    id: "director-8b",
    name: "Local Acting Director 8B",
    maker: "Greenroom Local",
    kind: "director",
    tier: "standard",
    description: "A private GGUF language model that turns scenes and physical action into editable performance plans.",
    sizeGb: 5.2,
    memoryGb: 10,
    capabilities: ["Scene analysis", "Emotional arcs", "Physical-state continuity", "Pronunciation help"],
    languages: ["Multilingual"], accents: [], licence: "Model-specific; shown before download",
    recommended: true,
  },
  {
    id: "whisper-large-v3-turbo",
    name: "Whisper Large v3 Turbo",
    maker: "OpenAI",
    kind: "transcription",
    tier: "standard",
    description: "Local transcription, timing, reference cleanup and take verification.",
    sizeGb: 1.7,
    memoryGb: 6,
    capabilities: ["Transcription", "Language detection", "Timing", "Clone sample checks"],
    languages: ["Multilingual"], accents: [], licence: "MIT",
  },
];

export function recommendedModels(profile: HardwareProfile, models = MODEL_CATALOG): string[] {
  const allowed = profile.tier === "studio" ? ["compact", "standard", "studio"] : profile.tier === "standard" ? ["compact", "standard"] : ["compact"];
  return models.filter((m) => m.recommended && allowed.includes(m.tier)).map((m) => m.id);
}

export function totalDownload(ids: string[], models = MODEL_CATALOG): number {
  return models.filter((m) => ids.includes(m.id)).reduce((n, m) => n + m.sizeGb, 0);
}
