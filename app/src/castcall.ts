/** A curated "casting call": voices grouped by accent that can be added to the library in one step. Piper keys were checked
 *  against the public rhasspy/piper-voices catalogue on 2026-11-02. Accent comes from the voice's locale. Nobody at Greenroom
 *  has rated how convincing each one is, so every card has a preview and the notes stay factual. */
export interface PiperRole { kind: "piper"; key: string; name: string; accent: string; language: string; mb: number; use: string }
export interface WazobiaRole { kind: "wazobia"; voice: string; lang: "en" | "yo" | "ha" | "ig"; name: string; accent: string; language: string; use: string }
export interface DesignRecipe { kind: "design"; id: string; name: string; accent: string; description: string; line: string }
export type CastRole = PiperRole | WazobiaRole | DesignRecipe;

const p = (key: string, name: string, accent: string, language: string, mb: number, use: string): PiperRole => ({ kind: "piper", key, name, accent, language, mb, use });

/** A voice file may hold several speakers: `file@N` picks speaker N. */
export const baseKey = (key: string) => key.split("@")[0]!;

export const PIPER_ROLES: PiperRole[] = [
  p("en_GB-alan-medium", "Alan", "British", "English", 63, "Narrator, documentary"),
  p("en_GB-alba-medium", "Alba", "Scottish", "English", 63, "Guide, storyteller"),
  p("en_GB-northern_english_male-medium", "Northern", "Northern English", "English", 63, "Everyman, shopkeeper"),
  p("en_GB-jenny_dioco-medium", "Jenny", "British", "English", 63, "Presenter, assistant"),
  p("en_GB-cori-high", "Cori", "British", "English", 114, "Audiobook, high quality"),
  p("en_US-lessac-high", "Lessac", "American", "English", 114, "Narrator, high quality"),
  p("en_US-amy-medium", "Amy", "American", "English", 63, "Assistant, explainer"),
  p("en_US-joe-medium", "Joe", "American", "English", 63, "Casual, podcast co-host"),
  p("en_US-john-medium", "John", "American", "English", 64, "Announcer, trailer"),
  p("en_US-kristin-medium", "Kristin", "American", "English", 64, "Ads, social"),
  p("en_US-bryce-medium", "Bryce", "American", "English", 64, "Younger male, game NPC"),
  p("en_US-kusal-medium", "Kusal", "American", "English", 63, "Calm lecturer"),
  p("es_MX-claude-high", "Claude", "Mexican", "Spanish", 63, "Dialogue, narration"),
  p("es_AR-daniela-high", "Daniela", "Argentine", "Spanish", 114, "Dialogue, narration"),
  p("es_ES-davefx-medium", "Davefx", "Castilian", "Spanish", 63, "Narration"),
  p("fr_FR-siwis-medium", "Siwis", "French", "French", 63, "Narration, dialogue"),
  p("fr_FR-tom-medium", "Tom", "French", "French", 64, "Dialogue"),
  p("de_DE-thorsten-medium", "Thorsten", "German", "German", 63, "Narration"),
  p("pt_BR-faber-medium", "Faber", "Brazilian", "Portuguese", 63, "Narration"),
  p("hi_IN-priyamvada-medium", "Priyamvada", "Indian", "Hindi", 64, "Narration, dialogue"),
  p("hi_IN-rohan-medium", "Rohan", "Indian", "Hindi", 63, "Dialogue"),
  p("ko_KR-kss-medium", "KSS", "Korean", "Korean", 63, "Narration"),
  p("ar_JO-kareem-medium", "Kareem", "Jordanian", "Arabic", 63, "Narration"),
  p("sw_CD-lanfrica-medium", "Lanfrica", "Congolese", "Swahili", 63, "Narration"),
  p("zh_CN-huayan-medium", "Huayan", "Mandarin", "Chinese", 63, "Narration, dialogue"),
  p("zh_CN-chaowen-medium", "Chaowen", "Mandarin", "Chinese", 63, "Dialogue"),
  p("zh_CN-xiao_ya-medium", "Xiao Ya", "Mandarin", "Chinese", 63, "Assistant, explainer"),
  p("hi_IN-pratham-medium", "Pratham", "Indian", "Hindi", 64, "Narration, dialogue"),
  p("ml_IN-meera-medium", "Meera", "Malayali", "Malayalam", 63, "Narration"),
  p("ml_IN-arjun-medium", "Arjun", "Malayali", "Malayalam", 63, "Dialogue"),
  p("te_IN-maya-medium", "Maya", "Telugu", "Telugu", 63, "Narration"),
  p("te_IN-venkatesh-medium", "Venkatesh", "Telugu", "Telugu", 64, "Dialogue"),
  p("ur_PK-fasih-medium", "Fasih", "Pakistani", "Urdu", 65, "Narration"),
  p("ne_NP-chitwan-medium", "Chitwan", "Nepali", "Nepali", 63, "Narration"),
  p("fa_IR-reza_ibrahim-medium", "Reza", "Persian", "Persian", 64, "Narration"),
  p("tr_TR-dfki-medium", "Dfki", "Turkish", "Turkish", 63, "Narration"),
  p("ru_RU-denis-medium", "Denis", "Russian", "Russian", 63, "Dialogue"),
  p("ru_RU-irina-medium", "Irina", "Russian", "Russian", 63, "Narration"),
  p("uk_UA-tetiana-high", "Tetiana", "Ukrainian", "Ukrainian", 114, "Narration"),
  p("pl_PL-gosia-medium", "Gosia", "Polish", "Polish", 63, "Narration"),
  p("it_IT-paola-medium", "Paola", "Italian", "Italian", 64, "Narration, dialogue"),
  p("it_IT-riccardo-x_low", "Riccardo", "Italian", "Italian", 28, "Dialogue, small download"),
  p("nl_NL-alex-medium", "Alex", "Dutch", "Dutch", 64, "Narration"),
  p("sv_SE-alma-medium", "Alma", "Swedish", "Swedish", 63, "Narration"),
  p("el_GR-rapunzelina-medium", "Rapunzelina", "Greek", "Greek", 63, "Narration"),
  p("pt_BR-cadu-medium", "Cadu", "Brazilian", "Portuguese", 63, "Dialogue"),
  p("es_MX-ald-medium", "Ald", "Mexican", "Spanish", 63, "Dialogue"),
  p("vi_VN-vais1000-medium", "Vais", "Vietnamese", "Vietnamese", 63, "Narration"),
  p("th_TH-tsync2-medium", "Tsync", "Thai", "Thai", 63, "Narration"),
  p("id_ID-news_tts-medium", "News", "Indonesian", "Indonesian", 63, "Newsreader"),
  p("he_IL-saspeech-medium", "Saspeech", "Israeli", "Hebrew", 63, "Narration"),
];

