// Languages and accents offered for finding voices and labelling characters. Each tile names the language, a flag that
// stands for where it is mainly spoken (a visual cue, not a claim), and how to find matching voices in each engine.
// Nothing here says a voice has an authentic accent: that is decided by listening.

export interface Tile {
  id: string;
  name: string;
  /** Country flag shown on the tile (lower-case code used by flag-icons). */
  cc: string;
  /** ISO language code used by ElevenLabs and to match other engines. */
  lang: string;
  /** Region for a regional variant, such as GB or NG, matched against VoiceKiller and Piper locales. */
  region?: string;
  /** ElevenLabs accent filter for a regional variant of a language. */
  accent?: string;
  /** Spoken mixing of languages with no code of its own. */
  mixed?: boolean;
}

const T = (id: string, name: string, cc: string, lang: string, extra: Partial<Tile> = {}): Tile => ({ id, name, cc, lang, ...extra });

export const TILES: Tile[] = [
  T("en-us", "English (American)", "us", "en", { region: "US", accent: "american" }),
  T("en-gb", "English (British)", "gb", "en", { region: "GB", accent: "british" }),
  T("en-ng", "English (Nigerian)", "ng", "en", { region: "NG", accent: "nigerian" }),
  T("pcm", "Nigerian Pidgin", "ng", "en", { accent: "nigerian", mixed: true }),
  T("en-gh", "English (Ghanaian)", "gh", "en", { region: "GH", accent: "ghanaian" }),
  T("en-za", "English (South African)", "za", "en", { region: "ZA", accent: "south african" }),
  T("en-ke", "English (Kenyan)", "ke", "en", { region: "KE", accent: "kenyan" }),
  T("en-in", "English (Indian)", "in", "en", { region: "IN", accent: "indian" }),
  T("en-au", "English (Australian)", "au", "en", { region: "AU", accent: "australian" }),
  T("en-ie", "English (Irish)", "ie", "en", { region: "IE", accent: "irish" }),
  T("en-sct", "English (Scottish)", "gb-sct", "en", { accent: "scottish" }),
  T("en-jm", "English (Jamaican)", "jm", "en", { region: "JM", accent: "jamaican" }),
  T("en-ca", "English (Canadian)", "ca", "en", { region: "CA", accent: "canadian" }),
  T("en-ph", "English (Filipino)", "ph", "en", { region: "PH", accent: "filipino" }),
  T("yo", "Yoruba", "ng", "yo"),
  T("ig", "Igbo", "ng", "ig"),
  T("ha", "Hausa", "ng", "ha"),
  T("sw", "Swahili", "ke", "sw"),
  T("zu", "Zulu", "za", "zu"),
  T("xh", "Xhosa", "za", "xh"),
  T("af", "Afrikaans", "za", "af"),
  T("am", "Amharic", "et", "am"),
  T("so", "Somali", "so", "so"),
  T("ar", "Arabic", "sa", "ar"),
  T("fr", "French", "fr", "fr", { region: "FR" }),
  T("fr-ca", "French (Canadian)", "ca", "fr", { region: "CA", accent: "canadian" }),
  T("es", "Spanish (Spain)", "es", "es", { region: "ES" }),
  T("es-mx", "Spanish (Mexican)", "mx", "es", { region: "MX", accent: "mexican" }),
  T("pt-br", "Portuguese (Brazilian)", "br", "pt", { region: "BR", accent: "brazilian" }),
  T("pt", "Portuguese (Portugal)", "pt", "pt", { region: "PT" }),
  T("de", "German", "de", "de"),
  T("it", "Italian", "it", "it"),
  T("nl", "Dutch", "nl", "nl"),
  T("pl", "Polish", "pl", "pl"),
  T("ru", "Russian", "ru", "ru"),
  T("uk", "Ukrainian", "ua", "uk"),
  T("cs", "Czech", "cz", "cs"),
  T("sk", "Slovak", "sk", "sk"),
  T("hu", "Hungarian", "hu", "hu"),
  T("ro", "Romanian", "ro", "ro"),
  T("bg", "Bulgarian", "bg", "bg"),
  T("el", "Greek", "gr", "el"),
  T("hr", "Croatian", "hr", "hr"),
  T("sr", "Serbian", "rs", "sr"),
  T("sl", "Slovenian", "si", "sl"),
  T("tr", "Turkish", "tr", "tr"),
  T("he", "Hebrew", "il", "he"),
  T("fa", "Persian", "ir", "fa"),
  T("hi", "Hindi", "in", "hi"),
  T("ta", "Tamil", "in", "ta"),
  T("te", "Telugu", "in", "te"),
  T("bn", "Bengali", "bd", "bn"),
  T("ur", "Urdu", "pk", "ur"),
  T("ne", "Nepali", "np", "ne"),
  T("si", "Sinhala", "lk", "si"),
  T("zh", "Chinese (Mandarin)", "cn", "zh"),
  T("yue", "Cantonese", "hk", "zh", { accent: "cantonese" }),
  T("ja", "Japanese", "jp", "ja"),
  T("ko", "Korean", "kr", "ko"),
  T("vi", "Vietnamese", "vn", "vi"),
  T("th", "Thai", "th", "th"),
  T("id", "Indonesian", "id", "id"),
  T("ms", "Malay", "my", "ms"),
  T("fil", "Filipino (Tagalog)", "ph", "fil"),
  T("taglish", "Taglish", "ph", "fil", { accent: "filipino", mixed: true }),
  T("sv", "Swedish", "se", "sv"),
  T("no", "Norwegian", "no", "no"),
  T("da", "Danish", "dk", "da"),
  T("fi", "Finnish", "fi", "fi"),
  T("is", "Icelandic", "is", "is"),
  T("ca", "Catalan", "es-ct", "ca"),
  T("cy", "Welsh", "gb-wls", "cy"),
  T("lv", "Latvian", "lv", "lv"),
  T("lt", "Lithuanian", "lt", "lt"),
  T("et", "Estonian", "ee", "et"),
  T("ka", "Georgian", "ge", "ka"),
  T("hy", "Armenian", "am", "hy"),
  T("kk", "Kazakh", "kz", "kk"),
  T("uz", "Uzbek", "uz", "uz"),
  T("az", "Azerbaijani", "az", "az"),
  T("km", "Khmer", "kh", "km"),
  T("lo", "Lao", "la", "lo"),
  T("my", "Burmese", "mm", "my"),
];

export const tileById = (id: string): Tile | undefined => TILES.find((t) => t.id === id);

/** The tile whose name a character carries as its language label, so its flag can be shown. */
export const tileByName = (name: string): Tile | undefined => TILES.find((t) => t.name === name || t.name.startsWith(name + " ("));

/** Accent labels worth offering as quick filters. Free text is always allowed. */
export const ACCENTS = ["nigerian", "ghanaian", "south african", "kenyan", "american", "british", "irish", "scottish", "australian", "indian", "jamaican", "filipino", "korean", "japanese", "french", "spanish", "arabic"];

export function languageName(code: string): string {
  return TILES.find((t) => t.lang === code && !t.region && !t.mixed)?.name ?? TILES.find((t) => t.lang === code)?.name.replace(/ \(.*\)$/, "") ?? code;
}

/** Does an engine's locale (`en-GB`, `en_US`, `yo`) belong to this tile? A tile with a region needs that region. */
export function localeMatches(t: Tile, locale: string): boolean {
  const [lang = "", region = ""] = locale.replace("_", "-").split("-");
  if (lang.toLowerCase() !== t.lang) return false;
  if (t.mixed) return false;
  return t.region ? region.toUpperCase() === t.region : true;
}
