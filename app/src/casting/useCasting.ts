// The one hook screens use to give a character a voice. It runs the integrity engine, asks the owner when a rule needs a decision
// (changing an approved voice, accepting something unverified, overriding a conflict) and only then changes the project.

import { useApp } from "../ctx";
import { readyEnginesFrom } from "../presets/cast";
import type { VoiceEntry } from "../types";
import { assignVoice, unlockVoice, type AssignRequest, type AssignResult } from "./lock";
import type { Actor, MatchContext } from "./types";

export interface AssignOptions {
  approve?: boolean;
  by?: Actor;
  /** The screen already showed the owner the facts and the owner pressed the approve button: no second sheet for unverified facts. */
  acknowledge?: boolean;
}

export function useCasting() {
  const { project, library, keys, edit, toast, confirmSpend } = useApp();

  /** What the matcher needs to know about this computer right now. */
  const context = (): MatchContext => {
    const ready = new Set(readyEnginesFrom(keys, library));
    return {
      commercial: project?.commercial === true,
      available: (id) => {
        const v = library.find((x) => x.id === id);
        if (!v) return { ok: false, why: "it is not in your voice library" };
        return ready.has(v.provider) ? { ok: true } : { ok: false, why: "its engine is not set up or its key is not saved" };
      },
    };
  };

  const apply = (req: Omit<AssignRequest, "context" | "now">): AssignResult | null => {
    if (!project) return null;
    const full: AssignRequest = { ...req, now: new Date().toISOString(), context: context() };
    const result = assignVoice(project.characters, full);
    // A refused attempt is still written to the character's history; a plain failure changes nothing.
    if (result.ok || result.code === "locked") edit((p) => ({ ...p, characters: assignVoice(p.characters, full).characters }), "cast");
    return result;
  };

  /** Gives the character the voice (or clears it) as the OWNER, asking whenever a rule needs a decision. */
  const assign = async (characterId: string, voice: VoiceEntry | null, opts: AssignOptions = {}): Promise<AssignResult | null> => {
    if (!project) return null;
    const c = project.characters.find((x) => x.id === characterId);
    if (!c) return null;
    const by = opts.by ?? "owner";
    const base = { characterId, voice, by, ...(opts.approve ? { approve: true } : {}), ...(opts.acknowledge ? { acknowledge: true } : {}) };
    let req: Omit<AssignRequest, "context" | "now"> = base;
    let r = assignVoice(project.characters, { ...req, now: "", context: context() });
    const ask = async (title: string, lines: string[], confirm: string) => confirmSpend({ title, lines, neutral: { text: "This is your decision as director. Nothing is spent and nothing is downloaded.", confirm } });

    if (r.code === "locked" && by === "owner") {
      const ok = await ask(`Change ${c.name}'s approved voice?`, [`${c.name} is approved with ${c.casting?.approval?.voiceName ?? "a voice"}.`, voice ? `You are changing it to ${voice.name}.` : "You are removing the voice.", "Audio already made with the old voice stays as it is and will be flagged."], "Change the voice");
      if (!ok) return r;
      req = { ...req, confirmChange: true };
      r = assignVoice(project.characters, { ...req, now: "", context: context() });
    }
    if (r.code === "needs_acknowledgement") {
      const ok = await ask(`Approve ${voice?.name ?? "this voice"} for ${c.name}?`, ["Some of what makes it a fit is not confirmed:", ...(r.match?.reasons.filter((x) => x.level === "hard" && (x.outcome === "unverified" || x.outcome === "unknown")).map((x) => x.text) ?? []), "Listen to it first if you have not."], "Approve and lock");
      if (!ok) return r;
      req = { ...req, acknowledge: true };
    }
    if (r.code === "incompatible" && by === "owner") {
      const ok = await ask(`${voice?.name ?? "This voice"} does not fit ${c.name}`, [r.message, "You can still use it. This will be recorded."], "Use it anyway");
      if (!ok) return r;
      req = { ...req, override: true, acknowledge: true };
    }
    const done = apply(req);
    if (done) toast(done.message, !done.ok);
    return done;
  };

  const unlock = async (characterId: string): Promise<void> => {
    if (!project) return;
    const c = project.characters.find((x) => x.id === characterId);
    if (!c?.casting?.approval) return;
    const ok = await confirmSpend({ title: `Unlock ${c.name}'s voice?`, lines: [`${c.name} is approved with ${c.casting.approval.voiceName}. Unlocking lets any screen change it. The voice itself stays until you change it.`], neutral: { text: "This is your decision as director. Nothing is spent and nothing is downloaded.", confirm: "Unlock" } });
    if (!ok) return;
    edit((p) => ({ ...p, characters: unlockVoice(p.characters, characterId, "owner", new Date().toISOString()).characters }), "cast");
    toast(`${c.name} is unlocked.`);
  };

  return { assign, unlock, context };
}
