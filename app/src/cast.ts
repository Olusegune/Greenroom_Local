import type { Character, Project, VoiceEntry } from "./types";

/** A named set of voices for named characters, kept apart from any one project so a show or series can reuse it. */
export interface SavedCast {
  id: string;
  name: string;
  createdAt: string;
  members: CastMember[];
}

export interface CastMember {
  /** The character's name as written in the script. */
  name: string;
  voiceId: string;
  /** Kept so the voice can be found again by name if its id is not in this library. */
  voiceName: string;
  provider: VoiceEntry["provider"];
  language: string;
}

const norm = (s: string) => s.trim().toLowerCase();

/** The characters that speak in the project and already have a voice in the library. */
export function castFrom(project: Pick<Project, "characters" | "lines">, library: VoiceEntry[], name: string, id: string, now: string): SavedCast {
  const speaking = new Set(project.lines.map((l) => l.characterId));
  const members: CastMember[] = [];
  for (const c of project.characters) {
    if (!speaking.has(c.id)) continue;
    const v = library.find((x) => x.id === c.voiceId);
    if (!v) continue;
    members.push({ name: c.name, voiceId: v.id, voiceName: v.name, provider: v.provider, language: c.language });
  }
  return { id, name: name.trim() || "Cast", createdAt: now, members };
}

export interface Applied {
  characters: Character[];
  /** Characters that got a voice. */
  applied: string[];
  /** In the saved cast, but nobody in this project has that name. */
  unmatched: string[];
  /** Matched by name, but the voice is no longer in the library. */
  lostVoices: string[];
  /** Speaking characters in this project the saved cast has no one for. */
  uncast: string[];
}

function findVoice(m: CastMember, library: VoiceEntry[]): VoiceEntry | undefined {
  return library.find((v) => v.id === m.voiceId) ?? library.find((v) => v.provider === m.provider && norm(v.name) === norm(m.voiceName));
}

/** Gives each project character the voice the cast has for that name. Anyone else is left as they were. */
export function applyCast(project: Pick<Project, "characters" | "lines">, cast: SavedCast, library: VoiceEntry[]): Applied {
  const applied: string[] = [];
  const lostVoices: string[] = [];
  const used = new Set<string>();
  const characters = project.characters.map((c) => {
    const m = cast.members.find((x) => norm(x.name) === norm(c.name));
    if (!m) return c;
    used.add(norm(m.name));
    const v = findVoice(m, library);
    if (!v) {
      lostVoices.push(c.name);
      return c;
    }
    applied.push(c.name);
    return { ...c, voiceId: v.id, language: m.language || c.language };
  });
  const speaking = new Set(project.lines.map((l) => l.characterId));
  return {
    characters,
    applied,
    lostVoices,
    unmatched: cast.members.filter((m) => !used.has(norm(m.name))).map((m) => m.name),
    uncast: project.characters.filter((c) => speaking.has(c.id) && !cast.members.some((m) => norm(m.name) === norm(c.name))).map((c) => c.name),
  };
}

/** One sentence saying what applying a cast did, for a toast. */
export function appliedSummary(a: Applied): string {
  const parts = [a.applied.length ? `Gave voices to ${a.applied.join(", ")}.` : "No character matched this cast."];
  if (a.lostVoices.length) parts.push(`${a.lostVoices.join(", ")}: the voice is no longer in your library.`);
  if (a.uncast.length) parts.push(`No voice in this cast for ${a.uncast.join(", ")}.`);
  return parts.join(" ");
}
