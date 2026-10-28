import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import type { SavedCast } from "./cast";
import type { Project, VoiceEntry, VoiceInfo } from "./types";
import { mock } from "./mock";
import type { EnginesCfg } from "./engines";
import type { HardwareProfile, InstalledModel } from "./models";

export type KeyName = "elevenlabs" | "kie" | "voicekiller" | "voicekiller-userid";
export type KeyStatus = { elevenlabs: boolean; kie: boolean; voicekiller: boolean };
export type Provider = "eleven-v4" | "eleven-tts" | "eleven-sfx" | "voicekiller" | "voicekiller-clone" | "kie-tts" | "kie-dialogue" | "kie-sfx" | "piper" | "local";

export interface ClipOut {
  audioB64: string;
  mime: string;
  ms: number;
}
export interface Audio {
  audioB64: string;
  mime: string;
}
export interface ClipReq {
  provider: Provider;
  text: string;
  voice?: string;
  speed?: number;
  seconds?: number;
  instructions?: string;
  /** An ElevenLabs output format, checked against an allow-list in the backend. */
  quality?: string;
}
export interface DesignPreview {
  generatedVoiceId: string;
  audioB64: string;
  seconds: number;
}
export interface PiperVoice {
  key: string;
  name: string;
  code: string;
  family: string;
  language: string;
  country: string;
  quality: string;
  speakers: number;
  sizeMb: number;
}
export interface PiperStatus {
  installed: boolean;
  voices: string[];
}
export interface VideoInfo {
  container: string;
  /** True when the frame rate and length were read from the file. */
  known: boolean;
  fpsNum: number;
  fpsDen: number;
  durationSec: number;
  width: number;
  height: number;
}
export const VIDEO_EXTENSIONS = ["mp4", "mov", "m4v", "webm", "mkv", "avi", "mpg", "mpeg"];

export interface VersionInfo {
  id: string;
  at: string;
  label: string;
  bytes: number;
}
export interface BackupInfo {
  file: string;
  projectId: string;
  name: string;
  at: string;
  bytes: number;
  takes: number;
}
export interface UpdateInfo {
  version: string;
  notes: string;
  date: string;
}
export interface FfmpegStatus {
  installed: boolean;
  source: "greenroom" | "system" | null;
}
export interface MuxResult {
  path: string;
  codec: string;
}
export interface MusicReq {
  title: string;
  style: string;
  lyrics: string;
  instrumental: boolean;
  version: string;
  negativeTags: string;
  vocalGender: string;
  duration: number;
}
export interface MadeMusic extends Imported {
  seconds: number;
}
export interface Imported {
  id: string;
  ext: string;
  name: string;
  bytes: number;
  sha256: string;
}
export const AUDIO_EXTENSIONS = ["wav", "mp3", "m4a", "flac", "ogg", "aac"];

export interface ProjectInfo {
  id: string;
  name: string;
  updatedAt: string;
}

/** True inside the Windows app. In a plain browser the demo backend in mock.ts answers instead, so the screens can be viewed. */
export const inApp = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

async function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return await invoke<T>(cmd, args);
  } catch (e) {
    throw new Error(typeof e === "string" ? e : "Something went wrong.");
  }
}

import type { Update } from "@tauri-apps/plugin-updater";
let pendingUpdate: Update | null = null;

