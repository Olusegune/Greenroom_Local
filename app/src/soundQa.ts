// Automatic technical checks on a piece of audio: silence, clipping, level, DC offset, length against what was asked,
// and a sample rate low enough to need upsampling. These are measurements of the file, not judgements of how it sounds.

import { integratedLoudness, samplePeakDb } from "./loudness";

export interface QaIssue {
  level: "warn" | "error";
  text: string;
}

export interface ClipQa {
  seconds: number;
  rate: number;
  channels: number;
  peakDb: number;
  /** Integrated loudness, or null when the clip is too short to measure (under 0.4 s) or silent. */
  lufs: number | null;
  clippedSamples: number;
  dcOffset: number;
  leadSilence: number;
  trailSilence: number;
  issues: QaIssue[];
}

const THRESH = 10 ** (-50 / 20);

export function validateClip(ch: Float32Array[], rate: number, opts: { requestedSeconds?: number; kind?: "speech" | "sound" } = {}): ClipQa {
  const n = Math.min(...ch.map((c) => c.length));
  const seconds = n / rate;
  const issues: QaIssue[] = [];
  if (ch.length === 0 || n === 0) {
    return { seconds: 0, rate, channels: ch.length, peakDb: -Infinity, lufs: null, clippedSamples: 0, dcOffset: 0, leadSilence: 0, trailSilence: 0, issues: [{ level: "error", text: "The file has no audio." }] };
  }
  let clipped = 0;
  let sum = 0;
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    let m = 0;
    for (const c of ch) {
      const a = Math.abs(c[i]!);
      if (a >= 0.999) clipped++;
      if (a > m) m = a;
      sum += c[i]!;
    }
    if (m > THRESH) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const peakDb = samplePeakDb(ch);
  const dc = sum / (n * ch.length);
  const lead = first < 0 ? seconds : first / rate;
  const trail = first < 0 ? 0 : (n - 1 - last) / rate;
  const lufs = first < 0 || seconds < 0.4 ? null : integratedLoudness(ch, rate);

  if (first < 0) issues.push({ level: "error", text: "The clip is silent." });
  else {
    if (clipped >= 4) issues.push({ level: clipped > n * 0.001 ? "error" : "warn", text: `Clipped: ${clipped} samples at full scale.` });
    if (peakDb < -30) issues.push({ level: "warn", text: `Very quiet: the peak is ${peakDb.toFixed(1)} dB.` });
    if (Math.abs(dc) > 0.01) issues.push({ level: "warn", text: `DC offset of ${(dc * 100).toFixed(1)}%: the waveform is not centred.` });
    if (lead > 1) issues.push({ level: "warn", text: `${lead.toFixed(1)} s of silence at the start.` });
    if (trail > (opts.kind === "sound" ? 1.5 : 2.5)) issues.push({ level: "warn", text: `${trail.toFixed(1)} s of silence at the end.` });
    if (opts.kind !== "sound" && seconds < 0.2) issues.push({ level: "warn", text: "Under a fifth of a second long." });
  }
  if (rate < 32000) issues.push({ level: "warn", text: `Sample rate ${rate} Hz is low; the mix will upsample it, which adds no detail.` });
  const want = opts.requestedSeconds;
  if (want && want > 0 && Math.abs(seconds - want) / want > 0.5) issues.push({ level: "warn", text: `Asked for about ${want.toFixed(1)} s but the clip is ${seconds.toFixed(1)} s.` });
  return { seconds, rate, channels: ch.length, peakDb, lufs: lufs !== null && Number.isFinite(lufs) ? lufs : null, clippedSamples: clipped, dcOffset: Number(dc.toFixed(4)), leadSilence: Number(lead.toFixed(2)), trailSilence: Number(trail.toFixed(2)), issues };
}

export interface QaRow {
  name: string;
  kind: "speech" | "sound";
  qa: ClipQa;
}

/** A plain-text report of every checked file. It states only measurements. */
export function qaMarkdown(project: string, rows: QaRow[], appVersion: string, now: string): string {
  const bad = rows.filter((r) => r.qa.issues.length);
  const f = (v: number) => (Number.isFinite(v) ? v.toFixed(1) : "silent");
  return [
    `# Technical QA: ${project}`,
    "",
    `Greenroom Local ${appVersion}, ${now}. ${rows.length} file${rows.length === 1 ? "" : "s"} checked; ${bad.length} with something to look at.`,
    "These are measurements of the files (level, clipping, silence, length, sample rate). They are not a judgement of how anything sounds: that needs listening.",
    "",
    "| File | Kind | Length | Rate | Peak dB | LUFS | Issues |",
    "|---|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r.name.replace(/\|/g, "/")} | ${r.kind} | ${r.qa.seconds.toFixed(2)} s | ${r.qa.rate} | ${f(r.qa.peakDb)} | ${r.qa.lufs === null ? "n/a" : r.qa.lufs.toFixed(1)} | ${r.qa.issues.map((i) => `${i.level === "error" ? "ERROR" : "warn"}: ${i.text}`).join(" ") || "none"} |`),
    "",
  ].join("\n");
}
