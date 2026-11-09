import { autoAvatar } from "./avatarLibrary";
import { useAvatars } from "./avatarState";
import { hintFor, portraitFor } from "./portrait";

// Cute clay-style 3D portraits for voices and characters. They are drawn from a seed (the voice's id and name), so the same
// voice always has the same face. They are original illustrations made of shaded shapes: not photographs, and not meant to
// look like anyone real.

const SKIN = ["#f6d3b8", "#eebb93", "#d9a074", "#bf8157", "#9a6140", "#74482f", "#523222", "#f8dfca"];
const HAIR = ["#2a1d17", "#3d281b", "#5b3a24", "#8a5a31", "#b9853c", "#d6b072", "#9a9aa3", "#e3ded2", "#5a3a78", "#1f5670"];
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
    shirt: ["#f1f4f6", "#3a4b5c", "#e0694b", "#4a8be0", "#38b07f", "#e8b445"][pick(6, 23)]!,
    tilt: pick(5, 26) - 2,
  };
}

/** Blend a #rrggbb colour toward another by t (0 to 1). Used to build soft highlights and shadows. */
export function mix(a: string, b: string, t: number): string {
  const n = (s: string, i: number) => parseInt(s.slice(1 + i * 2, 3 + i * 2), 16);
  const c = (i: number) => Math.round(n(a, i) + (n(b, i) - n(a, i)) * t).toString(16).padStart(2, "0");
  return `#${c(0)}${c(1)}${c(2)}`;
}

/** Hair drawn behind the head (long styles) and in front of it. `f` is the fill, a shaded gradient. */
function HairBack({ style, f }: { style: string; f: string }) {
  switch (style) {
    case "long":
      return <path d="M20 50 C14 20 34 11 48 11 C62 11 82 20 76 50 L79 78 C70 85 62 80 62 72 L34 72 C34 80 26 85 17 78 Z" fill={f} />;
    case "bob":
      return <path d="M19 52 C14 22 34 11 48 11 C62 11 82 22 77 52 L74 65 C70 69 66 65 66 58 L30 58 C30 65 26 69 22 65 Z" fill={f} />;
    case "bun":
      return <circle cx="48" cy="12" r="9.5" fill={f} />;
    default:
      return null;
  }
}

function HairFront({ style, f, band }: { style: string; f: string; band: string }) {
  switch (style) {
    case "long":
    case "bob":
      return <path d="M22 47 C25 27 71 27 74 47 C65 36 31 36 22 47 Z" fill={f} />;
    case "bun":
      return <path d="M22 46 C22 26 36 17 48 17 C60 17 74 26 74 46 C66 36 30 36 22 46 Z" fill={f} />;
    case "curls":
      return (
        <>
          {[24, 33, 42, 51, 60, 69].map((x, i) => (
            <circle key={x} cx={x + (i % 2 ? 1 : -1)} cy={i % 2 ? 29 : 33} r="9.5" fill={f} />
          ))}
          <path d="M22 46 C24 34 72 34 74 46 C66 38 30 38 22 46 Z" fill={f} />
        </>
      );
    case "wrap":
      return (
        <>
          <path d="M21 46 C20 22 36 13 48 13 C60 13 76 22 75 46 C64 34 32 34 21 46 Z" fill={f} />
          <path d="M24 35 C38 27 58 27 72 35" stroke={band} strokeWidth="3.2" strokeLinecap="round" fill="none" />
        </>
      );
    case "crop":
      return <path d="M22 46 C21 26 35 18 48 18 C61 18 75 26 74 46 C68 35 28 35 22 46 Z" fill={f} />;
    case "cap":
      return (
        <>
          <path d="M21 44 C21 21 35 15 48 15 C61 15 75 21 75 44 Z" fill={f} />
          <rect x="17" y="41" width="62" height="6.5" rx="3.2" fill={f} />
          <rect x="17" y="41" width="62" height="2" rx="1" fill="#fff" fillOpacity="0.25" />
        </>
      );
    case "bald":
      return null;
    default:
      return <path d="M21 48 C19 24 34 15 48 15 C62 15 77 24 75 48 C70 36 60 30 48 30 C36 30 26 36 21 48 Z" fill={f} />;
  }
}

