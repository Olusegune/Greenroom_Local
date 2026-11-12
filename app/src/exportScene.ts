// The full-scene export the Agent Studio can perform after the person approves delivery: mix the chosen takes on the
// timeline, bring the level to the project's chosen loudness target without exceeding its peak ceiling, and write one WAV
// into the project's export folder. It uses the same primitives as the Export screen (planTimeline, renderPlan, loudness,
// encodeWav, exportWrite) with the project's saved export settings. Stems, OTIO, EDL, cue sheets and the report stay on the
// Export screen. Rendering and writing are passed in, so tests run without audio hardware.

import { encodeWav, lineFileName, planTimeline, stemSets, toBase64, type Placed, type Plan } from "./audio";
import type { ExportPreset } from "./exportPresets";
import { applyGain, measure, planNormalization, TARGETS } from "./loudness";
import { DEFAULT_EXPORT, type ExportCfg, type Project } from "./types";

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

// ---- Delivery to a destination ----------------------------------------------------------------------------------------------------
// What the Agent Studio writes once the person approves delivery: the mix, and (when the destination or the brief asks) one file per
// scene, one stem per character / sound clips / atmosphere, and every chosen line. All files share ONE gain (from the full mix) so the
// stems and scenes keep their level relative to the mix and the stems add back to it. Nothing here changes the project.

export interface DeliveryDeps extends ExportDeps {
  /** Renders only the items the filter keeps (a stem). */
  renderFiltered: (plan: Plan, bedVolume: number, rate: number, filter: (p: Placed) => boolean) => Promise<Float32Array[]>;
  /** Writes a file into a folder of the project's export folder ("" for the top) and returns its path. */
  writeIn: (folder: string, name: string, b64: string) => Promise<string>;
  /** The original audio of a take, for the per-line files. */
  readTake: (takeId: string) => Promise<{ audioB64: string; ext: string }>;
}

export interface DeliveryFile { kind: "full" | "scene" | "stem" | "line"; folder: string; name: string; path: string }
export interface Delivery { preset: string | null; cfg: Pick<ExportCfg, "rate" | "bits" | "target" | "ceiling">; files: DeliveryFile[]; scene: SceneExport | null; counts: { scenes: number; stems: number; lines: number } }

/** The settings a delivery uses: the project's own export settings, then the destination's preset, then "stems" if the brief asked. */
export function deliveryConfig(project: Project, preset: ExportPreset | null, stems: boolean): ExportCfg {
  return { ...DEFAULT_EXPORT, ...(project.export ?? {}), ...(preset?.set ?? {}), ...(stems ? { stems: true } : {}) };
}

export async function exportDelivery(project: Project, deps: DeliveryDeps, opts: { preset?: ExportPreset | null; stems?: boolean } = {}): Promise<Delivery> {
  const spoken = project.lines.filter((l) => l.text.trim());
  const missing = spoken.filter((l) => !chosen(l));
  if (!spoken.length) throw new Error("There is nothing to export: the project has no spoken lines.");
  if (missing.length) throw new Error(`${missing.length} line${missing.length === 1 ? " has" : "s have"} no take, so it cannot be exported.`);
  const cfg = deliveryConfig(project, opts.preset ?? null, opts.stems === true);
  const stem = exportStem(project.name);
  const pic = project.picture;
  const plan = planTimeline(project, undefined, { exactTotal: pic && cfg.matchPicture && pic.duration > 0 ? pic.duration : undefined });
  const main = await deps.render(plan, project.bed.volume, cfg.rate);
  const target = TARGETS.find((t) => t.id === cfg.target) ?? TARGETS[0]!;
  const np = planNormalization(measure(main, cfg.rate), target.lufs, cfg.ceiling);
  const wav = (ch: Float32Array[], description = project.name) => toBase64(encodeWav(applyGain(ch, np.gainDb), cfg.rate, { bits: cfg.bits, dither: cfg.bits === 16, description, originator: "Greenroom" }));
  const files: DeliveryFile[] = [];
  const put = async (kind: DeliveryFile["kind"], folder: string, name: string, b64: string) => { files.push({ kind, folder, name, path: await deps.writeIn(folder, name, b64) }); };
  const safe = (t: string) => t.replace(/[^\p{L}\p{N} _.-]+/gu, "").replace(/ +/g, " ").trim() || "Track";

  let scene: SceneExport | null = null;
  if (cfg.whole) {
    const name = `${stem} - full scene.wav`;
    const bytes = encodeWav(applyGain(main, np.gainDb), cfg.rate, { bits: cfg.bits, dither: cfg.bits === 16, description: project.name, originator: "Greenroom" });
    await put("full", "", name, toBase64(bytes));
    scene = { path: files[0]!.path, name, seconds: plan.total, lufs: np.finalLufs, truePeakDb: np.finalTpDb, gainDb: np.gainDb, targetReached: np.reached, limitedBy: np.limitedBy, sha256: await deps.sha256(new Uint8Array(bytes)), rate: cfg.rate, bits: cfg.bits };
  }
  let scenes = 0;
  if (cfg.scenes) {
    for (let i = 0; i < project.scenes.length; i++) {
      const sp = planTimeline(project, i);
      if (sp.items.length === 0) continue;
      await put("scene", "", `${stem} - scene ${i + 1} ${safe(project.scenes[i]!)}.wav`.replace(/ +/g, " "), wav(await deps.render(sp, project.bed.volume, cfg.rate)));
      scenes++;
    }
  }
  let stems = 0;
  if (cfg.stems) {
    for (const s of stemSets(plan, project.characters)) {
      await put("stem", "Stems", `${stem} - stem - ${safe(s.name)}.wav`, wav(await deps.renderFiltered(plan, project.bed.volume, cfg.rate, s.filter)));
      stems++;
    }
  }
  let lines = 0;
  if (cfg.lines) {
    for (const [i, l] of project.lines.entries()) {
      const t = chosen(l);
      if (!t || !l.text.trim()) continue;
      const who = project.characters.find((c) => c.id === l.characterId)?.name ?? "Line";
      const a = await deps.readTake(t.id);
      await put("line", `Lines - ${safe(who)}`, lineFileName(i, who, a.ext), a.audioB64);
      lines++;
    }
  }
  return { preset: opts.preset?.id ?? null, cfg: { rate: cfg.rate, bits: cfg.bits, target: cfg.target, ceiling: cfg.ceiling }, files, scene, counts: { scenes, stems, lines } };
}
