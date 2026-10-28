import { useSyncExternalStore } from "react";
import { api, type UpdateInfo } from "./api";

export type Phase = "idle" | "checking" | "none" | "available" | "installing" | "error";

export interface UpdateState {
  phase: Phase;
  info: UpdateInfo | null;
  /** 0 to 1 while downloading, or -1 when the size is not known. */
  progress: number;
  error: string;
}

let state: UpdateState = { phase: "idle", info: null, progress: 0, error: "" };
const listeners = new Set<() => void>();
const set = (p: Partial<UpdateState>) => {
  state = { ...state, ...p };
  listeners.forEach((l) => l());
};

export const getUpdateState = () => state;
export const subscribeUpdates = (l: () => void) => (listeners.add(l), () => void listeners.delete(l));
export const useUpdates = () => useSyncExternalStore(subscribeUpdates, getUpdateState);

/** Plain words for a failure, so the owner knows whether it is their connection or something to report. */
export function updateError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e ?? "");
  if (/network|connect|dns|timed? ?out|offline|error sending request/i.test(m)) return "Could not reach the update server. Check your internet connection and try again.";
  if (/signature|verif|minisign|encoding/i.test(m)) return "The update did not pass its signature check, so it was not installed. Nothing was changed.";
  if (/404|not found|status/i.test(m)) return "No update information is published yet.";
  return m.slice(0, 200) || "Could not check for updates.";
}

/** Looks for a newer version. `quiet` leaves the state alone when nothing is wrong, for the check made at start-up. */
export async function checkForUpdates(quiet = false): Promise<UpdateInfo | null> {
  if (state.phase === "checking" || state.phase === "installing") return state.info;
  set({ phase: "checking", error: "" });
  try {
    const info = await api.updateCheck();
    set({ phase: info ? "available" : "none", info, progress: 0 });
    return info;
  } catch (e) {
    set(quiet ? { phase: "idle", error: "" } : { phase: "error", error: updateError(e) });
    return null;
  }
}

export async function installUpdate(): Promise<void> {
  if (state.phase !== "available") return;
  set({ phase: "installing", progress: 0, error: "" });
  try {
    await api.updateInstall((done, total) => set({ progress: total > 0 ? Math.min(1, done / total) : -1 }));
  } catch (e) {
    set({ phase: "error", error: updateError(e) });
  }
}

/** Test hook: put the store back as it started. */
export function resetUpdates(): void {
  state = { phase: "idle", info: null, progress: 0, error: "" };
  listeners.forEach((l) => l());
}
