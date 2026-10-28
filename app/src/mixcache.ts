// A rendered mix kept until something in it changes, so pressing Play again is instant.

import { encodeWav, renderPlan, type Plan } from "./audio";
import { takeBuffer } from "./media";
import type { Project } from "./types";

let cached: { key: string; url: string } | null = null;

export function mixKey(project: Project, plan: Plan): string {
  return JSON.stringify([plan.items.map((i) => [i.ref.id, Math.round(i.start * 1000), Math.round(i.seconds * 1000), i.gainDb, i.kind, i.fadeIn, i.fadeOut, i.trimIn ?? 0, !!i.duck]), plan.duck, project.bed.volume, Math.round(plan.total * 1000)]);
}

/** The address of the mixed sound for this plan: rendered now if it has changed, else the one already made. */
export async function mixUrl(project: Project, plan: Plan): Promise<string> {
  if (plan.items.length === 0) return "";
  const key = mixKey(project, plan);
  if (cached?.key === key) return cached.url;
  const ch = await renderPlan(plan, project.bed.volume, (ref) => takeBuffer(project.id, ref.id), 48000);
  const url = URL.createObjectURL(new Blob([encodeWav(ch, 48000)], { type: "audio/wav" }));
  if (cached) URL.revokeObjectURL(cached.url);
  cached = { key, url };
  return url;
}
