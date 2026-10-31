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
  /** Official model card or project page. Greenroom never sends users to a third-party mirror. */
  sourceUrl: string;
  sourceLabel: string;
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
    description: "Shared local runtime requirements. Greenroom installs a verified runtime only for engines that explicitly support in-app setup.",
    sizeGb: 1.2,
    memoryGb: 4,
    capabilities: ["Model isolation", "Background jobs", "CUDA", "Apple Metal", "CPU"],
    languages: [], accents: [], licence: "Greenroom components and third-party notices",
    sourceUrl: "https://github.com/resemble-ai/chatterbox", sourceLabel: "Runtime requirements",
    recommended: true,
  },
  {
    id: "chatterbox-multilingual-v3",
    name: "Chatterbox Multilingual V3",
    maker: "Resemble AI",
    kind: "speech",
    tier: "standard",
    description: "Model files and a local runtime are available in Greenroom. The current built-in voice is plain English speech; advanced acting and cloning remain model capabilities to connect.",
    sizeGb: 3.2,
    memoryGb: 8,
    capabilities: ["Voice cloning", "Emotion", "Chuckle", "Breath", "Exertion", "23+ languages"],
    languages: ["English", "Korean", "French", "Spanish", "Swahili", "Arabic", "Hindi"],
    accents: ["Voice-reference dependent"], licence: "MIT (verify model card at install)",
    sourceUrl: "https://huggingface.co/ResembleAI/chatterbox", sourceLabel: "Open Chatterbox model page",
    recommended: true,
  },
  {
    id: "qwen3-tts-17b",
    name: "Qwen3-TTS VoiceDesign 1.7B",
    maker: "Qwen",
    kind: "speech",
    tier: "studio",
    description: "High-end voice design, cloning and natural-language performance direction.",
    sizeGb: 4.5,
    memoryGb: 12,
    capabilities: ["Voice design", "Voice cloning", "Natural-language direction", "Korean"],
    languages: ["English", "Korean", "Chinese", "Japanese", "German", "French", "Spanish"],
    accents: ["Reference dependent"], licence: "Apache-2.0 (verify model card before use)",
    sourceUrl: "https://huggingface.co/Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign", sourceLabel: "Open Qwen model page",
  },
  {
    id: "kokoro-82m",
    name: "Kokoro 82M",
    maker: "Hexgrad",
    kind: "speech",
    tier: "compact",
    description: "Fast lightweight local narration with a broad preset voice catalog. Runtime and voice downloads are not yet managed by Greenroom.",
    sizeGb: 0.35,
    memoryGb: 2,
    capabilities: ["Fast previews", "CPU-friendly", "Preset voices", "Offline narration"],
    languages: ["English", "Spanish", "French", "Japanese", "Chinese"],
    accents: ["Preset-dependent"], licence: "Apache-2.0 (verify voice pack terms)",
    sourceUrl: "https://github.com/hexgrad/kokoro", sourceLabel: "Open Kokoro model page",
    recommended: true,
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
    sourceUrl: "https://huggingface.co/Axiveri/WazobiaVoice", sourceLabel: "Open Wazobia model page",
    experimental: true,
  },
  {
    id: "director-8b",
    name: "AI Director",
    maker: "Kie (connected engine)",
    kind: "director",
    tier: "standard",
    description: "Turns scenes and physical action into editable performance plans. Suggestions are reviewed before they change your script.",
    sizeGb: 5.2,
    memoryGb: 10,
    capabilities: ["Scene analysis", "Emotional arcs", "Physical-state continuity", "Pronunciation help"],
    languages: ["Multilingual"], accents: [], licence: "Check the selected model card",
    sourceUrl: "https://kie.ai", sourceLabel: "Open Kie",
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
    sourceUrl: "https://huggingface.co/openai/whisper-large-v3-turbo", sourceLabel: "Open Whisper model page",
  },
];

export function recommendedModels(profile: HardwareProfile, models = MODEL_CATALOG): string[] {
  const allowed = profile.tier === "studio" ? ["compact", "standard", "studio"] : profile.tier === "standard" ? ["compact", "standard"] : ["compact"];
  return models.filter((m) => m.recommended && allowed.includes(m.tier)).map((m) => m.id);
}

export function totalDownload(ids: string[], models = MODEL_CATALOG): number {
  return models.filter((m) => ids.includes(m.id)).reduce((n, m) => n + m.sizeGb, 0);
}
