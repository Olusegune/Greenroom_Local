// Turns a written stage direction ("Soft throat clearing", "Slowly removes his glasses; dry", "Nervous laugh, then silence") into what a
// voice engine can use: short emotion and delivery tags, body-sound tags and a speed. Eleven v3 and v4 take direction as short [tags];
// a whole phrase pasted into one tag is unreliable and can be read aloud. Silent stage business (looking up, removing glasses,
// straightening papers) makes no sound, so it is dropped from what is sent. The owner's own words stay in the script.
//
// Tags are short ordinary words: nothing here is a claim about how an engine will sound. Which tags a voice really acts on is for the
// owner to hear (see DECISIONS.md).

export interface Interpreted {
  /** Short emotion and delivery tags, in the order written (at most three). */
  emotion: string[];
  /** Body-sound tags: laughs, clears throat, sighs... (at most two). */
  sounds: string[];
  /** A pace change the direction asks for, or undefined. */
  speed?: number;
  /** Parts of the direction that make no sound and were not sent, so the owner can see what was left out. */
  dropped: string[];
}

const MAX_EMOTION = 3;
const MAX_SOUNDS = 2;
const FAST = 1.12;
const SLOW = 0.9;

// Body sounds. The first matching rule of a fragment wins; a second rule may add a qualifier through EMOTION below.
const SOUND_RULES: { re: RegExp; tag: string }[] = [
  { re: /(nervous(ly)? laugh|laughs? nervously)/, tag: "laughs nervously" },
  { re: /(suppress|stifl|barely).*(laugh|giggl|chuckl)|(laugh|giggl|chuckl).*(suppress|stifl)/, tag: "chuckles" },
  { re: /(evil|demonic) laugh/, tag: "evil laugh" },
  { re: /(belly|hearty|big) laugh/, tag: "belly laugh" },
  { re: /(laugh|laughs|laughing|laughter|laughed)/, tag: "laughs" },
  { re: /chuckl/, tag: "chuckles" },
  { re: /giggl/, tag: "giggles" },
  { re: /snicker|snigger/, tag: "snickers" },
  { re: /(clears?|clearing) (his |her |their )?throat|throat[- ]clear/, tag: "clears throat" },
  { re: /(long|deep) (irritated |tired |weary |heavy )?exhale|exhales?|exhaling/, tag: "exhales" },
  { re: /sigh/, tag: "sighs" },
  { re: /gasp/, tag: "gasps" },
  { re: /cough/, tag: "coughs" },
  { re: /sob|weep|crying|cries/, tag: "crying" },
  { re: /sniffl|sniff/, tag: "sniffles" },
  { re: /groan/, tag: "groans" },
  { re: /gulp|swallow/, tag: "gulps" },
  { re: /yawn/, tag: "yawns" },
  { re: /pant|out of breath|breathless/, tag: "out of breath" },
  { re: /scoff/, tag: "scoffs" },
  { re: /hmm/, tag: "hmm" },
];

// Words that describe the performance, written as the tag an engine understands.
const EMOTION_WORDS: [RegExp, string][] = [
  [/\b(furious|enraged|outraged|livid|raging)\b/, "angry"],
  [/\b(angry|anger)\b/, "angry"],
  [/\b(irritated|annoyed|exasperated|impatient|irritable)\b/, "annoyed"],
  [/\b(astonished|startled|surprised|shocked|stunned)\b/, "surprised"],
  [/\b(terror|terrified|horrified|panicking|panicked|frightened|scared|afraid)\b/, "scared"],
  [/\b(nervous|anxious|uneasy|worried)\b/, "nervous"],
  [/\b(sarcastic|sarcastically|sardonic)\b/, "sarcastic"],
  [/\b(offended|indignant|insulted)\b/, "offended"],
  [/\b(defensive)\b/, "defensive"],
  [/\b(cautious|wary|careful)\b/, "cautious"],
  [/\b(hopeful|hopefully)\b/, "hopeful"],
  [/\b(tender|gentle|gently|loving|maternal)\b/, "tender"],
  [/\b(joyful|joyfully|delighted|overjoyed|cheerful|cheerfully|bright|brightly|brightness)\b/, "cheerful"],
  [/\b(happy|happily)\b/, "happy"],
  [/\b(excited|thrilled|eager)\b/, "excited"],
  [/\b(sad|sorrowful|mournful|grief)\b/, "sad"],
  [/\b(tired|exhausted|weary|drained|defeated)\b/, "exhausted"],
  [/\b(confident|confidently|brash|cocky)\b/, "confident"],
  [/\b(amused|amusement)\b/, "amused"],
  [/\b(dry|dryly|deadpan)\b/, "dry"],
  [/\b(flat|monotone)\b/, "flat"],
  [/\b(serene|calm|calmly|composed)\b/, "calm"],
  [/\b(controlled|restrained|maintain(ing)? control|holding back)\b/, "controlled"],
  [/\b(dignified|stately)\b/, "dignified"],
  [/\b(icy|cold|coldly|chilly)\b/, "icy"],
  [/\b(polite|politeness|pleasantly|pleasant|courteous)\b/, "polite"],
  [/\b(condescending|patronising|patronizing|superior)\b/, "condescending"],
  [/\b(satisfied|satisfaction|smug|pleased)\b/, "satisfied"],
  [/\b(scolding|scolds|reproachful|chiding)\b/, "scolding"],
  [/\b(dismissive|dismissively)\b/, "dismissive"],
  [/\b(embarrassed|sheepish)\b/, "embarrassed"],
  [/\b(confused|puzzled|baffled)\b/, "confused"],
  [/\b(unimpressed|bored|indifferent)\b/, "unimpressed"],
  [/\b(clipped|crisp|brisk)\b/, "clipped"],
  [/\b(professional|businesslike|bureaucratic)\b/, "professional"],
  [/\b(matter[- ]of[- ]fact)\b/, "matter-of-fact"],
  [/\b(casual|casually|offhand)\b/, "casual"],
  [/\b(muttering|mutters|mumbling)\b/, "muttering"],
  [/\b(explosive|explosively)\b/, "explosive"],
  [/\b(interrupting|cutting in|sharply|sharp)\b/, "sharp"],
  [/\b(genuine)\b/, ""],
  [/\b(immense|extreme|utter|deep)\b/, ""],
];

