// Builds the five demonstration projects into the Greenroom data folder and records what really happened.
//
// NOT part of the normal test run: it writes to Documents\Greenroom Local and runs a real local engine (Piper), so it only
// runs when GREENROOM_BUILD_DEMOS=1.   cd app && GREENROOM_BUILD_DEMOS=1 npx vitest run src/demo/buildDemos.spec.ts
//
// Honest scope. The Agent Studio's own planner, steps, quality check and export run headlessly in LOCAL-ONLY mode with a
// spending limit of zero. The only engine is Piper, called directly with the same binary, voices and arguments as the app's
// Piper route (`piper_args` in local.rs). Nothing is sent to a cloud engine and no key is read. The harness approves the
// delivery gate where a person normally would; it says so in the audit log. Piper cannot act, play sounds or hold pauses and
// has no children's, Nigerian or other accent voices here, so those behaviours are listed as "not sent" and one demo is not
// rendered at all. Nothing in the audio was judged by ear.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, it } from "vitest";
import { frameActivity } from "../analysis";
import { encodeWav, planTimeline, toBase64 } from "../audio";
import { assignPresetFaces } from "../presets/portraits";
import { validateManifest, type AvatarManifest } from "../avatarLibrary";
import { exportFullScene } from "../exportScene";
import { effectiveLine } from "../performance";
import { plan } from "../generate";
import { integratedLoudness } from "../loudness";
import { applyPreset, readyEnginesFrom } from "../presets/cast";
import { STARTER_PRESETS } from "../presets";
import { parseScript } from "../script";
import { newProject, type Character, type Line, type Project, type Take, type VoiceEntry } from "../types";
import { approve, runAll } from "../agent/graph";
import { planProduction } from "../agent/plan";
import { countClipRuns, qualityCheck, summarize, type Measured } from "../agent/quality";
import { executors, type Env } from "../agent/services";
import { migrateRun } from "../agent/persist";
import { migrateDna } from "../voiceDna";
import { withActing } from "../performanceCompiler";
import { APP_VERSION } from "../version";

const RUN = process.env.GREENROOM_BUILD_DEMOS === "1";
const HOME = join(process.env.USERPROFILE ?? "", "Documents", "Greenroom Local");
const PIPER = join(HOME, "engines", "piper");

const PIPER_VOICES: VoiceEntry[] = [
  { id: "en_GB-alan-medium", name: "Alan (British)", provider: "piper", source: "library", language: "English", accent: "British", gender: "male", notes: "Piper, installed for the demo projects", createdAt: "" },
  { id: "en_GB-alba-medium", name: "Alba (Scottish)", provider: "piper", source: "library", language: "English", accent: "Scottish", gender: "female", notes: "Piper, installed for the demo projects", createdAt: "" },
  { id: "en_US-amy-medium", name: "Amy (American)", provider: "piper", source: "library", language: "English", accent: "American", gender: "female", notes: "Piper, installed for the demo projects", createdAt: "" },
  { id: "en_US-joe-medium", name: "Joe (American)", provider: "piper", source: "library", language: "English", accent: "American", gender: "male", notes: "Piper, installed for the demo projects", createdAt: "" },
];

interface CharDef { name: string; preset: string; voice: string; about: string; gender?: "m" | "f"; age?: "child" | "teen" | "young" | "mid" | "old" }
interface DemoDef { id: string; name: string; blurb: string; script: string; cast: CharDef[]; acting?: Record<string, string>; render: boolean; blocked?: string; brief: string }

