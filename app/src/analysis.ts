// Measuring a finished take: how fast it is spoken, where it pauses, how loud and how lively, and roughly where its pitch
// sits. All of this is an ESTIMATE from the waveform. It is used to carry an approved performance over to other lines
// as guidance. It cannot copy a delivery or a voice, and different models will not reproduce it exactly.

export interface TakeStats {
  seconds: number;
  /** Time with speech in it, from the first to the last voiced moment. */
  speechSeconds: number;
  words: number;
  wordsPerSecond: number;
  /** Silence at the start and end, in seconds. */
  leadSilence: number;
  trailSilence: number;
  /** Pauses inside the speech of at least 150 ms, in milliseconds. */
  pausesMs: number[];
  /** Average level of the speech, in dB below full scale. */
  levelDb: number;
  /** How much the level moves while speaking (standard deviation in dB). A flat read is low, an animated one higher. */
  liveliness: number;
  /** Median pitch of voiced frames, when it could be measured. */
  pitchHz: number | null;
  /** Median pitch over eight equal parts of the speech, null where no voice was found. */
  pitchContour: (number | null)[];
  /** Highest minus lowest part of the contour, in semitones, when at least two parts were measured. */
  pitchRangeSemitones: number | null;
}

const WIN = 0.02;
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};

/** Pitch of one frame by autocorrelation between 70 and 400 Hz. Null when the frame is not clearly voiced. */
function framePitch(x: Float32Array, start: number, len: number, rate: number): number | null {
  const lo = Math.floor(rate / 400);
  const hi = Math.min(Math.floor(rate / 70), len - 1);
  let e0 = 0;
  for (let i = 0; i < len; i++) e0 += x[start + i]! * x[start + i]!;
  if (e0 < 1e-6 || hi <= lo) return null;
  let best = 0;
  let bestLag = 0;
  for (let lag = lo; lag <= hi; lag++) {
    let c = 0;
    let e1 = 0;
    for (let i = 0; i + lag < len; i++) {
      c += x[start + i]! * x[start + i + lag]!;
      e1 += x[start + i + lag]! * x[start + i + lag]!;
    }
    const r = c / Math.sqrt(e0 * Math.max(e1, 1e-9));
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  return best > 0.6 && bestLag > 0 ? rate / bestLag : null;
}

export function analyzeSamples(x: Float32Array, rate: number, words: number): TakeStats {
  const seconds = x.length / rate;
  const n = Math.max(1, Math.floor(rate * WIN));
  const frames = Math.floor(x.length / n);
  const rms: number[] = [];
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += x[f * n + i]! * x[f * n + i]!;
    rms.push(Math.sqrt(s / n));
  }
  const peak = Math.max(0, ...rms);
  const floor = peak * Math.pow(10, -35 / 20);
  const voiced = rms.map((r) => r > floor && r > 1e-4);
  const first = voiced.indexOf(true);
  const last = voiced.lastIndexOf(true);
  if (first < 0) {
    return { seconds, speechSeconds: 0, words, wordsPerSecond: 0, leadSilence: seconds, trailSilence: 0, pausesMs: [], levelDb: -120, liveliness: 0, pitchHz: null, pitchContour: Array(8).fill(null), pitchRangeSemitones: null };
  }
  const speechFrames = last - first + 1;
  const speechSeconds = speechFrames * WIN;
  // Pauses: runs of silent frames between the first and last voiced frame.
  const pausesMs: number[] = [];
  let run = 0;
  for (let f = first; f <= last; f++) {
    if (!voiced[f]) run++;
    else {
      if (run * WIN * 1000 >= 150) pausesMs.push(Math.round(run * WIN * 1000));
      run = 0;
    }
  }
  const levels = rms.slice(first, last + 1).filter((_, i) => voiced[first + i]).map(db);
  const mean = levels.reduce((a, b) => a + b, 0) / Math.max(1, levels.length);
  const sd = Math.sqrt(levels.reduce((a, b) => a + (b - mean) * (b - mean), 0) / Math.max(1, levels.length));

  const pitchLen = Math.floor(rate * 0.04);
  const perSlice: number[][] = Array.from({ length: 8 }, () => []);
  const all: number[] = [];
  for (let f = first; f <= last; f++) {
    if (!voiced[f]) continue;
    const start = f * n;
    if (start + pitchLen > x.length) break;
    const p = framePitch(x, start, pitchLen, rate);
    if (p) {
      all.push(p);
      perSlice[Math.min(7, Math.floor(((f - first) / speechFrames) * 8))]!.push(p);
    }
  }
  const contour = perSlice.map((s) => median(s));
  const known = contour.filter((v): v is number => v !== null);
  return {
    seconds,
    speechSeconds,
    words,
    wordsPerSecond: words > 0 && speechSeconds > 0 ? Number((words / speechSeconds).toFixed(2)) : 0,
    leadSilence: Number((first * WIN).toFixed(2)),
    trailSilence: Number(((frames - 1 - last) * WIN + (x.length - frames * n) / rate).toFixed(2)),
    pausesMs,
    levelDb: Number(mean.toFixed(1)),
    liveliness: Number(sd.toFixed(1)),
    pitchHz: median(all) === null ? null : Math.round(median(all)!),
    pitchContour: contour.map((v) => (v === null ? null : Math.round(v))),
    pitchRangeSemitones: known.length >= 2 ? Number((12 * Math.log2(Math.max(...known) / Math.min(...known))).toFixed(1)) : null,
  };
}

