// Demo backend, used only when Greenroom is opened in a plain browser (never inside the Windows app).
// It makes short tones instead of calling any provider, so every screen can be viewed and tested for free.

import { encodeWav, toBase64 } from "./audio";
import type { SavedCast } from "./cast";
import type { Project, VoiceEntry, VoiceInfo } from "./types";
import type { Api, ClipReq, KeyName, PiperVoice, VideoInfo } from "./api";
import type { EnginesCfg } from "./engines";

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));
const demoEngine = { on: false };
const demoAce = { on: false };
const demoDirector = { on: false };
const directorImpl = async (_s: string, user: string) => {
    await wait(700);
    const ids = [...user.matchAll(/^(l-[\w-]+) \|/gm)].map((x) => x[1]!);
    if (_s.includes("planning a whole scene")) {
      return JSON.stringify({ lines: ids.map((id, i) => ({ id, objective: i % 2 ? "hide how hurt they are" : "get the others to hurry", subtext: i % 2 ? "afraid of being left behind" : "worried it is already too late", start: { emotion: i % 2 ? "sad" : "annoyed", strength: 0.4 }, end: { emotion: i % 2 ? "scared" : "angry", strength: 0.8 }, activity: i === 2 ? "running" : "still", effort: i === 2 ? 0.8 : 0, breathlessness: i === 2 ? 0.75 : 0, fatigue: 0, pain: 0, pace: i % 2 ? 0.9 : 1.1, projection: 0.5, tension: 0.4, breathiness: i % 2 ? 0.5 : 0.15 })) });
    }
    if (_s.includes("directing a whole scene")) return JSON.stringify({ lines: ids.map((id, i) => ({ id, direction: i % 2 ? "Quiet and hurt, hiding it. Short breaths, a pause before the last word." : "Sharp and impatient, close to losing patience. Fast, clipped, a little breathless." })) });
    const lines = ids.map((id, i) => ({ id, emotion: i % 3 === 0 ? "annoyed" : "", sounds: i % 3 === 1 ? ["sighs"] : i % 4 === 2 ? ["laughs"] : [], note: i % 2 === 0 ? "a little tired, as if carrying a heavy box" : "", speed: 1, pauseAfter: 0.5 }));
    return ["Here you go:", "```json", JSON.stringify({ lines, atmosphere: "a busy kitchen, soft pots and pans" }), "```"].join("\n");
  };

const demoSfx = { on: false };
let avatarsJson = "{}";
const keys = { elevenlabs: true, kie: true, voicekiller: true, inworld: true, huggingface: false, openai: true, gemini: true } as Record<string, boolean>;
const projects = new Map<string, Project>();
const takes = new Map<string, { audioB64: string; mime: string }>();
/** A voice library for trying the screens in a browser: set localStorage "greenroom-demo-library" to a JSON list of voices and reload. Demo only; the real app never uses this file. */
function demoLibrary(): VoiceEntry[] {
  try {
    const v = JSON.parse(window.localStorage.getItem("greenroom-demo-library") ?? "[]");
    return Array.isArray(v) ? (v.slice(0, 200) as VoiceEntry[]) : [];
  } catch {
    return [];
  }
}
let library: VoiceEntry[] = demoLibrary();
const demoKokoro = { runtime: false, model: false };
const demoQwen = { runtime: false, model: false };
const demoSpeaker = { on: false };
const demoQwenLock = { base: false, gpu: false, locked: new Set<string>() };
const qwenLockDemo = () => ({ baseReady: demoQwenLock.base, gpu: demoQwenLock.gpu, gpuName: demoQwenLock.gpu ? "Demo graphics card" : "", voices: ["qwen-warm-narrator", "qwen-gravel-man", "qwen-bright-young-woman", "qwen-gentle-older-man"].map((id) => ({ id, locked: demoQwenLock.locked.has(id) })) });
let casts: SavedCast[] = [];
let sheetJson = "{}";
const versions = new Map<string, { id: string; at: string; label: string; json: string }[]>();
let backups: { file: string; projectId: string; name: string; at: string; bytes: number; takes: number; json: string }[] = [];
const sheetAudio = new Map<string, string>();
let engines: Partial<EnginesCfg> = {};
let piperInstalled = false;
let ffmpegInstalled = false;
const piperVoices = new Set<string>();
const PIPER: PiperVoice[] = [
  { key: "en_GB-alba-medium", name: "alba", code: "en_GB", family: "en", language: "English", country: "Great Britain", quality: "medium", speakers: 1, sizeMb: 60.3 },
  { key: "en_US-lessac-medium", name: "lessac", code: "en_US", family: "en", language: "English", country: "United States", quality: "medium", speakers: 1, sizeMb: 60.3 },
  { key: "fr_FR-siwis-medium", name: "siwis", code: "fr_FR", family: "fr", language: "French", country: "France", quality: "medium", speakers: 1, sizeMb: 60.3 },
  { key: "sw_CD-lanfrica-medium", name: "lanfrica", code: "sw_CD", family: "sw", language: "Swahili", country: "Congo", quality: "medium", speakers: 1, sizeMb: 60.3 },
];

