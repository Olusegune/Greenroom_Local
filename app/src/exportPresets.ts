import type { ExportCfg } from "./types";

/** One-click export settings for a destination. Loudness numbers are the commonly published targets as of 2026-11-02;
 *  platforms change them, so each preset carries a note and the person should check the destination's current spec. */
export interface ExportPreset {
  id: string;
  label: string;
  note: string;
  set: Partial<Pick<ExportCfg, "rate" | "bits" | "target" | "ceiling" | "whole" | "scenes" | "lines" | "stems" | "markersInWav" | "cueSheet" | "otio" | "edl" | "report">>;
}

export const EXPORT_PRESETS: ExportPreset[] = [
  { id: "podcast", label: "Podcast", note: "-16 LUFS, 44.1 kHz, 24-bit. The usual podcast target. Apple and Spotify may re-level it.", set: { rate: 44100, bits: 24, target: "web", ceiling: -1, whole: true } },
  { id: "youtube", label: "YouTube and social", note: "-14 LUFS, 48 kHz, 24-bit. YouTube turns louder audio down toward about -14.", set: { rate: 48000, bits: 24, target: "stream", ceiling: -1, whole: true } },
  { id: "audiobook", label: "Audiobook", note: "-20 LUFS, -3 dBTP, 44.1 kHz. A starting point only: ACX measures RMS and noise floor, not LUFS, so run ACX's own checker before submitting.", set: { rate: 44100, bits: 16, target: "audiobook", ceiling: -3, whole: true, scenes: true } },
  { id: "tv", label: "Broadcast TV (EU)", note: "-23 LUFS (EBU R128), -1 dBTP, 48 kHz, 24-bit.", set: { rate: 48000, bits: 24, target: "r128", ceiling: -1, whole: true, stems: true } },
  { id: "film", label: "Film and US TV dialogue", note: "-24 LKFS (ATSC A/85), -2 dBTP, 48 kHz, 24-bit, with stems and cut lists.", set: { rate: 48000, bits: 24, target: "atsc", ceiling: -2, whole: true, stems: true, otio: true, edl: true, cueSheet: true } },
  { id: "editor", label: "Hand to an editor", note: "48 kHz, 24-bit, level left as mixed, with every line, stems, markers, OTIO and EDL.", set: { rate: 48000, bits: 24, target: "off", whole: true, lines: true, stems: true, markersInWav: true, otio: true, edl: true, cueSheet: true } },
  { id: "training", label: "Training and e-learning", note: "-16 LUFS, 44.1 kHz, 16-bit, one file per scene so each module can be placed on its own. A starting point: check your course platform's audio spec.", set: { rate: 44100, bits: 16, target: "web", ceiling: -1, whole: true, scenes: true } },
  { id: "game", label: "Game audio", note: "-16 LUFS, 48 kHz, 24-bit, every line as its own file.", set: { rate: 48000, bits: 24, target: "web", ceiling: -1, lines: true } },
];

export function applyPreset(cfg: ExportCfg, preset: ExportPreset): ExportCfg {
  return { ...cfg, ...preset.set };
}

/** The preset whose loudness and format settings match the current choice, if any. */
export function matchingPreset(cfg: ExportCfg): ExportPreset | undefined {
  return EXPORT_PRESETS.find((p) => (["rate", "bits", "target", "ceiling"] as const).every((k) => p.set[k] === undefined || p.set[k] === cfg[k]));
}

/** Words that name a destination, in the order they are tried. The first match wins, so "podcast" is read before "show". */
const WORDS: [string, RegExp][] = [
  ["audiobook", /\baudio ?books?\b|\bnarrat(?:ed|ion) (?:book|novel)\b/],
  ["podcast", /\bpodcasts?\b/],
  ["training", /\be-?learning\b|\btraining\b|\bcourses?\b|\blessons?\b|\bexplainer\b/],
  ["game", /\bgames?\b|\bunity\b|\bunreal\b|\bwwise\b|\bfmod\b/],
  ["film", /\bfilm\b|\bmovie\b|\bcinema\b|\batsc\b/],
  ["tv", /\bbroadcast\b|\btelevision\b|\btv\b|\br128\b/],
  ["editor", /\b(?:hand|send|give)\b.*\b(?:editor|mix engineer|sound designer)\b|\bto (?:an? )?editor\b/],
  ["youtube", /\byoutube\b|\bsocial\b|\btiktok\b|\binstagram\b|\bvideo\b|\bonline\b/],
];

/** The export preset an instruction asks for ("export this as a podcast"), or null when none is named. */
export function presetFromWords(text: string): ExportPreset | null {
  const t = text.toLowerCase();
  for (const [id, re] of WORDS) if (re.test(t)) return EXPORT_PRESETS.find((p) => p.id === id) ?? null;
  return null;
}

/** "with stems", "separate tracks for each character": the instruction asks for one file per character. */
export const asksForStems = (text: string): boolean => /\bstems?\b|\bseparate (?:tracks?|files?)\b|\bone (?:track|file) (?:per|for each) (?:character|speaker|voice)\b|\beach character (?:on )?(?:its|their|a) own (?:track|file)\b/i.test(text);
