import { MODEL_CATALOG, type HardwareProfile, type InstallState } from "./models";

/** One thing the setup wizard installs. */
export interface SetupStep {
  id: string;
  kind: "piper" | "voice" | "chatterbox-runtime" | "chatterbox-model";
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

  return {
    steps,
    alreadyDone: done,
    knownMb: steps.reduce((n, s) => n + (s.sizeMb ?? 0), 0),
    sizeUnknown: steps.some((s) => s.sizeMb === undefined),
    chatterboxAdvisable: advisable,
    chatterboxNote: advisable ? "Adds Re-voice and a local voice that can speak English with the Chatterbox default voice." : `This PC reports ${i.hardware.memoryGb} GB of memory. Chatterbox wants at least ${CHATTERBOX_MIN_MEMORY_GB} GB and may be very slow or fail here, so it is off unless you choose it.`,
  };
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