/** Non-native English speakers (Arabic, Mandarin, Hindi, Korean, Spanish, Vietnamese). The L2-ARCTIC corpus is licensed
 *  CC BY-NC 4.0: free for non-commercial work only. Native language and gender are from the corpus documentation. */
const L2 = "en_US-l2arctic-medium";
const l2 = (n: number, name: string, accent: string, g: string): PiperRole => ({ kind: "piper", key: `${L2}@${n}`, name, accent, language: "English", mb: 77, use: `${g}, English with a ${accent.replace(" English", "")} accent. Non-commercial licence` });
export const ACCENT_ROLES: PiperRole[] = [
  l2(3, "Zhaa", "Arabic English", "Woman"), l2(18, "Ybaa", "Arabic English", "Man"), l2(21, "Aba", "Arabic English", "Man"), l2(23, "Ska", "Arabic English", "Woman"),
  l2(20, "Bwc", "Chinese English", "Man"), l2(12, "Lxc", "Chinese English", "Woman"), l2(13, "Ncc", "Chinese English", "Woman"), l2(0, "Txhc", "Chinese English", "Man"),
  l2(10, "Asi", "Indian English", "Man"), l2(19, "Rrbi", "Indian English", "Man"), l2(2, "Svbi", "Indian English", "Woman"), l2(9, "Tni", "Indian English", "Woman"),
  l2(11, "Hjk", "Korean English", "Woman"), l2(16, "Hkk", "Korean English", "Man"), l2(15, "Ydck", "Korean English", "Woman"), l2(14, "Ykwk", "Korean English", "Man"),
  l2(22, "Ebvs", "Spanish English", "Man"), l2(6, "Erms", "Spanish English", "Man"), l2(7, "Mbmps", "Spanish English", "Woman"), l2(17, "Njs", "Spanish English", "Woman"),
  l2(8, "Hqtv", "Vietnamese English", "Man"), l2(4, "Pnv", "Vietnamese English", "Woman"), l2(1, "Thv", "Vietnamese English", "Woman"), l2(5, "Tlv", "Vietnamese English", "Man"),
];

