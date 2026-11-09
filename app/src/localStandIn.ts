import { ENGINES } from "./engines";
import type { VoiceEntry } from "./types";

/** What to match when a cloud voice is auditioned on this computer instead. Nothing here is audio: it is only what the library says about a voice. */
export interface StandInWant {
  gender?: string;
  language?: string;
  accent?: string;
  /** The voice library's age bands: child, teen, young, mid, old. */
  age?: VoiceEntry["age"];
}

const first = (s: string | undefined) => (s ?? "").trim().toLowerCase().split(/[\s,(/-]+/)[0] ?? "";

/**
 * Picks a free voice that runs on this computer to stand in for a cloud voice while auditioning.
 * It judges only the library's own notes (language, gender, age, accent). It never claims the result sounds like the cloud voice:
 * the screen has to say it is a plain-read stand-in. Returns null when there is no local voice for that language.
 */
export function pickStandIn(want: StandInWant, library: VoiceEntry[]): VoiceEntry | null {
  const lang = first(want.language);
  let best: VoiceEntry | null = null;
  let bestScore = -1;
  for (const v of library) {
    if (!ENGINES[v.provider]?.local) continue;
    // A voice in another language is not a stand-in: it would be a different audition, not a cheaper one.
    if (lang && first(v.language) && first(v.language) !== lang) continue;
    let score = 1;
    const g = (want.gender ?? "").toLowerCase();
    if (g && v.gender.toLowerCase() === g) score += 4;
    if (want.age && v.age === want.age) score += 3;
    if (want.accent && v.accent && v.accent.toLowerCase() === want.accent.toLowerCase()) score += 2;
    // A plain engine with no research-only licence note is the safer default.
    if (v.provider === "piper" || v.provider === "chatterbox") score += 0.5;
    if (score > bestScore) { best = v; bestScore = score; }
  }
  return best;
}

const AGE_BAND: Record<string, NonNullable<VoiceEntry["age"]>> = { child: "child", teen: "teen", young_adult: "young", adult: "mid", middle_aged: "mid", older_adult: "old", elderly: "old" };

/** The library's age band for a preset's first listed age, or undefined for "ageless". */
export function ageBandOf(ageRange: readonly string[]): VoiceEntry["age"] {
  for (const a of ageRange) { const b = AGE_BAND[a]; if (b) return b; }
  return undefined;
}

export function isLocalVoice(v: Pick<VoiceEntry, "provider">): boolean {
  return ENGINES[v.provider]?.local === true;
}
