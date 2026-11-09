// What the owner keeps about presets: favourites, recently used, and presets they made or imported. Kept in the
// browser's local storage (a convenience, never the only copy of anything that matters: a project saves the character
// the preset was applied to). Every read and write is guarded, so a blocked or full store never breaks the screen.

import { validatePreset, type VoicePreset } from "./schema";

export interface PresetState {
  favorites: string[];
  recent: string[];
  custom: VoicePreset[];
}

export const EMPTY_STATE: PresetState = { favorites: [], recent: [], custom: [] };
export const KEY = "greenroom-voice-presets";
export const MAX_RECENT = 12;
export const MAX_CUSTOM = 200;

type Store = Pick<Storage, "getItem" | "setItem">;

const ids = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 500) : []);

export function loadState(store: Store | null | undefined): PresetState {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return EMPTY_STATE;
    const o = JSON.parse(raw) as Record<string, unknown>;
    const custom: VoicePreset[] = [];
    for (const p of Array.isArray(o.custom) ? o.custom.slice(0, MAX_CUSTOM) : []) {
      const r = validatePreset(p);
      if (r.ok) custom.push(r.preset);
    }
    return { favorites: ids(o.favorites), recent: ids(o.recent).slice(0, MAX_RECENT), custom };
  } catch {
    return EMPTY_STATE;
  }
}

/** Returns false when the store refused, so the screen can say the change will not survive a restart. */
export function saveState(store: Store | null | undefined, s: PresetState): boolean {
  try {
    if (!store) return false;
    store.setItem(KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export const toggleFavorite = (s: PresetState, id: string): PresetState => ({ ...s, favorites: s.favorites.includes(id) ? s.favorites.filter((x) => x !== id) : [...s.favorites, id] });

export const markRecent = (s: PresetState, id: string): PresetState => ({ ...s, recent: [id, ...s.recent.filter((x) => x !== id)].slice(0, MAX_RECENT) });

export function addCustom(s: PresetState, presets: VoicePreset[]): PresetState {
  const have = new Set(s.custom.map((p) => p.id));
  return { ...s, custom: [...s.custom, ...presets.filter((p) => !have.has(p.id))].slice(0, MAX_CUSTOM) };
}

/** Only presets the owner made can be removed; starter presets are never deleted. */
export const removeCustom = (s: PresetState, id: string): PresetState => ({ ...s, custom: s.custom.filter((p) => p.id !== id), favorites: s.favorites.filter((x) => x !== id), recent: s.recent.filter((x) => x !== id) });
