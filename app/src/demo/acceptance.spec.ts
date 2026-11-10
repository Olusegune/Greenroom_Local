// The final acceptance run for casting integrity: a six-character production through the real casting rules and real LOCAL engines
// (Piper and Kokoro, the same binaries and workers the app uses). It writes audio to Documents\Greenroom Local\acceptance and the
// record to docs/acceptance-results.json.
//
// NOT part of the normal test run. GREENROOM_ACCEPTANCE=1 cd app && npx vitest run src/demo/acceptance.spec.ts
//
// Honest scope: the owner's approval is performed by the harness (actor "test_harness") and the audit says so. Nothing is judged by
// ear. Characters for whom this PC has no suitable voice (no Yoruba voice installed, no child voice, no teenage voice) are CORRECTLY
// left uncast: that refusal is the result being tested. No cloud engine is used and no key is read.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { encodeWav, planTimeline } from "../audio";
import { buildManifest } from "../manifest";
import { exportFullScene } from "../exportScene";
import { planCasting } from "../casting/autocast";
import { extractStated } from "../casting/extract";
import { assignVoice, auditCasting, castingGuard, stamp } from "../casting/lock";
import { readProjectCasting } from "../casting/persist";
import { rank } from "../casting/engine";
import { requirementsOf } from "../casting/requirements";
import { profileOf } from "../casting/voiceProfile";
import { STATUS_LABEL, type MatchStatus } from "../casting/types";
import { newProject, type Character, type Line, type Take, type VoiceEntry } from "../types";
import { APP_VERSION } from "../version";

const RUN = process.env.GREENROOM_ACCEPTANCE === "1";
const HOME = join(process.env.USERPROFILE ?? "", "Documents", "Greenroom Local");
const PIPER = join(HOME, "engines", "piper");
const OUT = join(HOME, "acceptance");
const NOW = () => new Date().toISOString();
const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const atomic = (path: string, data: string | Uint8Array) => { mkdirSync(join(path, ".."), { recursive: true }); const tmp = path + ".tmp"; writeFileSync(tmp, data); renameSync(tmp, path); };

interface Wav { rate: number; samples: Float32Array }
function readWav(bytes: Uint8Array): Wav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12, rate = 22050, ch = 1;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(p, p + 4)); const size = v.getUint32(p + 4, true);
    if (id === "fmt ") { ch = v.getUint16(p + 10, true); rate = v.getUint32(p + 12, true); }
    if (id === "data") { const n = Math.floor(Math.min(size, bytes.length - p - 8) / 2 / ch); const s = new Float32Array(n); for (let i = 0; i < n; i++) s[i] = v.getInt16(p + 8 + i * 2 * ch, true) / 32768; return { rate, samples: s }; }
    p += 8 + size + (size % 2);
  }
  throw new Error("no audio in the WAV");
}
const resample = (s: Float32Array, from: number, to: number): Float32Array => { if (from === to) return s; const n = Math.round((s.length * to) / from); const o = new Float32Array(n); for (let i = 0; i < n; i++) { const x = (i * from) / to; const a = Math.floor(x); const f = x - a; o[i] = (s[a] ?? 0) * (1 - f) + (s[Math.min(a + 1, s.length - 1)] ?? 0) * f; } return o; };

/** The same call the app's Piper route makes: voice key with an optional @speaker, working directory at the Piper folder. */
function piperSpeak(id: string, text: string): Uint8Array {
  const [key, speaker] = id.split("@");
  const out = join(PIPER, "tmp", `acc-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`);
  mkdirSync(join(PIPER, "tmp"), { recursive: true });
  const args = ["--model", join(PIPER, "voices", `${key}.onnx`), "--config", join(PIPER, "voices", `${key}.onnx.json`), "--output_file", out, "--length_scale", "1", "--sentence_silence", "0.2", ...(speaker ? ["--speaker", speaker] : [])];
  const r = spawnSync(join(PIPER, "piper", "piper.exe"), args, { input: text, cwd: join(PIPER, "piper"), encoding: "utf8", timeout: 60000 });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`Piper failed for ${id}`);
  const b = new Uint8Array(readFileSync(out)); rmSync(out); return b;
}