function tone(seconds: number, hz: number): string {
  const rate = 22050;
  const n = Math.floor(seconds * rate);
  const d = new Float32Array(n);
  for (let i = 0; i < n; i++) d[i] = Math.sin((2 * Math.PI * hz * i) / rate) * 0.2 * Math.min(1, i / 800, (n - i) / 800);
  return toBase64(encodeWav([d], rate));
}

const MINE: VoiceInfo[] = [
  { id: "demo-ada", name: "Ada (demo)", accent: "nigerian", language: "en", gender: "female", description: "warm, confident", category: "cloned", previewUrl: null },
  { id: "demo-tunde", name: "Tunde (demo)", accent: "nigerian", language: "en", gender: "male", description: "easygoing, young", category: "designed", previewUrl: null },
];
const SHARED: VoiceInfo[] = [
  { id: "sh1", owner: "own1", name: "Chidi", accent: "nigerian", language: "en", gender: "male", description: "calm, narration", category: "professional", previewUrl: null },
  { id: "sh2", owner: "own2", name: "Amara", accent: "nigerian", language: "yo", gender: "female", description: "bright, conversational", category: "professional", previewUrl: null },
  { id: "sh3", owner: "own3", name: "Min-jun", accent: "korean", language: "ko", gender: "male", description: "deep, dramatic", category: "professional", previewUrl: null },
];

