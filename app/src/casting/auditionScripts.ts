// Standard audition scripts, so candidate voices can be compared on the SAME words. A script never claims what a voice can do:
// it only gives you something to listen to. Lines in languages other than English were written by Greenroom and have not been
// checked by a native speaker, and the screen says so.

import { langKey } from "./lang";

export interface AuditionScript {
  id: "neutral" | "emotional" | "character" | "pronunciation" | "language" | "accent" | "expression";
  label: string;
  /** What listening to this one tells you. */
  purpose: string;
  text: string;
  /** Set when the words were written by Greenroom and not checked by a native speaker. */
  unchecked?: boolean;
}

const LANG_LINES: Record<string, { text: string; gloss: string }> = {
  english: { text: "Good morning. I hope you slept well. Shall we begin?", gloss: "Good morning. I hope you slept well. Shall we begin?" },
  yoruba: { text: "Ẹ káàárọ̀. Báwo ni? Ẹ jọ̀ọ́, ẹ jókòó.", gloss: "Good morning. How are you? Please, sit down." },
  hausa: { text: "Ina kwana. Yaya aiki? Don Allah, zauna.", gloss: "Good morning. How is work? Please, sit down." },
  igbo: { text: "Ụtụtụ ọma. Kedu ka ị mere? Biko, nọdụ ala.", gloss: "Good morning. How are you? Please, sit down." },
  pidgin: { text: "How you dey? Wetin dey happen? Abeg, come sit down.", gloss: "How are you? What is happening? Please, come and sit." },
  spanish: { text: "Buenos días. ¿Cómo has dormido? ¿Empezamos?", gloss: "Good morning. How did you sleep? Shall we begin?" },
  french: { text: "Bonjour. Avez-vous bien dormi ? On commence ?", gloss: "Good morning. Did you sleep well? Shall we begin?" },
  german: { text: "Guten Morgen. Haben Sie gut geschlafen? Fangen wir an?", gloss: "Good morning. Did you sleep well? Shall we begin?" },
  portuguese: { text: "Bom dia. Dormiu bem? Vamos começar?", gloss: "Good morning. Did you sleep well? Shall we begin?" },
  hindi: { text: "सुप्रभात। आप कैसे हैं? चलिए शुरू करें।", gloss: "Good morning. How are you? Let us begin." },
};

/** The same words for every candidate. `characterLine` is a line this character actually speaks, when there is one. */
export function auditionScripts(opts: { language?: string; accent?: string; characterLine?: string }): AuditionScript[] {
  const lang = langKey(opts.language) || "english";
  const l = LANG_LINES[lang];
  const out: AuditionScript[] = [
    { id: "neutral", label: "Neutral", purpose: "Plain delivery: clarity, pace, and whether the voice sounds like the person you have in mind.", text: "Good evening. My name is on the door. Please come in, and close it behind you." },
    { id: "emotional", label: "Emotional", purpose: "Whether the voice can carry feeling without breaking.", text: "I waited all night for you. I told myself you would not come. And here you are, and I do not know whether to laugh or to cry." },
    { id: "pronunciation", label: "Pronunciation", purpose: "Hard words and names: a voice that stumbles here will stumble in your script.", text: "The thorough physician, Mr. Okonkwo-Adeyemi, rehearsed the particularly rural, irregular statistics on Wednesday." },
  ];
  if (opts.characterLine?.trim()) out.push({ id: "character", label: "This character's line", purpose: "A line this character actually speaks, in this voice.", text: opts.characterLine.trim().slice(0, 240) });
  if (l && lang !== "english") out.push({ id: "language", label: `In ${opts.language}`, purpose: `Whether the voice speaks ${opts.language} at all. Meaning: ${l.gloss}`, text: l.text, unchecked: true });
  if (opts.accent?.trim()) out.push({ id: "accent", label: `Accent: ${opts.accent}`, purpose: "Listen for the accent you asked for. Whether it is convincing is for a listener from that community to say.", text: "Would you like a cup of tea? I think the weather will turn by the afternoon, so take an umbrella." });
  out.push({ id: "expression", label: "Vocal expression", purpose: "A laugh, a sigh, a whisper written as words. Plain engines read them flat; that tells you what the voice cannot do.", text: "Ha! Oh, that is wonderful. Hmm. No, no, wait. Listen closely, and I will say it only once." });
  return out;
}
