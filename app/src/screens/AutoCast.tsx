import { genderWord } from "../avatarLibrary";
import { useState } from "react";
import { api } from "../api";
import { describePlan, planCast, type CastPlan } from "../autocast";
import { useApp } from "../ctx";
import type { Character, VoiceEntry } from "../types";

/** Picks a voice for every character that has none. It shows the plan first and changes nothing until you press Apply. */
export default function AutoCast({ characters }: { characters: Character[] }) {
  const { library, edit, saveLibrary, confirmSpend, toast, go } = useApp();
  const [plan, setPlan] = useState<CastPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const needs = characters.filter((c) => !c.voiceId || !library.some((v) => v.id === c.voiceId));
  if (needs.length === 0) return null;

  const apply = (assign: Record<string, string>) => {
    edit((p) => ({ ...p, characters: p.characters.map((c) => (assign[c.id] ? { ...c, voiceId: assign[c.id] } : c)) }), "cast-auto");
    setPlan(null);
    toast(`${Object.keys(assign).length} character${Object.keys(assign).length === 1 ? "" : "s"} cast. Change any voice below, or press Undo.`);
  };

  const addSuggested = async () => {
    if (!plan) return;
    const mb = plan.suggestions.reduce((n, s) => n + s.role.mb, 0);
    const ok = await confirmSpend({ title: `Add ${plan.suggestions.length} voice${plan.suggestions.length === 1 ? "" : "s"} from the Casting call?`, lines: [...plan.suggestions.map((s) => `${s.role.name} (${s.role.accent}) for ${characters.find((c) => c.id === s.characterId)?.name}, ${s.role.mb} MB`), `About ${mb} MB in total, then they work offline.`, "If needed, Greenroom installs the small Piper speech engine first."], download: true });
    if (!ok) return;
    setBusy(true);
    try {
      const status = await api.piperStatus();
      if (!status.installed) await api.piperInstall();
      const added: VoiceEntry[] = [];
      for (const s of plan.suggestions) {
        if (!status.voices.includes(s.role.key)) await api.piperInstallVoice(s.role.key);
        added.push({ id: s.role.key, name: `${s.role.name} (${s.role.accent})`, provider: "piper", source: "library", language: s.role.language, accent: s.role.accent, gender: genderWord(s.role.key), notes: s.role.use, createdAt: new Date().toISOString() });
      }
      saveLibrary((l) => [...l, ...added.filter((a) => !l.some((x) => x.id === a.id && x.provider === a.provider))]);
      const assign = { ...plan.assign };
      plan.suggestions.forEach((s, i) => { assign[s.characterId] = added[i]!.id; });
      apply(assign);
    } catch (e) { toast((e as Error).message, true); }
    finally { setBusy(false); }
  };

  return (
    <div className="card stack autocast">
      <div className="row between wrap">
        <div><h2>Auto-cast</h2><p className="muted small">{needs.length} character{needs.length === 1 ? "" : "s"} without a voice. Greenroom can pick a different voice for each, matching language and mixing accents.</p></div>
        {!plan && <button className="primary" onClick={() => setPlan(planCast(characters, library))}>Auto-cast {needs.length}</button>}
      </div>
      {plan && (
        <div className="stack">
          {Object.keys(plan.assign).length > 0 && <ul aria-label="Proposed casting">{describePlan(plan, characters, library).map((l) => <li key={l}>{l}</li>)}</ul>}
          {library.length === 0 && <p className="muted small">Your library is empty. Add voices from the Casting call, or let Greenroom suggest some below.</p>}
          {plan.suggestions.length > 0 && <p className="muted small">{library.length === 0 ? "Suggested voices:" : "Your library has fewer voices than characters, so some would share a voice. Greenroom suggests"} {plan.suggestions.map((s) => `${s.role.name} (${s.role.accent}) for ${characters.find((c) => c.id === s.characterId)?.name}`).join(", ")}.</p>}
          <div className="row wrap">
            {Object.keys(plan.assign).length > 0 && plan.suggestions.length === 0 && <button className="primary" onClick={() => apply(plan.assign)}>Apply</button>}
            {plan.suggestions.length > 0 && <button className="primary" disabled={busy} onClick={() => void addSuggested()}>{busy ? "Adding voices…" : `Add suggested voices and cast`}</button>}
            {Object.keys(plan.assign).length > 0 && plan.suggestions.length > 0 && <button disabled={busy} onClick={() => apply(plan.assign)}>Cast with my library only</button>}
            <button className="sm ghost" onClick={() => go("voices")}>Browse the Casting call</button>
            <button className="sm ghost" onClick={() => setPlan(null)}>Cancel</button>
          </div>
        </div>
      )}
    </div>
  );
}
