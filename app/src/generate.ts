// Making one take: pick the engine from the voice, shape the text for it, save the audio, remember its length.

import { api, type Provider } from "./api";
import { castingGuard, type GuardCode } from "./casting/lock";
import type { MatchContext, MatchResult, TakeCast } from "./casting/types";
import { applyPronunciations, composeText, spokenWords, stripTags, vkInstructions } from "./direct";
import { ENGINES, providerFor, type ElevenModel, type InworldModel } from "./engines";
import { DEFAULT_INWORLD_MODEL, inworldPlan } from "./inworld";
import { applyVariation, type VariationId } from "./acting";
import { assemblePlan, cueText, emphasise, hasBeats, isAssembled, spliceBeat, type BeatPart } from "./beats";
import { effectiveLine } from "./performance";
import { withActing } from "./performanceCompiler";
import { encodeWav, fromBase64, toBase64 } from "./audio";
import { decode, remember, takeBuffer } from "./media";
import { analyzeSamples, takeFlags } from "./analysis";
import { uid } from "./script";
import { sha256Hex } from "./trust";
import { APP_VERSION } from "./version";
import type { Character, Line, Pronunciation, Take, VoiceEntry } from "./types";

export type Model = ElevenModel;

/** What is sent for this line and voice. Engines without tags get the plain words, plus delivery in words where they take it. */
/** Ask for the casting check: the character this line belongs to, and the library, so the voice can be compared with the one approved. */
export interface CastingCheck {
  character: Character | undefined;
  library: VoiceEntry[];
  modelId?: string | null;
  context?: MatchContext;
}

/** Raised when the voice about to speak is not the one this character is approved with. Nothing is made, and nothing is replaced. */
export class CastingError extends Error {
  constructor(message: string, readonly code: GuardCode, readonly alternatives: MatchResult[]) {
    super(message);
    this.name = "CastingError";
  }
}

/** The request that goes to the engine for one piece of text. The voice id carries the speaker (file@7, ife@yo) unchanged. */
export function clipRequest(p: Plan, voice: Pick<VoiceEntry, "id">, speed: number, quality?: string): Parameters<typeof api.runClip>[0] {
  return { provider: p.provider, text: p.text, voice: voice.id, speed, instructions: p.instructions, quality, model: p.modelId };
}

/** Runs the casting guard when a check was asked for. Returns the identity to stamp on the take, or throws. */
function guardCast(voice: VoiceEntry, opts: PlanOptions): TakeCast | undefined {
  if (!opts.casting) return undefined;
  const g = castingGuard(opts.casting.character, voice, opts.casting.library, opts.casting.modelId ?? null, opts.casting.context ?? {});
  if (!g.ok) throw new CastingError(g.message, g.code, g.alternatives);
  return g.cast;
}

export interface PlanOptions {
  /** When given, the voice is checked against the character's approval before anything is made, and the take records who it was made for. */
  casting?: CastingCheck;
  inworldModel?: InworldModel;
  /** Make the line as one of four interpretations. The saved line is not changed. */
  variation?: VariationId;
}

export interface Plan {
  provider: Provider;
  text: string;
  instructions?: string;
  model: Take["model"];
  /** Cloud model id for engines that have several, such as inworld-tts-2. */
  modelId?: string;
  steering?: string[];
  nonverbal?: string[];
  /** What the line asked for that this voice could not be given. Shown before paying. */
  notSent?: string[];
}

/** The director's own words for the line (if any) compiled for this voice's engine. The saved line is never changed. */
const acted = (l: Line, v: VoiceEntry, o: PlanOptions) => withActing(l, { engine: v.provider, ...(o.inworldModel ? { inworldModel: o.inworldModel } : {}) });

/** Whether making this line for this voice takes one request per phrase, counting beats that come from the director's own words. */
export const assembledFor = (original: Line, voice: VoiceEntry, opts: PlanOptions = {}): boolean => isAssembled(acted(original, voice, opts).line);