/** The same worker the app runs for Kokoro (runtime/kokoro_once.py through the managed runtime). */
function kokoroSpeak(voice: string, text: string): Uint8Array {
  const py = join(HOME, "runtime", "kokoro-managed", "python.exe");
  const script = readFileSync(join(__dirname, "..", "..", "..", "runtime", "kokoro_once.py"), "utf8");
  const r = spawnSync(py, ["-c", script], { input: JSON.stringify({ text, voice, speed: 1 }), env: { ...process.env, HF_HOME: join(HOME, "runtime", "kokoro-managed", "hf") }, timeout: 300000, maxBuffer: 1 << 28 });
  if (r.status !== 0 || !String(r.stdout.subarray(0, 4)).startsWith("RIFF")) throw new Error(`Kokoro failed for ${voice}`);
  return new Uint8Array(r.stdout);
}

const voiceEntry = (id: string, name: string, provider: VoiceEntry["provider"], language: string, accent: string, gender: string): VoiceEntry => ({ id, name, provider, source: "library", language, accent, gender, notes: "", createdAt: "2026-11-10T00:00:00Z" });

describe.skipIf(!RUN)("six-character acceptance run", () => {
  it("casts, approves, generates, saves, reopens, regenerates, mixes and verifies every voice", async () => {
    mkdirSync(join(OUT, "takes"), { recursive: true });
    // The library is what is installed on this PC: four Piper voices and the four Kokoro voices, plus one Wazobia Yoruba voice that is
    // NOT installed here (the model is gated), so it must come back UNAVAILABLE instead of being swapped for an English voice.
    const library: VoiceEntry[] = [
      voiceEntry("en_GB-alan-medium", "Alan (British)", "piper", "English", "British", "male"),
      voiceEntry("en_GB-alba-medium", "Alba (Scottish)", "piper", "English", "Scottish", "female"),
      voiceEntry("en_US-amy-medium", "Amy (American)", "piper", "English", "American", "female"),
      voiceEntry("en_US-joe-medium", "Joe (American)", "piper", "English", "American", "male"),
      voiceEntry("af_heart", "Heart (American, female)", "kokoro", "English", "American", "female"),
      voiceEntry("am_michael", "Michael (American, male)", "kokoro", "English", "American", "male"),
      voiceEntry("bf_emma", "Emma (British, female)", "kokoro", "English", "British", "female"),
      voiceEntry("bm_george", "George (British, male)", "kokoro", "English", "British", "male"),
      voiceEntry("elder_deji@yo", "Deji (Yoruba)", "wazobia", "yo", "Nigerian", ""),
    ];
    const installed = (id: string) => (id.includes("@yo") ? { ok: false, why: "the WazobiaVoice model is not installed on this PC" } : { ok: true });
    const context = { available: installed };

    const scenario: { id: string; name: string; about: string; lines: [string, string]; answers?: Partial<Character["cast"] & object> }[] = [
      { id: "baba", name: "BABA", about: "An elderly Yoruba-speaking grandfather.", lines: ["Come and sit with me, my child.", "A tree does not make a forest."] },
      { id: "detective", name: "DETECTIVE", about: "A middle-aged British woman, a detective.", lines: ["Nobody leaves this room.", "I have seen this before."], answers: { accent: "British", accentStrictness: "preferred" } },
      { id: "boy", name: "BOY", about: "A young American boy, 8 years old.", lines: ["Is it a monster?", "I want to go home."] },
      { id: "nimi", name: "NIMI", about: "A teenage Nigerian girl.", lines: ["Daddy, you are not listening!", "It is not fair."], answers: { accent: "Nigerian English", accentStrictness: "required" } },
      { id: "demon", name: "DEMON", about: "An aristocratic British male demon.", lines: ["Good evening. I do hope you are well.", "Your soul is overdue."], answers: { accent: "British", accentStrictness: "preferred" } },
      { id: "robot", name: "ROBOT", about: "A robotic science-fiction character.", lines: ["Query acknowledged.", "Please state your purpose."] },
    ];

    let characters: Character[] = scenario.map((s) => ({ id: s.id, name: s.name, language: "English", about: s.about }));
    const record: Record<string, unknown> = { appVersion: APP_VERSION, at: NOW(), scope: "Local engines only (Piper, Kokoro). The owner's approval is performed by the test harness. Nothing judged by ear." };

    // 1. The agent reads ONLY what the script states, and asks about the rest.
    const reading = scenario.map((s) => { const e = extractStated(s.name, s.about); return { character: s.name, stated: e.stated, questions: e.questions }; });
    record.reading = reading;
    characters = characters.map((c) => { const e = extractStated(c.name, c.about); return e.stated.length ? { ...c, cast: { version: 1 as const, ...e.spec } } : c; });
    // The owner answers the questions the agent asked (accent choices), as the harness.
    characters = characters.map((c) => { const a = scenario.find((s) => s.id === c.id)?.answers; return a ? { ...c, cast: { version: 1 as const, ...c.cast, ...a } } : c; });
    expect(characters.find((c) => c.id === "baba")!.cast).toMatchObject({ vocalGender: "masculine", vocalAge: ["old"], language: "Yoruba" });
    // Nationality did not become an accent or a language.
    expect(characters.find((c) => c.id === "nimi")!.cast!.language).toBeUndefined();

    // 2. Candidates for every character, with the reasons. Incompatible voices are listed as ruled out, never offered.
    const profiles = library.map(profileOf);
    const table = characters.map((c) => {
      const ranked = rank(requirementsOf(c), profiles, context);
      return { character: c.name, requirements: requirementsOf(c), results: ranked.map((m) => ({ voice: library.find((v) => v.id === m.voiceId)!.name, status: m.status, why: m.reasons.find((r) => r.outcome === "mismatch" || r.outcome === "unknown" || r.outcome === "unverified")?.text ?? m.reasons[0]?.text })) };
    });
    record.candidates = table;
    const plan = planCasting(characters, library, context);
    record.autoAssigned = plan.assign; // expected: nothing, because nothing has been listened to
    expect(plan.assign).toEqual({});
    // No voice is ever offered for Baba that does not speak Yoruba: the Yoruba voice is UNAVAILABLE here, the English voices INCOMPATIBLE.
    const baba = table.find((t) => t.character === "BABA")!;
    expect(baba.results.find((r) => r.voice.startsWith("Deji"))!.status).toBe("UNAVAILABLE");
    expect(baba.results.filter((r) => !r.voice.startsWith("Deji")).every((r) => r.status === "INCOMPATIBLE")).toBe(true);
    // A boy is never offered an adult voice as a match: with no recorded age every candidate says it must be auditioned first.
    expect(table.find((t) => t.character === "BOY")!.results.every((r) => r.status !== "VERIFIED_MATCH")).toBe(true);

    // 3. The harness (standing in for the owner) approves the voices it can honestly approve, acknowledging what is unverified.
    const choose: Record<string, string> = { detective: "bf_emma", demon: "bm_george", robot: "en_US-joe-medium" };
    const refusals: { attempt: string; code: string; message: string }[] = [];
    for (const [cid, vid] of Object.entries(choose)) {
      const r = assignVoice(characters, { characterId: cid, voice: library.find((v) => v.id === vid)!, by: "test_harness", approve: true, acknowledge: true, now: NOW(), context });
      expect(r.ok, `${cid}: ${r.message}`).toBe(true);
      characters = r.characters;
    }
    // Deliberate mismatches and unknowns, all of which must be refused or need acknowledgement:
    const tries: [string, string, Parameters<typeof assignVoice>[1]["by"], boolean?][] = [
      ["demon", "af_heart", "test_harness"], // a feminine voice for a masculine character that is already approved: locked
      ["boy", "en_US-joe-medium", "auto", true], // an adult voice for a boy by the auto-caster
      ["baba", "bm_george", "test_harness"], // an English-only voice for a Yoruba grandfather: incompatible
      ["nimi", "en_US-amy-medium", "test_harness"], // American accent where Nigerian is required: incompatible
      ["detective", "bm_george", "agent"], // the agent trying to change an approved voice
    ];
    for (const [cid, vid, by] of tries) {
      const r = assignVoice(characters, { characterId: cid, voice: library.find((v) => v.id === vid)!, by, now: NOW(), context });
      refusals.push({ attempt: `${by}: give ${vid} to ${cid}`, code: r.code, message: r.message });
      expect(r.ok, `${by} ${vid} ${cid} should have been refused`).toBe(false);
      characters = r.characters; // a refused attempt is recorded in the history, nothing else changes
    }
    const unknownTry = assignVoice(characters, { characterId: "boy", voice: library.find((v) => v.id === "en_US-joe-medium")!, by: "test_harness", approve: true, now: NOW(), context });
    refusals.push({ attempt: "owner: approve Joe for the boy without acknowledging the unknowns", code: unknownTry.code, message: unknownTry.message });
    expect(unknownTry.code).toBe("needs_acknowledgement");
    record.refusals = refusals;

    // 4. Dialogue for every cast character, in two scenes. Every take is stamped with the character and the exact voice.
    let lines: Line[] = [];
    const takes = new Map<string, Take>();
    const wavs = new Map<string, Wav>();
    const speak = (v: VoiceEntry, text: string) => (v.provider === "kokoro" ? kokoroSpeak(v.id, text) : piperSpeak(v.id, text));
    const makeTake = (c: Character, line: Line, take_id: string): Take => {
      const voice = library.find((v) => v.id === c.voiceId)!;
      const g = castingGuard(c, voice, library, null, context);
      if (!g.ok) throw new Error(g.message);
      const bytes = speak(voice, line.text);
      const w = readWav(bytes); wavs.set(take_id, w);
      atomic(join(OUT, "takes", `${take_id}.wav`), bytes);
      return stamp({ id: take_id, at: NOW(), model: voice.provider === "kokoro" ? "kokoro" : "piper", ext: "wav", voiceId: voice.id, sent: line.text, seconds: Number((w.samples.length / w.rate).toFixed(2)), provenance: { engine: voice.provider, voiceName: voice.name, speed: 1, chars: line.text.length, sha256: sha(bytes), appVersion: APP_VERSION, emotion: "", sounds: [], note: "", pronunciations: 0 } }, g.cast!);
    };
    const castChars = characters.filter((c) => c.casting?.approval);
    expect(castChars.map((c) => c.id).sort()).toEqual(["demon", "detective", "robot"]);
    for (const [si, scene] of [0, 1].entries()) {
      for (const c of castChars) {
        const s = scenario.find((x) => x.id === c.id)!;
        const l: Line = { id: `l-${c.id}-${scene}`, characterId: c.id, scene, text: s.lines[si]!, direction: { emotion: "", note: "", sounds: [], speed: 1, pauseAfter: 0.4 }, takes: [], events: [] };
        const t = makeTake(c, l, `t-${l.id}-1`);
        takes.set(t.id, t); lines.push({ ...l, takes: [t], chosen: t.id });
      }
    }

    // 5. Save and reopen: the file on disk is read back through the same validation the app uses on load.
    const project = { ...newProject("p-acceptance", "Six characters", NOW()), script: "", scenes: ["Scene 1", "Scene 2"], characters, lines };
    atomic(join(OUT, "project.json"), JSON.stringify(project, null, 1));
    const reopened = readProjectCasting(JSON.parse(readFileSync(join(OUT, "project.json"), "utf8")));
    for (const c of characters) { const r = reopened.characters.find((x) => x.id === c.id)!; expect(r.casting?.approval, c.id).toEqual(c.casting?.approval); expect(r.voiceId, c.id).toBe(c.voiceId); expect(r.cast, c.id).toEqual(c.cast); }
    characters = reopened.characters; lines = reopened.lines;

    // 6. Regenerate selected lines (the demon's second line and the detective's first), after reopening.
    const regen = ["l-demon-1", "l-detective-0"];
    lines = lines.map((l) => {
      if (!regen.includes(l.id)) return l;
      const c = characters.find((x) => x.id === l.characterId)!;
      const t = makeTake(c, l, `t-${l.id}-2`);
      return { ...l, takes: [...l.takes, t], chosen: t.id };
    });
    // A regeneration with the wrong voice is refused before anything is made.
    const demon = characters.find((c) => c.id === "demon")!;
    const wrong = castingGuard(demon, library.find((v) => v.id === "af_heart")!, library, null, context);
    expect(wrong.ok).toBe(false);
    refusals.push({ attempt: "generate a demon line with Heart", code: wrong.code, message: wrong.message });

    // 7. Scene switching: each scene still holds its own lines with the right voices.
    for (const scene of [0, 1]) for (const l of lines.filter((x) => x.scene === scene)) expect(l.takes.find((t) => t.id === l.chosen)!.voiceId).toBe(characters.find((c) => c.id === l.characterId)!.casting!.approval!.voiceId);

    // 8. The final mix.
    const projectNow = { ...project, characters, lines, export: { target: "web", ceiling: -1 } };
    const exported = await exportFullScene(projectNow as never, {
      render: async (pl, _bed, rate) => {
        const total = Math.ceil(pl.total * rate); const L = new Float32Array(total), R = new Float32Array(total);
        for (const it of pl.items) { if (it.kind !== "speech") continue; const w = wavs.get(it.ref.id) ?? readWav(new Uint8Array(readFileSync(join(OUT, "takes", `${it.ref.id}.wav`)))); const s = resample(w.samples, w.rate, rate); const g = Math.pow(10, it.gainDb / 20); const start = Math.round(it.start * rate); for (let i = 0; i < s.length && start + i < total; i++) { const a = s[i]! * g; L[start + i] = (L[start + i] ?? 0) + a; R[start + i] = (R[start + i] ?? 0) + a; } }
        return [L, R];
      },
      write: async (name, b64) => { const p = join(OUT, name); atomic(p, Buffer.from(b64, "base64")); return p; },
      sha256: async (b) => sha(b),
    });

    // 9. Verification: every chosen take is the approved voice, for the right character, with an unchanged file, and the manifest agrees.
    const issues = auditCasting(characters, lines, library);
    const manifest = buildManifest(projectNow as never, library, APP_VERSION, NOW());
    const rows = lines.map((l) => {
      const c = characters.find((x) => x.id === l.characterId)!; const t = l.takes.find((x) => x.id === l.chosen)!;
      const file = sha(new Uint8Array(readFileSync(join(OUT, "takes", `${t.id}.wav`))));
      return { character: c.name, line: l.id, scene: l.scene, approvedVoice: c.casting!.approval!.voiceId, takeVoice: t.voiceId, castStamp: t.cast, fileIntact: file === t.provenance!.sha256, manifestMatches: manifest.lines.find((m) => m.lineId === l.id)!.matchesCharacter };
    });
    for (const r of rows) { expect(r.takeVoice, r.line).toBe(r.approvedVoice); expect(r.fileIntact, r.line).toBe(true); expect(r.manifestMatches, r.line).toBe(true); expect(r.castStamp!.characterId, r.line).toBeTruthy(); }
    expect(issues.filter((i) => i.severity === "problem")).toEqual([]);

    record.cast = characters.map((c) => ({ character: c.name, approved: c.casting?.approval ? { voice: c.casting.approval.voiceName, basis: STATUS_LABEL[c.casting.approval.basis as MatchStatus], acknowledged: c.casting.approval.acknowledged, by: c.casting.approval.by, version: c.casting.approval.version } : null, historyEvents: c.casting?.history.map((h) => h.action) ?? [] }));
    record.notCast = characters.filter((c) => !c.casting?.approval).map((c) => ({ character: c.name, why: (table.find((t) => t.character === c.name)!.results.find((r) => r.status === "UNAVAILABLE" || r.status === "UNKNOWN_METADATA" || r.status === "NEEDS_AUDITION")?.why) ?? "No suitable voice", offered: table.find((t) => t.character === c.name)!.results.map((r) => `${r.voice}: ${r.status}`).slice(0, 4) }));
    record.takes = rows;
    record.regenerated = regen;
    record.audit = issues;
    record.export = { path: exported.path, lufs: exported.lufs, truePeakDb: exported.truePeakDb, seconds: exported.seconds };
    record.refusalsAll = refusals;
    writeFileSync(join(__dirname, "..", "..", "..", "docs", "acceptance-results.json"), JSON.stringify(record, null, 2));
    void planTimeline; void encodeWav;
  }, 900000);
});
