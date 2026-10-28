// Audio helpers for the browser side: decoding, a one-clip-at-a-time player and a cache of takes already loaded.

import { api, toUrl, type Audio } from "./api";
import { fromBase64 } from "./audio";

let ctx: AudioContext | null = null;
const audioContext = () => (ctx ??= new AudioContext());

const buffers = new Map<string, AudioBuffer>();
const urls = new Map<string, string>();

export async function decode(a: Audio): Promise<AudioBuffer> {
  const bytes = fromBase64(a.audioB64);
  const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return audioContext().decodeAudioData(copy);
}

/** Remember a clip we just made so it plays at once, without reading the file back. */
export async function remember(id: string, a: Audio): Promise<number> {
  const buf = await decode(a);
  buffers.set(id, buf);
  urls.set(id, toUrl(a));
  return buf.duration;
}

export async function takeUrl(project: string, id: string): Promise<string> {
  const hit = urls.get(id);
  if (hit) return hit;
  const a = await api.takeRead(project, id);
  const u = toUrl(a);
  urls.set(id, u);
  return u;
}

export async function takeBuffer(project: string, id: string): Promise<AudioBuffer> {
  const hit = buffers.get(id);
  if (hit) return hit;
  const b = await decode(await api.takeRead(project, id));
  buffers.set(id, b);
  return b;
}

export async function takeAudio(project: string, id: string): Promise<Audio> {
  return api.takeRead(project, id);
}

/** One sound at a time: starting another stops the first. */
let current: HTMLAudioElement | null = null;
let onStop: (() => void) | null = null;

export function stopPlayback() {
  current?.pause();
  current = null;
  const f = onStop;
  onStop = null;
  f?.();
}

export function playUrl(url: string, done?: () => void): Promise<void> {
  stopPlayback();
  const el = new Audio(url);
  current = el;
  return new Promise((resolve) => {
    const finish = () => {
      if (current === el) current = null;
      onStop = null;
      done?.();
      resolve();
    };
    onStop = finish;
    el.onended = finish;
    el.onerror = finish;
    el.play().catch(finish);
  });
}
