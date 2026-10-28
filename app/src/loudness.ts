// Loudness measurement and normalization.
// Integrated loudness follows ITU-R BS.1770-4 (K-weighting, 400 ms blocks at 75% overlap, absolute gate at -70 LUFS and
// relative gate 10 LU below), the method behind EBU R128 and ATSC A/85. The true-peak figure is an ESTIMATE made by
// 4x oversampling with a windowed-sinc interpolator; it is close but is not a certified meter.

export interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

/** The two K-weighting stages (high shelf, then high-pass), derived for any sample rate. */
export function kWeighting(fs: number): [Biquad, Biquad] {
  const shelfF = 1681.974450955533;
  const shelfG = 3.999843853973347;
  const shelfQ = 0.7071752369554196;
  let k = Math.tan((Math.PI * shelfF) / fs);
  const vh = Math.pow(10, shelfG / 20);
  const vb = Math.pow(vh, 0.4996667741545416);
  let a0 = 1 + k / shelfQ + k * k;
  const shelf: Biquad = { b0: (vh + (vb * k) / shelfQ + k * k) / a0, b1: (2 * (k * k - vh)) / a0, b2: (vh - (vb * k) / shelfQ + k * k) / a0, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / shelfQ + k * k) / a0 };

  const hpF = 38.13547087602444;
  const hpQ = 0.5003270373238773;
  k = Math.tan((Math.PI * hpF) / fs);
  a0 = 1 + k / hpQ + k * k;
  const hp: Biquad = { b0: 1, b1: -2, b2: 1, a1: (2 * (k * k - 1)) / a0, a2: (1 - k / hpQ + k * k) / a0 };
  return [shelf, hp];
}

function filter(x: Float32Array, c: Biquad): Float64Array {
  const y = new Float64Array(x.length);
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i]!;
    const yi = c.b0 * xi + c.b1 * x1 + c.b2 * x2 - c.a1 * y1 - c.a2 * y2;
    x2 = x1;
    x1 = xi;
    y2 = y1;
    y1 = yi;
    y[i] = yi;
  }
  return y;
}

const LUFS_OFFSET = -0.691;
const toLufs = (z: number) => (z > 0 ? LUFS_OFFSET + 10 * Math.log10(z) : -Infinity);

/** Integrated loudness in LUFS. Returns -Infinity for silence. Audio shorter than one block is measured as one block. */
export function integratedLoudness(channels: Float32Array[], fs: number): number {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return -Infinity;
  const [shelf, hp] = kWeighting(fs);
  // Running sums of the weighted, squared signal let any block's mean square be read in constant time.
  const sums = channels.map((ch) => {
    const w = filter(new Float32Array(filter(ch, shelf)), hp);
    const s = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) s[i + 1] = s[i]! + w[i]! * w[i]!;
    return s;
  });
  const block = Math.min(Math.round(0.4 * fs), n);
  const hop = Math.max(1, Math.round(0.1 * fs));
  const z: number[] = [];
  for (let start = 0; start + block <= n; start += hop) {
    let sum = 0;
    for (const s of sums) sum += (s[start + block]! - s[start]!) / block;
    z.push(sum);
  }
  const abs = z.filter((v) => toLufs(v) > -70);
  if (abs.length === 0) return -Infinity;
  const relGate = toLufs(abs.reduce((a, b) => a + b, 0) / abs.length) - 10;
  const kept = abs.filter((v) => toLufs(v) > relGate);
  if (kept.length === 0) return -Infinity;
  return toLufs(kept.reduce((a, b) => a + b, 0) / kept.length);
}

export function samplePeakDb(channels: Float32Array[]): number {
  let p = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) p = Math.max(p, Math.abs(ch[i]!));
  return p > 0 ? 20 * Math.log10(p) : -Infinity;
}

const TAPS = 8;
const hannSinc = (t: number) => {
  if (Math.abs(t) >= TAPS) return 0;
  const s = t === 0 ? 1 : Math.sin(Math.PI * t) / (Math.PI * t);
  return s * 0.5 * (1 + Math.cos((Math.PI * t) / TAPS));
};
const PHASES = [0.25, 0.5, 0.75].map((f) => Array.from({ length: 2 * TAPS }, (_, j) => hannSinc(j - (TAPS - 1) - f)));