function planOne(saved: Line, voice: VoiceEntry, model: Model, dict: Pronunciation[] = [], opts: PlanOptions = {}): Plan {
  // The performance plan (if any) is compiled into the direction here; the saved line is never changed.
  const line = effectiveLine(opts.variation ? applyVariation(saved, opts.variation) : saved, { emphasis: voice.provider === "inworld" });
  const e = voice.provider;
  const provider = providerFor(e, model, voice.vkClone);
  if (e === "inworld") {
    const modelId = opts.inworldModel ?? DEFAULT_INWORLD_MODEL;
    const w = inworldPlan({ text: applyPronunciations(line.text, dict), direction: line.direction }, modelId);
    return { provider, text: w.text, model: "inworld", modelId, steering: w.steering, nonverbal: w.nonverbal, notSent: w.notSent };
  }
  if (ENGINES[e].tags) return { provider, text: applyPronunciations(composeText(line), dict), model };
  const instructions = e === "voicekiller" ? vkInstructions(line.direction.emotion, line.direction.speed, line.direction.note) : undefined;
  return { provider, text: applyPronunciations(stripTags(line.text), dict), instructions, model: e as Take["model"] };
}

/** What is sent for this line and voice. Beats in "cues" mode that cannot be sent (pace, pause, emphasis on other engines) are listed in `notSent`. */
export function plan(original: Line, voice: VoiceEntry, model: Model, dict: Pronunciation[] = [], opts: PlanOptions = {}): Plan {
  const { line: saved, render } = acted(original, voice, opts);
  const p0 = planOne(saved, voice, model, dict, opts);
  // What the director's words asked for and this engine cannot do is listed, so it is never presented as generated.
  const p: Plan = render?.notSent.length ? { ...p0, notSent: [...(p0.notSent ?? []), ...render.notSent] } : p0;
  if (hasBeats(saved) && !isAssembled(saved)) {
    const extra = cueText(saved, voice.provider === "inworld").notSent;
    if (extra.length) return { ...p, notSent: [...(p.notSent ?? []), ...extra] };
  }
  return p;
}

/** The requests that making this line will take: one, or one per phrase when the line is assembled from beats. */
export function requestsFor(original: Line, voice: VoiceEntry, model: Model, dict: Pronunciation[], opts: PlanOptions = {}): Plan[] {
  if (!isAssembled(acted(original, voice, opts).line)) return [plan(original, voice, model, dict, opts)];
  const saved = acted(original, voice, opts).line;
  const line = effectiveLine(opts.variation ? applyVariation(saved, opts.variation) : saved, { emphasis: voice.provider === "inworld" });
  return assemblePlan(line).map((st) => planOne({ ...line, text: voice.provider === "inworld" && st.emphasis ? emphasise(st.line.text) : st.line.text, direction: st.line.direction, beats: undefined, performance: undefined }, voice, model, dict, { ...opts, variation: undefined }));
}

export async function makeTake(projectId: string, original: Line, voice: VoiceEntry, model: Model, dict: Pronunciation[] = [], quality?: string, opts: PlanOptions = {}): Promise<Take> {
  const cast = guardCast(voice, opts);
  const saved = acted(original, voice, opts).line;
  const line = effectiveLine(opts.variation ? applyVariation(saved, opts.variation) : saved, { emphasis: voice.provider === "inworld" });
  const p = plan(original, voice, model, dict, opts);
  const out = await api.runClip(clipRequest(p, voice, line.direction.speed, quality));
  const id = "t-" + uid();
  const ext = out.mime === "audio/wav" ? "wav" : "mp3";
  await api.takeWrite(projectId, id, ext, out.audioB64);
  const seconds = await remember(id, out);
  const sha256 = await sha256Hex(fromBase64(out.audioB64));
  // Measure the take once so a short line that came back far too long is flagged for a second listen.
  let check: string[] | undefined;
  try {
    const b = await takeBuffer(projectId, id);
    const words = spokenWords(line.text);
    const f = takeFlags(analyzeSamples(b.getChannelData(0), b.sampleRate, words), words);
    if (f.length) check = f;
  } catch {
    /* the check is a bonus; the take is kept either way */
  }
  return {
    id,
    at: new Date().toISOString(),
    model: p.model,
    ext,
    voiceId: voice.id,
    ...(cast ? { cast } : {}),
    sent: p.instructions ? `${p.text}  (instructions: ${p.instructions})` : p.text,
    seconds,
    provenance: {
      engine: voice.provider,
      voiceName: voice.name,
      quality: voice.provider === "elevenlabs" ? quality : undefined,
      speed: voice.provider === "chatterbox" || voice.provider === "wazobia" ? 1 : line.direction.speed,
      instructions: p.instructions,
      modelId: p.modelId,
      check,
      variation: opts.variation,
      steering: p.steering?.length ? p.steering : undefined,
      nonverbal: p.nonverbal?.length ? p.nonverbal : undefined,
      notSent: p.notSent?.length ? p.notSent : undefined,
      chars: p.text.length,
      sha256,
      appVersion: APP_VERSION,
      emotion: line.direction.emotion,
      sounds: line.direction.sounds,
      note: line.direction.note ?? "",
      pronunciations: dict.length,
    },
  };
}

