import { useState } from "react";
import { api } from "../api";
import { describePlan, planCast, type CastPlan } from "../autocast";
import { STATUS_LABEL } from "../casting/types";
import { assignVoice, isLocked } from "../casting/lock";
import { useCasting } from "../casting/useCasting";
import { useApp } from "../ctx";
import type { Character, VoiceEntry } from "../types";

/**
 * Suggests a voice for every character that has none. It decides nothing it cannot prove: a voice is assigned only when it is
 * proven to fit what is stated about the character. Everything else is listed with the reasons for you to choose. Nothing changes
 * until you press a button, and nothing is ever approved here: approving is yours, in Casting.
 */
export default function AutoCast({ characters }: { characters: Character[] }) {
  const { library, edit, saveLibrary, confirmSpend, toast, go } = useApp();
  const casting = useCasting();
  const [plan, setPlan] = useState<CastPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const needs = characters.filter((c) => !isLocked(c) && (!c.voiceId || !library.some((v) => v.id === c.voiceId)));
  if (needs.length === 0) return null;
  const name = (id: string) => characters.find((c) => c.id === id)?.name ?? id;
  const voiceName = (id: string) => library.find((v) => v.id === id)?.name ?? id;

  /** Gives voices the way an automatic caster may: into EMPTY slots only, as unapproved choices. */
  const apply = (assign: Record<string, string>, by: "auto" | "owner" = "auto") => {
    let given = 0;
    edit((p) => {
      let chars = p.characters;
      for (const [cid, vid] of Object.entries(assign)) {
        const voice = library.find((v) => v.id === vid);
        if (!voice) continue;
        const r = assignVoice(chars, { characterId: cid, voice, by, now: new Date().toISOString(), context: casting.context() });
        if (r.ok) { chars = r.characters; given++; }
      }
      return { ...p, characters: chars };
    }, "cast-auto");
    setPlan(null);
    toast(given ? `${given} voice${given === 1 ? "" : "s"} chosen. Listen to each, then approve it in Casting to lock it. Press Undo to take them back.` : "No voice was changed.");
  };

  const addSuggested = async () => {
    if (!plan) return;
    const ok = await confirmSpend({ title: `Add ${plan.suggestions.length} voice${plan.suggestions.length === 1 ? "" : "s"} from the Casting call?`, lines: [...plan.suggestions.map((s) => `${s.role.name} (${s.role.accent}) for ${name(s.characterId)}, about ${s.role.mb} MB`), "These free voices run on this computer.", "They are added WITHOUT a recorded gender or age: listen and record them in Voice metadata before relying on them."], download: true });
    if (!ok) return;
    setBusy(true);
    try {
      const status = await api.piperStatus();
      if (!status.installed) await api.piperInstall();
      const added: VoiceEntry[] = [];
      for (const s of plan.suggestions) {
        if (!status.voices.includes(s.role.key)) await api.piperInstallVoice(s.role.key);
        added.push({ id: s.role.key, name: `${s.role.name} (${s.role.accent})`, provider: "piper", source: "library", language: s.role.language, accent: s.role.accent, gender: "", notes: s.role.use, createdAt: new Date().toISOString() });
      }
      saveLibrary((l) => [...l, ...added.filter((a) => !l.some((x) => x.id === a.id && x.provider === a.provider))]);
      toast(`${added.length} voice${added.length === 1 ? "" : "s"} added. Check them in Cast.`);
      setPlan(null);
    } catch (e) { toast((e as Error).message, true); }
    finally { setBusy(false); }
  };

  const proven = Object.keys(plan?.assign ?? {}).length;
  return (
    <div className="card stack autocast">
      <div className="row between wrap">
        <div><h2>Suggest voices</h2><p className="muted small">{needs.length} character{needs.length === 1 ? "" : "s"} without a voice. Greenroom shows the voices that fit what you have stated about each one, and says why. Nothing is chosen for you unless it is proven to fit.</p></div>
        {!plan && <button className="primary" onClick={() => setPlan(planCast(characters, library))}>Find voices for {needs.length}</button>}
      </div>
      {plan && (
        <div className="stack">
          {proven > 0 && <><p className="small"><strong>Proven to fit</strong> (you confirmed what makes them fit):</p><ul aria-label="Voices proven to fit">{describePlan(plan, characters, library).map((l) => <li key={l}>{l}</li>)}</ul></>}
          {plan.proposals.length > 0 && (
            <div className="stack">
              <p className="small"><strong>For you to decide</strong></p>
              {plan.proposals.map((p) => (
                <div key={p.characterId} className="cast-prop">
                  <strong>{name(p.characterId)}</strong>{p.shared && <span className="muted small"> (the same voice is also the best choice for another character)</span>}
                  <ul>{p.candidates.slice(0, 3).map((m) => (
                    <li key={m.voiceId} className="row wrap"><span className={`status-chip s-${m.status.toLowerCase()}`}>{STATUS_LABEL[m.status]}</span> <strong>{voiceName(m.voiceId)}</strong> <span className="muted small">{m.reasons.find((r) => r.level === "hard" && r.outcome !== "match")?.text ?? m.reasons[0]?.text ?? ""}</span> <button className="sm" onClick={() => apply({ [p.characterId]: m.voiceId }, "owner")}>Use this</button></li>
                  ))}</ul>
                </div>
              ))}
            </div>
          )}
          {plan.none.length > 0 && <div className="note err" role="status"><strong>Nothing in your library can serve:</strong><ul>{plan.none.map((n) => <li key={n.characterId}>{name(n.characterId)}: {n.why}</li>)}</ul></div>}
          {plan.suggestions.length > 0 && <p className="muted small">The Casting call has voices that could serve: {plan.suggestions.map((s) => `${s.role.name} (${s.role.accent}) for ${name(s.characterId)}`).join(", ")}.</p>}
          {library.length === 0 && <p className="muted small">Your library is empty. Add voices from the Casting call.</p>}
          <div className="row wrap">
            {proven > 0 && <button className="primary" onClick={() => apply(plan.assign)}>Use the {proven} proven voice{proven === 1 ? "" : "s"}</button>}
            {plan.suggestions.length > 0 && <button disabled={busy} onClick={() => void addSuggested()}>{busy ? "Adding voices…" : "Add the suggested voices"}</button>}
            <button className="sm ghost" onClick={() => go("voices")}>Browse the Casting call</button>
            <button className="sm ghost" onClick={() => go("review")}>Record what I heard</button>
            <button className="sm ghost" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}

