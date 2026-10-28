import type { Provider } from "./api";

/** The places a voice can come from. A voice belongs to one engine, so choosing a voice chooses the engine. */
export type Engine = "elevenlabs" | "voicekiller" | "kie" | "piper" | "local";

export interface EngineInfo {
  label: string;
  /** Runs on this computer: free, private, works offline. */
  local: boolean;
  /** Understands [laughs]-style tags written into the text. */
  tags: boolean;
  blurb: string;
}

export const ENGINES: Record<Engine, EngineInfo> = {
  elevenlabs: { label: "ElevenLabs", local: false, tags: true, blurb: "The most expressive. Laughs, sighs and whispers from tags. Voice design and cloning." },
  voicekiller: { label: "VoiceKiller", local: false, tags: false, blurb: "About two thousand voices in many languages. Delivery is requested in words; no laugh or cough sounds." },
  kie: { label: "Kie", local: false, tags: false, blurb: "ElevenLabs Turbo through Kie, with 67 preset voices. Sound tags are not used." },
  piper: { label: "Piper (offline)", local: true, tags: false, blurb: "Runs on this PC with no internet and no cost. Many languages. Plain speech only." },
  local: { label: "My local server", local: true, tags: false, blurb: "A speech program you run on this PC, such as a Kokoro or Chatterbox server." },
};

export const ENGINE_ORDER: Engine[] = ["elevenlabs", "voicekiller", "kie", "piper", "local"];

export type ElevenModel = "eleven_v4" | "eleven_v3";

/** The backend provider name that renders speech for a voice from this engine. */
export function providerFor(engine: Engine, model: ElevenModel, vkClone = false): Provider {
  switch (engine) {
    case "elevenlabs":
      return model === "eleven_v4" ? "eleven-v4" : "eleven-tts";
    case "voicekiller":
      return vkClone ? "voicekiller-clone" : "voicekiller";
    case "kie":
      return "kie-tts";
    case "piper":
      return "piper";
    case "local":
      return "local";
  }
}

export type Quality = "standard" | "high" | "wav44" | "wav48";

/** Audio quality asked of ElevenLabs. Higher qualities need a higher ElevenLabs plan (docs, 2026-10-26). */
export const QUALITIES: { id: Quality; label: string; format: string; note: string }[] = [
  { id: "standard", label: "Standard: MP3 128 kbps", format: "mp3_44100_128", note: "Works on every plan." },
  { id: "high", label: "High: MP3 192 kbps", format: "mp3_44100_192", note: "Needs the Creator plan or above." },
  { id: "wav44", label: "Lossless: WAV 44.1 kHz", format: "wav_44100", note: "Needs the Pro plan or above. Best for pro work." },
  { id: "wav48", label: "Lossless: WAV 48 kHz", format: "wav_48000", note: "The plan needed is not stated by ElevenLabs. If it fails, go back to Standard." },
];

export const qualityFormat = (q: Quality | undefined): string => QUALITIES.find((x) => x.id === q)?.format ?? "mp3_44100_128";

/**
 * What the owner pays, as entered by them: Greenroom cannot see a price. Zero or missing means unknown, and then only
 * characters are counted. Offline engines are always free.
 */
export interface Prices {
  currency: string;
  /** Cost per 1,000 characters, by engine. */
  perKChars: Partial<Record<Engine, number>>;
  sfxClip: number;
  directorCall: number;
  designPreview: number;
  /** One Suno music request (usually two tracks). */
  musicRun?: number;
}

export const DEFAULT_PRICES: Prices = { currency: "USD", perKChars: {}, sfxClip: 0, directorCall: 0, designPreview: 0 };

export type SoundEngine = "elevenlabs" | "kie";
export const SOUND_ENGINES: { id: SoundEngine; label: string; ledger: string; provider: "eleven-sfx" | "kie-sfx"; key: "elevenlabs" | "kie" }[] = [
  { id: "elevenlabs", label: "ElevenLabs sound effects", ledger: "ElevenLabs sound effects", provider: "eleven-sfx", key: "elevenlabs" },
  { id: "kie", label: "Kie sound effects v2", ledger: "Kie sound effects", provider: "kie-sfx", key: "kie" },
];
export const soundEngineOf = (cfg: { soundEngine?: SoundEngine }) => SOUND_ENGINES.find((s) => s.id === cfg.soundEngine) ?? SOUND_ENGINES[0]!;

