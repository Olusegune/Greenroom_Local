// Timeline planning and WAV writing. The planning and the encoder are pure so they can be tested; the browser audio
// calls (decoding, offline rendering) are kept thin at the bottom.

import { chosenTake } from "./direct";
import { applyCrossfades, duckCurve, duckOf, EDGE_FADE_IN, EDGE_FADE_OUT, fadeCurve, fitFades, type DuckCfg } from "./timeline";
import { DEFAULT_MIX, type Line, type MixCfg, type MusicClip, type Project } from "./types";

export interface Placed {
  kind: "speech" | "event" | "bed" | "music";
  lineId?: string;
  characterId?: string;
  /** The audio file used. `seconds` is its own length, known for sound clips and the atmosphere. */
  ref: { id: string; ext: string; seconds?: number };
  start: number;
  seconds: number;
  /** Level in dB applied when mixing. */
  gainDb: number;
  /** Seconds faded in and out at the clip's edges. */
  fadeIn: number;
  fadeOut: number;
  /** Seconds skipped at the start of the file (music). */
  trimIn?: number;
  /** Dips under dialogue. */
  duck?: boolean;
}

export interface Span {
  lineId: string;
  start: number;
  end: number;
}

export interface Plan {
  items: Placed[];
  total: number;
  /** Line ids that have no chosen take and were left out. */
  missing: string[];
  /** Where each spoken line starts and ends, for markers and for ducking. */
  spans: Span[];
  /** How music dips under the spans, or null when ducking is off. */
  duck: DuckCfg | null;
}

export interface PlanOptions {
  /** The plan is at least this long. */
  minTotal?: number;
  /** The plan is exactly this long, for example the length of the picture: anything after it is cut off when mixed. */
  exactTotal?: number;
}

/**
 * Lays the lines out: sound before, speech, sound after, then the line's pause (or the project gap). A line with a cue
 * starts speaking at that time in the picture, even if that overlaps the line before; a line without one follows the
 * line before it. Plans for a single scene ignore cues and run in order from zero.
 */
export function planTimeline(p: Pick<Project, "lines" | "gap" | "bed"> & { music?: MusicClip[]; mix?: Partial<MixCfg> }, sceneIndex?: number, opts: PlanOptions = {}): Plan {
  const mix: MixCfg = { ...DEFAULT_MIX, ...(p.mix ?? {}) };
  const items: Placed[] = [];
  const spans: Span[] = [];
  const missing: string[] = [];
  let t = 0;
  let furthest = 0;
  for (const line of p.lines) {
    if (sceneIndex !== undefined && line.scene !== sceneIndex) continue;
    const take = chosenTake(line);
    if (!take) {
      missing.push(line.id);
      continue;
    }
    if (sceneIndex === undefined && typeof line.cue === "number" && Number.isFinite(line.cue)) {
      // Sound placed before the speech comes first, so the speech itself lands on the cue.
      const lead = line.events.filter((x) => x.placement === "before" && x.take).reduce((s, e) => s + e.take!.seconds, 0);
      t = Math.max(0, line.cue - lead);
    }
    for (const e of line.events.filter((x) => x.placement === "before" && x.take)) {
      items.push({ kind: "event", lineId: line.id, characterId: line.characterId, ref: e.take!, start: t, seconds: e.take!.seconds, gainDb: 0, fadeIn: EDGE_FADE_IN, fadeOut: EDGE_FADE_OUT });
      t += e.take!.seconds;
    }
    items.push({ kind: "speech", lineId: line.id, characterId: line.characterId, ref: { id: take.id, ext: take.ext }, start: t, seconds: take.seconds, gainDb: Number.isFinite(line.direction.gain) ? line.direction.gain! : 0, fadeIn: line.fadeIn ?? EDGE_FADE_IN, fadeOut: line.fadeOut ?? EDGE_FADE_OUT });
    spans.push({ lineId: line.id, start: t, end: t + take.seconds });
    t += take.seconds;
    for (const e of line.events.filter((x) => x.placement === "after" && x.take)) {
      items.push({ kind: "event", lineId: line.id, characterId: line.characterId, ref: e.take!, start: t, seconds: e.take!.seconds, gainDb: 0, fadeIn: EDGE_FADE_IN, fadeOut: EDGE_FADE_OUT });
      t += e.take!.seconds;
    }
    t += Number.isFinite(line.direction.pauseAfter) ? Math.max(0, line.direction.pauseAfter) : p.gap;
    furthest = Math.max(furthest, t);
  }
  if (sceneIndex === undefined) {
    for (const c of p.music ?? []) {
      const len = Math.max(0, Math.min(c.length, c.take.seconds - c.trimIn));
      if (len <= 0) continue;
      items.push({ kind: "music", ref: { id: c.take.id, ext: c.take.ext, seconds: c.take.seconds }, start: Math.max(0, c.start), seconds: len, gainDb: c.gainDb, fadeIn: c.fadeIn, fadeOut: c.fadeOut, trimIn: c.trimIn, duck: mix.duck && c.duck });
      furthest = Math.max(furthest, Math.max(0, c.start) + len);
    }
  }
  const total = opts.exactTotal ?? Math.max(furthest, opts.minTotal ?? 0);
  if (p.bed.take && total > 0) items.unshift({ kind: "bed", ref: p.bed.take, start: 0, seconds: total, gainDb: 0, fadeIn: 0, fadeOut: 0, duck: mix.duck && mix.duckAtmosphere });
  return { items: applyCrossfades(items), total: spans.length || items.length || opts.minTotal || opts.exactTotal ? total : 0, missing, spans, duck: mix.duck ? duckOf(mix) : null };
}