/** One-press bundles: Greenroom installs Piper if needed, downloads the voices and adds them to the library after one confirmation. */
export interface VoicePack { id: string; name: string; blurb: string; keys: string[] }
export const VOICE_PACKS: VoicePack[] = [
  { id: "starter", name: "Starter", blurb: "A British narrator, an American narrator and presenter, a Mexican Spanish voice and a French voice.", keys: ["en_GB-alan-medium", "en_US-lessac-high", "en_US-amy-medium", "es_MX-claude-high", "fr_FR-siwis-medium"] },
  { id: "asia", name: "Asia", blurb: "Mandarin, Korean, Hindi, Telugu, Vietnamese and Thai.", keys: ["zh_CN-huayan-medium", "ko_KR-kss-medium", "hi_IN-priyamvada-medium", "te_IN-maya-medium", "vi_VN-vais1000-medium", "th_TH-tsync2-medium"] },
  { id: "europe", name: "Europe", blurb: "German, Italian, Russian, Polish, Dutch and Swedish.", keys: ["de_DE-thorsten-medium", "it_IT-paola-medium", "ru_RU-irina-medium", "pl_PL-gosia-medium", "nl_NL-alex-medium", "sv_SE-alma-medium"] },
  { id: "latam", name: "Latin America", blurb: "Mexican, Argentine and Brazilian voices.", keys: ["es_MX-claude-high", "es_AR-daniela-high", "pt_BR-faber-medium", "pt_BR-cadu-medium"] },
  { id: "accents", name: "World accents in English", blurb: "Chinese, Korean, Indian, Arabic, Spanish and Vietnamese accents in English, two voices each. Non-commercial licence.", keys: [`${L2}@20`, `${L2}@12`, `${L2}@11`, `${L2}@16`, `${L2}@10`, `${L2}@2`, `${L2}@18`, `${L2}@3`, `${L2}@22`, `${L2}@7`, `${L2}@8`, `${L2}@4`] },
];
export const ALL_PIPER_ROLES: PiperRole[] = [...PIPER_ROLES, ...ACCENT_ROLES];

/**
 * The gender a voice's own DOCUMENTATION states, or "" when nothing documents it. Only the L2-ARCTIC speakers qualify: the corpus
 * lists each speaker's gender. A Piper voice's first name is not documentation, so every other voice gets "" and is listened to.
 */
export function documentedGender(key: string): "female" | "male" | "" {
  const r = ACCENT_ROLES.find((x) => x.key === key);
  return r ? (r.use.startsWith("Woman") ? "female" : r.use.startsWith("Man") ? "male" : "") : "";
}

const WAZOBIA_NAMES = ["adaeze", "amara", "bolaji", "elder_deji", "emeka", "hauwa", "ife", "james", "john", "musa", "ngozi", "tunde", "wura"];
const LANGS = [["en", "Nigerian English", "Nigerian"], ["yo", "Yoruba", "Yoruba"], ["ha", "Hausa", "Hausa"], ["ig", "Igbo", "Igbo"]] as const;
const title = (v: string) => v.split("_").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
export const WAZOBIA_ROLES: WazobiaRole[] = LANGS.flatMap(([lang, language, accent]) =>
  WAZOBIA_NAMES.map((voice): WazobiaRole => ({ kind: "wazobia", voice, lang, name: title(voice), accent, language, use: "Pick by ear: voice names are not mapped to age or gender" })));

