import { MODEL_CATALOG, type HardwareProfile, type InstallState } from "./models";

/** One thing the setup wizard installs. */
export interface SetupStep {
  id: string;
  kind: "piper" | "voice" | "chatterbox-runtime" | "chatterbox-model" | "kokoro-runtime" | "kokoro-model" | "kokoro-voices" | "qwen-runtime" | "qwen-model" | "qwen-voices";
  label: string;
  why: string;
  /** Known download size in MB, or undefined when the size is not known in advance. */
  sizeMb?: number;
  /** A Piper voice key, for kind "voice". */
  key?: string;
  /** Steps with this id must finish before this one starts. */
  needs?: string;
}

export interface SetupInput {
  hardware: Pick<HardwareProfile, "tier" | "memoryGb">;
  piperInstalled: boolean;
  /** Piper voice keys already on disk. */
  piperVoices: string[];
  /** Piper voice keys already in the voice library. */
  libraryVoices: string[];
  chatterboxRuntime: boolean;
  chatterboxModel: InstallState;
  /** The owner ticked "Also set up Chatterbox". */
  withChatterbox: boolean;
  /** The owner ticked "Also set up Kokoro". */
  withKokoro?: boolean;
  kokoroRuntime?: boolean;
  kokoroModel?: boolean;
  /** Kokoro voice ids already in the voice library. */
  libraryKokoro?: string[];
  /** The owner ticked "Also set up Qwen3-TTS". */
  withQwen?: boolean;
  qwenRuntime?: boolean;
  qwenModel?: boolean;
  /** Qwen voice ids already in the voice library. */
  libraryQwen?: string[];
  /** The Piper catalogue's own sizes, which win over the estimates below. */
  catalog?: { key: string; sizeMb: number }[];
}

export interface SetupPlan {
  steps: SetupStep[];
  /** Everything already in place, in words. */
  alreadyDone: string[];
  /** The sum of the sizes that are known. */
  knownMb: number;
  /** True when a step has no known size (the Chatterbox runtime), so the total is "at least". */
  sizeUnknown: boolean;
  /** Whether this PC is a sensible place for Chatterbox. Offered, never forced. */
  chatterboxAdvisable: boolean;
  chatterboxNote: string;
}

/** Two English Piper voices (one male, one female) that the catalogue lists. Free, offline. The sizes are estimates: the live catalogue's size is used when it loads. */
export const STARTER_VOICES: { key: string; label: string; sizeMb: number }[] = [
  { key: "en_GB-alan-medium", label: "Alan (British, male)", sizeMb: 63 },
  { key: "en_US-amy-medium", label: "Amy (American, female)", sizeMb: 63 },
];
/** Kokoro voices added to the library once Kokoro works. Names are from the Kokoro model's own voice list (hexgrad/Kokoro-82M, VOICES.md). */
export const KOKORO_VOICES: { id: string; name: string; gender: "female" | "male"; accent: "American" | "British" }[] = [
  { id: "af_heart", name: "Heart (American, female)", gender: "female", accent: "American" },
  { id: "am_michael", name: "Michael (American, male)", gender: "male", accent: "American" },
  { id: "bf_emma", name: "Emma (British, female)", gender: "female", accent: "British" },
  { id: "bm_george", name: "George (British, male)", gender: "male", accent: "British" },
];
/** Qwen3-TTS VoiceDesign voices: each is a written description kept in the app (lib.rs, qwen_voice_description). */
export const QWEN_VOICES: { id: string; name: string; gender: "female" | "male"; age: "young" | "mid" | "old" }[] = [
  { id: "qwen-warm-narrator", name: "Warm narrator (Qwen, female)", gender: "female", age: "mid" },
  { id: "qwen-gravel-man", name: "Gravel voice (Qwen, male)", gender: "male", age: "mid" },
  { id: "qwen-bright-young-woman", name: "Bright young woman (Qwen)", gender: "female", age: "young" },
  { id: "qwen-gentle-older-man", name: "Gentle older man (Qwen)", gender: "male", age: "old" },
];
export const PIPER_ENGINE_MB = 22;
export const CHATTERBOX_MODEL_ID = "chatterbox-multilingual-v3";