export const wordCount = (text: string): number => text.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;

/** A rough conversational rate used only to turn a measured rate into a pace setting. A rule of thumb, not a measurement of this voice. */
export const NOMINAL_WPS = 2.6;

export interface ReferencePlanHint {
  pace: number;
  projection: number;
  pauseAfter: number;
}

/**
 * What an approved take suggests for other lines. Pace is the measured rate against a nominal conversational rate,
 * projection follows the level, and the pause after is the take's own trailing silence. These are starting points to listen to and change.
 */
export function referenceHint(s: TakeStats): ReferencePlanHint {
  const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
  const r2 = (n: number) => Number(n.toFixed(2));
  return {
    pace: s.wordsPerSecond > 0 ? r2(clamp(s.wordsPerSecond / NOMINAL_WPS, 0.7, 1.2)) : 1,
    projection: r2(clamp((s.levelDb + 36) / 24, 0, 1)),
    pauseAfter: r2(clamp(s.trailSilence, 0, 3)),
  };
}

/**
 * Things worth a second listen in a new take, judged only from its length and shape. They catch a short line that came
 * back far too long, such as when a voice repeats it or reads the direction aloud. They are hints, not proof.
 */
export function takeFlags(s: TakeStats, words: number): string[] {
  if (words < 1 || s.speechSeconds <= 0) return [];
  const out: string[] = [];
  if (s.wordsPerSecond > 0 && s.wordsPerSecond < 0.9) out.push(`Much slower than speech usually is (${s.wordsPerSecond} words a second). The voice may have repeated the line or read the direction aloud.`);
  if (words <= 4 && s.pausesMs.length >= 2) out.push(`A ${words}-word line came back in ${s.pausesMs.length + 1} separate phrases. It may have been repeated.`);
  return out;
}

/** The loudest sample in each of `bins` equal slices, from 0 to 1, for drawing a waveform. */
export function waveformPeaks(x: Float32Array, bins: number): number[] {
  const out: number[] = [];
  const size = Math.max(1, Math.floor(x.length / bins));
  for (let b = 0; b < bins; b++) {
    let m = 0;
    for (let i = b * size; i < Math.min(x.length, (b + 1) * size); i++) {
      const v = Math.abs(x[i]!);
      if (v > m) m = v;
    }
    out.push(Number(Math.min(1, m).toFixed(3)));
  }
  return out;
}