/** Estimated true peak in dBTP (4x oversampled). Only the neighbourhood of the loudest samples is searched, for speed. */
export function truePeakDb(channels: Float32Array[]): number {
  let peak = 0;
  for (const ch of channels) for (let i = 0; i < ch.length; i++) peak = Math.max(peak, Math.abs(ch[i]!));
  if (peak === 0) return -Infinity;
  const floor = peak * 0.4;
  let tp = peak;
  for (const ch of channels) {
    const n = ch.length;
    for (let i = 0; i < n - 1; i++) {
      if (Math.abs(ch[i]!) < floor && Math.abs(ch[i + 1]!) < floor) continue;
      for (const phase of PHASES) {
        let acc = 0;
        for (let j = 0; j < 2 * TAPS; j++) {
          const idx = i - (TAPS - 1) + j;
          if (idx >= 0 && idx < n) acc += ch[idx]! * phase[j]!;
        }
        tp = Math.max(tp, Math.abs(acc));
      }
    }
  }
  return 20 * Math.log10(tp);
}

export function applyGain(channels: Float32Array[], db: number): Float32Array[] {
  if (db === 0) return channels;
  const g = Math.pow(10, db / 20);
  return channels.map((ch) => {
    const out = new Float32Array(ch.length);
    for (let i = 0; i < ch.length; i++) out[i] = ch[i]! * g;
    return out;
  });
}

export interface Measure {
  lufs: number;
  tpDb: number;
  peakDb: number;
}

export function measure(channels: Float32Array[], fs: number): Measure {
  return { lufs: integratedLoudness(channels, fs), tpDb: truePeakDb(channels), peakDb: samplePeakDb(channels) };
}

export interface NormPlan {
  gainDb: number;
  finalLufs: number;
  finalTpDb: number;
  /** The target loudness was reached. False when the true-peak ceiling stopped the gain first. */
  reached: boolean;
  limitedBy: "ceiling" | null;
}

/**
 * A single static gain that brings the mix to `targetLufs`, never letting the estimated true peak pass `ceilingDb`.
 * No limiter is used: if the ceiling stops the gain, the result is reported, not silently squashed.
 * `targetLufs` null means leave the level alone.
 */
export function planNormalization(m: Measure, targetLufs: number | null, ceilingDb: number): NormPlan {
  if (targetLufs === null || !Number.isFinite(m.lufs)) return { gainDb: 0, finalLufs: m.lufs, finalTpDb: m.tpDb, reached: targetLufs === null, limitedBy: null };
  let gain = Math.max(-40, Math.min(24, targetLufs - m.lufs));
  let limitedBy: NormPlan["limitedBy"] = null;
  if (Number.isFinite(m.tpDb) && m.tpDb + gain > ceilingDb) {
    gain = ceilingDb - m.tpDb;
    limitedBy = "ceiling";
  }
  return { gainDb: gain, finalLufs: m.lufs + gain, finalTpDb: m.tpDb + gain, reached: limitedBy === null, limitedBy };
}

export interface LoudnessTarget {
  id: string;
  label: string;
  lufs: number | null;
  note: string;
}

export const TARGETS: LoudnessTarget[] = [
  { id: "off", label: "Leave the level as it is", lufs: null, note: "" },
  { id: "r128", label: "-23 LUFS: EBU R128 (European broadcast)", lufs: -23, note: "Peak ceiling -1 dBTP" },
  { id: "atsc", label: "-24 LKFS: ATSC A/85 (US broadcast, film dialogue)", lufs: -24, note: "Peak ceiling -2 dBTP" },
  { id: "web", label: "-16 LUFS: podcasts and online video", lufs: -16, note: "Peak ceiling -1 dBTP" },
  { id: "stream", label: "-14 LUFS: music and video streaming", lufs: -14, note: "Peak ceiling -1 dBTP" },
];

export const fmtLufs = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} LUFS` : "silent");
export const fmtDb = (v: number) => (Number.isFinite(v) ? `${v.toFixed(1)} dB` : "silent");