const DEMOS: DemoDef[] = [
  {
    id: "demo-venomspur", name: "Demo: Venomspur (dark comedy)", render: true,
    blurb: "A British supernatural dark comedy: an impeccably polite demon bureaucrat and his nervous junior.",
    brief: "Dark comedy. Keep the demon's politeness and the menace restrained. Local only.",
    script: `# Scene 1: The Overdue Soul
(A cramped office in the lower levels. A door creaks open.)
GRIMBLE (nervous): Sir? You wanted to see me about the Henderson file.
VENOMSPUR: Ah, Grimble. Do come in. Mind the brimstone, it does stain.
GRIMBLE: I filed it on Tuesday, sir. I am quite certain I filed it.
VENOMSPUR: Of course you did. A lovely piece of filing. Beautifully alphabetical.
GRIMBLE: Thank you, sir.
VENOMSPUR: Mr Henderson's soul, however, is still on earth. Overdue by eleven days.
GRIMBLE (panicking): There must be a clerical error! Perhaps a clerical error!
VENOMSPUR: I do so hate to be a bother, but there is. And it is yours.`,
    cast: [
      { name: "VENOMSPUR", preset: "fantasy_horror_scifi.demon-bureaucrat", voice: "en_GB-alan-medium", about: "an impeccably polite, faintly bored demon bureaucrat", gender: "m", age: "mid" },
      { name: "GRIMBLE", preset: "film_tv.vulnerable-protagonist", voice: "en_US-joe-medium", about: "a nervous junior demon who files everything", gender: "m", age: "young" },
    ],
    acting: {
      "I do so hate to be a bother, but there is. And it is yours.": "begins with impeccable British politeness, clears his throat, chuckles quietly, pauses, then delivers the final sentence with restrained menace",
      "There must be a clerical error! Perhaps a clerical error!": "nervous, breathless, voice cracking, then quieter",
    },
  },
  {
    id: "demo-nigerian-family", name: "Demo: Nigerian family drama", render: false,
    blocked: "Needs a voice engine that can do Nigerian English, Yoruba, Igbo and Hausa accents (ElevenLabs with your key, or WazobiaVoice installed). Piper here has none, and rendering these characters in an unrelated accent would be misleading. The accent labels are unverified; use the Listening test before relying on them. The dialogue is English: lines in Yoruba, Igbo or Hausa need a native writer.",
    blurb: "A family dinner where the future of the family land is decided. Characters carry Yoruba, Igbo and Hausa cultural metadata; their accents are chosen by the voices you cast.",
    brief: "Nigerian family drama. Use Nigerian English where appropriate. Keep total cloud spending below $3.",
    script: `# Scene 1: The Land at Surulere
(Plates and low voices. A ceiling fan turns.)
IYA TUNDE (firmly): Nobody leaves this table until we have talked about the land.
TUNDE (tired): Mama, I have said I will not sell it. I only asked to hear the offer.
EZE (gently): A man who hears an offer has already half agreed. I learned that the hard way.
ALHAJI MUSA: Eze, the boy is not agreeing. He is thinking. There is a difference.
IYA TUNDE (quietly): Your father built that house with his hands, Tunde.
TUNDE: I know. I know what the house means. That is why I am afraid to lose it.
EZE: Then we will decide together, as a family, before the sun goes down.
ALHAJI MUSA (warmly): And after that, we eat. Nothing is decided well on an empty stomach.`,
    cast: [
      { name: "IYA TUNDE", preset: "international.yoruba-english", voice: "9nsJoy", about: "a mother who holds the family together; Yoruba cultural background", gender: "f", age: "old" },
      { name: "TUNDE", preset: "family.adult-conversation", voice: "9nsAbiola", about: "her adult son, torn about selling the family land", gender: "m", age: "young" },
      { name: "EZE", preset: "international.igbo-english", voice: "9nsRemJac", about: "Tunde's father-in-law, a careful elder; Igbo cultural background", gender: "m", age: "old" },
      { name: "ALHAJI MUSA", preset: "international.hausa-english", voice: "9nsAlex", about: "the neighbour and old family friend, a peacemaker; Hausa cultural background", gender: "m", age: "old" },
    ],
  },
  {
    id: "demo-childrens-adventure", name: "Demo: Children's adventure (animated)", render: true,
    blurb: "An animated bedtime adventure with a narrator, a curious child and a grumbling badger.",
    brief: "Create a version suitable for a children's animated film. Keep it gentle. Local only.",
    script: `# Scene 1: Lantern Hill
(Wind moves softly through tall grass.)
NARRATOR: On the very top of Lantern Hill lived a lamp that had forgotten how to shine.
POPPY (curious): Why is it so sad, Bramble? Lamps are supposed to be bright!
BRAMBLE (grumbling): Lamps are supposed to do lots of things, Poppy. Mostly they are supposed to stay put.
POPPY: I think it needs a friend. And maybe a very small adventure.
NARRATOR: So Poppy packed three biscuits and a bright red scarf, and off they went.
BRAMBLE (mischievous): Biscuits? I will carry the biscuits. Purely for safety.
POPPY (laughing): Bramble, you ate one already!
NARRATOR: And far above them, the lamp gave a tiny, hopeful flicker.`,
    cast: [
      { name: "NARRATOR", preset: "audiobooks.bedtime-storyteller", voice: "en_GB-alba-medium", about: "a warm bedtime storyteller", gender: "f", age: "mid" },
      { name: "POPPY", preset: "animation.curious-child", voice: "en_US-amy-medium", about: "a curious child (stand-in adult voice: no child voice is installed)", gender: "f", age: "child" },
      { name: "BRAMBLE", preset: "animation.talking-animal", voice: "en_US-joe-medium", about: "a grumbling, food-loving badger", gender: "m", age: "mid" },
    ],
  },
  {
    id: "demo-fantasy-rpg", name: "Demo: Fantasy RPG dialogue", render: true,
    blurb: "An RPG sequence with a hero, a quest giver, a shopkeeper and a villain.",
    brief: "Fantasy RPG. Hero determined, villain theatrical. Local only.",
    script: `# Scene 1: The Road to Ashfall
(Footsteps on a gravel road. A distant bell.)
MARA (determined): The bridge is out. We will have to take the old mine road.
OLD TOBIN: Aye, but the mine road is not kind, traveller. Something stirs under Ashfall.
MARA: Then tell me what you know, and I will be on my way before dark.
OLD TOBIN: A bargain, then. Bring back the Ember Stone, and the gate is yours to open.
SHOPKEEPER: Torches, rope, a very fine healing draught! Half price if you promise to come back alive.
LADY VASH: You walk into my mountain with a lantern and a promise. How charming.
MARA (strained): Stay back! I am not afraid of you!
LADY VASH: Everyone says that. Right until the door closes.`,
    cast: [
      { name: "MARA", preset: "games.heroic-protagonist", voice: "en_US-amy-medium", about: "the hero, determined and a little out of her depth", gender: "f", age: "young" },
      { name: "OLD TOBIN", preset: "games.quest-giver", voice: "en_GB-alan-medium", about: "a weathered quest giver", gender: "m", age: "old" },
      { name: "SHOPKEEPER", preset: "games.shopkeeper", voice: "en_US-joe-medium", about: "a cheerful, sly merchant", gender: "m", age: "mid" },
      { name: "LADY VASH", preset: "games.fantasy-villain", voice: "en_GB-alba-medium", about: "the mountain's silken, theatrical villain", gender: "f", age: "mid" },
    ],
    acting: { "Stay back! I am not afraid of you!": "strained, shouting, out of breath, then a grunt of effort" },
  },
  {
    id: "demo-science-explainer", name: "Demo: Science explainer (narration)", render: true,
    blurb: "An educational narration with a curious student asking the questions.",
    brief: "Educational narration. Clear and patient. Local only.",
    script: `# Scene 1: Why Is the Sky Blue?
NARRATOR: Look up on a clear day, and the sky is blue. But the light from the Sun is not blue at all.
STUDENT (curious): Wait, so where does the blue come from?
NARRATOR: Sunlight is every colour mixed together. When it hits the air, the short blue waves scatter far more than the red ones.
STUDENT: So the blue gets bounced all over the sky?
NARRATOR: Exactly. That is called Rayleigh scattering, and it is why you see blue in every direction.
STUDENT: Then why are sunsets red?
NARRATOR: At sunset the light travels through much more air, so the blue is scattered away before it reaches you, and the reds and oranges are left.`,
    cast: [
      { name: "NARRATOR", preset: "education.science-explainer", voice: "en_US-amy-medium", about: "a clear, patient science explainer", gender: "f", age: "young" },
      { name: "STUDENT", preset: "family.teenager", voice: "en_US-joe-medium", about: "a curious student", gender: "m", age: "teen" },
    ],
  },
];

