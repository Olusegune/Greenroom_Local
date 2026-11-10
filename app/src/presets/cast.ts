// Using a preset on a character. A preset never changes a project by itself: the screen shows what will change and
// the owner presses Apply. Existing profile text is kept unless the owner asks to replace it.

import { isLocked } from "../casting/lock";
import { specFromPreset } from "../casting/presetSpec";
import type { KeyStatus } from "../api";
import { ENGINE_ORDER, type Engine } from "../engines";
import type { Character, VoiceEntry } from "../types";
import { emptyProfile, touch } from "../characterProfile";
import { emptyDna, migrateDna, setIdentity } from "../voiceDna";
import { compatibleEngines, type VoicePreset } from "./schema";

/** Engines that can speak now: a cloud engine with a key, or a local engine that has a voice in the library. */
export function readyEnginesFrom(keys: Pick<KeyStatus, "elevenlabs" | "voicekiller" | "inworld" | "kie">, library: Pick<VoiceEntry, "provider">[]): Engine[] {
  return ENGINE_ORDER.filter((e) => (e === "elevenlabs" ? keys.elevenlabs : e === "voicekiller" ? keys.voicekiller : e === "inworld" ? keys.inworld : e === "kie" ? keys.kie : library.some((v) => v.provider === e)));
}

/** Library voices on an engine that meets the preset's needs and is ready now. */
export function voicesFor(preset: Pick<VoicePreset, "needs">, library: VoiceEntry[], ready: Engine[]): VoiceEntry[] {
  const ok = new Set(compatibleEngines(preset).filter((e) => ready.includes(e)));
  return library.filter((v) => ok.has(v.provider));
}

export interface PresetApplication {
  character: Character;
  /** What was filled in, in plain words, for the confirmation line. */
  filled: string[];
  /** What was already there and kept. */
  kept: string[];
  /** Things the owner should know before relying on it. */
  warnings: string[];
}

const ageLook: Record<string, NonNullable<Character["look"]>["age"]> = { child: "child", teen: "teen", young_adult: "young", adult: "mid", middle_aged: "mid", older_adult: "old", elderly: "old" };

/**
 * Applies a preset to a character. With a voice, the character also gets that voice and the profile records it as the
 * approved identity. Without one, only the profile is filled in and the preset says it still needs a voice.
 */
export function applyPreset(character: Character, preset: VoicePreset, opts: { voice?: VoiceEntry; replace?: boolean; modelId?: string | null; avatarId?: string; now?: string; appVersion?: string } = {}): PresetApplication {
  const dna = migrateDna(character.dna) ?? emptyDna();
  const filled: string[] = [];
  const kept: string[] = [];
  const warnings: string[] = [];
  const put = (label: string, current: string, next: string): string => {
    if (!next) return current;
    if (current && !opts.replace) {
      kept.push(label);
      return current;
    }
    filled.push(label);
    return next;
  };
  let next = {
    ...dna,
    timbre: put("timbre", dna.timbre, `${preset.texture}; ${preset.pitch} pitch`),
    accent: put("accent", dna.accent, preset.accent.label),
    tendencies: put("tendencies", dna.tendencies, preset.acting.direction),
    range: put("emotional range", dna.range, preset.acting.emotionalRange.join(", ")),
  };
  // The lasting profile: what this preset says about the character, with where it came from. Existing text is kept unless replacing.
  const prof = next.profile ?? emptyProfile(opts.now ?? "", opts.appVersion ?? "");
  const fill = <K extends "audition" | "texture">(k: K, v: string) => (prof[k] && !opts.replace ? prof[k] : v);
  next = {
    ...next,
    profile: touch({
      ...prof,
      audition: fill("audition", preset.audition),
      texture: fill("texture", preset.texture),
      ...(!prof.pitch || opts.replace ? { pitch: preset.pitch } : {}),
      ...(preset.ageRange[0] && (!prof.ageRange || opts.replace) ? { ageRange: preset.ageRange[0] } : {}),
      ...(preset.gender && (!prof.presentation || opts.replace) ? { presentation: preset.gender } : {}),
      provenance: { ...prof.provenance, source: "preset", presetId: preset.id, presetVersion: preset.version },
    }, opts.now ?? "", opts.appVersion ?? ""),
  };
  filled.push("profile");
  const lockedVoice = isLocked(character);
  const keepsVoice = lockedVoice || (!!character.voiceId && !opts.replace);
  if (opts.voice && keepsVoice) warnings.push(lockedVoice ? `${character.name} has an approved voice, so the preset did not change it. Unlock it in Casting first if you want a different voice.` : `${character.name} already has a voice, so the preset did not change it.`);
  if (opts.voice && !keepsVoice) {
    const compat = compatibleEngines(preset);
    if (!compat.includes(opts.voice.provider)) warnings.push(`${opts.voice.name} is on an engine that cannot perform everything this preset asks for.`);
    next = setIdentity(next, opts.voice, opts.modelId ?? null);
    filled.push("voice");
    if (opts.voice.licence !== "commercial") warnings.push(`The licence of ${opts.voice.name} is ${opts.voice.licence ?? "unknown"}. Check it before commercial use.`);
    if (opts.voice.source === "cloned" && !opts.voice.consent) warnings.push(`${opts.voice.name} is a cloned voice with no consent record.`);
  }
  if (preset.accent.quality !== "native_reviewed" && preset.accent.quality !== "community_reviewed" && preset.accent.label !== "Neutral") warnings.push(`Accent "${preset.accent.label}" is ${preset.accent.quality === "experimental" ? "experimental" : "not verified"}: listen before relying on it.`);
  const look = { ...(character.look ?? {}) };
  const lookAge = preset.ageRange.length === 1 ? ageLook[preset.ageRange[0]!] : undefined;
  if (opts.avatarId && !character.avatarId) filled.push("picture");
  if (lookAge && !look.age) { look.age = lookAge; filled.push("age"); }
  if (preset.gender && !look.gender && preset.gender !== "nonbinary") { look.gender = preset.gender === "male" ? "m" : "f"; filled.push("presentation"); }
  const out: Character = {
    ...character,
    ...(opts.voice && !keepsVoice ? { voiceId: opts.voice.id } : {}),
    // What the preset says about the character becomes the casting requirement, but only where the owner has not set one.
    ...(character.cast ? {} : { cast: specFromPreset(preset) }),
    // The picture is separate from the voice: a character that already has one keeps it.
    ...(opts.avatarId && !character.avatarId ? { avatarId: opts.avatarId } : {}),
    language: !character.language || character.language === "English" ? preset.language : character.language,
    ...(Object.keys(look).length ? { look } : {}),
    dna: { ...next, presets: next.presets },
  };
  return { character: out, filled, kept, warnings };
}