export interface Stem {
  id: string;
  name: string;
  filter: (p: Placed) => boolean;
}

/**
 * The separate tracks of a mix: one per character, one for sound clips, one for the atmosphere. Every item belongs to
 * exactly one stem, so adding the stems back together gives the mix.
 */
export function stemSets(plan: Plan, characters: { id: string; name: string }[]): Stem[] {
  const out: Stem[] = [];
  for (const c of characters) {
    if (plan.items.some((i) => i.kind === "speech" && i.characterId === c.id)) out.push({ id: "c-" + c.id, name: c.name, filter: (i) => i.kind === "speech" && i.characterId === c.id });
  }
  if (plan.items.some((i) => i.kind === "event")) out.push({ id: "events", name: "Sound clips", filter: (i) => i.kind === "event" });
  if (plan.items.some((i) => i.kind === "bed")) out.push({ id: "bed", name: "Atmosphere", filter: (i) => i.kind === "bed" });
  if (plan.items.some((i) => i.kind === "music")) out.push({ id: "music", name: "Music", filter: (i) => i.kind === "music" });
  return out;
}

export interface WavMarker {
  sec: number;
  name: string;
}

export interface WavOptions {
  /** 16 or 24 bit integer, or 32 bit float. Default 16. */
  bits?: 16 | 24 | 32;
  /** Random noise added before rounding to 16 bit, which hides the rounding. Ignored for 24 and 32 bit. */
  dither?: boolean;
  /** Cue points with labels, readable by most editors and DAWs. */
  markers?: WavMarker[];
  /** Adds a Broadcast Wave `bext` chunk with this description. */
  description?: string;
  originator?: string;
  /** Broadcast Wave time reference: the sample position of the first sample since midnight, so a DAW can place the file at its timecode. */
  timeReference?: number;
}

function ascii(v: DataView, o: number, s: string, max = s.length) {
  for (let i = 0; i < max; i++) v.setUint8(o + i, i < s.length ? s.charCodeAt(i) & 0x7f : 0);
}

const pad2 = (n: number) => n + (n % 2);