// ---- helpers ----------------------------------------------------------------------------------------------------

const sha = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
const atomic = (path: string, data: string | Uint8Array) => { mkdirSync(join(path, ".."), { recursive: true }); const tmp = path + ".tmp"; writeFileSync(tmp, data); renameSync(tmp, path); };

interface Wav { rate: number; samples: Float32Array }
function readWav(bytes: Uint8Array): Wav {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let p = 12, rate = 22050, ch = 1, bits = 16;
  while (p + 8 <= bytes.length) {
    const id = String.fromCharCode(...bytes.slice(p, p + 4)); const size = v.getUint32(p + 4, true);
    if (id === "fmt ") { ch = v.getUint16(p + 10, true); rate = v.getUint32(p + 12, true); bits = v.getUint16(p + 22, true); }
    if (id === "data") {
      if (bits !== 16) throw new Error("expected 16-bit Piper output");
      const n = Math.floor(Math.min(size, bytes.length - p - 8) / 2 / ch);
      const s = new Float32Array(n);
      for (let i = 0; i < n; i++) s[i] = v.getInt16(p + 8 + i * 2 * ch, true) / 32768;
      return { rate, samples: s };
    }
    p += 8 + size + (size % 2);
  }
  throw new Error("no audio in the WAV");
}

/** The same call the app's Piper route makes (piper_args in local.rs): model, config, length scale and sentence silence. */
function piperSpeak(voiceKey: string, text: string, speed: number): Uint8Array {
  const out = join(PIPER, "tmp", `demo-${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}.wav`);
  mkdirSync(join(PIPER, "tmp"), { recursive: true });
  const length = Math.min(1.7, Math.max(0.6, 1 / Math.min(1.6, Math.max(0.6, speed))));
  const clean = text.replace(/\s+/g, " ").trim();
  const r = spawnSync(join(PIPER, "piper", "piper.exe"), ["--model", join(PIPER, "voices", `${voiceKey}.onnx`), "--config", join(PIPER, "voices", `${voiceKey}.onnx.json`), "--output_file", out, "--length_scale", length.toFixed(2), "--sentence_silence", "0.25"], { input: clean, cwd: join(PIPER, "piper"), timeout: 90_000 });
  if (r.status !== 0 || !existsSync(out)) throw new Error(`Piper failed for ${voiceKey}: ${String(r.stderr).slice(-200)}`);
  const bytes = new Uint8Array(readFileSync(out));
  rmSync(out);
  if (bytes.length < 200 || String.fromCharCode(...bytes.slice(0, 4)) !== "RIFF") throw new Error("Piper produced no audio.");
  return bytes;
}