/** Written recipes for ElevenLabs Voice Design (paid). They open in Design a voice; nothing is spent until you generate. */
export const DESIGN_RECIPES: DesignRecipe[] = [
  { kind: "design", id: "mandarin-english", name: "Beijing business traveller", accent: "Chinese-accented English", description: "A polite Mandarin-speaking businesswoman in her thirties from Beijing, speaking English with a Mandarin accent, careful precise pronunciation, calm and friendly.", line: "Thank you for waiting. Please let me explain the schedule for tomorrow." },
  { kind: "design", id: "korean-english", name: "Seoul student", accent: "Korean-accented English", description: "A cheerful Korean university student in his twenties from Seoul, speaking English with a Korean accent, bright and quick, slightly shy.", line: "Excuse me, is this the right way to the library? I am a little lost." },
  { kind: "design", id: "japanese-english", name: "Tokyo engineer", accent: "Japanese-accented English", description: "A soft-spoken Japanese engineer in his forties from Tokyo, speaking English with a Japanese accent, measured and courteous.", line: "I am sorry, may I ask one question about the design before we begin?" },
  { kind: "design", id: "hindi-english", name: "Mumbai call-centre agent", accent: "Indian English", description: "A fast, friendly woman in her twenties from Mumbai, speaking English with a Hindi-influenced Indian accent, upbeat customer-service tone.", line: "Thank you for calling, how may I help you today?" },
  { kind: "design", id: "spanish-english", name: "Madrid tour guide", accent: "Spanish-accented English", description: "An expressive man in his thirties from Madrid, speaking English with a Spanish accent, warm, animated and proud of his city.", line: "Please, follow me. In this square, the story begins, my friends." },
  { kind: "design", id: "french-english", name: "Parisian chef", accent: "French-accented English", description: "A passionate French chef in her fifties, speaking English with a French accent, quick and theatrical, fond of dramatic pauses.", line: "No, no, no. You must taste it slowly. Slowly! Now tell me, what do you feel?" },
  { kind: "design", id: "russian-english", name: "Moscow professor", accent: "Russian-accented English", description: "A stern but kind Russian professor in his sixties, speaking English with a Russian accent, deep and slow, dry humour.", line: "This problem is not difficult. You are only afraid of it." },
  { kind: "design", id: "arabic-english", name: "Cairo shopkeeper", accent: "Arabic-accented English", description: "A hospitable Egyptian shopkeeper in his fifties, speaking English with an Arabic accent, generous and rhythmic, always bargaining with a smile.", line: "Come, come, my friend. Special price for you, only today." },
  { kind: "design", id: "brazil-english", name: "Rio musician", accent: "Brazilian-accented English", description: "A relaxed Brazilian guitarist in his thirties from Rio, speaking English with a Portuguese accent, laid-back and musical.", line: "Tonight we play something slow, something for the sea." },
  { kind: "design", id: "kenyan-english", name: "Nairobi journalist", accent: "East African English", description: "A confident Kenyan radio journalist in her thirties, speaking English with a Kenyan accent, crisp and authoritative.", line: "Good evening, and welcome to the news from Nairobi." },
  { kind: "design", id: "hausa-english", name: "Kano trader", accent: "Hausa-accented English", description: "A dignified Hausa trader in his fifties from Kano, speaking English with a Hausa-influenced Nigerian accent, calm, measured and courteous.", line: "Peace be upon you. Sit, and let us talk about the price." },
  { kind: "design", id: "lagos-trader", name: "Lagos market trader", accent: "Nigerian English", description: "A warm, quick-witted woman in her mid-forties from Lagos, speaking Nigerian English with a lively, slightly raspy voice, projecting over market noise, friendly but shrewd.", line: "Madam, come and see! Fresh fish today, I will give you good price." },
  { kind: "design", id: "yoruba-elder", name: "Yoruba elder", accent: "Yoruba-accented English", description: "An elderly Yoruba man in his seventies, slow and deliberate, deep gravelly voice, speaking English with a Yoruba accent and proverb-like cadence, calm authority.", line: "A child who respects his elders will walk far, my son." },
  { kind: "design", id: "naija-teen", name: "Naija teenager", accent: "Nigerian Pidgin-influenced", description: "A confident Nigerian teenage boy, fast and playful, light voice, mixing Nigerian English and Pidgin rhythm, cheeky humour.", line: "Wahala no dey, I don sort am. Just relax." },
  { kind: "design", id: "cockney-detective", name: "London detective", accent: "British (London)", description: "A weary London detective in his fifties, low and gravelly, dry understatement, slow pace, cigarette-roughened voice.", line: "I have seen this before. It never ends well." },
  { kind: "design", id: "southern-sheriff", name: "Southern sheriff", accent: "American (Southern)", description: "A big, easygoing Southern American sheriff in his sixties, slow drawl, warm baritone with a hint of menace.", line: "Now, son, I am going to ask you nicely one more time." },
  { kind: "design", id: "irish-storyteller", name: "Irish storyteller", accent: "Irish", description: "A lilting Irish woman in her sixties, soft and musical, a smile in the voice, storytelling pace with gentle pauses.", line: "Sit down now, and I will tell you how it all began." },
  { kind: "design", id: "jamaican-dj", name: "Kingston radio host", accent: "Jamaican", description: "An energetic Jamaican radio host in his thirties, deep and smooth, rhythmic, high charisma, big smile.", line: "Welcome back, you are locked in, and the vibes are right." },
  { kind: "design", id: "indian-professor", name: "Indian professor", accent: "Indian English", description: "A kind Indian English professor in her fifties, precise and clear, measured pace, patient and encouraging.", line: "Let us look at this problem step by step, together." },
  { kind: "design", id: "aussie-ranger", name: "Outback ranger", accent: "Australian", description: "A relaxed Australian park ranger in his forties, dry humour, medium-low voice, outdoors and unhurried.", line: "She will be right, mate. Just keep walking." },
  { kind: "design", id: "villain-whisper", name: "Whispering villain", accent: "Neutral British", description: "A calm, intimate villain, ageless, quiet breathy voice close to the microphone, precise and cold, never raising it.", line: "You really thought I would let you leave?" },
  { kind: "design", id: "child-narrator", name: "Curious child", accent: "Neutral American", description: "A curious eight-year-old child, bright and a little breathless, rising intonation, innocent and excited.", line: "Wait, what is that noise? Come on, let us go look!" },
  { kind: "design", id: "robot-assistant", name: "Gentle AI assistant", accent: "Neutral", description: "A gentle synthetic assistant voice, smooth and even, slightly airy, friendly with very subtle digital texture.", line: "I have found three routes. Shall I begin?" },
];
