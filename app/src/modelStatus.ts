// The honest state of a local model in Model Center. "Ready" means Greenroom can actually use it to make something
// today, not that its files downloaded. Models whose files or runtime can be installed but which have no route into
// Perform (or the sound and music tools) are "Installed", with the reason said plainly.

import type { HardwareProfile, InstallState, LocalModel } from "./models";

export type ModelStatus = "download-required" | "installed" | "ready" | "requires-setup" | "unsupported";

export interface StatusInfo {
  status: ModelStatus;
  label: string;
  /** Experimental models say so beside their status. */
  experimental: boolean;
  /** The reason, in plain words. */
  detail: string;
}

/** Models Greenroom has a working route for. A model not in this list is never "Ready". */
export const CONNECTED: Record<string, string> = {
  "chatterbox-multilingual-v3": "Speaks with the default voice in Perform.",
  "wazobia-voice": "Speaks in Perform once its voices are added to your library.",
  "director-qwen3-4b": "Used by the AI Director when chosen in Engines.",
  "ace-step-v1": "Makes music from the Timeline.",
  "stable-audio-open-small": "Makes sound clips when chosen as the sound engine.",
};

export const LABEL: Record<ModelStatus, string> = { "download-required": "Download required", installed: "Installed", ready: "Ready", "requires-setup": "Requires setup", unsupported: "Unsupported on this hardware" };

export function modelStatus(m: LocalModel, state: InstallState, runtimeInstalled: boolean, hw: Pick<HardwareProfile, "memoryGb" | "accelerator" | "vramGb">): StatusInfo {
  const base = { experimental: !!m.experimental };
  if (m.id === "ace-step-v1" && /^(apple|cpu)/i.test(hw.accelerator)) return { ...base, status: "unsupported", label: LABEL.unsupported, detail: "Needs an NVIDIA graphics card." };
  if (m.memoryGb > hw.memoryGb && hw.memoryGb > 0 && state !== "installed") return { ...base, status: "unsupported", label: LABEL.unsupported, detail: `Needs about ${m.memoryGb} GB of memory; this computer has ${hw.memoryGb} GB.` };
  const needsRuntime = ["chatterbox-multilingual-v3", "wazobia-voice", "kokoro-82m", "qwen3-tts-17b"].includes(m.id);
  const weights = state === "installed";
  if (m.id === "greenroom-runtime") return { ...base, status: "installed", label: "Shared requirements", detail: "Not a separate install." };
  if (!weights && !(needsRuntime && runtimeInstalled && (m.id === "kokoro-82m" || m.id === "qwen3-tts-17b"))) {
    return { ...base, status: "download-required", label: LABEL["download-required"], detail: state === "downloading" ? "Downloading." : `About ${m.sizeGb} GB.` };
  }
  if (needsRuntime && !runtimeInstalled) return { ...base, status: "requires-setup", label: LABEL["requires-setup"], detail: "The model files are here but its runtime is not installed." };
  const route = CONNECTED[m.id];
  if (route) return { ...base, status: "ready", label: LABEL.ready, detail: route };
  return { ...base, status: "installed", label: LABEL.installed, detail: "Installed, but Greenroom has no route to use it yet, so it cannot make anything." };
}
