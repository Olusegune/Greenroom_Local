// Performance compiler: turns a director's own words ("begins politely, clears his throat, chuckles quietly, pauses,
// then delivers the final sentence with restrained menace") into a structured acting plan, then maps that plan onto what
// one engine can actually be given. It is rule based and offline: the same words always give the same plan, nothing is
// sent anywhere, and nothing is spent.
//
// Three honest rules:
//   1. A clause the compiler does not understand is reported, never dropped quietly.
//   2. Every behaviour is reported per engine as sent, approximated or not sent. "Not sent" is also written to the take's
//      provenance (`notSent`), so an unsupported behaviour is never presented as generated.
//   3. It says what an engine ACCEPTS (engineCaps.ts), never how good it sounds. Quality is the owner's ear.

import { phrases, type BeatMode, type BeatSetting } from "./beats";
import { ALL_SOUND_TAGS } from "./direct";
import { CAPS } from "./engineCaps";
import type { Engine, InworldModel } from "./engines";
import { actsOnWords } from "./engineCaps";
import { DEFAULT_PERFORMANCE, type PerformancePlan } from "./performance";
import type { Line, Pronunciation } from "./types";

// ---- vocabulary -------------------------------------------------------------------------------------------------

export type EventName = "clear_throat" | "chuckle" | "laugh" | "giggle" | "sigh" | "gasp" | "groan" | "cough" | "cry" | "sob" | "sniffle" | "gulp" | "yawn" | "pant" | "breath" | "grunt" | "wince" | "scream";

/** The [tag] each event is written as for engines that read tags, and the soft variant when it is meant quietly. */
const EVENT_TAG: Record<EventName, { tag: string; soft?: string }> = {
  clear_throat: { tag: "clears throat" },
  chuckle: { tag: "chuckles" },
  laugh: { tag: "laughs", soft: "laughs softly" },
  giggle: { tag: "giggles" },
  sigh: { tag: "sighs", soft: "sighs" },
  gasp: { tag: "gasps" },
  groan: { tag: "groans" },
  cough: { tag: "coughs" },
  cry: { tag: "crying" },
  sob: { tag: "sobs" },
  sniffle: { tag: "sniffles" },
  gulp: { tag: "gulps" },
  yawn: { tag: "yawns" },
  pant: { tag: "panting" },
  breath: { tag: "deep breath" },
  grunt: { tag: "grunts" },
  wince: { tag: "winces" },
  scream: { tag: "screams" },
};

/** Inworld documents five non-verbal tags only (see inworld.ts). Others are not sent to it. */
const INWORLD_TAGS: Partial<Record<EventName, { tag: string; exact: boolean }>> = {
  laugh: { tag: "laugh", exact: true },
  sigh: { tag: "sigh", exact: true },
  cough: { tag: "cough", exact: true },
  clear_throat: { tag: "clear throat", exact: true },
  pant: { tag: "breathe", exact: false },
  breath: { tag: "breathe", exact: false },
};

const verified = (tag: string) => ALL_SOUND_TAGS.some((s) => s.tag === tag && s.verified);

