// Checking a recording before it is re-voiced, and comparing the result with it afterwards. Voice conversion keeps the
// timing and delivery of a human recording and changes only the voice, so the useful questions are: was the recording
// clean enough, did the timing survive, did the pauses survive, and did the liveliness of the performance survive.
// Everything here is measured from the audio. None of it says how the result sounds: that needs listening.

import { frameActivity, type TakeStats } from "./analysis";

const WIN = 0.02;
const db = (x: number) => 20 * Math.log10(Math.max(x, 1e-9));

/** Stretches of speech as [start, end] seconds, split wherever there is at least `gapMs` of silence. These are phrase timings, not word timings. */
export function speechSegments(x: Float32Array, rate: number, gapMs = 150): [number, number][] {
  const { voiced, n } = frameActivity(x, rate);
  const frames = voiced.length;
  const out: [number, number][] = [];
  const t = (f: number) => Number(((f * n) / rate).toFixed(2));
  let start = -1;
  let silent = 0;
  const gap = Math.ceil(gapMs / ((n / rate) * 1000));
  for (let f = 0; f < frames; f++) {
    if (voiced[f]) {
      if (start < 0) start = f;
      silent = 0;
    } else if (start >= 0 && ++silent >= gap) {
      out.push([t(start), t(f - silent + 1)]);
      start = -1;
      silent = 0;
    }
  }
  if (start >= 0) out.push([t(start), t(frames - silent)]);
  return out;
}

export interface RecordingCheck {
  seconds: number;
  /** Speech level over the quiet floor, in dB. Low means a noisy room or a distant microphone. */
  snrDb: number | null;
  peakDb: number;
  clippedSamples: number;
  warnings: string[];
}

export function checkRecordingQuality(x: Float32Array, rate: number): RecordingCheck {
  const seconds = x.length / rate;
  const n = Math.max(1, Math.floor(rate * WIN));
  const frames = Math.floor(x.length / n);
  const levels: number[] = [];
  let peak = 0;
  let clipped = 0;
  for (let f = 0; f < frames; f++) {
    let s = 0;
    for (let i = 0; i < n; i++) {
      const v = Math.abs(x[f * n + i]!);
      s += v * v;
      if (v > peak) peak = v;
      if (v >= 0.999) clipped++;
    }
    levels.push(db(Math.sqrt(s / n)));
  }
  const sorted = [...levels].sort((a, b) => a - b);
  const noise = sorted.length ? sorted[Math.floor(sorted.length * 0.1)]! : -120;
  const speech = sorted.length ? sorted[Math.floor(sorted.length * 0.9)]! : -120;
  const snr = sorted.length >= 10 ? Number((speech - noise).toFixed(1)) : null;
  const warnings: string[] = [];
  if (peak === 0 || speech < -60) warnings.push("The recording is silent or almost silent. Check the microphone.");
  else {
    if (db(peak) < -30) warnings.push(`Very quiet (peak ${db(peak).toFixed(0)} dB). Move closer to the microphone.`);
    if (clipped >= 4) warnings.push(`Clipped: ${clipped} samples hit full scale. Record again a little quieter.`);
    if (snr !== null && snr < 20) warnings.push(`Noisy: speech is only about ${snr} dB above the background. Conversion keeps the noise's effect on the voice, so a quiet room gives a cleaner result.`);
  }
  if (seconds > 60) warnings.push(`${Math.round(seconds)} seconds is long. Conversion is slower and less reliable on long recordings; one sentence or line at a time works best.`);
  return { seconds, snrDb: snr, peakDb: Number(db(peak).toFixed(1)), clippedSamples: clipped, warnings };
}

export interface ConvertReport {
  sourceSeconds: number;
  resultSeconds: number;
  /** Result length against the recording's, as a percentage. Conversion should keep timing, so this should be near zero. */
  driftPercent: number;
  pausesSource: number;
  pausesResult: number;
  /** How much the level moves while speaking, in dB, for each. Falling a lot means the delivery went flat. */
  livelinessSource: number;
  livelinessResult: number;
  pitchSource: number | null;
  pitchResult: number | null;
  leadSource: number;
  leadResult: number;
  /** Phrase timings of the result, for lip-sync and editing tools. Not word timings. */
  segmentsResult: [number, number][];
  flags: string[];
}

export function compareConversion(source: TakeStats, result: TakeStats, resultSamples: Float32Array, resultRate: number): ConvertReport {
  const drift = source.seconds > 0 ? Number((((result.seconds - source.seconds) / source.seconds) * 100).toFixed(1)) : 0;
  const flags: string[] = [];
  if (Math.abs(drift) > 5) flags.push(`The result is ${Math.abs(drift)}% ${drift > 0 ? "longer" : "shorter"} than the recording. Conversion should keep your timing, so check it lines up.`);
  if (Math.abs(source.pausesMs.length - result.pausesMs.length) >= 2) flags.push(`Your recording has ${source.pausesMs.length} pause${source.pausesMs.length === 1 ? "" : "s"} and the result ${result.pausesMs.length}. Some pauses may have been lost or added.`);
  if (source.liveliness > 3 && result.liveliness < source.liveliness * 0.5) flags.push("The result is much flatter than your performance. Some of the emotion may have been lost.");
  if (Math.abs(result.leadSilence - source.leadSilence) > 0.3) flags.push(`The speech starts ${Math.abs(result.leadSilence - source.leadSilence).toFixed(1)} s ${result.leadSilence > source.leadSilence ? "later" : "earlier"} than in your recording. Check lip-sync.`);
  return {
    sourceSeconds: Number(source.seconds.toFixed(2)),
    resultSeconds: Number(result.seconds.toFixed(2)),
    driftPercent: drift,
    pausesSource: source.pausesMs.length,
    pausesResult: result.pausesMs.length,
    livelinessSource: source.liveliness,
    livelinessResult: result.liveliness,
    pitchSource: source.pitchHz,
    pitchResult: result.pitchHz,
    leadSource: source.leadSilence,
    leadResult: result.leadSilence,
    segmentsResult: speechSegments(resultSamples, resultRate),
    flags,
  };
}
