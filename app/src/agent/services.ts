// What each production step actually does, written against a small environment the caller supplies. In the app the
// environment is backed by the real project, generation and measuring functions; in tests it is fakes. Every change to the
// project goes through `env.edit`, so the person's Undo reverts it, and every step reports what it did as plain data.

import type { Engine } from "../engines";
import { APP_VERSION } from "../version";
import { applyPreset as applyToCharacter, voicesFor } from "../presets/cast";
import { recommend, STARTER_PRESETS, type Genre, type VoicePreset } from "../presets";
import type { Line, Project, Take, VoiceEntry } from "../types";
import { foleyPlan } from "../foley";
import type { SceneExport } from "../exportScene";
import { MAX_SOUNDS } from "./plan";
import { auditionPlan } from "../presets/audition";
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
  /** A portrait id from the existing library for a preset, when the library is loaded. */
  portraitFor?: (presetId: string) => string | undefined;
  /** Makes one sound clip (a cloud call unless the sound engine is local). The caller has already checked the limit. */
  makeSound?: (prompt: string, seconds: number) => Promise<{ take: NonNullable<Line["events"][number]["take"]>; spent: number }>;
  /** Mixes and writes the full scene. Only ever called after the person has approved delivery. */
  exportScene?: (project: Project) => Promise<SceneExport>;
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
      const lib = env.library().filter((v) => !env.localOnly || ["piper", "chatterbox", "kokoro", "wazobia", "local"].includes(v.provider));
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
        const avatarId = env.portraitFor?.(pick.r.preset.id);
        const applied = applyToCharacter(c, pick.r.preset, { voice, ...(avatarId ? { avatarId } : {}), now: new Date().toISOString(), appVersion: APP_VERSION });
        env.edit((p) => ({ ...p, characters: p.characters.map((x) => (x.id === c.id ? applied.character : x)) }));
        made.push({ character: c.name, voice: voice.name, preset: pick.r.preset.name });
      }
      if (missing.length) throw new Error(`No suitable voice in your library for ${missing.join(", ")}. Add a voice in Voices or pick one in Cast, then retry.`);
      return { output: { cast: made } };
    },

    async audition() {
      const p = env.project();
      const all = env.presets ?? STARTER_PRESETS;
      const lib = env.library().filter((v) => !env.localOnly || ["piper", "chatterbox", "kokoro", "wazobia", "local"].includes(v.provider));
      const ready = env.ready();
      const rows = speaking().map((c) => {
        const dna = c.dna;
        const preset = all.find((x) => x.id === dna?.profile?.provenance.presetId);
        const voices = (preset ? voicesFor(preset, lib, ready) : lib.filter((v) => ready.includes(v.provider))).slice(0, 4);
        const first = p.lines.find((l) => l.characterId === c.id && l.text.trim());
        const line = preset && voices[0] ? auditionPlan(preset, voices[0]).text : (first?.text ?? "").slice(0, 120);
        return { character: c.name, preset: preset?.name ?? null, line, voices: voices.map((v) => ({ id: v.id, name: v.name, engine: v.provider, cloud: !["piper", "chatterbox", "kokoro", "wazobia", "local"].includes(v.provider) })) };
      });
      return { output: { candidates: rows, note: "Nothing was generated. Press Play on a voice to hear it; cloud voices ask before they spend." } };
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

    async sound(node) {
      const p = env.project();
      const ideas = foleyPlan(p.script, p.lines).slice(0, MAX_SOUNDS);
      if (!ideas.length) return { output: { made: 0, note: "No sounds were found in the stage directions." } };
      if (!env.makeSound) return { output: { ideas: ideas.length, made: 0, note: "Sound generation is not connected here." } };
      let spent = 0;
      let made = 0;
      const skipped: string[] = [];
      for (const idea of ideas) {
        const line = env.project().lines.find((l) => l.id === idea.lineId);
        if (!line) continue;
        if (line.events.some((e) => e.prompt === idea.prompt)) { skipped.push(`${idea.prompt} (already there)`); continue; }
        // Stay inside what this step was estimated and approved for.
        if (node.cloud && spent >= node.estimate - 1e-9 && node.estimate > 0 && made >= ideas.length) break;
        const r = await env.makeSound(idea.prompt, idea.seconds);
        spent += r.spent; made++;
        env.edit((pr) => ({ ...pr, lines: pr.lines.map((l) => (l.id === idea.lineId ? { ...l, events: [...l.events, { id: `ev-${idea.id}`, prompt: idea.prompt, placement: idea.placement, seconds: r.take.seconds, take: r.take }] } : l)) }));
      }
      return { output: { made, skipped, note: "Sounds are placed next to the lines they were read from. Listen to them in Perform or the timeline." }, spent };
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
      // Unsupported acting (an engine that could not play a sound or hold a pause) is flagged for the person, who sees the
      // "not sent" list when approving delivery. It does not block the file being written; everything else that is a problem does.
      const bad = f.filter((x) => x.severity === "problem" && x.kind !== "listen" && x.kind !== "unsupported");
      if (bad.length) throw new Error(`${bad.length} problem(s) must be fixed before export: ${bad[0]!.text}`);
      const unsupported = [...new Set(f.filter((x) => x.kind === "unsupported").map((x) => x.text))];
      // This step is behind the delivery gate: it only runs after the person approved it.
      if (!env.exportScene) return { output: { ready: true, unsupported, note: "Ready. Open Export to choose a format and deliver." } };
      const out = await env.exportScene(p);
      return { output: { ...out, unsupported, note: "Written. Stems, OTIO, EDL, cue sheet and the production report are on the Export screen." } };
    },
  };
}

export { settingsFrom };
