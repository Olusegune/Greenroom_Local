// Rendering the scene to one WAV, for listening in the app and for export. Both use the same path so what you hear is what you get.

import { encodeWav, planTimeline, renderPlan, toBase64, type Plan } from "./audio";
import { playUrl, takeBuffer } from "./media";
import type { Project } from "./types";

export function audioPlan(p: Project, scene?: number): Plan {
  return planTimeline(p, scene);
}

export async function mixToWav(p: Project, plan: Plan): Promise<ArrayBuffer> {
  const rate = 48000;
  const channels = await renderPlan(plan, p.bed.volume, (ref) => takeBuffer(p.id, ref.id), rate);
  return encodeWav(channels, rate);
}

export async function previewScene(p: Project, done: () => void, scene?: number): Promise<void> {
  const wav = await mixToWav(p, audioPlan(p, scene));
  const url = URL.createObjectURL(new Blob([wav], { type: "audio/wav" }));
  await playUrl(url, () => (URL.revokeObjectURL(url), done()));
}

export const wavBase64 = (wav: ArrayBuffer) => toBase64(wav);
