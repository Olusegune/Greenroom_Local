// A face for each preset, taken from the portrait library Greenroom already has. Nothing is generated and no file path is
// invented: every id comes from the library's own manifest, and a preset with a `portraitId` of its own keeps it.
//
// The rule that matters most: appearance, ethnicity, nationality, language and accent are separate things. The matcher
// therefore never sees a preset's language, accent or culture, and any word in a preset's text that the library would read
// as a heritage ("Nigerian", "British", "Filipino") is removed before matching. A face is chosen only from the preset's role,
// its age range and its stated presentation (never inferred), using the same hard rules as the rest of the app: a child
// preset gets only a child or teen face, an adult preset never does, and a stated gender is never crossed.

import { LOOKS, readVoice, type AvatarManifest, type Heritage, type VoiceAge, type VoiceMeta } from "../avatarLibrary";
import { matchFaces, pickFace, type FaceWant } from "../avatarMatch";
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
 * What an author has said these presets LOOK like, when the preset is about a particular people. It is a written statement on the
 * preset, shown and editable like any other field; nothing is read from an accent, a name or a language at run time. A preset that
 * states a culture but has no entry here gets no face at all: a neutral mark is better than a guess.
 */
export const PRESET_APPEARANCE: Record<string, Heritage> = {
  "international.yoruba-english": "black",
  "international.igbo-english": "black",
  "international.hausa-english": "black",
  "international.nigerian-pidgin": "black",
  "international.filipino-english": "east_asian",
  "international.indian-english": "south_asian",
};

/** Why a preset has the face it has, or why it has none. For the preset card and for the audit. */
export function presetFaceFacts(p: Pick<VoicePreset, "id" | "gender" | "ageRange" | "culture">): { want: FaceWant; blocked?: string } {
  const gender = p.gender === "male" ? "m" : p.gender === "female" ? "f" : undefined;
  const heritage = PRESET_APPEARANCE[p.id];
  const want: FaceWant = { ...(gender ? { gender } : {}), ...(presetAge(p) ? { age: presetAge(p)! } : {}), ...(heritage ? { heritage } : {}) };
  if (p.culture && !heritage) return { want, blocked: "This preset states a culture but not how the character looks, so no face is guessed." };
  return { want };
}

/**
 * A portrait id for the presets that STATE enough to choose one, in library order. A preset with no stated gender gets no face (the card
 * shows a neutral mark), and a stated gender, age band for a child or teen, and heritage are never given up to find a face. Each takes
 * the least-used fitting face, so the faces spread. Stable: the same presets and library always give the same faces, and adding a preset
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
    // A role the preset names outright (an android, a dragon, a pharaoh) has its own portrait; a stated gender still has to agree.
    const gender = p.gender === "male" || p.gender === "female" ? p.gender : undefined;
    const story = readVoice(gender, presetHint(p)).story;
    if (story) {
      const roleFaces = manifest.avatars.filter((a) => story.includes(a.id) && (!gender || LOOKS[a.id]?.g === "n" || LOOKS[a.id]?.g === (gender === "male" ? "m" : "f")));
      const r = roleFaces.length ? pickFace({ faces: roleFaces.map((entry) => ({ entry, ageExact: true })), used: [] }, p.id, usage) : null;
      if (r) { out.set(p.id, r.id); usage.set(r.id, (usage.get(r.id) ?? 0) + 1); continue; }
    }
    const { want, blocked } = presetFaceFacts(p);
    if (blocked) continue;
    const a = pickFace(matchFaces(manifest, want), p.id, usage);
    if (a) { out.set(p.id, a.id); usage.set(a.id, (usage.get(a.id) ?? 0) + 1); }
  }
  return out;
}
