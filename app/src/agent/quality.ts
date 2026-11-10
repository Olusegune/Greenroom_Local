// The production quality check. It measures what can be measured (missing lines, clipping, long silence, timing, sounds an
// engine could not play, voices that do not fit) and flags what only a person can judge for a listen. It never calls a
// performance good or bad: "sounds unnatural" is the director's call.

import { auditCasting } from "../casting/lock";
import type { Project, VoiceEntry } from "../types";
import { DEFAULT_MIX } from "../types";
import { identityWarning, migrateDna } from "../voiceDna";

export type Severity = "problem" | "listen" | "note";
export interface Finding { severity: Severity; lineId?: string; kind: "missing" | "clipping" | "silence" | "timing" | "unsupported" | "assignment" | "rights" | "listen" | "loudness" | "ducking" | "sync" | "consistency"; text: string }

/** What was measured on a take, when it could be. Absent means not measured, which is reported, not assumed fine. */
export interface Measured {
  peak: number; silenceRatio: number; seconds: number;
  /** Integrated loudness in LUFS, when measured. */
  lufs?: number | null;
  /** How many runs of three or more full-scale samples in a row the take has: flat tops, which is what clipping is. Absent when not counted. */
  clipRuns?: number;
}

/** Runs of three or more consecutive samples at full scale. A take normalised to 0 dBFS has a peak there but no such runs; a clipped one does. */
export function countClipRuns(x: ArrayLike<number>, threshold = 0.9999): number {
  let runs = 0, len = 0;
  for (let i = 0; i < x.length; i++) {
    if (Math.abs(x[i]!) >= threshold) { len++; if (len === 3) runs++; } else len = 0;
  }
  return runs;
}

const NOMINAL_WPS = 2.6;
const words = (t: string) => t.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function qualityCheck(project: Project, library: VoiceEntry[], measured: Record<string, Measured> = {}): Finding[] {
  const out: Finding[] = [];
  // A chosen take made for another character, with another voice than the one approved, or whose approved voice is gone: the audio belongs to the wrong person.
  for (const i of auditCasting(project.characters, project.lines, library)) if (i.kind !== "unstamped") out.push({ severity: i.severity === "problem" ? "problem" : "listen", lineId: i.lineId, kind: "assignment", text: i.text });
  for (const l of project.lines) {
    if (!l.text.trim()) continue;
    const c = project.characters.find((x) => x.id === l.characterId);
    const who = c?.name ?? "A character";
    const v = c?.voiceId ? library.find((x) => x.id === c.voiceId) : undefined;
    if (!c) out.push({ severity: "problem", lineId: l.id, kind: "assignment", text: `A line has no character.` });
    else if (!v) out.push({ severity: "problem", lineId: l.id, kind: "assignment", text: `${who} has no voice in the library.` });
    if (v?.source === "cloned" && !v.consent) out.push({ severity: "problem", lineId: l.id, kind: "rights", text: `${v.name} is cloned with no consent record.` });
    const take = l.takes.find((t) => t.id === l.chosen) ?? l.takes[l.takes.length - 1];
    if (!take) { out.push({ severity: "problem", lineId: l.id, kind: "missing", text: `${who}: “${l.text.slice(0, 40)}” has no take.` }); continue; }
    if (v && take.voiceId !== v.id) out.push({ severity: "problem", lineId: l.id, kind: "assignment", text: `${who}'s take was made with a different voice than the one now cast.` });
    const warn = c ? identityWarning(migrateDna(c.dna), v) : null;
    if (warn) out.push({ severity: "note", lineId: l.id, kind: "assignment", text: warn });
    for (const n of take.provenance?.notSent ?? []) out.push({ severity: "problem", lineId: l.id, kind: "unsupported", text: `${who}: not played by the engine: ${n}.` });
    const m = measured[take.id];
    if (!m) { out.push({ severity: "note", lineId: l.id, kind: "listen", text: `${who}: this take was not measured.` }); }
    else {
      const dbfs = (20 * Math.log10(Math.max(m.peak, 1e-6))).toFixed(1);
      if (typeof m.clipRuns === "number") {
        if (m.clipRuns > 0) out.push({ severity: "problem", lineId: l.id, kind: "clipping", text: `${who}: the take clips (${m.clipRuns} flat-topped stretch${m.clipRuns === 1 ? "" : "es"}, peak ${dbfs} dBFS).` });
      } else if (m.peak >= 0.999) {
        // Only the peak is known: full scale can be a normalised take or a clipped one, so it is for a listen, not a block.
        out.push({ severity: "listen", lineId: l.id, kind: "clipping", text: `${who}: the peak is at full scale (${dbfs} dBFS). It may be normalised or clipped. Listen.` });
      }
      if (m.silenceRatio > 0.45) out.push({ severity: "listen", lineId: l.id, kind: "silence", text: `${who}: more than ${Math.round(m.silenceRatio * 100)}% of the take is silence. Listen.` });
      const w = words(l.text);
      const expected = w / NOMINAL_WPS;
      if (w >= 3 && (m.seconds > expected * 2.5 + 1 || m.seconds < expected * 0.3)) out.push({ severity: "listen", lineId: l.id, kind: "timing", text: `${who}: ${m.seconds.toFixed(1)}s for ${w} words is far from the usual length. Listen.` });
    }
    for (const n of take.provenance?.check ?? []) out.push({ severity: "listen", lineId: l.id, kind: "listen", text: `${who}: ${n}` });
  }
  out.push(...loudnessChecks(project, measured), ...mixChecks(project), ...syncChecks(project));
  return out;
}