const EMOTION_WORDS: [RegExp, string][] = [
  [/\b(polite\w*|courteous\w*|courtesy|civil\w*|genteel|well[- ]mannered)\b/, "polite"],
  [/\b(menac\w*|threaten\w*|sinister|ominous|malevolen\w*)\b/, "menacing"],
  [/\b(ang(ry|er)|furious\w*|fury|rage|raging|livid|irate)\b/, "angry"],
  [/\b(annoy\w*|irritat\w*|exasperat\w*)\b/, "annoyed"],
  [/\b(sad\w*|sorrow\w*|grie[fv]\w*|heartbr\w*|mournful\w*|melanchol\w*)\b/, "sad"],
  [/\b(happy|happi\w*|joy\w*|delight\w*|cheerful\w*|glad)\b/, "happy"],
  [/\b(excit\w*|thrill\w*|eager\w*|giddy)\b/, "excited"],
  [/\b(scared|afraid|terrif\w*|frighten\w*|fear\w*|panick\w*)\b/, "scared"],
  [/\b(nervous\w*|anxious\w*|anxiety|uneasy|jittery)\b/, "nervous"],
  [/\b(tender\w*|loving|affection\w*|gentle|gentleness|warmth|warm)\b/, "tender"],
  [/\b(sarcas\w*|sardonic)\b/, "sarcastic"],
  [/\b(iron(y|ic\w*)|wry\w*|dry humou?r)\b/, "wry"],
  [/\b(contempt\w*|disdain\w*|scorn\w*|sneer\w*|condescend\w*)\b/, "contemptuous"],
  [/\b(calm\w*|serene\w*|composed|unruffled)\b/, "calm"],
  [/\b(amus\w*|playful\w*|mischievous\w*)\b/, "amused"],
  [/\b(bitter\w*|resent\w*)\b/, "bitter"],
  [/\b(hopeful\w*|hope)\b/, "hopeful"],
  [/\b(defian\w*)\b/, "defiant"],
  [/\b(deadpan|flat affect)\b/, "deadpan"],
  [/\b(confident\w*|assured|authoritative)\b/, "confident"],
  [/\b(worr\w*|concern\w*)\b/, "worried"],
  [/\b(embarrass\w*|sheepish\w*|flustered)\b/, "embarrassed"],
  [/\b(sincere\w*|earnest\w*)\b/, "sincere"],
  [/\b(longing|wistful\w*|nostalg\w*)\b/, "wistful"],
  [/\b(smug\w*|self[- ]satisfied|arrogan\w*)\b/, "smug"],
  [/\b(suspicious\w*|wary|guarded)\b/, "suspicious"],
];

const EVENT_WORDS: [RegExp, EventName][] = [
  [/\b(clears?|cleared|clearing)\s+(?:\w+\s+)?throat\b|\bahem\b|\bthroat[- ]clear\w*/, "clear_throat"],
  [/\bchuckl\w*/, "chuckle"],
  [/\bgiggl\w*|\btitter\w*/, "giggle"],
  [/\blaugh\w*|\bcackl\w*|\bguffaw\w*|\bsnicker\w*/, "laugh"],
  [/\bsigh\w*/, "sigh"],
  [/\bgasp\w*/, "gasp"],
  [/\bgroan\w*|\bmoan\w*/, "groan"],
  [/\bcough\w*/, "cough"],
  [/\bsob\w*/, "sob"],
  [/\b(cry|cries|crying|cried|weep\w*|tearful\w*|in tears)\b/, "cry"],
  [/\bsniffl\w*|\bsniff\w*/, "sniffle"],
  [/\bgulp\w*|\bswallow\w*/, "gulp"],
  [/\byawn\w*/, "yawn"],
  [/\bpant\w*|\bout of breath\b|\bgasping for (air|breath)\b/, "pant"],
  [/\b(deep|sharp|shaky|steadying|slow|long) (breath|inhale|exhale)\b|\binhal\w*|\bexhal\w*|\bcatch\w* (his|her|their|my) breath\b|\btakes? a breath\b/, "breath"],
  [/\bgrunt\w*|\bstrain\w*|\bexert\w*/, "grunt"],
  [/\bwinc\w*|\bflinch\w*/, "wince"],
  [/\bscream\w*|\bshriek\w*/, "scream"],
];

const PAUSE_WORD = /\b(paus\w*|silence|hesitat\w*|stammer\w*|falter\w*|trail\w* off|a beat|beat of silence)\b/;
const PHYSICAL: [RegExp, Partial<Record<"effort" | "fatigue" | "pain" | "breathlessness", number>>, string][] = [
  [/\b(running|sprint\w*|racing|fleeing)\b/, { effort: 0.7, breathlessness: 0.7 }, "running"],
  [/\b(lifting|carrying|hauling|heaving)\b/, { effort: 0.7 }, "lifting"],
  [/\b(pushing|dragging)\b/, { effort: 0.7 }, "pushing"],
  [/\b(fighting|struggl\w*|wrestl\w*|brawl\w*)\b/, { effort: 0.8, breathlessness: 0.5 }, "fighting"],
  [/\b(injur\w*|wounded|hurt|bleeding|in pain|agony|painful\w*)\b/, { pain: 0.7 }, "injured"],
  [/\b(cold|freezing|shivering|shiver\w*)\b/, { effort: 0.2 }, "cold"],
  [/\b(walking|strolling|hiking)\b/, { effort: 0.2 }, "walking"],
  [/\b(exhaust\w*|tired|weary|fatigu\w*|drained|worn out)\b/, { fatigue: 0.65 }, ""],
  [/\b(breathless\w*|winded)\b/, { breathlessness: 0.7 }, ""],
];

