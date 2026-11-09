// The full-scene export the Agent Studio can perform after the person approves delivery: mix the chosen takes on the
// timeline, bring the level to the project's chosen loudness target without exceeding its peak ceiling, and write one WAV
// into the project's export folder. It uses the same primitives as the Export screen (planTimeline, renderPlan, loudness,
// encodeWav, exportWrite) with the project's saved export settings. Stems, OTIO, EDL, cue sheets and the report stay on the
// Export screen. Rendering and writing are passed in, so tests run without audio hardware.

import { encodeWav, planTimeline, toBase64, type Plan } from "./audio";
import { applyGain, measure, planNormalization, TARGETS } from "./loudness";
import { DEFAULT_EXPORT, type Project } from "./types";

export interface ExportDeps {
  /** Renders the plan to channels at the sample rate. */
  render: (plan: Plan, bedVolume: number, rate: number) => Promise<Float32Array[]>;
  /** Writes a file into the project's export folder and returns its path. */
  write: (name: string, b64: string) => Promise<string>;
  sha256: (bytes: Uint8Array) => Promise<string>;
}

export interface SceneExport { path: string; name: string; seconds: number; lufs: number; truePeakDb: number; gainDb: number; targetReached: boolean; limitedBy: "ceiling" | null; sha256: string; rate: number; bits: number }

const chosen = (l: Project["lines"][number]) => l.takes.find((t) => t.id === l.chosen) ?? l.takes[l.takes.length - 1];

/** A file name from the project name: letters, digits, spaces, dashes. Never a path. */
export const exportStem = (name: string): string => name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim().slice(0, 60) || "Greenroom";

export async function exportFullScene(project: Project, deps: ExportDeps): Promise<SceneExport> {
  const spoken = project.lines.filter((l) => l.text.trim());
  const missing = spoken.filter((l) => !chosen(l));
  if (!spoken.length) throw new Error("There is nothing to export: the project has no spoken lines.");
  if (missing.length) throw new Error(`${missing.length} line${missing.length === 1 ? " has" : "s have"} no take, so the scene cannot be exported.`);
  const cfg = { ...DEFAULT_EXPORT, ...(project.export ?? {}) };
  const pic = project.picture;
  const plan = planTimeline(project, undefined, { exactTotal: pic && cfg.matchPicture && pic.duration > 0 ? pic.duration : undefined });
  const main = await deps.render(plan, project.bed.volume, cfg.rate);
  const m = measure(main, cfg.rate);
  const target = TARGETS.find((t) => t.id === cfg.target) ?? TARGETS[0]!;
  const np = planNormalization(m, target.lufs, cfg.ceiling);
  const name = `${exportStem(project.name)} - full scene.wav`;
  const bytes = encodeWav(applyGain(main, np.gainDb), cfg.rate, { bits: cfg.bits, dither: cfg.bits === 16, description: project.name, originator: "Greenroom" });
  const path = await deps.write(name, toBase64(bytes));
  return { path, name, seconds: plan.total, lufs: np.finalLufs, truePeakDb: np.finalTpDb, gainDb: np.gainDb, targetReached: np.reached, limitedBy: np.limitedBy, sha256: await deps.sha256(new Uint8Array(bytes)), rate: cfg.rate, bits: cfg.bits };
}
