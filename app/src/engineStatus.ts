import type { KeyStatus } from "./api";
import type { VoiceEntry } from "./types";

export type EngineChip = { level: "ready" | "partial" | "setup"; label: string; detail: string };

/** One line that answers "can I make speech right now, and where does it run?". */
export function engineChip(keys: KeyStatus, library: Pick<VoiceEntry, "provider">[], localReady: boolean): EngineChip {
  const cloud = keys.elevenlabs || keys.voicekiller || keys.kie || keys.inworld;
  const localVoices = library.some((v) => ["piper", "chatterbox", "wazobia", "local"].includes(v.provider));
  if (localReady && localVoices) return { level: "ready", label: cloud ? "Local + cloud" : "Offline ready", detail: "Local voices are installed and in your library." };
  if (localReady) return { level: "partial", label: cloud ? "Cloud + local engine" : "Engine ready", detail: "A local engine is installed. Add voices in Voices, Casting call." };
  if (cloud) return { level: "partial", label: "Cloud voices", detail: "Cloud engines are connected. Install a local engine in Model Center to work offline." };
  return { level: "setup", label: "Set up voices", detail: "No voice engine is ready yet. Open Model Center to install one." };
}
