import { ANIMATION, EDUCATION, FILM_TV, GAMES } from "./dataA";
import { ADVERTISING, AUDIOBOOKS, FAITH, PODCASTS } from "./dataB";
import { CORPORATE, FAMILY, FANTASY, INTERNATIONAL } from "./dataC";
import type { VoicePreset } from "./schema";

export * from "./schema";

/** The 120 starter presets, in genre order. Pure data: no audio and no model weights ship with them. */
export const STARTER_PRESETS: VoicePreset[] = [...FILM_TV, ...GAMES, ...ANIMATION, ...EDUCATION, ...AUDIOBOOKS, ...PODCASTS, ...ADVERTISING, ...FAITH, ...FANTASY, ...CORPORATE, ...INTERNATIONAL, ...FAMILY];

/** What each genre must contain, so a missing or extra preset is caught by a test. */
export const EXPECTED_COUNTS = { film_tv: 16, games: 14, animation: 14, education: 10, audiobooks: 10, podcasts_radio: 10, advertising: 8, faith: 8, fantasy_horror_scifi: 10, corporate: 6, international: 8, family: 6 } as const;
