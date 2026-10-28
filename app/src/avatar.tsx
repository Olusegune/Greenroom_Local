// Stylised portraits for voices and characters. They are drawn from a seed (the voice's id and name), so the same voice
// always has the same face, and they are illustrations: not photographs, and not meant to look like anyone real.

const SKIN = ["#f3d2b3", "#e6b98f", "#cf9a6b", "#b57a4e", "#8d5a38", "#6b4229", "#4a2d1c", "#f6dcc4"];
const HAIR = ["#1b1410", "#2c1d14", "#4a2f1e", "#7a4a2a", "#a8742f", "#c9a063", "#8b8b92", "#d9d4c8", "#3a1f4d", "#12384a"];
const BG: [string, string][] = [
  ["#1d6b4a", "#0e2b21"],
  ["#2f5f8a", "#102236"],
  ["#7a4a8f", "#25152e"],
  ["#a0632f", "#2e1a0c"],
  ["#2a7f86", "#0c2a2e"],
  ["#8a3f55", "#2e1019"],
  ["#5e7f2f", "#1a260c"],
  ["#4b52a8", "#14163a"],
];

/** A small, stable hash so one seed always draws one face. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type Look = "feminine" | "masculine" | "neutral";

export function lookFor(gender?: string): Look {
  const g = (gender ?? "").toLowerCase();
  return g.startsWith("f") || g === "woman" ? "feminine" : g.startsWith("m") || g === "man" ? "masculine" : "neutral";
}

/** The choices a seed makes, kept apart from drawing so they can be tested. */
export function traits(seed: string, look: Look = "neutral") {
  const h = hash(seed);
  const pick = (n: number, shift: number) => (h >>> shift) % n;
  const longHair = look === "feminine" ? pick(10, 3) < 7 : look === "masculine" ? pick(10, 3) < 1 : pick(10, 3) < 4;
  const styles = longHair ? ["long", "bob", "bun", "curls", "wrap"] : ["short", "crop", "curls", "cap", "bald"];
  return {
    bg: BG[pick(BG.length, 0)]!,
    skin: SKIN[pick(SKIN.length, 5)]!,
    hair: HAIR[pick(HAIR.length, 9)]!,
    style: styles[pick(styles.length, 13)]!,
    glasses: pick(7, 17) === 0,
    beard: look === "masculine" ? pick(4, 20) === 0 : look === "neutral" ? pick(9, 20) === 0 : false,
    shirt: ["#e9edf0", "#2d3a46", "#c4553b", "#3b7bd4", "#2f9e6e", "#d8a73a"][pick(6, 23)]!,
    tilt: pick(5, 26) - 2,
  };
}

function Hair({ style, color }: { style: string; color: string }) {
  switch (style) {
    case "long":
      return (
        <>
          <path d="M24 52 C18 24 34 12 48 12 C62 12 78 24 72 52 L72 72 L62 72 L62 44 L34 44 L34 72 L24 72 Z" fill={color} />
        </>
      );
    case "bob":
      return <path d="M25 50 C20 24 34 13 48 13 C62 13 76 24 71 50 L66 56 L66 42 L30 42 L30 56 Z" fill={color} />;
    case "bun":
      return (
        <>
          <circle cx="48" cy="10" r="8" fill={color} />
          <path d="M27 44 C26 24 36 17 48 17 C60 17 70 24 69 44 L64 38 C56 33 40 33 32 38 Z" fill={color} />
        </>
      );
    case "curls":
      return (
        <>
          {[28, 36, 44, 52, 60, 68].map((x, i) => (
            <circle key={x} cx={x} cy={i % 2 ? 22 : 26} r="9" fill={color} />
          ))}
          <path d="M26 40 C28 26 68 26 70 40 L64 36 C56 31 40 31 32 36 Z" fill={color} />
        </>
      );
    case "wrap":
      return (
        <>
          <path d="M26 40 C26 20 38 12 48 12 C58 12 70 20 70 40 C60 31 36 31 26 40 Z" fill={color} />
          <path d="M28 34 C40 28 58 28 68 34" stroke="#ffffff" strokeOpacity="0.35" strokeWidth="2" fill="none" />
        </>
      );
    case "crop":
      return <path d="M28 42 C28 24 38 19 48 19 C58 19 68 24 68 42 C62 33 34 33 28 42 Z" fill={color} />;
    case "cap":
      return (
        <>
          <path d="M26 40 C26 22 38 16 48 16 C58 16 70 22 70 40 Z" fill={color} />
          <rect x="24" y="38" width="48" height="5" rx="2.5" fill={color} />
        </>
      );
    case "bald":
      return null;
    default:
      return <path d="M27 44 C26 22 38 16 48 16 C58 16 70 22 69 44 C64 33 32 33 27 44 Z" fill={color} />;
  }
}

