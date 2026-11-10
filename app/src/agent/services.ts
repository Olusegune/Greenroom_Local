// What each production step actually does, written against a small environment the caller supplies. In the app the
// environment is backed by the real project, generation and measuring functions; in tests it is fakes. Every change to the
// project goes through `env.edit`, so the person's Undo reverts it, and every step reports what it did as plain data.

import type { Engine } from "../engines";
import { voicesFor } from "../presets/cast";
import { STARTER_PRESETS, type VoicePreset } from "../presets";
import { planCasting } from "../casting/autocast";
import { assignVoice, isLocked } from "../casting/lock";
import { requirementsOf, describeRequirements } from "../casting/requirements";
import { STATUS_LABEL } from "../casting/types";
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


export function executors(env: Env): Executors {
  const speaking = () => { const p = env.project(); return p.characters.filter((c) => p.lines.some((l) => l.characterId === c.id && l.text.trim())); };
  return {
    async analyze() {
      const p = env.project();
      const per = speaking().map((c) => ({ name: c.name, lines: p.lines.filter((l) => l.characterId === c.id).length }));
      return { output: { characters: per, lines: p.lines.length, scenes: p.scenes.length || 1 } };
    },

    // Proposes voices. It reads ONLY what is stated about each character (its casting requirements and stated look); it never
    // invents a gender, age, language or accent, and it never writes a preset's guesses onto a character. It assigns a voice only
    // when the voice is PROVEN to fit; everything else is listed with reasons for the person to decide. A locked voice is never touched.
    async cast() {
      const p = env.project();
      const lib = env.library().filter((v) => !env.localOnly || ["piper", "chatterbox", "kokoro", "qwen", "wazobia", "local"].includes(v.provider));
      const sp = speaking();
      const plan = planCasting(sp, lib, { commercial: p.commercial === true });
      const made: { character: string; voice: string; status: string }[] = [];
      for (const [characterId, voiceId] of Object.entries(plan.assign)) {
        const voice = lib.find((v) => v.id === voiceId)!;
        let result: ReturnType<typeof assignVoice> | undefined;
        env.edit((pr) => { result = assignVoice(pr.characters, { characterId, voice, by: "agent", now: new Date().toISOString(), context: { commercial: pr.commercial === true } }); return result.ok ? { ...pr, characters: result.characters } : pr; });
        if (result?.ok) made.push({ character: sp.find((c) => c.id === characterId)!.name, voice: voice.name, status: "VERIFIED_MATCH" });
      }
      const name = (id: string) => sp.find((c) => c.id === id)?.name ?? id;
      const decide: string[] = [];
      for (const pr of plan.proposals) {
        const c = sp.find((x) => x.id === pr.characterId)!;
        const req = requirementsOf(c);
        const stated = describeRequirements(req);
        decide.push(`${name(pr.characterId)}${req.empty ? " (nothing required is stated about their voice: tell me, or set it in Casting)" : ` (${stated.join("; ")})`} — ${pr.candidates.slice(0, 3).map((m) => `${p.characters.length ? (lib.find((v) => v.id === m.voiceId)?.name ?? m.voiceId) : m.voiceId} [${STATUS_LABEL[m.status]}]`).join(", ")}`);
      }
      for (const n of plan.none) decide.push(`${name(n.characterId)} — no voice in your library can be used: ${n.why}`);
      if (decide.length) throw new Error(`The cast needs your decision. ${made.length ? `Assigned ${made.map((m) => `${m.character}: ${m.voice}`).join(", ")}. ` : ""}Choose a voice in Cast (or Voices), listen to it, then retry this step.\n${decide.join("\n")}`);
      return { output: { cast: made, note: "Nothing is approved yet: the next step is yours." } };
    },

    // The only step that locks voices, and it is always the person's: its gate is never automatic.
    async approve_cast() {
      const sp = speaking();
      const locked: string[] = [];
      const refused: string[] = [];
      for (const c of sp) {
        if (isLocked(c)) { locked.push(c.name); continue; }
        const voice = c.voiceId ? env.library().find((v) => v.id === c.voiceId) : undefined;
        if (!voice) { refused.push(`${c.name} has no voice`); continue; }
        let result: ReturnType<typeof assignVoice> | undefined;
        env.edit((pr) => { result = assignVoice(pr.characters, { characterId: c.id, voice, by: "owner", approve: true, acknowledge: true, now: new Date().toISOString(), context: { commercial: pr.commercial === true } }); return result.ok ? { ...pr, characters: result.characters } : pr; });
        if (result?.ok) locked.push(c.name); else refused.push(`${c.name}: ${result?.message ?? "could not be approved"}`);
      }
      if (refused.length) throw new Error(`Could not lock the cast. ${refused.join("; ")}.`);
      return { output: { locked, note: "Approved by you at this checkpoint and locked. Only you can change these voices now." } };
    },

    async audition() {
      const p = env.project();
      const all = env.presets ?? STARTER_PRESETS;
      const lib = env.library().filter((v) => !env.localOnly || ["piper", "chatterbox", "kokoro", "qwen", "wazobia", "local"].includes(v.provider));
      const ready = env.ready();
      const rows = speaking().map((c) => {
        const dna = c.dna;
        const preset = all.find((x) => x.id === dna?.profile?.provenance.presetId);
        const voices = (preset ? voicesFor(preset, lib, ready) : lib.filter((v) => ready.includes(v.provider))).slice(0, 4);
        const first = p.lines.find((l) => l.characterId === c.id && l.text.trim());
        const line = preset && voices[0] ? auditionPlan(preset, voices[0]).text : (first?.text ?? "").slice(0, 120);
        return { character: c.name, preset: preset?.name ?? null, line, voices: voices.map((v) => ({ id: v.id, name: v.name, engine: v.provider, cloud: !["piper", "chatterbox", "kokoro", "qwen", "wazobia", "local"].includes(v.provider) })) };
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