const NAMED_LANGS = ["Yoruba", "Igbo", "Hausa", "Pidgin", "English", "French", "Spanish", "Arabic", "German", "Italian", "Portuguese", "Hindi", "Tagalog", "Mandarin", "Cantonese", "Japanese", "Swahili", "Twi", "Latin", "Welsh", "Irish", "Scots", "Scottish"];

// ---- the draft --------------------------------------------------------------------------------------------------

export type ActItem =
  | { kind: "emotion"; clause: number; emotion: string; intensity: number; restrained: boolean }
  | { kind: "event"; clause: number; event: EventName; soft: boolean }
  | { kind: "pause"; clause: number; seconds: number }
  | { kind: "delivery"; clause: number; mode: "whisper" | "shout" | "quiet" | "loud" | "slow" | "fast" | "measured" | "halting" }
  | { kind: "physical"; clause: number; activity: string; effort: number; fatigue: number; pain: number; breathlessness: number }
  | { kind: "language"; clause: number; request: string }
  | { kind: "intent"; clause: number; objective?: string; subtext?: string };

export interface Clause {
  text: string;
  /** Where in the line this clause happens, 0 (start) to 1 (end). */
  at: number;
  anchor: "start" | "end" | null;
}

export interface ActingDraft {
  source: string;
  clauses: Clause[];
  items: ActItem[];
  /** Clauses nothing was recognised in. Shown to the director, never dropped silently. */
  unrecognized: string[];
  /** "Pronounce X as Y" requests, offered for the pronunciation dictionary. Not applied by themselves. */
  pronunciations: Pronunciation[];
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

const INTENSITY_UP: [RegExp, number][] = [[/\b(extremely|overwhelming\w*|utterly|unbearabl\w*|desperat\w*)\b/, 0.95], [/\b(very|deeply|intens\w*|strongly|fully|impeccabl\w*|perfectly|thoroughly|genuinely|truly)\b/, 0.82], [/\b(somewhat|mildly|a bit|a little|rather)\b/, 0.4], [/\b(slight\w*|faint\w*|barely|hint of|trace of|touch of|subtle\w*)\b/, 0.25]];
const RESTRAINED = /\b(restrain\w*|understat\w*|muted|suppress\w*|bottled|held back|controlled|contained|tamped)\b/;

function intensityOf(c: string): { value: number; restrained: boolean } {
  const restrained = RESTRAINED.test(c);
  for (const [re, v] of INTENSITY_UP) if (re.test(c)) return { value: restrained ? Math.min(v, 0.4) : v, restrained };
  return { value: restrained ? 0.35 : 0.55, restrained };
}

const splitClauses = (t: string): string[] => t.split(/[,;.!?\n]+|\bthen\b|\band then\b/i).map((s) => s.replace(/^\s*(and|but|so|also|while)\s+/i, "").trim()).filter(Boolean);

/** Reads the director's words. Deterministic and offline. */
export function parseDirection(source: string): ActingDraft {
  let text = source.replace(/\s+/g, " ").trim().slice(0, 1200);
  const pronunciations: Pronunciation[] = [];
  text = text.replace(/\bpronounc\w*\s+["“']?([^"”',;.]+?)["”']?\s+(?:as|like)\s+["“']?([^"”',;.]+?)["”']?(?=\s*(?:[,;.]|$|\band\b))/gi, (_m, from: string, to: string) => {
    pronunciations.push({ from: from.trim(), to: to.trim() });
    return "";
  });
  const raw = splitClauses(text);
  const n = raw.length;
  const clauses: Clause[] = [];
  const items: ActItem[] = [];
  const unrecognized: string[] = [];
  raw.forEach((original, i) => {
    const c = original.toLowerCase();
    const anchor: Clause["anchor"] = /\b(begin\w*|start\w*|open\w*|initially|at first)\b/.test(c) ? "start" : /\b(final\w*|last (sentence|line|word|phrase)|closing|ends? (with|on)|at the end|finishes? (with|on))\b/.test(c) ? "end" : null;
    const at = anchor === "start" ? 0 : anchor === "end" ? 1 : n === 1 ? 0 : i / (n - 1);
    clauses.push({ text: original, at, anchor });
    const before = items.length;
    const { value, restrained } = intensityOf(c);
    const soft = /\b(quiet\w*|soft\w*|gentl\w*|under (his|her|their) breath|faint\w*|slight\w*)\b/.test(c);

    let hasEvent = false;
    for (const [re, event] of EVENT_WORDS) if (re.test(c)) { items.push({ kind: "event", clause: i, event, soft }); hasEvent = true; }
    if (PAUSE_WORD.test(c)) {
      const long = /\b(long|lingering|heavy|dramatic)\b/.test(c);
      const short = /\b(brief|short|slight|small|momentary|tiny)\b/.test(c);
      items.push({ kind: "pause", clause: i, seconds: long ? 1.2 : short ? 0.3 : /hesitat|stammer|falter/.test(c) ? 0.4 : 0.7 });
      if (/hesitat|stammer|falter/.test(c)) items.push({ kind: "delivery", clause: i, mode: "halting" });
    }
    for (const [re, emotion] of EMOTION_WORDS) if (re.test(c)) items.push({ kind: "emotion", clause: i, emotion, intensity: value, restrained });
    for (const [re, v, activity] of PHYSICAL) {
      if (re.test(c)) items.push({ kind: "physical", clause: i, activity, effort: v.effort ?? 0, fatigue: v.fatigue ?? 0, pain: v.pain ?? 0, breathlessness: v.breathlessness ?? 0 });
    }
    if (/\bwhisper\w*|\bhushed\b|\bunder (his|her|their) breath\b/.test(c)) items.push({ kind: "delivery", clause: i, mode: "whisper" });
    if (/\b(shout\w*|yell\w*|bellow\w*|roar\w*|bark\w*)\b/.test(c)) items.push({ kind: "delivery", clause: i, mode: "shout" });
    if (!hasEvent && /\b(quiet\w*|soft\w*|murmur\w*|low voice)\b/.test(c)) items.push({ kind: "delivery", clause: i, mode: "quiet" });
    if (/\b(loud\w*|project\w*|booming|resound\w*)\b/.test(c)) items.push({ kind: "delivery", clause: i, mode: "loud" });
    if (/\b(slow\w*|deliberate\w*|unhurried|drawn out|leisurely)\b/.test(c)) items.push({ kind: "delivery", clause: i, mode: "slow" });
    if (/\b(fast|quick\w*|rushed|hurried|rapid\w*|brisk\w*|breathless pace)\b/.test(c) && !/\bquick(ly)? (laugh|chuckle|breath|glance)/.test(c)) items.push({ kind: "delivery", clause: i, mode: "fast" });
    if (/\b(measured|even(ly)? paced|steady pace|careful\w*)\b/.test(c)) items.push({ kind: "delivery", clause: i, mode: "measured" });
    if (/\b(halting|hesitant|faltering|stuttering)\b/.test(c)) items.push({ kind: "delivery", clause: i, mode: "halting" });

    // Accent or language changes: only when phrased as one, so "British politeness" is not read as an accent request.
    const acc = original.match(/\b(?:in|with)\s+(?:an?\s+)?([A-Z][A-Za-z-]+(?:\s[A-Z][A-Za-z-]+)?)\s+accent\b/);
    const sw = original.match(/\b(?:switch\w*|chang\w*|slip\w*|laps\w*|reverts?)\s+(?:back\s+)?(?:in)?to\s+([A-Z][A-Za-z-]+)/) ?? original.match(/\b(?:speak\w*|says?|saying)\s+in\s+([A-Z][A-Za-z-]+)/);
    if (acc) items.push({ kind: "language", clause: i, request: `${acc[1]} accent` });
    else if (sw && NAMED_LANGS.includes(sw[1]!)) items.push({ kind: "language", clause: i, request: sw[1]! });

    const goal = c.match(/\b(?:trying|wants?|wanting|aims?|intends?|attempts?) to ([^,;.]+)/);
    const sub = c.match(/\b(?:subtext|underneath|secretly|really|actually)[: ,]+([^,;.]+)/);
    if (goal || sub) items.push({ kind: "intent", clause: i, ...(goal ? { objective: goal[1]!.trim() } : {}), ...(sub ? { subtext: sub[1]!.trim() } : {}) });

    if (items.length === before) unrecognized.push(original);
  });
  return { source, clauses, items, unrecognized, pronunciations };
}

// ---- the structured plan ----------------------------------------------------------------------------------------

export interface PlacedEvent { event: EventName; soft: boolean; /** Insert before phrase `boundary` (0 = before the first, P = after the last). */ boundary: number }

export interface CompiledActing {
  draft: ActingDraft;
  plan: PerformancePlan;
  beats: BeatSetting[];
  events: PlacedEvent[];
  /** Silence in seconds after phrase `after` (0-based). */
  pauses: { after: number; seconds: number }[];
  /** A pause asked for before the first phrase, which no engine path here can place. */
  leadPause: number;
  languageRequests: string[];
  /** Things that changed because of what came before this line. */
  carried: string[];
  warnings: string[];
}

const phraseAt = (pos: number, P: number, anchor: Clause["anchor"]): number => (anchor === "end" ? P - 1 : anchor === "start" ? 0 : clamp(Math.round(pos * (P - 1)), 0, P - 1));
const boundaryAt = (pos: number, P: number, anchor: Clause["anchor"]): number => (anchor === "end" ? P : anchor === "start" ? 0 : clamp(Math.round(pos * P), 0, P));

/** What an earlier line left behind: the state its last moment ended in, to be fed to the next line's compile. */
export interface Carry { emotion?: string; intensity?: number; physical?: Pick<PerformancePlan["physical"], "activity" | "effort" | "fatigue" | "pain" | "breathlessness"> }

export function compileActing(source: string | ActingDraft, lineText: string, previous?: Carry): CompiledActing {
  const draft = typeof source === "string" ? parseDirection(source) : source;
  const ps = phrases(lineText);
  const P = Math.max(1, ps.length);
  const clause = (i: number) => draft.clauses[i] ?? { text: "", at: 0, anchor: null as Clause["anchor"] };
  const warnings: string[] = [];
  const carried: string[] = [];

  const emo = draft.items.filter((x): x is Extract<ActItem, { kind: "emotion" }> => x.kind === "emotion").map((x) => ({ ...x, pos: clause(x.clause).anchor === "end" ? 1 : clause(x.clause).at, anchor: clause(x.clause).anchor }));
  const arc = emo.length ? emo.map((x) => ({ position: x.pos, emotion: x.emotion, intensity: x.intensity })).sort((a, b) => a.position - b.position) : DEFAULT_PERFORMANCE.arc.map((p) => ({ ...p }));
  if (!emo.length && previous?.emotion && previous.emotion !== "neutral") {
    arc[0] = { position: 0, emotion: previous.emotion, intensity: clamp((previous.intensity ?? 0.5) * 0.8, 0.1, 1) };
    carried.push(`starts ${previous.emotion}, as the line before ended`);
  }

  const phys = { activity: "still" as string, effort: 0, fatigue: 0, pain: 0, breathlessness: 0 };
  for (const x of draft.items) {
    if (x.kind !== "physical") continue;
    if (x.activity && phys.activity === "still") phys.activity = x.activity;
    phys.effort = Math.max(phys.effort, x.effort);
    phys.fatigue = Math.max(phys.fatigue, x.fatigue);
    phys.pain = Math.max(phys.pain, x.pain);
    phys.breathlessness = Math.max(phys.breathlessness, x.breathlessness);
  }
  for (const x of draft.items) if (x.kind === "event" && (x.event === "pant" || x.event === "grunt")) { phys.breathlessness = Math.max(phys.breathlessness, x.event === "pant" ? 0.6 : 0); phys.effort = Math.max(phys.effort, x.event === "grunt" ? 0.5 : 0); }
  if (previous?.physical && !draft.items.some((x) => x.kind === "physical")) {
    const q = previous.physical;
    const keep = (n: number) => Number((n * 0.7).toFixed(2));
    if (Math.max(q.effort, q.fatigue, q.pain, q.breathlessness) > 0.3) {
      phys.activity = q.activity; phys.effort = keep(q.effort); phys.fatigue = keep(q.fatigue); phys.pain = keep(q.pain); phys.breathlessness = keep(q.breathlessness);
      carried.push("physical state carried from the line before, easing off");
    }
  }
  const activity = (["still", "walking", "running", "lifting", "pushing", "fighting", "injured", "cold", "custom"] as const).find((a) => a === phys.activity) ?? "custom";

  const modes = draft.items.filter((x): x is Extract<ActItem, { kind: "delivery" }> => x.kind === "delivery").map((x) => x.mode);
  let pace = 1;
  if (modes.includes("slow")) pace *= 0.85;
  if (modes.includes("measured")) pace *= 0.93;
  if (modes.includes("fast")) pace *= 1.15;
  if (modes.includes("halting")) pace *= 0.92;
  const restrained = emo.some((x) => x.restrained);
  const projection = modes.includes("loud") || modes.includes("shout") ? 0.85 : modes.includes("whisper") ? 0.1 : modes.includes("quiet") || restrained ? 0.28 : 0.5;
  const tension = clamp(0.2 + (emo.some((x) => ["menacing", "angry", "scared", "nervous", "suspicious"].includes(x.emotion)) ? 0.3 : 0) + (modes.includes("halting") ? 0.1 : 0), 0, 1);
  const breathiness = modes.includes("whisper") ? 0.7 : modes.includes("quiet") ? 0.35 : 0.15;
  const intent = draft.items.filter((x): x is Extract<ActItem, { kind: "intent" }> => x.kind === "intent");

  const plan: PerformancePlan = {
    ...DEFAULT_PERFORMANCE,
    objective: intent.find((x) => x.objective)?.objective?.slice(0, 160) ?? "",
    subtext: intent.find((x) => x.subtext)?.subtext?.slice(0, 160) ?? "",
    arc,
    physical: { activity, effort: phys.effort, fatigue: phys.fatigue, pain: phys.pain, breathlessness: phys.breathlessness, note: "" },
    pace: clamp(Number(pace.toFixed(2)), 0.7, 1.2),
    projection, tension, breathiness,
    events: [],
  };

  // Beats: one per phrase that has its own emotion, pace or pause.
  const beats = new Map<number, BeatSetting>();
  const beat = (i: number): BeatSetting => { const b = beats.get(i) ?? { text: ps[i] ?? "" }; beats.set(i, b); return b; };
  if (ps.length >= 2) {
    for (const x of emo) beat(phraseAt(x.pos, P, x.anchor)).emotion = x.emotion;
    for (const x of draft.items) {
      if (x.kind !== "delivery") continue;
      const c = clause(x.clause);
      const i = phraseAt(c.at, P, c.anchor);
      if (x.mode === "slow") beat(i).pace = 0.85;
      if (x.mode === "fast") beat(i).pace = 1.15;
      if (x.mode === "halting") beat(i).pace = 0.92;
    }
  }
  const pauses: CompiledActing["pauses"] = [];
  let leadPause = 0;
  const events: PlacedEvent[] = [];
  for (const x of draft.items) {
    const c = clause(x.clause);
    if (x.kind === "event") events.push({ event: x.event, soft: x.soft, boundary: boundaryAt(c.at, P, c.anchor) });
    if (x.kind === "pause") {
      const b = boundaryAt(c.at, P, c.anchor);
      if (b === 0) leadPause = Math.max(leadPause, x.seconds);
      else pauses.push({ after: b - 1, seconds: x.seconds });
    }
  }
  for (const p of pauses) if (ps.length >= 2 || p.after === 0) beat(p.after).pauseAfter = clamp(Math.max(beat(p.after).pauseAfter ?? 0, p.seconds), 0, 2);
  const keep = [...beats.entries()].filter(([, b]) => b.emotion || b.pace || b.pauseAfter).sort((a, b) => a[0] - b[0]).map(([, b]) => b);

  const languageRequests = draft.items.filter((x): x is Extract<ActItem, { kind: "language" }> => x.kind === "language").map((x) => x.request);
  if (languageRequests.length) warnings.push(`Greenroom cannot change language or accent inside a line (${languageRequests.join(", ")}): the voice you cast decides that. Cast a voice for it, or split the line.`);
  if (leadPause > 0) warnings.push(`A pause before the line (${leadPause}s) cannot be placed; add it as a pause after the line before.`);
  if (draft.unrecognized.length) warnings.push(`Not understood, so not used: ${draft.unrecognized.map((u) => `"${u}"`).join(", ")}.`);
  return { draft, plan, beats: keep, events, pauses, leadPause, languageRequests, carried, warnings };
}

/** What a finished line leaves for the next one. */
export function carryFrom(c: CompiledActing): Carry {
  const last = c.plan.arc[c.plan.arc.length - 1];
  return { ...(last ? { emotion: last.emotion, intensity: last.intensity } : {}), physical: { activity: c.plan.physical.activity, effort: c.plan.physical.effort, fatigue: c.plan.physical.fatigue, pain: c.plan.physical.pain, breathlessness: c.plan.physical.breathlessness } };
}

// ---- mapping to one engine --------------------------------------------------------------------------------------

export interface RenderItem { what: string; status: "sent" | "approximated" | "not_sent"; how: string }

export interface ActingRender {
  /** The line as it should be sent: text with positioned tags, plan, beats and speed. The saved line is never changed. */
  line: Line;
  items: RenderItem[];
  /** Plain-words list for the take's provenance and the cost sheet. Only what was NOT sent. */
  notSent: string[];
  /** Ways to get more of the direction through, each with what it costs. */
  suggestions: string[];
  mode: BeatMode;
  /** How many engine requests making this line will take. */
  requests: number;
  compiled: CompiledActing;
}

export interface Target { engine: Engine; inworldModel?: InworldModel }

/** Writes tags into the text at phrase boundaries. Returns the new text and the phrase texts it produced, one per original phrase. */
function tagText(ps: string[], at: Map<number, string[]>): { text: string; ps: string[] } {
  const out = ps.map((p, i) => [...(i === 0 ? (at.get(0) ?? []).map((t) => `[${t}]`) : []), p, ...(at.get(i + 1) ?? []).map((t) => `[${t}]`)].join(" "));
  return { text: out.join(" "), ps: out };
}

export function renderActing(line: Line, c: CompiledActing, t: Target): ActingRender {
  const caps = CAPS[t.engine];
  const words = actsOnWords(t.engine, t.inworldModel);
  const items: RenderItem[] = [];
  const suggestions: string[] = [];
  const ps = phrases(line.text);
  const wantsAssemble = line.beatMode === "assemble" && ps.length >= 2;
  const mode: BeatMode = wantsAssemble ? "assemble" : "cues";
  const out = (what: string, status: RenderItem["status"], how: string) => items.push({ what, status, how });

  // Emotion, intent, physical state and voice quality: all delivered as written direction.
  const arcWhat = c.plan.arc.length > 1 ? `emotion: ${c.plan.arc.map((p) => p.emotion).join(" → ")}` : c.plan.arc[0]?.emotion && c.plan.arc[0].emotion !== "neutral" ? `emotion: ${c.plan.arc[0].emotion}` : "";
  const physicalOn = Math.max(c.plan.physical.effort, c.plan.physical.fatigue, c.plan.physical.pain, c.plan.physical.breathlessness) > 0.2;
  if (arcWhat) out(arcWhat, words ? (c.plan.arc.length > 1 && mode === "cues" ? "approximated" : "sent") : "not_sent", words ? (c.plan.arc.length > 1 && mode === "cues" ? "written as 'starts … ends …'; the change inside the line is up to the voice" : "written direction") : `${t.engine} does not act on written direction`);
  if (physicalOn) out(`physical state: ${c.plan.physical.activity}`, words ? "approximated" : "not_sent", words ? "written direction; no sound is added for it" : `${t.engine} does not act on written direction`);
  if (c.plan.objective || c.plan.subtext) out("intent and subtext", words ? "sent" : "not_sent", words ? "written direction" : `${t.engine} does not act on written direction`);
  const quality = [c.plan.projection >= 0.7 && "projected", c.plan.projection <= 0.3 && "quiet", c.plan.tension >= 0.5 && "tense", c.plan.breathiness >= 0.4 && "breathy"].filter(Boolean) as string[];
  if (quality.length) out(`voice: ${quality.join(", ")}`, words ? "sent" : "not_sent", words ? "written direction" : `${t.engine} does not act on written direction`);
  for (const m of new Set(c.draft.items.filter((x): x is Extract<ActItem, { kind: "delivery" }> => x.kind === "delivery").map((x) => x.mode))) {
    if (m === "whisper" || m === "shout") out(m === "whisper" ? "whispering" : "shouting", words ? "sent" : "not_sent", words ? (m === "whisper" ? "as a [whispers] tag" : "as a [shouting] tag (not yet judged by ear)") : `${t.engine} cannot whisper or shout on request`);
  }

  // Pace: a speed setting, where the engine has one.
  if (Math.abs(c.plan.pace - 1) > 0.02) out(`pace ×${c.plan.pace}`, caps.speed ? "sent" : "not_sent", caps.speed ? "speed setting" : `${t.engine} has no speed setting`);

  // Vocal events: written as tags at phrase boundaries, only where the engine plays them.
  const at = new Map<number, string[]>();
  for (const e of c.events) {
    const spec = EVENT_TAG[e.event];
    const name = e.event.replace("_", " ");
    if (t.engine === "inworld") {
      const m = INWORLD_TAGS[e.event];
      if (!m) { out(name, "not_sent", "Inworld has no such sound; use a sound clip"); continue; }
      (at.get(e.boundary) ?? at.set(e.boundary, []).get(e.boundary)!).push(m.tag);
      out(name, m.exact ? "sent" : "approximated", m.exact ? `as [${m.tag}]` : `sent as a plain [${m.tag}]`);
    } else if (caps.nonverbal) {
      const tag = e.soft && spec.soft ? spec.soft : spec.tag;
      (at.get(e.boundary) ?? at.set(e.boundary, []).get(e.boundary)!).push(tag);
      out(name, "sent", verified(tag) ? `as [${tag}]` : `as [${tag}] (this tag has not been judged by ear)`);
    } else out(name, "not_sent", `${t.engine} does not play sounds from tags`);
  }
  const tagged = tagText(ps, at);

  // Pauses and per-phrase pace need the line made phrase by phrase.
  for (const p of c.pauses) out(`pause ${p.seconds}s`, mode === "assemble" ? "sent" : "not_sent", mode === "assemble" ? "silence between separately made phrases" : "one-request lines cannot hold a timed pause");
  if (c.pauses.length && mode !== "assemble") suggestions.push(`Make this line phrase by phrase to get the pause${c.pauses.length > 1 ? "s" : ""}: ${ps.length} requests instead of 1, and the joins can sound different.`);
  if (c.beats.some((b) => b.pace) && mode !== "assemble") suggestions.push("Per-phrase pace also needs the line made phrase by phrase.");

  for (const l of c.languageRequests) out(`language or accent: ${l}`, "not_sent", "the cast voice decides language and accent");
  if (c.leadPause > 0) out(`pause before the line ${c.leadPause}s`, "not_sent", "no place to put silence before the first phrase");

  const text = caps.nonverbal || t.engine === "inworld" ? tagged.text : line.text;
  const beatList = text !== line.text && ps.length >= 2 && phrases(text).length === ps.length ? c.beats.map((b) => ({ ...b, text: phrases(text)[ps.indexOf(b.text)] ?? b.text })) : c.beats;
  const acted: Line = {
    ...line,
    text,
    performance: c.plan,
    beats: [...(Array.isArray(line.beats) ? (line.beats as BeatSetting[]) : []).filter((b) => !beatList.some((n) => n.text === b.text)), ...beatList],
    beatMode: mode,
  };
  const notSent = items.filter((i) => i.status === "not_sent").map((i) => `${i.what} (${i.how})`);
  return { line: acted, items, notSent, suggestions, mode, requests: mode === "assemble" ? ps.length : 1, compiled: c };
}

/** The line with the director's own words compiled for this engine, or the line untouched if it has none. */
export function withActing(line: Line & { acting?: string }, t: Target, previous?: Carry): { line: Line; render: ActingRender | null } {
  const src = line.acting?.trim();
  if (!src) return { line, render: null };
  const render = renderActing(line, compileActing(src, line.text, previous), t);
  return { line: render.line, render };
}
