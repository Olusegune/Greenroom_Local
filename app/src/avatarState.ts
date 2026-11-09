// The avatar library as the screens see it: the built-in manifest (read once from the app's own files, no network) and the
// owner's saved library (custom avatars, favourites, recent). One shared copy, so every screen shows the same faces.

import { useSyncExternalStore } from "react";
import { api } from "./api";
import { emptyStore, faceFor, migrateStore, validateManifest, type AvatarManifest, type AvatarStore, type Expression, type Face } from "./avatarLibrary";

interface State {
  manifest: AvatarManifest | null;
  store: AvatarStore;
  /** Problems found reading the manifest, so a broken library is reported instead of silently showing fewer faces. */
  problems: string[];
  loaded: boolean;
}

let state: State = { manifest: null, store: emptyStore(), problems: [], loaded: false };
const listeners = new Set<() => void>();
const set = (next: Partial<State>) => {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
};

export function useAvatars(): State {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}

/** Reads the built-in manifest from the app's own files and the owner's saved library. Safe to call more than once. */
export async function loadAvatars(): Promise<void> {
  let manifest: AvatarManifest | null = null;
  let problems: string[] = [];
  try {
    const res = await fetch("./avatars/manifest.json");
    if (res.ok) {
      const check = validateManifest(await res.json());
      manifest = check.manifest;
      problems = check.problems;
    } else problems = ["The avatar manifest could not be read."];
  } catch {
    problems = ["The avatar manifest could not be read."];
  }
  let store = emptyStore();
  try {
    store = migrateStore(JSON.parse(await api.avatarsLoad()));
  } catch {
    /* a missing or damaged saved library starts empty; nothing else depends on it */
  }
  set({ manifest, store, problems, loaded: true });
}

/** Changes the saved library and writes it to disk. The screens update at once; a failed write is reported to the caller. */
export async function updateStore(fn: (s: AvatarStore) => AvatarStore): Promise<void> {
  const next = fn(state.store);
  set({ store: next });
  await api.avatarsSave(JSON.stringify(next));
}

export const currentManifest = () => state.manifest;
export const currentFace = (id: string | undefined, expression?: Expression): Face | null => faceFor(id, state.manifest, state.store, expression);