/** A round, soft 3D-style portrait. `size` is in pixels. */
export function Avatar({ seed, gender, size = 64, label, hint }: { seed: string; gender?: string; size?: number; label?: string; hint?: string }) {
  const photo = portraitFor(seed);
  const { manifest } = useAvatars();
  if (photo) return <img className="avatar" src={photo} alt={label ?? ""} width={size} height={size} style={{ objectFit: "cover", borderRadius: "50%" }} />;
  // No chosen picture: a steady built-in portrait (never saved; choosing an avatar replaces it). The drawn face is only the
  // fallback while the library has not loaded or cannot be read.
  const auto = autoAvatar(manifest, seed, gender, [hintFor(seed), hint].filter(Boolean).join(" "));
  if (auto) {
    const p = size >= 96 ? auto.assets.card ?? auto.assets.card_small : size >= 48 ? auto.assets.card_small : auto.assets.thumbnail;
    return <img className="avatar" src={`./avatars/${p}`} alt={label ?? ""} width={size} height={size} decoding="async" loading="lazy" style={{ objectFit: "cover", borderRadius: "50%" }} />;
  }
  const t = traits(seed, lookFor(gender));
  const id = "av" + hash(seed).toString(36);
  const behind = t.style === "long" || t.style === "bob" || t.style === "bun";
  const skinHi = mix(t.skin, "#ffffff", 0.35);
  const skinLo = mix(t.skin, "#4a1f10", 0.28);
  const hairHi = mix(t.hair, "#ffffff", 0.3);
  const hairLo = mix(t.hair, "#000000", 0.3);
  const shirtHi = mix(t.shirt, "#ffffff", 0.3);
  const shirtLo = mix(t.shirt, "#000000", 0.25);
  const bgHi = mix(t.bg[0], "#ffffff", 0.45);
  const bgLo = mix(t.bg[0], "#ffffff", 0.12);
  const radial = (name: string, hi: string, mid: string, lo: string, cx = 0.35, cy = 0.28) => (
    <radialGradient id={`${id}${name}`} cx={cx} cy={cy} r="0.85">
      <stop offset="0" stopColor={hi} />
      <stop offset="0.55" stopColor={mid} />
      <stop offset="1" stopColor={lo} />
    </radialGradient>
  );
  const dark = "#2b1c18";
  return (
    <svg className="avatar" width={size} height={size} viewBox="0 0 96 96" role={label ? "img" : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      <defs>
        <radialGradient id={id} cx="0.3" cy="0.2" r="1">
          <stop offset="0" stopColor={bgHi} />
          <stop offset="1" stopColor={bgLo} />
        </radialGradient>
        {radial("s", skinHi, t.skin, skinLo)}
        {radial("h", hairHi, t.hair, hairLo, 0.4, 0.15)}
        {radial("t", shirtHi, t.shirt, shirtLo)}
        <clipPath id={id + "c"}>
          <circle cx="48" cy="48" r="48" />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}c)`}>
        <rect width="96" height="96" fill={`url(#${id})`} />
        <circle cx="78" cy="16" r="24" fill="#ffffff" fillOpacity="0.16" />
        <g transform={`rotate(${t.tilt} 48 70)`}>
          <ellipse cx="48" cy="90" rx="30" ry="5" fill="#000" fillOpacity="0.14" />
          {/* body: a soft, rounded torso */}
          <path d="M18 100 C16 80 28 71 48 71 C68 71 80 80 78 100 Z" fill={`url(#${id}t)`} />
          <rect x="40" y="62" width="16" height="14" rx="7" fill={t.skin} />
          <path d="M40 70 C44 77 52 77 56 70 L56 74 C52 80 44 80 40 74 Z" fill={skinLo} fillOpacity="0.45" />
          {behind && <HairBack style={t.style} f={`url(#${id}h)`} />}
          <circle cx="22.5" cy="53" r="6" fill={`url(#${id}s)`} />
          <circle cx="73.5" cy="53" r="6" fill={`url(#${id}s)`} />
          {/* head: big and round, lit from the top left */}
          <ellipse cx="48" cy="49" rx="27" ry="25" fill={`url(#${id}s)`} />
          {t.beard && <path d="M22 54 C23 80 73 80 74 54 C69 67 27 67 22 54 Z" fill={`url(#${id}h)`} />}
          <HairFront style={t.style} f={`url(#${id}h)`} band={t.shirt} />
          {/* face */}
          <ellipse cx="30.5" cy="60" rx="5.2" ry="3.4" fill="#ff7f8f" fillOpacity="0.38" />
          <ellipse cx="65.5" cy="60" rx="5.2" ry="3.4" fill="#ff7f8f" fillOpacity="0.38" />
          <ellipse cx="48" cy="57" rx="1.8" ry="1.2" fill={skinLo} fillOpacity="0.55" />
          <ellipse cx="38" cy="52" rx="3.6" ry="4.5" fill={dark} />
          <ellipse cx="58" cy="52" rx="3.6" ry="4.5" fill={dark} />
          <circle cx="36.8" cy="50.2" r="1.5" fill="#fff" />
          <circle cx="56.8" cy="50.2" r="1.5" fill="#fff" />
          <circle cx="39.2" cy="54" r="0.75" fill="#fff" fillOpacity="0.8" />
          <circle cx="59.2" cy="54" r="0.75" fill="#fff" fillOpacity="0.8" />
          <path d="M42.5 62 C45.5 66 50.5 66 53.5 62" stroke={t.beard ? mix(t.hair, "#ffffff", 0.55) : dark} strokeWidth="2" strokeLinecap="round" fill="none" />
          {t.glasses && (
            <g stroke="#34424f" strokeWidth="1.9" fill="#ffffff" fillOpacity="0.12">
              <circle cx="38" cy="52" r="7.8" />
              <circle cx="58" cy="52" r="7.8" />
              <path d="M45.8 51.5 H50.2" fill="none" />
            </g>
          )}
          {/* gloss */}
          <ellipse cx="36" cy="34" rx="9" ry="4.2" transform="rotate(-24 36 34)" fill="#fff" fillOpacity={t.style === "bald" ? 0.28 : 0.14} />
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
