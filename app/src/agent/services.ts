// What each production step actually does, written against a small environment the caller supplies. In the app the
// environment is backed by the real project, generation and measuring functions; in tests it is fakes. Every change to the
// project goes through `env.edit`, so the person's Undo reverts it, and every step reports what it did as plain data.

import type { Engine } from "../engines";
import { applyPreset as applyToCharacter, voicesFor } from "../presets/cast";
import { recommend, STARTER_PRESETS, type Genre, type VoicePreset } from "../presets";
import type { Line, Project, Take, VoiceEntry } from "../types";
import { foleyPlan } from "../foley";
import type { Executors } from "./graph";
import { settingsFrom, type Interpretation } from "./brief";
import { linesToRemake, qualityCheck, summarize, type Measured } from "./quality";

export interface Env {
  project: () => Project;
  library: () => VoiceEntry[];
  ready: () => Engine[];
  presets?: VoicePreset[];
  edit: (fn: (p: Project) => Project) => void;
  /** Makes one take for a line. Spends only if the voice is a cloud voice, and the caller has already confirmed that. */
  makeTake: (line: Line, voice: VoiceEntry) => Promise<{ take: Take; spent: number }>;
  measure: (take: Take) => Promise<Measured | null>;
  interpretation?: Interpretation;
  localOnly: boolean;
}

const genreOf = (i?: Interpretation): Genre | undefined => i?.proposals.find((p): p is Extract<typeof p, { kind: "genre" }> => p.kind === "genre")?.genre;

export function executors(env: Env): Executors {
  const speaking = () => { const p = env.project(); return p.characters.filter((c) => p.lines.some((l) => l.characterId === c.id && l.text.trim())); };
  return {
    async analyze() {
      const p = env.project();
      const per = speaking().map((c) => ({ name: c.name, lines: p.lines.filter((l) => l.characterId === c.id).length }));
      return { output: { characters: per, lines: p.lines.length, scenes: p.scenes.length || 1 } };
    },

    async cast() {
      const lib = env.library().filter((v) => !env.localOnly || ["piper", "chatterbox", "wazobia", "local"].includes(v.provider));
      const ready = env.ready();
      const all = env.presets ?? STARTER_PRESETS;
      const made: { character: string; voice: string; preset: string }[] = [];
      const missing: string[] = [];
      for (const c of speaking()) {
        if (c.voiceId && env.library().some((v) => v.id === c.voiceId)) continue; // already cast: the person's choice stays
        const recs = recommend(all, { ...(genreOf(env.interpretation) ? { genre: genreOf(env.interpretation)! } : {}), ...(c.look?.age ? { age: ({ child: "child", teen: "teen", young: "young_adult", mid: "adult", old: "older_adult" } as const)[c.look.age] } : {}), ...(c.look?.gender ? { gender: c.look.gender === "m" ? "male" as const : "female" as const } : {}), keywords: [c.name, ...(c.about ?? "").split(/\W+/).filter((w) => w.length > 3).slice(0, 8)], private: env.localOnly }, ready);
        const pick = recs.map((r) => ({ r, voices: voicesFor(r.preset, lib, ready) })).find((x) => x.voices.length);
        if (!pick) { missing.push(c.name); continue; }
        const voice = pick.voices[0]!;
        const applied = applyToCharacter(c, pick.r.preset, { voice });
        env.edit((p) => ({ ...p, characters: p.characters.map((x) => (x.id === c.id ? applied.character : x)) }));
        made.push({ character: c.name, voice: voice.name, preset: pick.r.preset.name });
      }
      if (missing.length) throw new Error(`No suitable voice in your library for ${missing.join(", ")}. Add a voice in Voices or pick one in Cast, then retry.`);
      return { output: { cast: made } };
    },

    async direct() {
      const tone = (env.interpretation?.proposals ?? []).filter((p): p is Extract<typeof p, { kind: "tone" }> => p.kind === "tone").map((p) => p.direction);
      const natural = (env.interpretation?.proposals ?? []).some((p) => p.kind === "naturalness");
      const extra = [...tone, ...(natural ? ["natural, unscripted, with small breaths and varied pace"] : [])];
      let changed = 0;
      if (extra.length) {
        env.edit((p) => ({ ...p, lines: p.lines.map((l) => { if (l.acting?.trim() || !l.text.trim()) return l; changed++; return { ...l, acting: [l.direction.note?.trim(), ...extra].filter(Boolean).join(", ") }; }) }));
      }
      return { output: { directed: changed, note: extra.length ? "Added the brief's tone to lines without their own direction." : "No tone requested; your own direction was left as it is." } };
    },

    async take(node) {
      const p = env.project();
      const line = p.lines.find((l) => l.id === node.lineId);
      if (!line) throw new Error("The line no longer exists.");
      const c = p.characters.find((x) => x.id === line.characterId);
      const voice = c?.voiceId ? env.library().find((v) => v.id === c.voiceId) : undefined;
      if (!voice) throw new Error(`${c?.name ?? "This character"} has no voice.`);
      if (voice.source === "cloned" && !voice.consent) throw new Error(`${voice.name} is a cloned voice with no consent record.`);
      const { take, spent } = await env.makeTake(line, voice);
      env.edit((pr) => ({ ...pr, lines: pr.lines.map((l) => (l.id === line.id ? { ...l, takes: [...l.takes, take], chosen: l.chosen ?? take.id } : l)) }));
      return { output: { takeId: take.id, notSent: take.provenance?.notSent ?? [] }, spent };
    },

    async qc() {
      const p = env.project();
      const m: Record<string, Measured> = {};
      for (const l of p.lines) for (const t of l.takes) { const x = await env.measure(t).catch(() => null); if (x) m[t.id] = x; }
      const findings = qualityCheck(p, env.library(), m);
      return { output: { ...summarize(findings), findings, remake: linesToRemake(findings) } };
    },

    async sound() {
      const p = env.project();
      return { output: { ideas: foleyPlan(p.script, p.lines).length, note: "Ideas only. Generating sounds is a separate paid step." } };
    },

    async timeline() {
      const p = env.project();
      const lacking = p.lines.filter((l) => l.text.trim() && !l.takes.length);
      if (lacking.length) throw new Error(`${lacking.length} line(s) have no take, so the timeline cannot be assembled.`);
      env.edit((pr) => ({ ...pr, lines: pr.lines.map((l) => (l.takes.length && !l.chosen ? { ...l, chosen: l.takes[l.takes.length - 1]!.id } : l)) }));
      return { output: { lines: p.lines.filter((l) => l.text.trim()).length } };
    },

    async export() {
      const p = env.project();
      const f = qualityCheck(p, env.library());
      const bad = f.filter((x) => x.severity === "problem" && x.kind !== "listen");
      if (bad.length) throw new Error(`${bad.length} problem(s) must be fixed before export: ${bad[0]!.text}`);
      return { output: { ready: true, note: "Open Export to choose a format and deliver. Greenroom never exports for you." } };
    },
  };
}

export { settingsFrom };