/** Chatterbox needs real memory. Below this the app says so instead of starting a multi-GB install that would crawl. */
const CHATTERBOX_MIN_MEMORY_GB = 8;

/**
 * Works out what is left to install. Pure: it reads the state it is given and decides nothing about the network.
 * Anything already installed is listed as done and skipped, so running the wizard twice is safe.
 */
export function planSetup(i: SetupInput): SetupPlan {
  const steps: SetupStep[] = [];
  const done: string[] = [];
  if (i.piperInstalled) done.push("Piper speech engine"); else steps.push({ id: "piper", kind: "piper", label: "Piper speech engine", why: "Reads text aloud on this PC. Free, offline, plain delivery.", sizeMb: PIPER_ENGINE_MB });
  for (const v of STARTER_VOICES) {
    const onDisk = i.piperVoices.includes(v.key);
    const inLibrary = i.libraryVoices.includes(v.key);
    if (onDisk && inLibrary) { done.push(v.label); continue; }
    steps.push({ id: "voice:" + v.key, kind: "voice", key: v.key, label: v.label, why: onDisk ? "Already downloaded; adds it to your voice library." : "A free local voice for previews and drafts.", sizeMb: onDisk ? 0 : (i.catalog?.find((c) => c.key === v.key)?.sizeMb ?? v.sizeMb), needs: i.piperInstalled ? undefined : "piper" });
  }

  const model = MODEL_CATALOG.find((m) => m.id === CHATTERBOX_MODEL_ID);
  const advisable = i.hardware.memoryGb >= CHATTERBOX_MIN_MEMORY_GB && i.hardware.tier !== "compact";
  if (i.withChatterbox) {
    if (i.chatterboxRuntime) done.push("Chatterbox runtime"); else steps.push({ id: "chatterbox-runtime", kind: "chatterbox-runtime", label: "Chatterbox runtime", why: "A private Python environment for Chatterbox. Several GB; takes several minutes." });
    if (i.chatterboxModel === "installed") done.push("Chatterbox model files"); else steps.push({ id: "chatterbox-model", kind: "chatterbox-model", label: "Chatterbox model files", why: "The local voice and Re-voice (turn your own recording into a character's voice).", sizeMb: Math.round((model?.sizeGb ?? 3.2) * 1000) });
  }

  if (i.withKokoro) {
    if (i.kokoroRuntime) done.push("Kokoro runtime"); else steps.push({ id: "kokoro-runtime", kind: "kokoro-runtime", label: "Kokoro runtime", why: "A private Python environment for Kokoro (about 2 GB, several minutes)." });
    if (i.kokoroModel) done.push("Kokoro model"); else steps.push({ id: "kokoro-model", kind: "kokoro-model", label: "Kokoro model and test line", why: "Downloads the Kokoro model (about 315 MB) and speaks one short line to prove it works. Needs internet this once.", sizeMb: 315, needs: i.kokoroRuntime ? undefined : "kokoro-runtime" });
    const missing = KOKORO_VOICES.filter((v) => !(i.libraryKokoro ?? []).includes(v.id));
    if (!missing.length) done.push("Kokoro voices"); else steps.push({ id: "kokoro-voices", kind: "kokoro-voices", label: "Kokoro voices (" + missing.length + ")", why: "Adds ready-made English voices to your voice library. No download.", sizeMb: 0, needs: i.kokoroModel ? undefined : "kokoro-model" });
  }

  if (i.withQwen) {
    if (i.qwenRuntime) done.push("Qwen3-TTS runtime"); else steps.push({ id: "qwen-runtime", kind: "qwen-runtime", label: "Qwen3-TTS runtime", why: "A private Python environment for Qwen3-TTS (a few GB, several minutes)." });
    if (i.qwenModel) done.push("Qwen3-TTS model"); else steps.push({ id: "qwen-model", kind: "qwen-model", label: "Qwen3-TTS model and test line", why: "Downloads the Qwen3-TTS model (several GB) and speaks one short line, which is slow on a CPU. Needs internet this once.", needs: i.qwenRuntime ? undefined : "qwen-runtime" });
    const missing = QWEN_VOICES.filter((v) => !(i.libraryQwen ?? []).includes(v.id));
    if (!missing.length) done.push("Qwen voices"); else steps.push({ id: "qwen-voices", kind: "qwen-voices", label: "Qwen voices (" + missing.length + ")", why: "Adds four described voices to your voice library. No download.", sizeMb: 0, needs: i.qwenModel ? undefined : "qwen-model" });
  }

  return {
    steps,
    alreadyDone: done,
    knownMb: steps.reduce((n, s) => n + (s.sizeMb ?? 0), 0),
    sizeUnknown: steps.some((s) => s.sizeMb === undefined),
    chatterboxAdvisable: advisable,
    chatterboxNote: advisable ? "Adds Re-voice and a local voice that can speak English with the Chatterbox default voice." : `This PC reports ${i.hardware.memoryGb} GB of memory. Chatterbox wants at least ${CHATTERBOX_MIN_MEMORY_GB} GB and may be very slow or fail here, so it is off unless you choose it.`,
  };
}