function measureWav(w: Wav): Measured {
  let peak = 0;
  for (const s of w.samples) peak = Math.max(peak, Math.abs(s));
  const { voiced } = frameActivity(w.samples, w.rate);
  return { peak, silenceRatio: voiced.length ? 1 - voiced.filter(Boolean).length / voiced.length : 0, seconds: w.samples.length / w.rate, lufs: integratedLoudness([w.samples], w.rate), clipRuns: countClipRuns(w.samples) };
}

function resample(s: Float32Array, from: number, to: number): Float32Array {
  if (from === to) return s;
  const n = Math.round((s.length * to) / from);
  const o = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * from) / to; const a = Math.floor(x); const f = x - a; o[i] = (s[a] ?? 0) * (1 - f) + (s[Math.min(a + 1, s.length - 1)] ?? 0) * f; }
  return o;
}

// ---- the run ----------------------------------------------------------------------------------------------------

interface DemoResult { id: string; name: string; rendered: boolean; blocked?: string; characters: number; lines: number; takes: number; seconds: number; lufs: number | null; notSent: string[]; qc: { problems: number; listen: number; notes: number; sample: string[] }; export?: { path: string; sha256: string; lufs: number; truePeakDb: number; seconds: number }; verified?: string[]; steps: Record<string, string>; auditEntries: number; spent: number; engine: string }