export function encodeWav(channels: Float32Array[], sampleRate: number, opts: WavOptions = {}): ArrayBuffer {
  const bits = opts.bits ?? 16;
  const n = channels[0]?.length ?? 0;
  const ch = channels.length || 1;
  const bytes = bits / 8;
  const float = bits === 32;
  const dataBytes = n * ch * bytes;
  const markers = (opts.markers ?? []).filter((m) => Number.isFinite(m.sec) && m.sec >= 0);
  const bext = opts.description !== undefined || opts.originator !== undefined || opts.timeReference !== undefined;

  const fmtSize = 8 + 16;
  const factSize = float ? 8 + 4 : 0;
  const bextSize = bext ? 8 + 602 : 0;
  const dataSize = 8 + pad2(dataBytes);
  const labels = markers.map((m) => new TextEncoder().encode(m.name.slice(0, 120)));
  const cueSize = markers.length ? 8 + 4 + markers.length * 24 : 0;
  const listSize = markers.length ? 8 + 4 + labels.reduce((s, l) => s + 8 + pad2(4 + l.length + 1), 0) : 0;
  const total = 12 + fmtSize + factSize + bextSize + dataSize + cueSize + listSize;

  const buf = new ArrayBuffer(total);
  const v = new DataView(buf);
  let o = 0;
  ascii(v, o, "RIFF");
  v.setUint32(o + 4, total - 8, true);
  ascii(v, o + 8, "WAVE");
  o = 12;
  ascii(v, o, "fmt ");
  v.setUint32(o + 4, 16, true);
  v.setUint16(o + 8, float ? 3 : 1, true);
  v.setUint16(o + 10, ch, true);
  v.setUint32(o + 12, sampleRate, true);
  v.setUint32(o + 16, sampleRate * ch * bytes, true);
  v.setUint16(o + 20, ch * bytes, true);
  v.setUint16(o + 22, bits, true);
  o += fmtSize;
  if (float) {
    ascii(v, o, "fact");
    v.setUint32(o + 4, 4, true);
    v.setUint32(o + 8, n, true);
    o += factSize;
  }
  if (bext) {
    ascii(v, o, "bext");
    v.setUint32(o + 4, 602, true);
    const b = o + 8;
    ascii(v, b, opts.description ?? "", 256);
    ascii(v, b + 256, opts.originator ?? "Greenroom", 32);
    const d = new Date();
    ascii(v, b + 320, d.toISOString().slice(0, 10), 10);
    ascii(v, b + 330, d.toISOString().slice(11, 19), 8);
    const tr = Math.max(0, Math.floor(opts.timeReference ?? 0));
    v.setUint32(b + 338, tr % 0x100000000, true);
    v.setUint32(b + 342, Math.floor(tr / 0x100000000), true);
    v.setUint16(b + 346, 1, true); // BWF version
    o += bextSize;
  }
  ascii(v, o, "data");
  v.setUint32(o + 4, dataBytes, true);
  let p = o + 8;
  const dither = bits === 16 && opts.dither;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const raw = channels[c]![i] ?? 0;
      if (float) {
        v.setFloat32(p, raw, true);
      } else if (bits === 24) {
        const s = Math.max(-1, Math.min(1, raw));
        const q = Math.round(s < 0 ? s * 0x800000 : s * 0x7fffff);
        v.setUint8(p, q & 0xff);
        v.setUint8(p + 1, (q >> 8) & 0xff);
        v.setUint8(p + 2, (q >> 16) & 0xff);
      } else {
        const noise = dither ? (Math.random() - Math.random()) / 32768 : 0;
        const s = Math.max(-1, Math.min(1, raw + noise));
        v.setInt16(p, Math.round(s < 0 ? s * 0x8000 : s * 0x7fff), true);
      }
      p += bytes;
    }
  }
  o += dataSize;
  if (markers.length) {
    ascii(v, o, "cue ");
    v.setUint32(o + 4, 4 + markers.length * 24, true);
    v.setUint32(o + 8, markers.length, true);
    markers.forEach((m, i) => {
      const at = o + 12 + i * 24;
      const frame = Math.round(m.sec * sampleRate);
      v.setUint32(at, i + 1, true);
      v.setUint32(at + 4, frame, true);
      ascii(v, at + 8, "data");
      v.setUint32(at + 12, 0, true);
      v.setUint32(at + 16, 0, true);
      v.setUint32(at + 20, frame, true);
    });
    o += cueSize;
    ascii(v, o, "LIST");
    v.setUint32(o + 4, listSize - 8, true);
    ascii(v, o + 8, "adtl");
    let q = o + 12;
    labels.forEach((l, i) => {
      ascii(v, q, "labl");
      v.setUint32(q + 4, 4 + l.length + 1, true);
      v.setUint32(q + 8, i + 1, true);
      new Uint8Array(buf, q + 12, l.length).set(l);
      q += 8 + pad2(4 + l.length + 1);
    });
  }
  return buf;
}