export const mock: Api = {
  keyStatus: async () => ({ elevenlabs: keys.elevenlabs!, kie: keys.kie!, voicekiller: keys.voicekiller!, inworld: keys.inworld!, huggingface: keys.huggingface!, openai: !!keys.openai, gemini: !!keys.gemini }),
  setKey: async (n: KeyName) => void (keys[n === "voicekiller-userid" ? "voicekiller" : n] = true),
  clearKey: async (n: KeyName) => void (keys[n === "voicekiller-userid" ? "voicekiller" : n] = false),
  huggingfaceCheck: async () => { if (!keys.huggingface) throw new Error("Add a Hugging Face token first."); return "Demo account"; },
  runClip: async (req: ClipReq) => {
    await wait(400);
    const secs = req.provider.endsWith("sfx") ? (req.seconds ?? 2) : Math.min(8, 1 + req.text.length / 22);
    return { audioB64: tone(secs, 180 + (req.text.length % 7) * 40), mime: "audio/wav", ms: 400 };
  },
  voicesMine: async () => (await wait(), MINE),
  avatarsLoad: async () => avatarsJson,
  avatarsSave: async (json: string) => void (avatarsJson = json),
  avatarGenerate: async (prompt: string) => {
    await wait(900);
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const g = c.getContext("2d")!;
    const h = [...prompt].reduce((a, ch) => (a * 31 + ch.charCodeAt(0)) >>> 0, 7);
    const bg = g.createRadialGradient(256, 200, 20, 256, 256, 420);
    bg.addColorStop(0, `hsl(${h % 360} 45% 38%)`);
    bg.addColorStop(1, "#0b1a1c");
    g.fillStyle = bg;
    g.fillRect(0, 0, 512, 512);
    g.fillStyle = `hsl(${20 + (h % 20)} 45% ${45 + (h % 25)}%)`;
    g.beginPath();
    g.ellipse(256, 230, 95, 120, 0, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = "#1b1b22";
    g.beginPath();
    g.ellipse(256, 150, 105, 70, 0, Math.PI, 0);
    g.fill();
    g.fillStyle = `hsl(${h % 360} 30% 25%)`;
    g.beginPath();
    g.ellipse(256, 520, 190, 150, 0, Math.PI, 0);
    g.fill();
    return { imageB64: c.toDataURL("image/png").split(",")[1]!, mime: "image/png" };
  },
  inworldCheck: async () => (await wait(), 3),
  voicesInworld: async () => (await wait(), { total: 3, truncated: false, voices: [
    { voiceId: "Alex", displayName: "Alex", language: "en-US", description: "Mature, calm narrator", tags: ["narrator", "calm"], source: "SYSTEM", gender: "MALE", ageGroup: "ADULT" },
    { voiceId: "Olivia", displayName: "Olivia", language: "en-GB", description: "Dry, precise British voice", tags: ["british", "precise"], source: "SYSTEM", gender: "FEMALE", ageGroup: "ADULT" },
    { voiceId: "workspace-mum", displayName: "Mum (cloned)", language: "en-US", description: "Cloned in this workspace", tags: [], source: "IVC", gender: "FEMALE", ageGroup: "ADULT" },
  ] }),
  inworldPreview: async () => (await wait(), { audioB64: tone(1.6, 260), mime: "audio/wav" }),
  inworldClone: async (a: { name: string }) => (await wait(), { warnings: [], voice: { voiceId: "demo-clone", displayName: a.name, language: "en-US", description: "", tags: [], source: "IVC", gender: "", ageGroup: "" } }),
  voicesVoiceKiller: async () => (await wait(), [{ name: "Bella", language: "en" }, { name: "Lucia (es-MX)", language: "es-MX" }, { name: "Authoritative Advisor 1 (en-GB)", language: "en-GB" }]),
  voicesShared: async (search, language, accent) => {
    await wait();
    const l = SHARED.filter((v) => (!search || v.name.toLowerCase().includes(search.toLowerCase())) && (!language || v.language === language) && (!accent || v.accent === accent));
    return { voices: l, more: false };
  },
  voiceAddShared: async (_o, v) => (await wait(), "added-" + v),
  voiceDesign: async () => (await wait(700), [1, 2, 3].map((i) => ({ generatedVoiceId: "gen" + i, audioB64: tone(2.5, 150 + i * 60), seconds: 2.5 }))),
  voiceDesignSave: async (g) => (await wait(), "designed-" + g),
  qwenDesignPreview: async () => (await wait(900), [1, 2, 3].map((i) => ({ generatedVoiceId: "qwen-design-0000000" + i, audioB64: tone(2.5, 120 + i * 50), seconds: 2.5 }))),
  qwenDesignReady: async () => demoQwen.model,
  qwenDesignSave: async (g) => (await wait(), g),
  voiceClone: async (name, _f, _m, _a, permission) => {
    if (!permission) throw new Error("Confirm that you have permission to clone this voice first.");
    await wait(600);
    return "cloned-" + name.toLowerCase().replace(/\W+/g, "");
  },
  voiceDelete: async () => void (await wait()),
  previewFetch: async () => ({ audioB64: tone(1.6, 330), mime: "audio/wav" }),
  projectList: async () => [...projects.values()].map((p) => ({ id: p.id, name: p.name, updatedAt: p.updatedAt })).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  projectLoad: async (id) => {
    const p = projects.get(id);
    if (!p) throw new Error("Could not open that project.");
    return structuredClone(p);
  },
  projectSave: async (p) => void projects.set(p.id, structuredClone(p)),
  takeWrite: async (_p, take, ext, audioB64) => void takes.set(take, { audioB64, mime: ext === "mp3" ? "audio/mpeg" : "audio/wav" }),
  takeRead: async (_p, take) => {
    const t = takes.get(take);
    if (!t) throw new Error("That take is missing from the project folder.");
    return t;
  },
  exportWrite: async (_p, folder, filename) => `C:\\Users\\you\\Documents\\Greenroom\\projects\\demo\\exports\\${folder ? folder + "\\" : ""}${filename}`,
  libraryLoad: async () => structuredClone(library),
  librarySave: async (v) => void (library = structuredClone(v)),
  versionSave: async (project: string, label: string) => {
    const p = projects.get(project);
    if (!p) throw new Error("Could not read the project.");
    const list = versions.get(project) ?? [];
    const json = JSON.stringify(p);
    if (list[0]?.json === json) return null;
    const at = new Date().toISOString();
    const id = at.replace(/[-:]/g, "").slice(0, 15) + "Z" + (label ? "-" + label.toLowerCase().replace(/[^a-z0-9]+/g, "-") : "") + list.length;
    versions.set(project, [{ id, at, label, json }, ...list].slice(0, 60));
    return id;
  },
  versionList: async (project: string) => (versions.get(project) ?? []).map((v) => ({ id: v.id, at: v.at, label: v.label, bytes: v.json.length })),
  versionLoad: async (project: string, id: string) => {
    const v = versions.get(project)?.find((x) => x.id === id);
    if (!v) throw new Error("That version is missing.");
    return JSON.parse(v.json) as Project;
  },
  backupNow: async (project: string) => {
    const p = projects.get(project);
    if (!p) throw new Error("Could not read the project.");
    const at = new Date().toISOString();
    const file = `${project}__${at.replace(/[-:]/g, "").slice(0, 15)}Z.zip`;
    backups = [{ file, projectId: project, name: p.name, at, bytes: JSON.stringify(p).length + 40000, takes: p.lines.reduce((n, l) => n + l.takes.length, 0), json: JSON.stringify(p) }, ...backups].slice(0, 5);
    return "C:\\Users\\you\\Documents\\Greenroom\\backups\\" + file;
  },
  backupAuto: async () => null,
  backupList: async () => backups.map(({ json: _j, ...b }) => (void _j, b)),
  backupRestore: async (file: string) => {
    const b = backups.find((x) => x.file === file);
    if (!b) throw new Error("That backup is not valid.");
    const p = JSON.parse(b.json) as Project;
    const id = "p-restored" + projects.size;
    projects.set(id, { ...p, id, name: p.name + " (restored)", updatedAt: new Date().toISOString() });
    return id;
  },
  sheetLoad: async () => sheetJson,
  sheetSave: async (json: string) => void (sheetJson = json),
  sheetAudioWrite: async (id: string, audioB64: string) => void sheetAudio.set(id, audioB64),
  sheetAudioRead: async (id: string) => ({ audioB64: sheetAudio.get(id) ?? tone(1, 300), mime: "audio/wav" }),
  sheetExport: async (filename: string) => `C:\\Users\\you\\Documents\\Greenroom\\accent-sheet\\reports\\${filename}`,
  castsLoad: async () => structuredClone(casts),
  castsSave: async (c: SavedCast[]) => void (casts = structuredClone(c)),
  enginesLoad: async () => structuredClone(engines),
  enginesSave: async (c) => void (engines = structuredClone(c)),
  piperStatus: async () => ({ installed: piperInstalled, voices: [...piperVoices] }),
  piperInstall: async () => (await wait(900), void (piperInstalled = true)),
  piperCatalog: async () => (await wait(), PIPER),
  piperPreview: async () => ({ audioB64: tone(1, 300), mime: "audio/wav" }),
  piperInstallVoice: async (k) => (await wait(900), void piperVoices.add(k)),
  piperRemoveVoice: async (k) => void piperVoices.delete(k),
  localVoices: async () => (await wait(), ["af_bella", "am_adam"]),
  modelHardware: async () => ({ platform: "windows" as const, memoryGb: 16, accelerator: "Demo GPU", vramGb: 8, tier: "standard" as const }),
  modelStates: async (ids: string[]) => ids.map((id) => ({ id, state: "available" as const, progress: 0 })),
  modelInstall: async (id: string) => (await wait(900), { id, state: "installed" as const, progress: 100, version: "demo" }),
  wazobiaInstallAutomatic: async () => (await wait(900), { id: "wazobia-voice", state: "installed" as const, progress: 100, version: "v2" }),
  wazobiaImportFile: async () => (await wait(900), { id: "wazobia-voice", state: "installed" as const, progress: 100, version: "v2" }),
  chatterboxImportDownloads: async () => (await wait(900), { id: "chatterbox-multilingual-v3", state: "installed" as const, progress: 100, version: "demo" }),
  wazobiaInstallDownload: async () => (await wait(1500), { id: "wazobia-voice", state: "installed" as const, progress: 100, version: "8ca840df" }),
  wazobiaVoices: async () => ["adaeze", "amara", "bolaji", "elder_deji", "emeka", "hauwa", "ife", "james", "john", "musa", "ngozi", "tunde", "wura"],
  chatterboxReady: async () => demoEngine.on,
  chatterboxRuntimeStatus: async () => ({ installed: demoEngine.on, modelReady: false, detail: demoEngine.on ? "Runtime ready." : "Install the local runtime, then download the model files." }),
  chatterboxRuntimeInstall: async () => (await wait(1000), (demoEngine.on = true), { installed: true, modelReady: false, detail: "Runtime ready. Download Chatterbox model files to enable speech." }),
  kokoroRuntimeStatus: async () => ({ installed: demoKokoro.runtime, modelReady: demoKokoro.model, detail: demoKokoro.model ? "Kokoro is ready: runtime installed and model downloaded." : demoKokoro.runtime ? "Runtime installed. Download the Kokoro model to enable speech." : "Install the Kokoro runtime to enable local speech." }),
  kokoroRuntimeInstall: async () => (await wait(800), (demoKokoro.runtime = true), { installed: true, modelReady: demoKokoro.model, detail: "Runtime installed. Download the Kokoro model to enable speech." }),
  kokoroPrefetch: async () => { if (!demoKokoro.runtime) throw new Error("Install the Kokoro runtime first."); await wait(800); demoKokoro.model = true; return { installed: true, modelReady: true, detail: "Kokoro is ready: runtime installed and model downloaded." }; },
  qwenRuntimeStatus: async () => ({ installed: demoQwen.runtime, modelReady: demoQwen.model, detail: demoQwen.model ? "Qwen3-TTS is ready: runtime installed and model downloaded." : demoQwen.runtime ? "Runtime installed. Download the Qwen3-TTS model to enable speech." : "Install the Qwen3-TTS runtime to enable local speech." }),
  qwenRuntimeInstall: async () => (await wait(800), (demoQwen.runtime = true), { installed: true, modelReady: demoQwen.model, detail: "Runtime installed. Download the Qwen3-TTS model to enable speech." }),
  qwenUnload: async () => false,
  qwenLockStatus: async () => qwenLockDemo(),
  qwenBaseDownload: async () => { demoQwenLock.base = true; return qwenLockDemo(); },
  qwenLockVoice: async (voice: string) => { demoQwenLock.locked.add(voice); return qwenLockDemo(); },
  qwenUnlockVoice: async (voice: string) => { demoQwenLock.locked.delete(voice); return qwenLockDemo(); },
  qwenGpuInstall: async () => { demoQwenLock.gpu = true; return qwenLockDemo(); },
  speakerStatus: async () => ({ ready: demoSpeaker.on, detail: demoSpeaker.on ? "Ready: Greenroom can measure whether a character's takes sound like one speaker." : "Not installed. It is a small download (about 100 MB)." }),
  speakerInstall: async () => (await wait(800), (demoSpeaker.on = true), { ready: true, detail: "Ready: Greenroom can measure whether a character's takes sound like one speaker." }),
  // Demo only: a fixed vector per take id, with one take that sounds like someone else, so the screen and the agent can be exercised.
  speakerEmbed: async (_project: string, takes: string[]) => (await wait(300), takes.map((t, i) => ({ take: t, embedding: Array.from({ length: 256 }, (_, k) => (k === 0 ? 1 : k === 1 ? (i === 3 ? 4 : 0.05 * ((i * 7) % 5)) : 0.01 * (((k + i) * 13) % 7)) as number) }))),
  qwenPrefetch: async () => { if (!demoQwen.runtime) throw new Error("Install the Qwen3-TTS runtime first."); await wait(800); demoQwen.model = true; return { installed: true, modelReady: true, detail: "Qwen3-TTS is ready: runtime installed and model downloaded." }; },
  voiceConvert: async () => { await wait(1500); return { audioB64: tone(4, 330), mime: "audio/wav", ms: 1500 }; },
  directorLocalStatus: async () => ({ installed: demoDirector.on, modelReady: demoDirector.on, detail: demoDirector.on ? "Ready. The Director runs on this computer." : "Install the local director: a 38 MB engine and a 2.5 GB model." }),
  directorLocalInstall: async () => (await wait(1500), (demoDirector.on = true), { installed: true, modelReady: true, detail: "Ready. The Director runs on this computer." }),
  directorLocalComplete: async (s: string, user: string) => (s.includes("writing acting instructions") ? "Read in a low, shaky voice, anxious and full of self-doubt. Short breaths, trailing off at the end." : directorImpl(s, user)),
  pickScript: async () => "demo/The Late Delivery.fountain",
  scriptOpen: async (_path: string) => ({ name: "The Late Delivery.fountain", format: "fountain" as const, truncated: false, text: "Title: The Late Delivery\n\nINT. KITCHEN - DAY\n\nADA (60s, Nigerian) sits at the table, stern. She taps her watch. TUNDE, a young man in his twenties, bursts in out of breath.\n\nADA\n(annoyed)\nYou said ten o'clock. It is nearly noon.\n\nTUNDE\nI know, I know. The traffic on the bridge was impossible.\n\nINT. KITCHEN - LATER\n\nMAMA (V.O.)\nWho is making that noise?\n\nADA\nNobody, Mama.\n" }),
  setupCheck: async (engine: string) => [
    { name: "Folder path length", ok: true, detail: "40 characters", fix: "" },
    { name: "Disk space", ok: true, detail: "120 GB free (about 7 GB needed)", fix: "" },
    { name: "Hugging Face (models)", ok: true, detail: "reachable", fix: "" },
    ...(engine === "wazobia" ? [{ name: "WazobiaVoice terms", ok: false, detail: "this account cannot download the files yet", fix: "Open huggingface.co/Axiveri/WazobiaVoice signed in to the SAME account as the token, press Agree and access repository, then try again." }] : []),
  ],
  setupReport: async () => "Greenroom Local (demo)\nNo setup log in the demo.",
  llmModels: async () => ({ openai: { models: ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"], default: "gpt-6.1-terra" }, gemini: { models: ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"], default: "gemini-3.6-flash" } }),
  directorComplete: async (s: string, user: string, _provider?: string, _model?: string) => (s.includes("writing acting instructions") ? "Read in a low, shaky voice, anxious and full of self-doubt. Short breaths, trailing off at the end." : directorImpl(s, user)),
  pickAudio: async () => "C:/Demo/Theme Music.wav",
  pickModelFile: async () => "C:/Demo/t3_mtl23ls_v2.safetensors",
  audioImport: async (_p: string, path: string) => {
    await wait(300);
    const id = "m-demo" + takes.size;
    takes.set(id, { audioB64: tone(24, 220), mime: "audio/wav" });
    return { id, ext: "wav", name: path.split(/[\/]/).pop() ?? "music.wav", bytes: 24 * 22050 * 2 + 44, sha256: "d".repeat(64) };
  },
  sfxStatus: async () => ({ installed: demoSfx.on, modelReady: demoSfx.on, detail: demoSfx.on ? "Ready. Sound effects are made on this computer." : "Install the sound-effects engine and model (about 6 GB in total)." }),
  sfxRuntimeInstall: async () => (await wait(1200), (demoSfx.on = true), { installed: true, modelReady: false, detail: "Engine ready. Download the sound-effects model (about 2.6 GB)." }),
  sfxInstallModels: async () => (await wait(1500), (demoSfx.on = true), { installed: true, modelReady: true, detail: "Ready. Sound effects are made on this computer." }),
  acestepStatus: async () => ({ installed: demoAce.on, modelReady: demoAce.on, detail: demoAce.on ? "Ready. Music is made on this computer." : "Install the music engine and download the model (about 11 GB in total)." }),
  acestepRuntimeInstall: async () => (await wait(1200), (demoAce.on = true), { installed: true, modelReady: false, detail: "Engine ready. Download the ACE-Step music model (8.3 GB)." }),
  musicLocalGenerate: async (_p: string, req: { title: string; seconds: number }) => {
    await wait(1500);
    const id = "m-ace" + takes.size;
    takes.set(id, { audioB64: tone(req.seconds, 220), mime: "audio/wav" });
    return [{ id, ext: "wav", name: req.title, bytes: 1000, sha256: "f".repeat(64), seconds: req.seconds }];
  },
  musicGenerate: async (_p: string, req: { title: string }) => {
    await wait(1200);
    return [0, 1].map((i) => {
      const id = "m-suno" + takes.size + i;
      takes.set(id, { audioB64: tone(20 + i * 4, 196 + i * 40), mime: "audio/wav" });
      return { id, ext: "wav", name: `${req.title} (take ${i + 1})`, bytes: 1000, sha256: "e".repeat(64), seconds: 20 + i * 4 };
    });
  },
  updateCheck: async () => {
    await wait(600);
    // Demo only: add ?demo-update to the address to see what an available update looks like.
    return typeof location !== "undefined" && location.search.includes("demo-update") ? { version: "9.9.9", notes: "Demo notes: faster exports and a calmer Studio.", date: "2026-11-01T00:00:00Z" } : null;
  },
  updateInstall: async (onProgress: (done: number, total: number) => void) => {
    for (let i = 1; i <= 5; i++) {
      await wait(200);
      onProgress(i * 200_000, 1_000_000);
    }
  },
  ffmpegStatus: async () => ({ installed: ffmpegInstalled, source: ffmpegInstalled ? ("greenroom" as const) : null }),
  ffmpegInstall: async () => (await wait(900), void (ffmpegInstalled = true)),
  videoMux: async (_p: string, video: string, _m: string, _k: boolean) => {
    await wait(700);
    const stem = (video.split(/[\/]/).pop() ?? "video").replace(/\.[^.]+$/, "");
    return { path: ["C:", "Users", "you", "Documents", "Greenroom", "projects", "demo", "exports", "Video", stem + " with Greenroom mix.mp4"].join("\\"), codec: "AAC 320 kbps" };
  },
  videoProbe: async (path: string): Promise<VideoInfo> => ({ container: path.split(".").pop() ?? "mp4", known: false, fpsNum: 0, fpsDen: 0, durationSec: 0, width: 0, height: 0 }),
  videoAllow: async () => undefined,
  pickVideo: async () => "C:/Demo/Rough Cut.webm",
  saveReport: async () => "C:\\Users\\you\\Documents\\Greenroom\\listening-report.md",
};
