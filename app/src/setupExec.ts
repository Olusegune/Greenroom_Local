import { api, type PiperVoice } from "./api";
import { genderWord } from "./avatarLibrary";
import { CHATTERBOX_MODEL_ID, KOKORO_VOICES, type SetupStep } from "./setupPlan";
import type { VoiceEntry } from "./types";

type SaveLibrary = (fn: (l: VoiceEntry[]) => VoiceEntry[]) => void;

/** Does the real work of one setup step through the same commands the Model Center buttons use. Throws a plain message on failure. */
export async function execStep(s: SetupStep, ctx: { catalog: PiperVoice[]; saveLibrary: SaveLibrary }): Promise<void> {
  const now = new Date().toISOString();
  if (s.kind === "piper") {
    await api.piperInstall();
    const st = await api.piperStatus();
    if (!st.installed) throw new Error("Piper could not be verified after downloading.");
  } else if (s.kind === "voice" && s.key) {
    const st = await api.piperStatus();
    if (!st.voices.includes(s.key)) await api.piperInstallVoice(s.key);
    const meta = ctx.catalog.find((c) => c.key === s.key);
    ctx.saveLibrary((l) => (l.some((x) => x.id === s.key && x.provider === "piper") ? l : [...l, { id: s.key!, name: meta?.name ?? s.label, provider: "piper", source: "library", language: meta?.language ?? "English", accent: meta?.country ?? "", gender: genderWord(s.key!), notes: "Added by Set up my PC", createdAt: now }]));
  } else if (s.kind === "chatterbox-runtime") {
    const st = await api.chatterboxRuntimeInstall();
    if (!st.installed) throw new Error(st.detail || "The Chatterbox runtime did not install.");
  } else if (s.kind === "chatterbox-model") {
    const r = await api.modelInstall(CHATTERBOX_MODEL_ID);
    if (r.state !== "installed") throw new Error(r.error || "The Chatterbox model files did not finish downloading.");
  } else if (s.kind === "kokoro-runtime") {
    const st = await api.kokoroRuntimeInstall();
    if (!st.installed) throw new Error(st.detail || "The Kokoro runtime did not install.");
  } else if (s.kind === "kokoro-model") {
    const st = await api.kokoroPrefetch();
    if (!st.modelReady) throw new Error(st.detail || "Kokoro did not finish setting up.");
  } else if (s.kind === "kokoro-voices") {
    ctx.saveLibrary((l) => [...l, ...KOKORO_VOICES.filter((v) => !l.some((x) => x.provider === "kokoro" && x.id === v.id)).map((v): VoiceEntry => ({ id: v.id, name: v.name, provider: "kokoro", source: "library", language: "English", accent: v.accent, gender: v.gender, notes: "Kokoro built-in voice. Plain delivery on this PC.", createdAt: now }))]);
  }
}
