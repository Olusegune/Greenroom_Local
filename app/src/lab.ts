// Slice 0 listening test: the lines, which provider renders each, and the report the owner saves.
// Nothing here is a claim about quality. Ratings come from listening.

export type Provider = "eleven-v4" | "eleven-tts" |"eleven-sfx" | "kie-tts" | "kie-dialogue" | "kie-sfx";
export type KeyName = "elevenlabs" | "kie";

export interface Clip {
  id: string;
  group: "Speech with feeling" | "Body sounds";
  title: string;
  text: string;
  provider: Provider;
  /** What a good result sounds like, so the rating is against the same yardstick. */
  listenFor: string;
}

export const PROVIDER_INFO: Record<Provider, { label: string; key: KeyName; note: string }> = {
  "eleven-v4": { label: "ElevenLabs v4", key: "elevenlabs", note: "Newest model; [tag] support is not confirmed in the docs" },
  "eleven-tts": { label: "ElevenLabs v3", key: "elevenlabs", note: "Direct, supports [tags]" },
  "eleven-sfx": { label: "ElevenLabs sound effects", key: "elevenlabs", note: "Non-speech sounds" },
  "kie-tts": { label: "Kie · ElevenLabs Turbo 2.5", key: "kie", note: "Tags may be read aloud: that is a finding" },
  "kie-dialogue": { label: "Kie · ElevenLabs Dialogue v3", key: "kie", note: "Tag support not documented" },
  "kie-sfx": { label: "Kie · Sound effects v2", key: "kie", note: "Non-speech sounds" },
};

const SPEECH: { id: string; title: string; text: string; listenFor: string }[] = [
  { id: "plain", title: "Plain line", text: "I told you I would be here, and I am.", listenFor: "Natural pacing, no robotic stress" },
  { id: "laugh", title: "Laugh", text: "[laughs] I cannot believe you actually did that!", listenFor: "A real laugh, not the word laugh" },
  { id: "sigh", title: "Sigh", text: "[sighs] Fine. You win.", listenFor: "An audible tired breath before the words" },
  { id: "cry", title: "Crying", text: "[crying] I just... I miss her so much.", listenFor: "Shaky, wet voice; breaks in the words" },
  { id: "whisper", title: "Whisper", text: "[whispers] Do not move. They are right outside.", listenFor: "Breathy whisper with tension" },
  { id: "gasp", title: "Gasp", text: "[gasps] Oh my god!", listenFor: "A sharp intake of breath" },
  { id: "cough", title: "Cough in speech", text: "[coughs] Sorry... [coughs] the smoke is thick in here.", listenFor: "Real coughs between the words" },
  { id: "breath", title: "Out of breath", text: "[out of breath] I ran... all the way... from the station.", listenFor: "Panting, short phrases" },
  { id: "accent", title: "Nigerian English", text: "Ehn, you are late again. Abeg, sit down and let us begin.", listenFor: "Authentic rhythm, not a caricature" },
];

const SOUNDS: { id: string; title: string; text: string; listenFor: string }[] = [
  { id: "cough", title: "Cough", text: "A man coughing twice, dry cough, close microphone", listenFor: "Sounds human, no music or speech" },
  { id: "sneeze", title: "Sneeze", text: "A woman sneezing once, then sniffing", listenFor: "Convincing sneeze, clean ending" },
  { id: "gasp", title: "Gasp", text: "A short sharp gasp of surprise, female", listenFor: "One clean gasp" },
  { id: "run", title: "Running breath", text: "A person breathing hard after running, heavy panting", listenFor: "Steady, believable breathing" },
];

const elevenSpeech = SPEECH.flatMap((s): Clip[] => [
  { ...s, id: `eleven-v4:${s.id}`, group: "Speech with feeling", provider: "eleven-v4" },
  { ...s, id: `eleven-tts:${s.id}`, group: "Speech with feeling", provider: "eleven-tts" },
]);
const kieSpeech = SPEECH.filter((s) => ["plain", "laugh", "cry", "cough"].includes(s.id)).flatMap((s): Clip[] => [
  { ...s, id: `kie-tts:${s.id}`, group: "Speech with feeling", provider: "kie-tts" },
  { ...s, id: `kie-dialogue:${s.id}`, group: "Speech with feeling", provider: "kie-dialogue" },
]);
const sounds = SOUNDS.flatMap((s): Clip[] => [
  { ...s, id: `eleven-sfx:${s.id}`, group: "Body sounds", provider: "eleven-sfx" },
  { ...s, id: `kie-sfx:${s.id}`, group: "Body sounds", provider: "kie-sfx" },
]);

export const CLIPS: Clip[] = [...elevenSpeech, ...kieSpeech, ...sounds];

export interface Result {
  state: "idle" | "running" | "done" | "error";
  error?: string;
  url?: string;
  ms?: number;
  rating?: number;
  note?: string;
}

export function characters(clips: Clip[]): number {
  return clips.reduce((n, c) => n + c.text.length, 0);
}

export function countByProvider(clips: Clip[]): { provider: Provider; n: number; chars: number }[] {
  const order = Object.keys(PROVIDER_INFO) as Provider[];
  return order.map((p) => ({ provider: p, n: clips.filter((c) => c.provider === p).length, chars: characters(clips.filter((c) => c.provider === p)) })).filter((r) => r.n > 0);
}

/** Markdown the owner can keep and I can read: what was tried, how it was rated, and what failed. */
export function buildReport(results: Record<string, Result>, date: string): string {
  const lines = [`# Greenroom listening report`, ``, `Date: ${date}`, ``, `Ratings are 1 (bad) to 5 (convincing). Written by the owner after listening.`, ``];
  for (const group of ["Speech with feeling", "Body sounds"] as const) {
    lines.push(`## ${group}`, ``, `| Clip | Provider | Rating | Time | Note |`, `|---|---|---|---|---|`);
    for (const c of CLIPS.filter((x) => x.group === group)) {
      const r = results[c.id];
      if (!r || r.state === "idle") continue;
      const rating = r.state === "error" ? `failed: ${(r.error ?? "").replace(/\|/g, "/")}` : r.rating ? String(r.rating) : "not rated";
      const time = r.ms ? `${(r.ms / 1000).toFixed(1)}s` : "";
      lines.push(`| ${c.title} | ${PROVIDER_INFO[c.provider].label} | ${rating} | ${time} | ${(r.note ?? "").replace(/\|/g, "/").replace(/\n/g, " ")} |`);
    }
    lines.push(``);
  }
  const rated = Object.entries(results).filter(([, r]) => r.rating);
  const avg = new Map<Provider, number[]>();
  for (const [id, r] of rated) {
    const c = CLIPS.find((x) => x.id === id);
    if (c && r.rating) avg.set(c.provider, [...(avg.get(c.provider) ?? []), r.rating]);
  }
  lines.push(`## Average rating by provider`, ``);
  if (avg.size === 0) lines.push(`Nothing rated yet.`);
  for (const [p, v] of avg) lines.push(`- ${PROVIDER_INFO[p].label}: ${(v.reduce((a, b) => a + b, 0) / v.length).toFixed(1)} over ${v.length} clips`);
  return lines.join("\n") + "\n";
}