const chosenTake = (l: Project["lines"][number]) => l.takes.find((t) => t.id === l.chosen) ?? l.takes[l.takes.length - 1];
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = s.length >> 1; return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2; };

/** Loudness consistency: a line far from the scene's typical level is worth a listen (about 6 LU is clearly audible). */
export function loudnessChecks(project: Project, measured: Record<string, Measured>, spreadLu = 6): Finding[] {
  const rows = project.lines.flatMap((l) => { const t = chosenTake(l); const m = t ? measured[t.id] : undefined; return t && m && typeof m.lufs === "number" && Number.isFinite(m.lufs) && m.lufs > -70 ? [{ l, lufs: m.lufs }] : []; });
  if (rows.length < 3) return [];
  const mid = median(rows.map((r) => r.lufs));
  return rows.filter((r) => Math.abs(r.lufs - mid) > spreadLu).map((r) => ({ severity: "listen" as const, lineId: r.l.id, kind: "loudness" as const, text: `${project.characters.find((c) => c.id === r.l.characterId)?.name ?? "A line"}: ${r.lufs.toFixed(1)} LUFS, ${Math.abs(r.lufs - mid).toFixed(1)} LU ${r.lufs > mid ? "louder" : "quieter"} than the scene's typical ${mid.toFixed(1)}. Listen, or normalise.` }));
}

/** Music against dialogue: music that does not dip under speech, or dips too little to keep words clear. */
export function mixChecks(project: Project): Finding[] {
  const music = project.music ?? [];
  const speaks = project.lines.some((l) => l.takes.length);
  if (!music.length || !speaks) return [];
  const mix = { ...DEFAULT_MIX, ...(project.mix ?? {}) };
  const out: Finding[] = [];
  const clips = music.filter((m) => m.duck);
  if (!mix.duck) out.push({ severity: "problem", kind: "ducking", text: "Music is in the mix but ducking is off, so it will sit on top of the dialogue." });
  else if (!clips.length) out.push({ severity: "problem", kind: "ducking", text: "Ducking is on but none of the music clips is set to dip under dialogue." });
  else if (mix.amountDb > -6) out.push({ severity: "listen", kind: "ducking", text: `Music dips only ${Math.abs(mix.amountDb)} dB under speech. Around 8 to 12 dB usually keeps words clear. Listen.` });
  if (mix.duck && mix.attack < 0.05) out.push({ severity: "note", kind: "ducking", text: "The dip starts almost with the line, so the first word may be partly covered." });
  return out;
}

/** Picture sync: cues past the end of the picture, and lines that run into the next cued line. */
export function syncChecks(project: Project): Finding[] {
  const pic = project.picture;
  if (!pic) return [];
  const out: Finding[] = [];
  const timed = project.lines.filter((l) => typeof l.cue === "number" && l.text.trim()).map((l) => ({ l, at: l.cue as number, len: chosenTake(l)?.seconds ?? 0 })).sort((a, b) => a.at - b.at);
  const name = (l: Project["lines"][number]) => project.characters.find((c) => c.id === l.characterId)?.name ?? "A line";
  for (const t of timed) if (pic.duration > 0 && t.at + t.len > pic.duration + 0.05) out.push({ severity: "problem", lineId: t.l.id, kind: "sync", text: `${name(t.l)}: the line ends ${(t.at + t.len - pic.duration).toFixed(1)}s after the picture does.` });
  for (let i = 0; i + 1 < timed.length; i++) {
    const a = timed[i]!, b = timed[i + 1]!;
    if (a.len > 0 && a.at + a.len > b.at + 0.05) out.push({ severity: "listen", lineId: b.l.id, kind: "sync", text: `${name(a.l)}'s line runs ${(a.at + a.len - b.at).toFixed(1)}s into ${name(b.l)}'s cue. They overlap. Listen.` });
  }
  const uncued = project.lines.filter((l) => l.text.trim() && typeof l.cue !== "number").length;
  if (timed.length && uncued) out.push({ severity: "note", kind: "sync", text: `${uncued} line${uncued === 1 ? " has" : "s have"} no cue and will follow the line before.` });
  if (!timed.length && project.lines.some((l) => l.text.trim())) out.push({ severity: "note", kind: "sync", text: "A picture is attached but no line has a cue, so nothing is timed to it." });
  return out;
}

export const summarize = (f: Finding[]) => ({ problems: f.filter((x) => x.severity === "problem").length, listen: f.filter((x) => x.severity === "listen").length, notes: f.filter((x) => x.severity === "note").length });
/** Line ids worth remaking: the measurable problems and the lines flagged for a listen. */
export const linesToRemake = (f: Finding[]): string[] => [...new Set(f.filter((x) => x.lineId && (x.severity === "problem" && x.kind !== "missing" && x.kind !== "rights" && x.kind !== "assignment" || x.severity === "listen")).map((x) => x.lineId!))];