describe.skipIf(!RUN)("build the demo projects", () => {
  it("writes five demo projects and renders four with real local audio", async () => {
    const results: DemoResult[] = [];
    const manifest = validateManifest(JSON.parse(readFileSync(join(__dirname, "..", "..", "public", "avatars", "manifest.json"), "utf8"))).manifest as AvatarManifest;
    const faces = assignPresetFaces(manifest, STARTER_PRESETS);
    const now = new Date().toISOString();

    // The voice library gets the four Piper voices (added only if missing), after a backup.
    const libPath = join(HOME, "voices.json");
    const lib: VoiceEntry[] = existsSync(libPath) ? JSON.parse(readFileSync(libPath, "utf8")) : [];
    if (existsSync(libPath) && !existsSync(libPath + ".before-demo")) writeFileSync(libPath + ".before-demo", readFileSync(libPath));
    let changed = false;
    for (const v of PIPER_VOICES) if (!lib.some((x) => x.id === v.id && x.provider === "piper")) { lib.push({ ...v, createdAt: now }); changed = true; }
    if (changed) atomic(libPath, JSON.stringify(lib));
    const byKey = new Map<string, VoiceEntry>(lib.map((v) => [v.id, v]));
    // The Nigerian demo is cast from the owner's own ElevenLabs library voices (never generated here).
    const eleven = lib.filter((v) => v.provider === "elevenlabs");
    const elevenFor: Record<string, VoiceEntry | undefined> = { "9nsJoy": eleven.find((v) => /^Joy/.test(v.name)), "9nsAbiola": eleven.find((v) => /^Abiola/.test(v.name)), "9nsRemJac": eleven.find((v) => /^RemJac/.test(v.name)), "9nsAlex": eleven.find((v) => /^Alex Oke/.test(v.name)) };

    for (const d of DEMOS) {
      const dir = join(HOME, "projects", d.id);
      if (existsSync(join(dir, "project.json"))) {
        const old = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as { name?: string };
        if (!String(old.name).startsWith("Demo:")) throw new Error(`${d.id} exists and is not a demo project. Refusing to touch it.`);
        rmSync(dir, { recursive: true, force: true });
      }
      let n = 0;
      const parsed = parseScript(d.script, [], [], () => `${d.id.slice(5, 9)}${(++n).toString(36)}`);
      const project: Project = { ...newProject(d.id, d.name, now), script: d.script, scenes: parsed.scenes, characters: parsed.characters, lines: parsed.lines };
      const library: VoiceEntry[] = [...lib];
      project.characters = project.characters.map((c): Character => {
        const def = d.cast.find((x) => x.name === c.name);
        if (!def) return c;
        const preset = STARTER_PRESETS.find((p) => p.id === def.preset)!;
        const voice = byKeyOrEleven(def.voice);
        const applied = applyPreset({ ...c, about: def.about, look: { ...(def.gender ? { gender: def.gender } : {}), ...(def.age ? { age: def.age } : {}) } }, preset, { ...(voice ? { voice } : {}), avatarId: faces.get(preset.id), now, appVersion: APP_VERSION });
        return applied.character;
      });
      function byKeyOrEleven(k: string) { return byKey.get(k) ?? elevenFor[k]; }
      for (const l of project.lines) { const a = d.acting?.[l.text]; if (a) l.acting = a; }
      // Web loudness (-16 LUFS, -1 dBTP ceiling) so the exported scene is level-safe; Piper itself writes very hot files.
      project.export = { target: "web", ceiling: -1 };

      const result: DemoResult = { id: d.id, name: d.name, rendered: d.render, ...(d.blocked ? { blocked: d.blocked } : {}), characters: project.characters.length, lines: project.lines.length, takes: 0, seconds: 0, lufs: null, notSent: [], qc: { problems: 0, listen: 0, notes: 0, sample: [] }, steps: {}, auditEntries: 0, spent: 0, engine: d.render ? "Piper (local, real inference)" : "none: not rendered" };
      const runId = `run-${d.id}`;
      const priced = () => 0;

      if (!d.render) {
        // Planned, not started: a Guided run with a small cloud limit, so the owner sees the estimate and starts it themselves.
        const run = planProduction(project, library, { id: runId, brief: d.brief, mode: "guided", localOnly: false, cloudLimit: 3, now, price: priced });
        project.agent = run;
        result.steps = Object.fromEntries(run.nodes.map((x) => [x.id, x.status]));
        result.auditEntries = run.audit.length;
        atomic(join(dir, "project.json"), JSON.stringify(project, null, 1));
        results.push(result);
        continue;
      }

      const measured: Record<string, Measured> = {};
      const wavs = new Map<string, Wav>();
      const env: Env = {
        project: () => project, library: () => library, ready: () => readyEnginesFrom({ elevenlabs: false, voicekiller: false, inworld: false, kie: false }, library), localOnly: true,
        edit: (fn) => { Object.assign(project, fn(project)); },
        async makeTake(line: Line, voice: VoiceEntry) {
          const p = plan(line, voice, "eleven_v4", [], {});
          const eff = effectiveLine(withActing(line, { engine: voice.provider }).line);
          const bytes = piperSpeak(voice.id, p.text, eff.direction.speed);
          const id = `t-${line.id}-demo`;
          atomic(join(dir, "takes", `${id}.wav`), bytes);
          const w = readWav(bytes);
          wavs.set(id, w);
          const take: Take = { id, at: new Date().toISOString(), model: "piper", ext: "wav", voiceId: voice.id, sent: p.text, seconds: Number((w.samples.length / w.rate).toFixed(3)), provenance: { engine: "piper", voiceName: voice.name, speed: eff.direction.speed, chars: p.text.length, sha256: sha(bytes), appVersion: APP_VERSION, emotion: eff.direction.emotion, sounds: eff.direction.sounds, note: eff.direction.note ?? "", pronunciations: 0, ...(p.notSent?.length ? { notSent: p.notSent } : {}) } };
          measured[id] = measureWav(w);
          return { take, spent: 0 };
        },
        async measure(take) { return measured[take.id] ?? null; },
        portraitFor: (pid) => faces.get(pid),
        exportScene: (proj) => exportFullScene(proj, {
          render: async (pl, _bed, rate) => {
            const total = Math.ceil(pl.total * rate);
            const L = new Float32Array(total), R = new Float32Array(total);
            for (const it of pl.items) {
              if (it.kind !== "speech") continue;
              const w = wavs.get(it.ref.id) ?? readWav(new Uint8Array(readFileSync(join(dir, "takes", `${it.ref.id}.${it.ref.ext}`))));
              const s = resample(w.samples, w.rate, rate);
              const g = Math.pow(10, it.gainDb / 20);
              const start = Math.round(it.start * rate);
              const fo = Math.min(Math.round(it.fadeOut * rate), s.length), fi = Math.min(Math.round(it.fadeIn * rate), s.length);
              for (let i = 0; i < s.length && start + i < total; i++) {
                let a = s[i]! * g;
                if (i < fi) a *= i / fi;
                if (i > s.length - fo) a *= (s.length - i) / fo;
                L[start + i] = (L[start + i] ?? 0) + a; R[start + i] = (R[start + i] ?? 0) + a;
              }
            }
            return [L, R];
          },
          write: async (name, b64) => { const p = join(dir, "exports", name); atomic(p, Buffer.from(b64, "base64")); return p; },
          sha256: async (b) => sha(b),
        }),
      };

      let run = planProduction(project, library, { id: runId, brief: d.brief, mode: "autonomous", localOnly: true, cloudLimit: 0, now, price: priced });
      const ex = executors(env);
      run = await runAll(run, ex, () => new Date().toISOString());
      // The delivery gate waits for a person. The harness stands in for the person here, and the audit log records it as the harness.
      const wait = run.nodes.find((x) => x.id === "export");
      if (wait?.status === "awaiting_approval") {
        run = approve(run, "export", new Date().toISOString());
        run = { ...run, audit: [...run.audit, { at: new Date().toISOString(), nodeId: "export", event: "delivery approved by the demo build harness, standing in for a person", by: "system", note: "scripts: buildDemos.spec.ts" }] };
        run = await runAll(run, ex, () => new Date().toISOString());
      }
      project.agent = run;
      project.updatedAt = new Date().toISOString();

      const takes = project.lines.flatMap((l) => l.takes);
      result.takes = takes.length;
      result.seconds = Number(takes.reduce((s, t) => s + t.seconds, 0).toFixed(1));
      const lufsVals = Object.values(measured).map((m) => m.lufs).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
      result.lufs = lufsVals.length ? Number((lufsVals.reduce((s, x) => s + x, 0) / lufsVals.length).toFixed(1)) : null;
      result.notSent = [...new Set(takes.flatMap((t) => t.provenance?.notSent ?? []))];
      const findings = qualityCheck(project, library, measured);
      const s = summarize(findings);
      result.qc = { ...s, sample: findings.filter((f) => f.severity !== "note").slice(0, 5).map((f) => f.text) };
      const ex2 = run.nodes.find((x) => x.id === "export");
      if (ex2?.status === "completed" && ex2.output) { const o = ex2.output as { path: string; sha256: string; lufs: number; truePeakDb: number; seconds: number }; result.export = { path: o.path, sha256: o.sha256, lufs: Number(o.lufs.toFixed(1)), truePeakDb: Number(o.truePeakDb.toFixed(1)), seconds: Number(o.seconds.toFixed(1)) }; }
      result.steps = Object.fromEntries(run.nodes.map((x) => [x.id, x.status]));
      result.auditEntries = run.audit.length;
      result.spent = run.spent;
      atomic(join(dir, "project.json"), JSON.stringify(project, null, 1));
      results.push(result);
    }

    // Re-read every demo from disk, as the app will, and check it stands up.
    for (const r of results) {
      const dir = join(HOME, "projects", r.id);
      const proj = JSON.parse(readFileSync(join(dir, "project.json"), "utf8")) as Project;
      const v: string[] = [];
      const lib2: VoiceEntry[] = JSON.parse(readFileSync(libPath, "utf8"));
      for (const c of proj.characters) {
        if (!c.voiceId || !lib2.some((x) => x.id === c.voiceId)) throw new Error(`${r.id}: ${c.name} has no voice in the library`);
        if (!migrateDna(c.dna)?.profile) throw new Error(`${r.id}: ${c.name} lost its profile`);
        if (!c.avatarId) throw new Error(`${r.id}: ${c.name} has no portrait`);
      }
      v.push(`${proj.characters.length} characters, each with a library voice, a profile and a portrait`);
      let files = 0;
      for (const l of proj.lines) for (const t of l.takes) {
        const f = join(dir, "takes", `${t.id}.${t.ext}`);
        if (!existsSync(f)) throw new Error(`${r.id}: missing take file ${t.id}`);
        if (sha(new Uint8Array(readFileSync(f))) !== t.provenance?.sha256) throw new Error(`${r.id}: ${t.id} does not match its recorded checksum`);
        files++;
      }
      v.push(`${files} take files present, each matching its recorded SHA-256`);
      const back = migrateRun(proj.agent);
      if (!back || back.nodes.length !== proj.agent!.nodes.length) throw new Error(`${r.id}: the saved agent run did not read back`);
      v.push(`agent run reads back through the strict reader (${back.nodes.length} steps, ${back.audit.length} audit entries, local-only: ${back.localOnly})`);
      if (r.export && !existsSync(r.export.path)) throw new Error(`${r.id}: exported file is missing`);
      if (r.export) v.push("exported WAV present on disk");
      r.verified = v;
    }
    void toBase64; void planTimeline; void encodeWav;
    writeFileSync(join(__dirname, "..", "..", "..", "docs", "demo-results.json"), JSON.stringify({ builtAt: now, appVersion: APP_VERSION, results }, null, 1));
  }, 900_000);
});