/** A sound clip (laugh, sneeze, door) made by the sound-effects model, kept like any other take. */
export async function makeSound(projectId: string, prompt: string, seconds: number, quality?: string, provider: "eleven-sfx" | "kie-sfx" | "local-sfx" = "eleven-sfx", options: { loop?: boolean; promptInfluence?: number; sfxModel?: "eleven_text_to_sound_v2" | "eleven_text_to_sound_v3" } = {}) {
  const out = await api.runClip({ provider, text: prompt, seconds, quality, ...options });
  const id = "s-" + uid();
  const ext = out.mime === "audio/wav" ? "wav" : "mp3";
  await api.takeWrite(projectId, id, ext, out.audioB64);
  const real = await remember(id, out);
  const sha256 = await sha256Hex(fromBase64(out.audioB64));
  return { id, ext, seconds: real, sha256, prompt, ...options } as const;
}

/**
 * A line made phrase by phrase and joined with silence: each phrase is a separate request with its own emotion, intention
 * and pace, and the owner's pause is left after it. It works with any voice but costs a request per phrase, and the joins
 * can sound different from one continuous read.
 */
export async function makeBeatTake(projectId: string, original: Line, voice: VoiceEntry, model: Model, dict: Pronunciation[] = [], quality?: string, opts: PlanOptions = {}): Promise<Take> {
  const cast = guardCast(voice, opts);
  const { line: saved, render } = acted(original, voice, opts);
  const line = effectiveLine(opts.variation ? applyVariation(saved, opts.variation) : saved, { emphasis: voice.provider === "inworld" });
  const steps = assemblePlan(line);
  const pieces: Float32Array[] = [];
  const sent: string[] = [];
  const parts: BeatPart[] = [];
  let at0 = 0;
  let rate = 0;
  let chars = 0;
  let first: Plan | null = null;
  for (const st of steps) {
    const sub: Line = { ...line, text: voice.provider === "inworld" && st.emphasis ? emphasise(st.line.text) : st.line.text, direction: st.line.direction, beats: undefined, performance: undefined };
    const p = planOne(sub, voice, model, dict, { ...opts, variation: undefined });
    first ??= p;
    const out = await api.runClip(clipRequest(p, voice, sub.direction.speed, quality));
    const buf = await decode(out);
    if (rate && buf.sampleRate !== rate) throw new Error("The phrases came back at different sample rates, so they cannot be joined. Make this line as one take.");
    rate = buf.sampleRate;
    const speech = Float32Array.from(buf.getChannelData(0));
    pieces.push(speech, new Float32Array(Math.round(st.pauseAfter * rate)));
    parts.push({ text: st.line.text, start: Number((at0 / rate).toFixed(3)), end: Number(((at0 + speech.length) / rate).toFixed(3)), pause: st.pauseAfter });
    at0 += speech.length + Math.round(st.pauseAfter * rate);
    sent.push(p.text);
    chars += p.text.length;
  }
  const total = pieces.reduce((n, a) => n + a.length, 0);
  const joined = new Float32Array(total);
  let at = 0;
  for (const a of pieces) {
    joined.set(a, at);
    at += a.length;
  }
  const b64 = toBase64(encodeWav([joined], rate));
  const id = "t-" + uid();
  await api.takeWrite(projectId, id, "wav", b64);
  const seconds = await remember(id, { audioB64: b64, mime: "audio/wav" });
  const sha256 = await sha256Hex(fromBase64(b64));
  return {
    id,
    at: new Date().toISOString(),
    model: first!.model,
    ext: "wav",
    voiceId: voice.id,
    ...(cast ? { cast } : {}),
    sent: sent.map((t, i) => `(${i + 1}) ${t}`).join("  "),
    seconds,
    provenance: {
      engine: voice.provider,
      voiceName: voice.name,
      speed: line.direction.speed,
      modelId: first!.modelId,
      assembled: steps.length,
      parts,
      ...(render?.notSent.length ? { notSent: render.notSent } : {}),
      chars,
      sha256,
      appVersion: APP_VERSION,
      emotion: line.direction.emotion,
      sounds: line.direction.sounds,
      note: line.direction.note ?? "",
      pronunciations: dict.length,
      variation: opts.variation,
    },
  };
}