export interface EnginesCfg {
  elevenModel: ElevenModel;
  quality: Quality;
  /** Look for a new Greenroom when it starts. Off means only when you press the button. Default on. */
  updateCheck?: boolean;
  /** Which engine makes sound clips and the atmosphere. */
  soundEngine?: SoundEngine;
  prices: Prices;
  localServer: { url: string; model: string };
}

export const DEFAULT_ENGINES_CFG: EnginesCfg = { elevenModel: "eleven_v4", quality: "standard", prices: DEFAULT_PRICES, localServer: { url: "http://127.0.0.1:8880", model: "kokoro" } };

/** Kie's preset voices for ElevenLabs Turbo 2.5 (from Kie's docs, 2026-10-26). Names repeat, so the id is what counts. */
export const KIE_VOICES: { id: string; name: string; style: string }[] = [
  ["EkK5I93UQWFDigLMpZcX", "James", "Husky, engaging and bold"],
  ["Z3R5wn05IrDiVCyEkUrK", "Arabella", "Mysterious and emotive"],
  ["NNl6r8mD7vthiJatiJt1", "Bradford", "Expressive and articulate"],
  ["YOq2y2Up4RgXP2HyXjE5", "Xavier", "Dominating, metallic announcer"],
  ["B8gJV1IhpuegLxdpXFOE", "Kuon", "Cheerful, clear and steady"],
  ["2zRM7PkgwBPiau2jvVXc", "Monika Sogam", "Deep and natural"],
  ["1SM7GgM6IMuvQlz2BwM3", "Mark (casual)", "Casual, relaxed and light"],
  ["5l5f8iK3YPeGga21rQIX", "Adeline", "Feminine and conversational"],
  ["scOwDtmlUjD3prqpp97I", "Sam", "Support agent"],
  ["NOpBlnGInO9m6vDvFkFC", "Spuds Oxley", "Wise and approachable"],
  ["BZgkqPqms7Kj9ulSkVzn", "Eve", "Authentic, energetic and happy"],
  ["wo6udizrrtpIxWGp2qJk", "Northern Terry", ""],
  ["gU0LNdkMOQCOrPrwtbee", "British Football Announcer", ""],
  ["DGzg6RaUqxGRTHSBjfgF", "Brock", "Commanding and loud sergeant"],
  ["x70vRnQBMBu4FAYhjJbO", "Nathan", "Virtual radio host"],
  ["Sm1seazb4gs7RSlUVw7c", "Anika", "Animated, friendly and engaging"],
  ["P1bg08DkjqiVEzOn76yG", "Viraj (rich)", "Rich and soft"],
  ["qDuRKMlYmrm8trt5QyBn", "Taksh", "Calm, serious and smooth"],
  ["qXpMhyvQqiRxWQs4qSSB", "Horatius", "Energetic character voice"],
  ["TX3LPaxmHKxFdv7VOQHJ", "Liam", "Energetic, social media creator"],
  ["N2lVS1w4EtoT3dr4eOWO", "Callum", "Husky trickster"],
  ["FGY2WhTYpPnrIDTdsKH5", "Laura", "Enthusiast, quirky attitude"],
  ["kPzsL2i3teMYv0FxEYQ6", "Brittney", "Fun, youthful and informative"],
  ["UgBBYS2sOqTuMpoF3BR0", "Mark (natural)", "Natural conversations"],
  ["hpp4J3VqNfWAUOO0d1Us", "Bella", "Professional, bright, warm"],
  ["nPczCjzI2devNBz1zQrb", "Brian", "Deep, resonant and comforting"],
  ["uYXf8XasLslADfZ2MB4u", "Hope (bubbly)", "Bubbly, gossipy and girly"],
  ["gs0tAILXbY5DNrJrsM6F", "Jeff", "Classy, resonating and strong"],
  ["DTKMou8ccj1ZaWGBiotd", "Jamahal", "Young, vibrant and natural"],
  ["vBKc2FfBKJfcZNyEt1n6", "Finn", "Youthful, eager and energetic"],
  ["DYkrAHD8iwork3YSUBbs", "Tom", "Conversations and books"],
  ["56AoDkrOh6qfVPDXZ7Pt", "Cassidy", "Crisp, direct and clear"],
  ["eR40ATw9ArzDf9h3v7t7", "Addison 2.0", "Australian audiobook and podcast"],
  ["g6xIsTj2HwM6VR4iXFCw", "Jessica Anne Bogart (chatty)", "Chatty and friendly"],
  ["lcMyyd2HUfFzxdCaC4Ta", "Lucy", "Fresh and casual"],
  ["6aDn1KB0hjpdcocrUkmq", "Tiffany", "Natural and welcoming"],
  ["Sq93GQT4X1lKDXsQcixO", "Felix", "Warm, positive and contemporary RP"],
  ["flHkNRp1BlvT73UL6gyz", "Jessica Anne Bogart (villain)", "Eloquent villain"],
  ["9yzdeviXkFddZ4Oz8Mok", "Lutz", "Chuckling, giggly and cheerful"],
  ["pPdl9cQBQq4p6mRkZy2Z", "Emma", "Adorable and upbeat"],
  ["zYcjlYFOd3taleS0gkk3", "Edward", "Loud, confident and cocky"],
  ["nzeAacJi50IvxcyDnMXa", "Marshal", "Friendly, funny professor"],
  ["ruirxsoakN0GWmGNIo04", "John Morgan", "Gritty, rugged cowboy"],
  ["TC0Zp7WVFzhA8zpTlRqV", "Aria", "Sultry villain"],
  ["ljo9gAlSqKOvF6D8sOsX", "Viking Bjorn", "Epic medieval raider"],
  ["PPzYpIqttlTYA83688JI", "Pirate Marshal", ""],
  ["8JVbfL6oEdmuxKn5DK2C", "Johnny Kid", "Serious and calm narrator"],
  ["iCrDUkL56s3C8sCRl7wb", "Hope (poetic)", "Poetic, romantic and captivating"],
  ["wJqPPQ618aTW29mptyoc", "Ana Rita", "Smooth, expressive and bright"],
  ["EiNlNiXeDU1pqqOPrYMO", "John Doe", "Deep"],
  ["4YYIPFl9wE5c4L2eu2Gb", "Burt Reynolds", "Deep, smooth and clear"],
  ["6F5Zhi321D3Oq7v1oNT4", "Hank", "Deep and engaging narrator"],
  ["YXpFCvM1S3JbWEJhoskW", "Wyatt", "Wise rustic cowboy"],
  ["LG95yZDEHg6fCZdQjLqj", "Phil", "Explosive, passionate announcer"],
  ["CeNX9CMwmxDxUF5Q2Inm", "Johnny Dynamite", "Vintage radio DJ"],
  ["aD6riP1btT197c6dACmy", "Rachel M", "Pro British radio presenter"],
  ["mtrellq69YZsNwzUSyXh", "Rex Thunder", "Deep and tough"],
  ["dHd5gvgSOzSfduK4CvEg", "Ed", "Late night announcer"],
  ["eVItLK1UvXctxuaRV2Oq", "Jean", "Alluring and playful femme fatale"],
  ["esy0r39YPLQjOczyOib8", "Britney", "Calm and calculative villain"],
  ["Tsns2HvNFKfGiNjllgqo", "Sven", "Emotional and nice"],
  ["1U02n4nD6AdIZ9CjF053", "Viraj (gentle)", "Smooth and gentle"],
  ["AeRdCCKzvd23BpJoofzx", "Nathaniel", "Engaging, British and calm"],
  ["LruHrtVF6PSyGItzMNHS", "Benjamin", "Deep, warm, calming"],
  ["1wGbFxmAM3Fgw63G1zZJ", "Allison", "Calm, soothing and meditative"],
  ["hqfrgApggtO1785R4Fsn", "Theodore HQ", "Serene and grounded"],
  ["MJ0RnG71ty4LH3dvNfSd", "Leon", "Soothing and grounded"],
].map(([id, name, style]) => ({ id: id!, name: name!, style: style! }));
