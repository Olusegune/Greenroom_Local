// What each engine can be asked to do about ten kinds of vocal expression, and HOW (written tag, written instruction, assembled phrases,
// or a separate sound clip). It says what an engine ACCEPTS, never how it sounds: nothing here has been judged by ear, so no
// control is "native_verified". A control becomes verified only when the owner records a listening result.

import { ENGINE_ORDER, ENGINES, type Engine } from "../engines";

export type Control = "laugh" | "cry" | "whisper" | "shout" | "sigh" | "cough" | "breathless" | "sarcasm" | "transition" | "exertion";
export const CONTROLS: { id: Control; label: string }[] = [
  { id: "laugh", label: "Laughing" }, { id: "cry", label: "Crying" }, { id: "whisper", label: "Whispering" }, { id: "shout", label: "Shouting" }, { id: "sigh", label: "Sighing" },
  { id: "cough", label: "Coughing" }, { id: "breathless", label: "Breathlessness" }, { id: "sarcasm", label: "Sarcasm" }, { id: "transition", label: "Emotional transitions" }, { id: "exertion", label: "Physical exertion" },
];

/** native_verified: sent to the engine in its own format AND a listener confirmed it. native_unverified: sent in the engine's own format, nobody has confirmed it. approximated: turned into a written instruction or split into phrases. asset: made by a separate sound clip mixed in. unsupported: cannot be done by this engine. */
export type Support = "native_verified" | "native_unverified" | "approximated" | "asset" | "unsupported";

export interface ControlSupport { status: Support; how: string }

const NONVERBAL: Control[] = ["laugh", "sigh", "cough", "breathless", "exertion"];
const DELIVERY: Control[] = ["cry", "whisper", "shout", "sarcasm"];

/** Listening results the owner has recorded (control by engine). Empty today: nothing has been judged by ear. */
export const VERIFIED_BY_EAR: ReadonlySet<string> = new Set<string>();

const asset = (c: Control): ControlSupport => ({ status: "asset", how: `A separate ${c} clip from the character's reaction library (or your own audio) mixed into the line. The voice itself does not perform it.` });

export function controlSupport(engine: Engine, control: Control): ControlSupport {
  const heard = VERIFIED_BY_EAR.has(`${engine}:${control}`);
  const native = (how: string): ControlSupport => ({ status: heard ? "native_verified" : "native_unverified", how });
  if (control === "transition") return engine === "elevenlabs" || engine === "inworld" || engine === "voicekiller" ? { status: "approximated", how: "The line is made phrase by phrase with a different direction for each phrase, then joined. One request per phrase." } : { status: "unsupported", how: `${ENGINES[engine].label} takes no direction, so a change of feeling inside a line cannot be requested.` };
  switch (engine) {
    case "elevenlabs":
      if (NONVERBAL.includes(control) || DELIVERY.includes(control)) return native("Written as a [tag] in the line. Eleven v3 and v4 act on tags.");
      break;
    case "inworld":
      if (control === "laugh" || control === "sigh" || control === "cough") return native("Sent as one of Inworld's non-verbal tags, exactly.");
      if (control === "breathless" || control === "exertion") return { status: "approximated", how: "Inworld has one breathing tag, sent as the nearest match, not an exact one." };
      if (DELIVERY.includes(control)) return { status: "approximated", how: "Steered with a written sentence on Inworld TTS 2 only. Not available on the flash model." };
      break;
    case "voicekiller":
      if (DELIVERY.includes(control)) return { status: "approximated", how: "Requested as an instruction sentence. No sound tags." };
      return asset(control);
    default:
      break;
  }
  if (NONVERBAL.includes(control)) return asset(control);
  return { status: "unsupported", how: `${ENGINES[engine].label} reads plain text and takes no delivery direction.` };
}

export interface ExpressionReport {
  engine: Engine;
  perControl: { control: Control; support: ControlSupport }[];
  /** Controls this engine cannot do and cannot approximate. The line will be read without them. */
  unsupported: Control[];
  approximated: Control[];
  assets: Control[];
  /** Engines that handle the unsupported ones natively or by approximation, in the app's usual order. */
  alternatives: Engine[];
}

/** What would happen to the expressions a line asks for on this engine, and where else they could be done. Never silent. */
export function expressionReport(engine: Engine, wanted: Control[]): ExpressionReport {
  const perControl = wanted.map((control) => ({ control, support: controlSupport(engine, control) }));
  const unsupported = perControl.filter((x) => x.support.status === "unsupported").map((x) => x.control);
  const alternatives = unsupported.length ? ENGINE_ORDER.filter((e) => e !== engine && unsupported.every((c) => ["native_verified", "native_unverified", "approximated"].includes(controlSupport(e, c).status))) : [];
  return { engine, perControl, unsupported, approximated: perControl.filter((x) => x.support.status === "approximated").map((x) => x.control), assets: perControl.filter((x) => x.support.status === "asset").map((x) => x.control), alternatives };
}

/** The listening test for one control: what to write, what to hear for, and what counts as a failure. */
export const LISTENING_TESTS: Record<Control, { line: string; listenFor: string; failure: string }> = {
  laugh: { line: "Ha! [laughs] Oh, that is wonderful.", listenFor: "A real laugh before the second sentence.", failure: "The voice says the word \"laughs\" aloud, or nothing happens." },
  cry: { line: "I tried so hard. [crying] I really did.", listenFor: "A catch in the voice, wetness, a sob.", failure: "The voice reads the tag aloud, or sounds calm." },
  whisper: { line: "[whispers] Do not wake them. Not a sound.", listenFor: "Breathy, quiet, close.", failure: "Normal volume, or the tag spoken aloud." },
  shout: { line: "[shouting] Get out! Get out right now!", listenFor: "Raised, strained, projecting.", failure: "The same level as the neutral line." },
  sigh: { line: "[sighs] Fine. We will do it your way.", listenFor: "An audible exhale before the words.", failure: "No breath, or the word \"sighs\" spoken." },
  cough: { line: "[coughs] Sorry. Where was I?", listenFor: "A cough before the words.", failure: "The word \"coughs\" spoken aloud." },
  breathless: { line: "[out of breath] I ran... all the way... from the station.", listenFor: "Gasps between phrases, shortened lines.", failure: "Even, rested delivery." },
  sarcasm: { line: "Oh, brilliant. Another meeting. Just what I wanted.", listenFor: "Flat, over-sweet delivery that means the opposite.", failure: "Sincere reading of every word." },
  transition: { line: "I am fine. (phrase 2, angry) I said I am fine! (phrase 3, tired) Leave it.", listenFor: "A clear change of feeling at each phrase, smooth joins.", failure: "One feeling throughout, or audible seams." },
  exertion: { line: "[straining] Just... a little... more. Lift!", listenFor: "Effort in the voice: grunts, strain, breath.", failure: "Calm delivery." },
};