/**
 * Remakes one phrase of a take that was made phrase by phrase, and joins it back between the untouched rest. One request.
 * The original take is never changed: this returns a new take that says which phrase was remade and from which take.
 */
export async function remakeBeat(projectId: string, original: Line, from: Take, index: number, voice: VoiceEntry, model: Model, dict: Pronunciation[] = [], quality?: string, opts: PlanOptions = {}): Promise<Take> {
  // The rest of this take was spoken by from.voiceId. A phrase from another voice would make one take with two voices in it,
  // labelled as one of them: refuse before anything is requested.
  if (from.voiceId !== voice.id) throw new CastingError(`This take was made with ${from.provenance?.voiceName ?? from.voiceId}, but ${voice.name} was about to remake a phrase of it. Make the line again instead.`, "voice_changed", []);
  const cast = guardCast(voice, opts);
  const saved = acted(original, voice, opts).line;
  const parts = from.provenance?.parts;
  if (!parts?.[index]) throw new Error("This take has no phrase timings, so one phrase cannot be remade. Make the line again.");
  const line = effectiveLine(opts.variation ? applyVariation(saved, opts.variation) : saved, { emphasis: voice.provider === "inworld" });
  const st = assemblePlan(line)[index];
  if (!st || st.line.text !== parts[index]!.text) throw new Error("The line has been edited since this take was made, so its phrases no longer match. Make the line again.");
  const sub: Line = { ...line, text: voice.provider === "inworld" && st.emphasis ? emphasise(st.line.text) : st.line.text, direction: st.line.direction, beats: undefined, performance: undefined };
  const p = planOne(sub, voice, model, dict, { ...opts, variation: undefined });
  const out = await api.runClip(clipRequest(p, voice, sub.direction.speed, quality));
  const [old, fresh] = [await takeBuffer(projectId, from.id), await decode(out)];
  if (old.sampleRate !== fresh.sampleRate) throw new Error("The new phrase came back at a different sample rate, so it cannot be joined. Make the line again.");
  const joined = spliceBeat(Float32Array.from(old.getChannelData(0)), old.sampleRate, parts, index, Float32Array.from(fresh.getChannelData(0)));
  const b64 = toBase64(encodeWav([joined.samples], old.sampleRate));
  const id = "t-" + uid();
  await api.takeWrite(projectId, id, "wav", b64);
  const seconds = await remember(id, { audioB64: b64, mime: "audio/wav" });
  const sha256 = await sha256Hex(fromBase64(b64));
  const sent = from.sent.split(/ {2}(?=\(\d+\) )/).map((x, i) => (i === index ? `(${i + 1}) ${p.text}` : x)).join("  ");
  return { ...from, id, ...(cast ? { cast } : {}), at: new Date().toISOString(), sent, seconds, provenance: { ...from.provenance!, sha256, parts: joined.parts, remade: { phrase: index + 1, from: from.id }, chars: (from.provenance!.chars ?? 0) + p.text.length, check: undefined } };
}

export function modelLabel(m: Take["model"]): string {
  return m === "eleven_v4" ? "Eleven v4" : m === "eleven_v3" ? "Eleven v3" : m === "voicekiller" ? "VoiceKiller" : m === "inworld" ? "Inworld" : m === "kie" ? "Kie" : m === "piper" ? "Piper" : m === "chatterbox" ? "Chatterbox" : m === "kokoro" ? "Kokoro" : m === "qwen" ? "Qwen3-TTS" : m === "wazobia" ? "WazobiaVoice" : "Local";
}
