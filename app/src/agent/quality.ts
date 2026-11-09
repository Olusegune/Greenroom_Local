// The production quality check. It measures what can be measured (missing lines, clipping, long silence, timing, sounds an
// engine could not play, voices that do not fit) and flags what only a person can judge for a listen. It never calls a
// performance good or bad: "sounds unnatural" is the director's call.

import type { Project, VoiceEntry } from "../types";
import { identityWarning, migrateDna } from "../voiceDna";

export type Severity = "problem" | "listen" | "note";
export interface Finding { severity: Severity; lineId?: string; kind: "missing" | "clipping" | "silence" | "timing" | "unsupported" | "assignment" | "rights" | "listen"; text: string }

/** What was measured on a take, when it could be. Absent means not measured, which is reported, not assumed fine. */
export interface Measured { peak: number; silenceRatio: number; seconds: number }

const NOMINAL_WPS = 2.6;
const words = (t: string) => t.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

export function qualityCheck(project: Project, library: VoiceEntry[], measured: Record<string, Measured> = {}): Finding[] {
  const out: Finding[] = [];
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
      if (m.peak >= 0.99) out.push({ severity: "problem", lineId: l.id, kind: "clipping", text: `${who}: the take clips (peak ${(20 * Math.log10(Math.max(m.peak, 1e-6))).toFixed(1)} dBFS).` });
      if (m.silenceRatio > 0.45) out.push({ severity: "listen", lineId: l.id, kind: "silence", text: `${who}: more than ${Math.round(m.silenceRatio * 100)}% of the take is silence. Listen.` });
      const w = words(l.text);
      const expected = w / NOMINAL_WPS;
      if (w >= 3 && (m.seconds > expected * 2.5 + 1 || m.seconds < expected * 0.3)) out.push({ severity: "listen", lineId: l.id, kind: "timing", text: `${who}: ${m.seconds.toFixed(1)}s for ${w} words is far from the usual length. Listen.` });
    }
    for (const n of take.provenance?.check ?? []) out.push({ severity: "listen", lineId: l.id, kind: "listen", text: `${who}: ${n}` });
  }
  return out;
}

export const summarize = (f: Finding[]) => ({ problems: f.filter((x) => x.severity === "problem").length, listen: f.filter((x) => x.severity === "listen").length, notes: f.filter((x) => x.severity === "note").length });
/** Line ids worth remaking: the measurable problems and the lines flagged for a listen. */
export const linesToRemake = (f: Finding[]): string[] => [...new Set(f.filter((x) => x.lineId && (x.severity === "problem" && x.kind !== "missing" && x.kind !== "rights" && x.kind !== "assignment" || x.severity === "listen")).map((x) => x.lineId!))];