const real = {
  keyStatus: () => call<KeyStatus>("key_status"),
  setKey: (name: KeyName, value: string) => call<void>("set_key", { name, value }),
  clearKey: (name: KeyName) => call<void>("clear_key", { name }),
  runClip: (req: ClipReq) => call<ClipOut>("run_clip", { req }),
  voicesMine: () => call<VoiceInfo[]>("voices_mine"),
  voicesVoiceKiller: () => call<{ name: string; language: string }[]>("voices_voicekiller"),
  voicesShared: (search: string, language: string, accent: string, gender: string, page: number) => call<{ voices: VoiceInfo[]; more: boolean }>("voices_shared", { search, language, accent, gender, page }),
  voiceAddShared: (owner: string, voice: string, name: string) => call<string>("voice_add_shared", { owner, voice, name }),
  voiceDesign: (description: string, sample?: string) => call<DesignPreview[]>("voice_design", { description, sample }),
  voiceDesignSave: (generated: string, name: string, description: string) => call<string>("voice_design_save", { generated, name, description }),
  voiceClone: (name: string, filename: string, mime: string, audioB64: string, permission: boolean) => call<string>("voice_clone", { name, filename, mime, audioB64, permission }),
  voiceDelete: (id: string) => call<void>("voice_delete", { id }),
  previewFetch: (url: string) => call<Audio>("preview_fetch", { url }),
  projectList: () => call<ProjectInfo[]>("project_list"),
  projectLoad: async (id: string) => JSON.parse(await call<string>("project_load", { id })) as Project,
  projectSave: (p: Project) => call<void>("project_save", { id: p.id, json: JSON.stringify(p) }),
  takeWrite: (project: string, take: string, ext: string, audioB64: string) => call<void>("take_write", { project, take, ext, audioB64 }),
  takeRead: (project: string, take: string) => call<Audio>("take_read", { project, take }),
  exportWrite: (project: string, folder: string, filename: string, audioB64: string) => call<string>("export_write", { project, folder, filename, audioB64 }),
  libraryLoad: async () => JSON.parse(await call<string>("library_load")) as VoiceEntry[],
  versionSave: (project: string, label: string) => call<string | null>("version_save", { project, label }),
  versionList: (project: string) => call<VersionInfo[]>("version_list", { project }),
  versionLoad: async (project: string, id: string) => JSON.parse(await call<string>("version_load", { project, id })) as Project,
  backupNow: (project: string) => call<string>("backup_now", { project }),
  backupAuto: (project: string) => call<string | null>("backup_auto", { project }),
  backupList: () => call<BackupInfo[]>("backup_list"),
  backupRestore: (file: string) => call<string>("backup_restore", { file }),
  sheetLoad: () => call<string>("sheet_load"),
  sheetSave: (json: string) => call<void>("sheet_save", { json }),
  sheetAudioWrite: (id: string, audioB64: string) => call<void>("sheet_audio_write", { id, audioB64 }),
  sheetAudioRead: (id: string) => call<Audio>("sheet_audio_read", { id }),
  sheetExport: (filename: string, text: string) => call<string>("sheet_export", { filename, text }),
  castsLoad: async () => JSON.parse(await call<string>("casts_load")) as SavedCast[],
  castsSave: (c: SavedCast[]) => call<void>("casts_save", { json: JSON.stringify(c) }),
  librarySave: (v: VoiceEntry[]) => call<void>("library_save", { json: JSON.stringify(v) }),
  saveReport: (text: string) => call<string>("save_report", { text }),
  enginesLoad: async () => JSON.parse(await call<string>("engines_load")) as Partial<EnginesCfg>,
  enginesSave: (c: EnginesCfg) => call<void>("engines_save", { json: JSON.stringify(c) }),
  piperStatus: () => call<PiperStatus>("piper_status"),
  piperInstall: () => call<void>("piper_install"),
  piperCatalog: () => call<PiperVoice[]>("piper_catalog"),
  piperInstallVoice: (key: string) => call<void>("piper_install_voice", { key }),
  piperRemoveVoice: (key: string) => call<void>("piper_remove_voice", { key }),
  localVoices: () => call<string[]>("local_voices"),
  modelHardware: () => call<HardwareProfile>("model_hardware"),
  modelStates: (ids: string[]) => call<InstalledModel[]>("model_states", { ids }),
  modelInstall: (id: string) => call<InstalledModel>("model_install", { id }),
  directorComplete: (system: string, user: string) => call<string>("director_complete", { system, user }),
  musicGenerate: (project: string, req: MusicReq) => call<MadeMusic[]>("music_generate", { project, req }),
  audioImport: (project: string, path: string) => call<Imported>("audio_import", { project, path }),
  pickAudio: async (): Promise<string | null> => {
    const r = await openDialog({ multiple: false, directory: false, filters: [{ name: "Audio", extensions: AUDIO_EXTENSIONS }] });
    return typeof r === "string" ? r : null;
  },
  /** Asks GitHub whether a newer signed Greenroom exists. Sends nothing but the request. Null when this is the newest. */
  updateCheck: async (): Promise<UpdateInfo | null> => {
    const { check } = await import("@tauri-apps/plugin-updater");
    const u = await check();
    pendingUpdate = u;
    return u ? { version: u.version, notes: u.body ?? "", date: u.date ?? "" } : null;
  },
  /** Downloads the update, checks its signature, installs it and restarts. Only called from a button the owner pressed. */
  updateInstall: async (onProgress: (done: number, total: number) => void): Promise<void> => {
    if (!pendingUpdate) throw new Error("Check for updates first.");
    let total = 0;
    let done = 0;
    await pendingUpdate.downloadAndInstall((e) => {
      if (e.event === "Started") total = e.data.contentLength ?? 0;
      else if (e.event === "Progress") onProgress((done += e.data.chunkLength), total);
    });
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
  },
  ffmpegStatus: () => call<FfmpegStatus>("ffmpeg_status"),
  ffmpegInstall: () => call<void>("ffmpeg_install"),
  videoMux: (project: string, video: string, mix: string, keepOriginal: boolean) => call<MuxResult>("video_mux", { project, video, mix, keepOriginal }),
  videoProbe: (path: string) => call<VideoInfo>("video_probe", { path }),
  videoAllow: (path: string) => call<void>("video_allow", { path }),
  /** Opens the Windows file picker. Returns null if the owner cancels. */
  pickVideo: async (): Promise<string | null> => {
    const r = await openDialog({ multiple: false, directory: false, filters: [{ name: "Video", extensions: VIDEO_EXTENSIONS }] });
    return typeof r === "string" ? r : null;
  },
};

export type Api = typeof real;
export const api: Api = inApp() ? real : mock;

/** The address the player uses for a chosen video. In a plain browser (demo mode) a test video can be supplied by the page. */
export function videoUrl(path: string): string {
  if (inApp()) return convertFileSrc(path);
  return (window as unknown as { __greenroomDemoVideo?: string }).__greenroomDemoVideo ?? "";
}

export function toUrl(a: Audio): string {
  const bin = atob(a.audioB64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return URL.createObjectURL(new Blob([bytes], { type: a.mime }));
}