/** A round illustrated portrait. `size` is in pixels. */
export function Avatar({ seed, gender, size = 64, label }: { seed: string; gender?: string; size?: number; label?: string }) {
  const t = traits(seed, lookFor(gender));
  const id = "av" + hash(seed).toString(36);
  const behind = t.style === "long" || t.style === "bob";
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 96 96" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={t.bg[0]} />
          <stop offset="1" stopColor={t.bg[1]} />
        </linearGradient>
        <clipPath id={id + "c"}>
          <circle cx="48" cy="48" r="48" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="96" height="96" fill={`url(#${id})`} />
        <circle cx="76" cy="20" r="26" fill="#ffffff" fillOpacity="0.07" />
        <g transform={`rotate(${t.tilt} 48 60)`}>
          <path d="M10 100 C12 78 28 70 48 70 C68 70 84 78 86 100 Z" fill={t.shirt} />
          <rect x="41" y="56" width="14" height="18" rx="6" fill={t.skin} />
          <path d="M41 66 C44 72 52 72 55 66 L55 70 C52 75 44 75 41 70 Z" fill="#000" fillOpacity="0.12" />
          {behind && <Hair style={t.style} color={t.hair} />}
          <ellipse cx="48" cy="44" rx="18" ry="21" fill={t.skin} />
          <ellipse cx="30" cy="46" rx="3" ry="5" fill={t.skin} />
          <ellipse cx="66" cy="46" rx="3" ry="5" fill={t.skin} />
          {t.beard && <path d="M31 48 C32 66 64 66 65 48 C60 58 36 58 31 48 Z" fill={t.hair} fillOpacity="0.92" />}
          {!behind && <Hair style={t.style} color={t.hair} />}
          {behind && <path d="M30 40 C36 28 60 28 66 40 C58 34 38 34 30 40 Z" fill={t.hair} />}
          <ellipse cx="41" cy="46" rx="2.1" ry="2.6" fill="#1b1410" />
          <ellipse cx="55" cy="46" rx="2.1" ry="2.6" fill="#1b1410" />
          <path d="M42 56 C46 60 50 60 54 56" stroke="#1b1410" strokeOpacity="0.7" strokeWidth="2" strokeLinecap="round" fill="none" />
          {t.glasses && (
            <g stroke="#e9edf0" strokeWidth="1.8" fill="none" strokeOpacity="0.9">
              <circle cx="41" cy="46" r="6" />
              <circle cx="55" cy="46" r="6" />
              <path d="M47 46 H49" />
            </g>
          )}
        </g>
      </g>
    </svg>
  );
}

/** Abstract cover art for a project: a gradient and a waveform drawn from its name. Not tied to any content. */
export function Cover({ seed, size = 56 }: { seed: string; size?: number }) {
  const h = hash(seed);
  const [a, b] = BG[h % BG.length]!;
  const bars = Array.from({ length: 9 }, (_, i) => 0.25 + (((h >>> (i * 3)) & 7) / 7) * 0.75);
  const id = "cv" + h.toString(36);
  return (
    <svg className="cover" width={size} height={size} viewBox="0 0 56 56" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={a} />
          <stop offset="1" stopColor={b} />
        </linearGradient>
      </defs>
      <rect width="56" height="56" rx="14" fill={`url(#${id})`} />
      {bars.map((v, i) => (
        <rect key={i} x={7 + i * 5} y={28 - v * 17} width="3" height={v * 34} rx="1.5" fill="#fff" fillOpacity={0.55 + v * 0.35} />
      ))}
    </svg>
  );
}