/** Only the Kokoro steps, for the Kokoro card in Model Center. */
export function planKokoro(i: { kokoroRuntime: boolean; kokoroModel: boolean; libraryKokoro: string[] }): SetupPlan {
  return planSetup({ hardware: { tier: "standard", memoryGb: 16 }, piperInstalled: true, piperVoices: STARTER_VOICES.map((v) => v.key), libraryVoices: STARTER_VOICES.map((v) => v.key), chatterboxRuntime: true, chatterboxModel: "installed", withChatterbox: false, withKokoro: true, ...i });
}

/** Only the Qwen3-TTS steps, for the Qwen card in Model Center. */
export function planQwen(i: { qwenRuntime: boolean; qwenModel: boolean; libraryQwen: string[] }): SetupPlan {
  return planSetup({ hardware: { tier: "standard", memoryGb: 16 }, piperInstalled: true, piperVoices: STARTER_VOICES.map((v) => v.key), libraryVoices: STARTER_VOICES.map((v) => v.key), chatterboxRuntime: true, chatterboxModel: "installed", withChatterbox: false, withQwen: true, ...i });
}

export type StepStatus = "waiting" | "running" | "done" | "failed" | "skipped";
export interface StepResult { id: string; status: StepStatus; error?: string }

/**
 * Runs the steps in order with an injected executor. A failed step does not stop unrelated steps, but a step whose `needs`
 * failed is skipped and says why. `stop()` is checked between steps: a download already under way cannot be cancelled,
 * so stopping takes effect when it finishes. Nothing here retries: the caller can run the wizard again, which plans from the
 * state on disk and skips what is done.
 */
export async function runSetup(
  steps: SetupStep[],
  exec: (s: SetupStep) => Promise<void>,
  onUpdate: (r: StepResult[]) => void,
  stop: () => boolean = () => false,
): Promise<StepResult[]> {
  const results: StepResult[] = steps.map((s) => ({ id: s.id, status: "waiting" }));
  const set = (idx: number, r: Partial<StepResult>) => { results[idx] = { ...results[idx]!, ...r }; onUpdate(results.map((x) => ({ ...x }))); };
  onUpdate(results.map((x) => ({ ...x })));
  for (let n = 0; n < steps.length; n++) {
    const s = steps[n]!;
    if (stop()) { set(n, { status: "skipped", error: "Stopped before this step." }); continue; }
    if (s.needs) {
      const dep = results[steps.findIndex((x) => x.id === s.needs)];
      if (dep && dep.status !== "done") { set(n, { status: "skipped", error: `Needs "${steps.find((x) => x.id === s.needs)?.label}", which did not finish.` }); continue; }
    }
    set(n, { status: "running" });
    try { await exec(s); set(n, { status: "done" }); }
    catch (e) { set(n, { status: "failed", error: (e as Error).message || "Failed." }); }
  }
  return results;
}

/** One plain sentence about how it went. */
export function summarize(results: StepResult[]): string {
  const ok = results.filter((r) => r.status === "done").length;
  const bad = results.filter((r) => r.status === "failed").length;
  const skipped = results.filter((r) => r.status === "skipped").length;
  if (!results.length) return "Everything was already set up.";
  if (!bad && !skipped) return `All ${ok} step${ok === 1 ? "" : "s"} finished.`;
  return `${ok} finished, ${bad} failed, ${skipped} skipped. Press Set up again to retry what is left: finished steps are not repeated.`;
}