// Volume and closeness, which an engine understands as a tag.
const VOLUME_RULES: [RegExp, string][] = [
  [/barely audible/, "barely audible"],
  [/\bwhisper(s|ing|ed)?\b/, "whispers"],
  [/\b(very soft|softly|soft)\b/, "softly"],
  [/\b(quiet|quietly|hushed|low voice|under (his|her|their) breath)\b/, "quietly"],
  [/\b(shout|shouts|shouting|yell|yelling|bellow)\b/, "shouting"],
  [/\b(projecting|projected|loud|loudly|booming)\b/, "loudly"],
];

// Silent stage business: nothing to hear, so nothing is sent.
const STAGE_BUSINESS = /(looking (up|down|away)|look(s)? (up|down|away)|removes? (his|her|their) glasses|puts? (on|down)|straighten|stamps?|shuffl|turns? (to|away)|walks?|steps? |smiles?|nods?|shrugs?|rolls? (his|her|their) eyes|close to (the )?microphone|then silence|a beat|pause|pausing|silence|for a moment|without )/;

/** Strips a trailing "-ly" so "pleasantly" and "pleasant" read the same when there is no better word. */
const cleanWord = (w: string): string => w.replace(/[^\p{L}\p{N}' -]/gu, "").trim();

/** Reads one written direction. Pure: the same words always give the same result. */
export function interpretDirection(raw: string | undefined): Interpreted {
  const out: Interpreted = { emotion: [], sounds: [], dropped: [] };
  const text = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!text) return out;
  const fragments = text.split(/[;,]| then | and /i).map((f) => f.trim()).filter(Boolean);
  const addEmotion = (t: string) => { if (t && !out.emotion.includes(t) && out.emotion.length < MAX_EMOTION) out.emotion.push(t); };
  const addSound = (t: string) => { if (t && !out.sounds.includes(t) && out.sounds.length < MAX_SOUNDS) out.sounds.push(t); };
  for (const frag of fragments) {
    const f = frag.toLowerCase();
    let used = false;
    // body sounds
    const s = SOUND_RULES.find((r) => r.re.test(f));
    if (s) { addSound(s.tag); used = true; }
    // volume
    for (const [re, tag] of VOLUME_RULES) {
      if (re.test(f)) {
        if (tag === "whispers") { addSound("whispers"); } else addEmotion(tag);
        used = true;
        break;
      }
    }
    // pace
    if (/\b(fast|quick|quickly|rapid|rapidly|rushed|brisk)\b/.test(f)) { out.speed = FAST; used = true; }
    else if (/\b(slow|slowly|deliberate|deliberately|measured|unhurried)\b/.test(f) && !/removes?|puts?|turns?/.test(f)) { out.speed = SLOW; used = true; }
    // feelings and manner
    for (const [re, tag] of EMOTION_WORDS) {
      if (re.test(f)) { if (tag) addEmotion(tag); used = true; }
    }
    if (!used) {
      if (STAGE_BUSINESS.test(f)) { out.dropped.push(frag); continue; }
      // an unknown short phrase is kept as a tag so the owner's intent still reaches the engine
      const words = cleanWord(f).split(" ").filter(Boolean);
      if (words.length > 0 && words.length <= 3) addEmotion(words.join(" "));
      else if (words.length > 3) out.dropped.push(frag);
    } else if (STAGE_BUSINESS.test(f) && !s) {
      // "slowly removes his glasses" still carries a pace, but the action itself is silent
      out.dropped.push(frag);
    }
  }
  // the same manner is not sent twice: "whispers" already says quiet
  if (out.sounds.includes("whispers")) out.emotion = out.emotion.filter((e) => e !== "quietly" && e !== "softly");
  return out;
}

/** The direction fields a script line gets from its written direction. */
export function directionFrom(raw: string): { emotion: string; sounds: string[]; speed?: number } {
  const i = interpretDirection(raw);
  return { emotion: i.emotion.join(", "), sounds: i.sounds, ...(i.speed ? { speed: i.speed } : {}) };
}
