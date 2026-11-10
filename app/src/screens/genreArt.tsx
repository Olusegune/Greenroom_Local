import type React from "react";
import type { Genre } from "../presets/schema";

/** One hue per genre (degrees on the colour wheel). The tile tints itself from it, so the grid reads as twelve places, not twelve boxes. */
export const GENRE_HUE: Record<Genre, number> = { film_tv: 160, games: 265, animation: 28, education: 205, audiobooks: 18, podcasts_radio: 320, advertising: 48, faith: 188, fantasy_horror_scifi: 290, corporate: 222, international: 140, family: 350 };

const PATHS: Record<Genre, React.ReactElement> = {
  film_tv: <><rect x="3" y="9" width="18" height="11" rx="1.5" /><path d="M3 9l2.5-5 4 1-2.5 5M9.5 5l4 1-2.5 5M14 6l4 1-2 4" /></>,
  games: <><rect x="2.5" y="8" width="19" height="10" rx="5" /><path d="M7 11v4M5 13h4" /><circle cx="16" cy="12" r=".9" /><circle cx="18.2" cy="14.2" r=".9" /></>,
  animation: <><circle cx="12" cy="12" r="9" /><path d="M8 14c1 2.2 7 2.2 8 0" /><circle cx="9" cy="10" r=".9" /><circle cx="15" cy="10" r=".9" /></>,
  education: <><path d="M2 9l10-5 10 5-10 5z" /><path d="M6 11.5v4.5c3 2.5 9 2.5 12 0v-4.5" /></>,
  audiobooks: <><path d="M12 6c-2-1.5-5-2-8-1.5v13c3-.5 6 0 8 1.5 2-1.5 5-2 8-1.5v-13C17 4 14 4.5 12 6z" /><path d="M12 6v13" /></>,
  podcasts_radio: <><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0014 0M12 18v3M9 21h6" /></>,
  advertising: <><path d="M3 10v4h3l8 4V6L6 10z" /><path d="M17 9c1.5 1.2 1.5 4.8 0 6" /></>,
  faith: <><circle cx="12" cy="12" r="3.5" /><path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" /></>,
  fantasy_horror_scifi: <><path d="M20 14.5A8 8 0 019.5 4 8 8 0 1020 14.5z" /><path d="M17 3.5v3M15.5 5h3" /></>,
  corporate: <><rect x="3" y="7" width="18" height="13" rx="2" /><path d="M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2M3 13h18" /></>,
  international: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3 3 3 15 0 18M12 3c-3 3-3 15 0 18" /></>,
  family: <><path d="M3 11l9-7 9 7" /><path d="M5 10v10h14V10M10 20v-6h4v6" /></>,
};

/** A line icon for a genre. Decorative: the genre's name is always written beside it. */
export function GenreIcon({ genre, size = 22 }: { genre: Genre; size?: number }) {
  return <svg className="genre-svg" viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">{PATHS[genre]}</svg>;
}
