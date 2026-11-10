// Do a character's takes sound like ONE speaker? Each take is turned into a speaker vector (runtime/speaker_embed.py, Resemblyzer) and
// compared by cosine similarity. This measures similarity of voices, nothing else: it does not judge acting, it does not say a voice
// is right for a character, and it is not a statement about anyone's age, gender or ethnicity.
//
// The two thresholds were measured on this PC (2026-11-10) with real audio, six different lines per voice:
//   same voice, different lines : Piper 0.70-0.94 (mean 0.83), Kokoro 0.81-0.94 (mean 0.87)
//   different voices            : Piper 0.26-0.72 (mean 0.48), Kokoro 0.37-0.65 (mean 0.49)
// See docs/QWEN_STABILITY.md for the Qwen3-TTS numbers and how the thresholds were chosen.

export const SAME_SPEAKER_AT = 0.75;
export const LIKELY_DIFFERENT_BELOW = 0.65;

export type Verdict = "consistent" | "check" | "different";

export function cosine(a: ArrayLike<number>, b: ArrayLike<number>): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! * a[i]!; nb += b[i]! * b[i]!; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

export const verdictOf = (similarity: number): Verdict => (similarity >= SAME_SPEAKER_AT ? "consistent" : similarity >= LIKELY_DIFFERENT_BELOW ? "check" : "different");

export interface TakeVector { takeId: string; lineId: string; embedding: number[] }

export interface TakeConsistency { takeId: string; lineId: string; /** How alike this take is to the character's other takes: the upper median of its similarities, so one odd take does not make the others look odd. */ similarity: number; verdict: Verdict }

export interface ConsistencyReport {
  takes: TakeConsistency[];
  /** Mean of all pairs, or null when there is only one take. */
  meanPair: number | null;
  minPair: number | null;
  verdict: Verdict | "not_enough";
  /** One honest sentence. */
  note: string;
}

const WORSE: Record<Verdict, number> = { consistent: 0, check: 1, different: 2 };

/** The consistency of one character's takes. Needs two or more takes; with one there is nothing to compare. */
export function consistencyOf(vectors: TakeVector[]): ConsistencyReport {
  const v = vectors.filter((x) => x.embedding.length > 0);
  if (v.length < 2) return { takes: [], meanPair: null, minPair: null, verdict: "not_enough", note: "Needs at least two takes of this character to compare." };
  const pairs: number[] = [];
  const sims: number[][] = v.map(() => v.map(() => 1));
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) { const s = cosine(v[i]!.embedding, v[j]!.embedding); sims[i]![j] = s; sims[j]![i] = s; pairs.push(s); }
  const takes: TakeConsistency[] = v.map((t, i) => {
    const others = sims[i]!.filter((_, j) => j !== i).sort((a, b) => a - b);
    // The upper median: with one odd take among the rest, the others still match most of what they are compared with and are not blamed;
    // the odd one matches none of them and is flagged. A character split into two voices flags every take.
    const typical = others[Math.floor(others.length / 2)]!;
    return { takeId: t.takeId, lineId: t.lineId, similarity: Math.round(typical * 1000) / 1000, verdict: verdictOf(typical) };
  });
  const worst = takes.reduce<Verdict>((w, t) => (WORSE[t.verdict] > WORSE[w] ? t.verdict : w), "consistent");
  const meanPair = pairs.reduce((a, b) => a + b, 0) / pairs.length;
  const odd = takes.filter((t) => t.verdict !== "consistent").length;
  const note = worst === "consistent" ? `These ${v.length} takes measure as one speaker (similarity ${meanPair.toFixed(2)}). Whether it is the voice you want is for your ears.`
    : worst === "check" ? `${odd} of ${v.length} takes are less alike than usual for one voice. Listen to the flagged takes.`
      : `${odd} of ${v.length} takes measure as a different voice from the rest. Listen to them: the voice may have drifted.`;
  return { takes, meanPair: Math.round(meanPair * 1000) / 1000, minPair: Math.round(Math.min(...pairs) * 1000) / 1000, verdict: worst, note };
}