export function toBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function fromBase64(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const textBase64 = (s: string): string => toBase64(new TextEncoder().encode(s).buffer as ArrayBuffer);

export function fmtTime(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function lineFileName(index: number, characterName: string, ext: string): string {
  return `${String(index + 1).padStart(2, "0")} - ${characterName.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "Line"}.${ext}`;
}

export type Loader = (ref: { id: string; ext: string }) => Promise<AudioBuffer>;

const dbToGain = (db: number) => Math.pow(10, db / 20);

/**
 * Mixes the plan into one stereo buffer at `sampleRate`. The bed loops under everything at its volume. A `filter` keeps
 * only some items, so stems come out the same length as the mix and line up with it.
 */
export async function renderPlan(plan: Plan, bedVolume: number, load: Loader, sampleRate = 48000, filter?: (p: Placed) => boolean): Promise<Float32Array[]> {
  const length = Math.max(1, Math.ceil(plan.total * sampleRate));
  const ctx = new OfflineAudioContext(2, length, sampleRate);
  // The level music should have at every moment: dips under the spoken lines. Shared by every clip that ducks.
  const duck = plan.duck && plan.total > 0 ? duckCurve(plan.spans, plan.total, plan.duck) : null;
  for (const it of plan.items) {
    if (filter && !filter(it)) continue;
    const src = ctx.createBufferSource();
    src.buffer = await load(it.ref);
    const level = ctx.createGain();
    const fades = ctx.createGain();
    if (it.kind === "bed") {
      src.loop = true;
      level.gain.setValueAtTime(bedVolume, 0);
      level.gain.setValueAtTime(bedVolume, Math.max(0, it.seconds - 1.2));
      level.gain.linearRampToValueAtTime(0, it.seconds);
    } else {
      level.gain.value = dbToGain(it.gainDb);
      // Fade in and out with equal-power curves, kept from overlapping inside a short clip.
      const { fi, fo } = fitFades(it.seconds, it.fadeIn, it.fadeOut);
      if (fi > 0.0005) fades.gain.setValueCurveAtTime(fadeCurve("in"), it.start, fi);
      if (fo > 0.0005) fades.gain.setValueCurveAtTime(fadeCurve("out"), it.start + it.seconds - fo, fo);
    }
    let tail: AudioNode = src.connect(fades).connect(level);
    if (it.duck && duck) {
      const d = ctx.createGain();
      d.gain.setValueCurveAtTime(duck, 0, plan.total);
      tail = tail.connect(d);
    }
    tail.connect(ctx.destination);
    if (it.kind === "music") src.start(it.start, it.trimIn ?? 0, it.seconds);
    else src.start(it.start);
    if (it.kind === "bed") src.stop(it.seconds);
  }
  const out = await ctx.startRendering();
  return [out.getChannelData(0), out.getChannelData(1)];
}

export function sceneLines(lines: Line[], scene: number): Line[] {
  return lines.filter((l) => l.scene === scene);
}
