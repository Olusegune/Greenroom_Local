// What a voice looks like in a list. A voice has no face: nobody has said who is speaking, so Greenroom does not draw a person.
// A voice shows a small waveform mark, tinted by its engine, and its facts are written beside it. A real picture appears only when
// the owner chose one for the voice. A character's face is a separate thing (see CharacterFace), chosen by the owner or drawn
// only from what the owner stated about that character.

import type { VoiceEntry } from "./types";

const HUE: Record<string, number> = { elevenlabs: 265, inworld: 190, voicekiller: 35, kie: 330, piper: 150, kokoro: 172, qwen: 282, chatterbox: 212, wazobia: 24, local: 100 };

const hash = (s: string): number => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };

/** Nine bars whose heights come from the voice id: steady, so a voice always looks like itself, and different voices look different. Says nothing about the voice. */
export function barHeights(id: string): number[] {
  let h = hash(id);
  return Array.from({ length: 9 }, (_, i) => { h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0; const base = 0.3 + 0.7 * Math.sin(((i + 0.5) / 9) * Math.PI); return Math.round((0.35 + 0.65 * ((h % 1000) / 1000)) * base * 100) / 100; });
}

/** The neutral mark for a voice. Decorative: the voice's name is always written beside it. */
export function VoiceMark({ id, provider, size = 54 }: { id: string; provider?: string; size?: number }) {
  const hue = HUE[provider ?? ""] ?? 200;
  const bars = barHeights(id);
  const w = 54, pad = 11, gap = 2.6, bw = (w - pad * 2 - gap * 8) / 9;
  return (
    <svg className="voice-mark" role="presentation" aria-hidden="true" focusable="false" viewBox="0 0 54 54" width={size} height={size} style={{ "--vm": hue } as React.CSSProperties}>
      <circle cx="27" cy="27" r="26" className="vm-bg" />
      {bars.map((b, i) => { const hgt = Math.max(3, b * 30); return <rect key={i} x={pad + i * (bw + gap)} y={27 - hgt / 2} width={bw} height={hgt} rx={bw / 2} className="vm-bar" />; })}
    </svg>
  );
}

/** A character with no picture and nothing stated about how they look: their initials, nothing more. */
export function CharacterMark({ name, size = 44 }: { name: string; size?: number }) {
  const initials = name.trim().split(/\s+/).slice(0, 2).map((w) => w.charAt(0).toUpperCase()).join("") || "?";
  const hue = hash(name) % 360;
  return <span className="char-mark" role="presentation" aria-hidden="true" style={{ width: size, height: size, fontSize: Math.round(size * 0.38), "--cm": hue } as React.CSSProperties}>{initials}</span>;
}

/** The face of a voice in a list: the picture the OWNER chose for it, or the neutral mark. Never a guessed person. */
export function VoiceFace({ voice, id, provider, size = 54 }: { voice?: Pick<VoiceEntry, "id" | "provider" | "portrait" | "name">; id?: string; provider?: string; size?: number }) {
  const photo = voice?.portrait && voice.portrait.startsWith("data:image/") ? voice.portrait : null;
  if (photo) return <img className="avatar" src={photo} alt="" width={size} height={size} decoding="async" style={{ objectFit: "cover", borderRadius: "50%" }} />;
  return <VoiceMark id={voice?.id ?? id ?? "x"} provider={voice?.provider ?? provider} size={size} />;
}
