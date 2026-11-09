// A face for each preset, taken from the portrait library Greenroom already has. Nothing is generated and no file path is
// invented: every id comes from the library's own manifest, and a preset with a `portraitId` of its own keeps it.
//
// The rule that matters most: appearance, ethnicity, nationality, language and accent are separate things. The matcher
// therefore never sees a preset's language, accent or culture, and any word in a preset's text that the library would read
// as a heritage ("Nigerian", "British", "Filipino") is removed before matching. A face is chosen only from the preset's role,
// its age range and its stated presentation (never inferred), using the same hard rules as the rest of the app: a child
// preset gets only a child or teen face, an adult preset never does, and a stated gender is never crossed.

import { autoAvatar, readVoice, type AvatarEntry, type AvatarManifest, type VoiceAge, type VoiceMeta } from "../avatarLibrary";
import type { VoicePreset } from "./schema";

/** Words from the preset that say what the character IS (role, mood, job), with anything heritage-like taken out. */
export function presetHint(p: Pick<VoicePreset, "name" | "archetype" | "description" | "tags" | "genre">): string {
  // International starters are named after an accent. They have no role to match, so they match on age and presentation only.
  if (p.genre === "international") return "";
  return [p.name, p.archetype, p.description, ...p.tags]
    .join(" ")
    .split(/[\s,.;:()]+/)
    .filter((w) => w && readVoice("", w).h === undefined)
    .join(" ");
}

/** The age band the preset states. Always explicit when it can be, so a word like "children's" in a name cannot make an adult host look like a child. */
export function presetAge(p: Pick<VoicePreset, "ageRange">): VoiceAge | undefined {
  const a = new Set(p.ageRange);
  if (a.has("ageless") && a.size === 1) return undefined;
  const has = (...k: VoicePreset["ageRange"]) => k.some((x) => a.has(x));
  if (has("child") && !has("adult", "middle_aged", "young_adult", "older_adult", "elderly")) return "child";
  if (has("teen") && !has("adult", "middle_aged", "older_adult", "elderly")) return "teen";
  if (has("elderly", "older_adult") && !has("young_adult", "adult", "child", "teen")) return "old";
  if (has("middle_aged", "adult") && !has("young_adult")) return "mid";
  if (has("young_adult")) return "young";
  return "mid";
}

export function presetMeta(p: Pick<VoicePreset, "ageRange">): VoiceMeta | undefined {
  const age = presetAge(p);
  return age ? { age } : undefined;
}

/**
 * A portrait id for every preset, in library order. Each takes the least-used fitting face, so 120 presets show a spread of
 * faces and not the same one many times. Stable: the same presets and library always give the same faces, and adding a preset
 * at the end does not change the earlier ones.
 */
export function assignPresetFaces(manifest: AvatarManifest | null, presets: VoicePreset[]): Map<string, string> {
  const out = new Map<string, string>();
  if (!manifest) return out;
  const usage = new Map<string, number>();
  const have = new Set(manifest.avatars.map((a) => a.id));
  for (const p of presets) {
    if (p.portraitId && have.has(p.portraitId)) { out.set(p.id, p.portraitId); usage.set(p.portraitId, (usage.get(p.portraitId) ?? 0) + 1); }
  }
  for (const p of presets) {
    if (out.has(p.id)) continue;
    const gender = p.gender === "male" || p.gender === "female" ? p.gender : undefined;
    const a: AvatarEntry | null = autoAvatar(manifest, p.id, gender, presetHint(p), presetMeta(p), usage);
    if (a) { out.set(p.id, a.id); usage.set(a.id, (usage.get(a.id) ?? 0) + 1); }
  }
  return out;
}
