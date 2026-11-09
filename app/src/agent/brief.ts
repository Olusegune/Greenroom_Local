// Reads a producer's instruction ("make the villain's voice more sophisticated, keep cloud spending below $5") and turns it
// into explicit, reviewable proposals. It never edits anything: each proposal says what it would change and why, and the
// person accepts or rejects it. Rule based and offline, so the same words always give the same proposals.

export type Proposal =
  | { kind: "set_budget"; amount: number; text: string }
  | { kind: "local_only"; text: string }
  | { kind: "prefer_local"; text: string }
  | { kind: "tone"; direction: string; scope: "scene" | "line"; text: string }
  | { kind: "recast"; who: string; want: string[]; text: string }
  | { kind: "genre"; genre: "animation" | "film_tv" | "games" | "education" | "audiobooks" | "family"; text: string }
  | { kind: "accent_where_apt"; accent: string; text: string }
  | { kind: "regenerate_flagged"; text: string }
  | { kind: "naturalness"; text: string };

export interface Interpretation {
  proposals: Proposal[];
  /** Parts of the instruction that matched nothing, shown back so nothing is silently ignored. */
  unmatched: string[];
}

const money = (t: string): number | null => {
  const m = t.match(/(?:below|under|less than|at most|no more than|max(?:imum)?|limit(?:ed)?(?: to)?|cap(?:ped)?(?: at)?|within)\s*(?:of\s*)?(?:\$|usd|£|€)?\s*(\d+(?:\.\d{1,2})?)/i) ?? t.match(/(?:\$|£|€)\s*(\d+(?:\.\d{1,2})?)/);
  return m ? Number(m[1]) : null;
};

export function interpret(text: string): Interpretation {
  const t = text.replace(/\s+/g, " ").trim().slice(0, 1500);
  const parts = t.split(/(?<=[.!?])\s+|;\s+/).map((p) => p.trim()).filter(Boolean);
  const proposals: Proposal[] = [];
  const unmatched: string[] = [];
  for (const p of parts) {
    const l = p.toLowerCase();
    const before = proposals.length;
    const amount = /cloud|spend|spending|budget|cost|pay/.test(l) ? money(l) : null;
    if (amount !== null) proposals.push({ kind: "set_budget", amount, text: `Limit cloud spending to ${amount}. The agent stops before passing it.` });
    if (/\b(offline|local[- ]only|keep (it |everything )?(on|local)|never (use|send).*(cloud|online)|no cloud)\b/.test(l)) proposals.push({ kind: "local_only", text: "Make this run local-only: nothing is sent to a cloud engine." });
    else if (/\blocal (models?|engines?|voices?)\b.*\b(unless|where possible|first|prefer)|\bprefer\w* local\b|use local/.test(l)) proposals.push({ kind: "prefer_local", text: "Prefer local engines; use a cloud engine only where a step cannot be done locally, and ask first." });
    const restrained = /(more |less )?(emotionally )?(restrained|subtle|understated|toned down|quiet(er)?|muted)/.exec(l);
    if (restrained && !/villain|voice|accent/.test(l)) proposals.push({ kind: "tone", scope: "scene", direction: "restrained, understated, holding the feeling back", text: "Add “restrained, understated” direction to every line in the scene." });
    if (/(more |less )?(emotional(ly)?|expressive|dramatic|intense)\b/.test(l) && !restrained && /\bmore\b/.test(l)) proposals.push({ kind: "tone", scope: "scene", direction: "more expressive, with the feeling showing", text: "Add “more expressive” direction to every line in the scene." });
    const villain = l.match(/(?:give|make) (?:the |my )?(villain|hero|narrator|mentor|detective|boss|[a-z]+) (?:a |an )?(?:more )?([a-z ,]*?)(?:british|nigerian|american|irish|scottish|indian|filipino)?\s*voice/);
    if (villain && /sophisticated|refined|posh|british|older|younger|deeper|warmer|softer|colder|menacing/.test(l)) proposals.push({ kind: "recast", who: villain[1]!, want: l.match(/sophisticated|refined|posh|british|older|younger|deeper|warmer|softer|colder|menacing/g) ?? [], text: `Look for a different preset or voice for the ${villain[1]}: ${(l.match(/sophisticated|refined|posh|british|older|younger|deeper|warmer|softer|colder|menacing/g) ?? []).join(", ")}. You choose before anything changes.` });
    if (/\bnigerian english\b|\bnigerian\b.*\bwhere appropriate\b|\bwhere appropriate\b.*\bnigerian\b/.test(l)) proposals.push({ kind: "accent_where_apt", accent: "Nigerian English", text: "Suggest Nigerian English voices for characters it fits. These accents are unverified starters: listen before relying on them." });
    if (/children'?s|kids?|child(ren)?|family[- ]friendly/.test(l) && /animat|film|cartoon|show|story/.test(l)) proposals.push({ kind: "genre", genre: "animation", text: "Treat this as a children's animated production: animation presets and gentler, brighter direction." });
    else if (/\beducational|\blesson|\bexplainer|\btutorial/.test(l)) proposals.push({ kind: "genre", genre: "education", text: "Treat this as educational narration: clear, patient presets." });
    if (/(regenerate|redo|remake|re-?make|fix)\b.*\b(only|just)?.*\b(unnatural|robotic|flat|wrong|bad|off|weak)\b/.test(l) || /only the lines that (sound|are|feel)/.test(l)) proposals.push({ kind: "regenerate_flagged", text: "Remake only the lines the checks flagged, or you mark as unnatural. Approved takes are kept." });
    if (/(less|not) (so |too )?robotic|more (natural|human|lifelike|real)/.test(l)) proposals.push({ kind: "naturalness", text: "Add natural-speech direction (breath, varied pace) and remake only the flat lines. You review the result." });
    if (proposals.length === before) unmatched.push(p);
  }
  return { proposals, unmatched };
}

/** Applies the budget and privacy proposals to the run settings. Everything else is a suggestion the person acts on. */
export function settingsFrom(ps: Proposal[]): { cloudLimit?: number; localOnly?: boolean } {
  const out: { cloudLimit?: number; localOnly?: boolean } = {};
  for (const p of ps) {
    if (p.kind === "set_budget") out.cloudLimit = p.amount;
    if (p.kind === "local_only") { out.localOnly = true; out.cloudLimit = 0; }
  }
  return out;
}
