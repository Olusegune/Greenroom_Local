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
    description: "Makes a voice from a written description. Greenroom uses it for four described voices in plain English; per-line direction and cloning are not connected. Experimental and slow on a CPU (about a minute per short line on a six-core desktop).",
    sizeGb: 6.4,
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
    id: "ace-step-v1",
    name: "ACE-Step Music",
    maker: "ACE Studio and StepFun",
    kind: "audio",
    tier: "studio",
    description: "Makes full instrumental or sung tracks on your own PC from a text description. Free, private, no credits. Needs an NVIDIA graphics card.",
    sizeGb: 8.3,
    memoryGb: 16,
    capabilities: ["Text to music", "Instrumental or vocals", "10 to 90 seconds", "NVIDIA GPU", "Offline"],
    languages: ["English", "Chinese", "Japanese", "Korean", "Spanish", "French", "German"], accents: [],
    licence: "Apache-2.0",
    sourceUrl: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B", sourceLabel: "Open ACE-Step model page",
    experimental: true,
  },
  {
    id: "stable-audio-open-small",
    name: "Stable Audio Open Small",
    maker: "Stability AI",
    kind: "audio",
    tier: "standard",
    description: "Makes sound effects and short loops on your own PC from a text description, up to 11 seconds each. One-click setup with a free Hugging Face account.",
    sizeGb: 2.6,
    memoryGb: 8,
    capabilities: ["Text to sound", "Up to 11 seconds", "Stereo 44.1 kHz", "Offline"],
    languages: ["English prompts"], accents: [],
    licence: "Stability AI Community License (free below its revenue limit)",
    sourceUrl: "https://huggingface.co/stabilityai/stable-audio-open-small", sourceLabel: "Open Stable Audio Open page",
    experimental: true,
  },
  {
    id: "wazobia-voice",
    name: "WazobiaVoice",
    maker: "Axiveri",
    kind: "speech",
    tier: "studio",
    description: "Nigerian English, Yoruba, Hausa and Igbo with 13 built-in voices, on your PC. One-click setup with a free Hugging Face account. Experimental until native listeners review it.",
    sizeGb: 3.2,
    memoryGb: 10,
    capabilities: ["13 built-in voices", "Offline", "Non-commercial licence"],
    languages: ["Yoruba", "Igbo", "Hausa", "Nigerian English"],
    accents: ["Nigerian English — not independently verified"], licence: "Axiveri Research License: non-commercial; commercial licence required",
    sourceUrl: "https://huggingface.co/Axiveri/WazobiaVoice", sourceLabel: "Open Wazobia model page",
    experimental: true,
  },
  {
    id: "director-qwen3-4b",
    name: "Local AI Director",
    maker: "Qwen (Alibaba)",
    kind: "director",
    tier: "standard",
    description: "Suggests emotion, sounds and a short note for every line, on your own PC. Free and private: your script never leaves your computer. Needs about 4 GB of graphics or system memory.",
    sizeGb: 2.5,
    memoryGb: 6,
    capabilities: ["Scene analysis", "Emotion and sound cues", "Direction notes", "Offline"],
    languages: ["English"], accents: [],
    licence: "Apache-2.0 (model), MIT (engine)",
    sourceUrl: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF", sourceLabel: "Open the model page",
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

/** The one-sentence version of a description, for the card. The full text stays under Details. */
export function shortDescription(text: string, max = 120): string {
  const first = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  if (first.length <= max) return first;
  return first.slice(0, max).replace(/\s+\S*$/, "") + "…";
}

/** Which artwork family a model gets, and the word on it. */
export function modelArt(m: Pick<LocalModel, "id" | "kind">): { kind: "speech" | "music" | "sfx" | "director" | "content"; label: string } {
  if (m.id.includes("ace-step")) return { kind: "music", label: "Music" };
  if (m.id.includes("stable-audio")) return { kind: "sfx", label: "Sound" };
  if (m.kind === "director") return { kind: "director", label: "Director" };
  if (m.kind === "speech") return { kind: "speech", label: "Voice" };
  return { kind: "content", label: "Listen" };
}
