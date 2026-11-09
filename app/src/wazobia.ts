import type { VoiceEntry } from "./types";

/** WazobiaVoice (Axiveri) is a gated Hugging Face model: one-click install still needs the person's own account and token. */
export const WAZOBIA_PAGE = "https://huggingface.co/Axiveri/WazobiaVoice";
export const TOKEN_PAGE = "https://huggingface.co/settings/tokens";
export const WAZOBIA_DOWNLOAD_GB = 3.2;

export const WAZOBIA_LANGUAGES = [
  { code: "en", label: "Nigerian English" },
  { code: "yo", label: "Yoruba" },
  { code: "ha", label: "Hausa" },
  { code: "ig", label: "Igbo" },
] as const;
export type WazobiaLanguage = (typeof WAZOBIA_LANGUAGES)[number]["code"];

export const WAZOBIA_VOICES = ["adaeze", "amara", "bolaji", "elder_deji", "emeka", "hauwa", "ife", "james", "john", "musa", "ngozi", "tunde", "wura"] as const;

export type SetupStep = "token" | "terms" | "engine" | "model" | "ready";

export interface SetupFacts { hasToken: boolean; termsOpened: boolean; engineReady: boolean; modelReady: boolean }

/** The one thing to do next. The golden path is always the first step that is not yet true. */
export function nextStep(f: SetupFacts): SetupStep {
  if (f.modelReady && f.engineReady) return "ready";
  if (!f.hasToken) return "token";
  if (!f.termsOpened && !f.modelReady) return "terms";
  if (!f.engineReady) return "engine";
  return "model";
}

export const STEP_LABEL: Record<Exclude<SetupStep, "ready">, { title: string; button: string }> = {
  token: { title: "Connect your Hugging Face account", button: "Save token" },
  terms: { title: "Accept the model terms (free, once)", button: "Open model page" },
  engine: { title: "Install the local voice engine", button: "Install engine" },
  model: { title: `Download WazobiaVoice (${WAZOBIA_DOWNLOAD_GB} GB)`, button: "Download WazobiaVoice" },
};

/** A library voice. The id carries the language ("ife@yo") so one reference voice can speak several languages. */
export function wazobiaVoiceEntry(voice: string, lang: WazobiaLanguage): Omit<VoiceEntry, "createdAt"> {
  const language = WAZOBIA_LANGUAGES.find((l) => l.code === lang)?.label ?? "Nigerian English";
  const name = voice.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
  return {
    id: `${voice}@${lang}`, name: `${name} (${language})`, provider: "wazobia", source: "library", language, accent: "Nigerian", gender: "",
    notes: "WazobiaVoice built-in voice. Accent quality is not yet reviewed by native listeners: judge by ear. Research licence, not for commercial use.",
  };
}

/** Plain words for the failures a person can fix themselves. */
export function installHint(message: string): string {
  if (/accept|refused|terms/i.test(message)) return "Open the model page, press Agree and access repository while signed in to the same Hugging Face account, then try again.";
  if (/token|Add your/i.test(message)) return "Paste a Hugging Face read token above, then try again.";
  if (/connect|reach/i.test(message)) return "Check your internet connection. The download resumes where it stopped.";
  if (/did not finish|could not start|verification|could not load/i.test(message)) return "Press \"Find out why it failed\" below to see the likely cause, then try again. Partly downloaded files are kept and checked before use.";
  return "Try again. Partly downloaded files are kept and checked before use.";
}
