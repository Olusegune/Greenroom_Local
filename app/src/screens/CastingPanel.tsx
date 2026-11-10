import { useMemo, useState } from "react";
import { useApp } from "../ctx";
import { ENGINES } from "../engines";
import { playUrl } from "../media";
import { auditionScripts } from "../casting/auditionScripts";
import { OFFERABLE, rank, summaryOf } from "../casting/engine";
import { describeRequirements, requirementsOf } from "../casting/requirements";
import { STATUS_LABEL, type CastingSpec, type MatchResult, type VocalAge } from "../casting/types";
import { useCasting } from "../casting/useCasting";
import { profileOf } from "../casting/voiceProfile";
import type { Character, VoiceEntry } from "../types";
import { PlayButton } from "../ui";
import IntegrityCard, { IntegrityTable } from "./IntegrityCard";
import ConsistencyCheck from "./ConsistencyCheck";
import { integrityOf } from "../casting/integrity";
import { useSample } from "../useSample";

const AGES: { id: VocalAge; label: string }[] = [{ id: "child", label: "Child" }, { id: "teen", label: "Teen" }, { id: "young", label: "Young adult" }, { id: "mid", label: "Adult" }, { id: "old", label: "Older" }];
const MAX_COMPARE = 3;

/** Who this character is meant to sound like, the voices that can serve them with the reasons, a side-by-side audition and the approval that locks the choice. */
export default function CastingPanel({ character }: { character: Character }) {
  const { project, library, edit, toast, go } = useApp();
  const casting = useCasting();
  const sample = useSample();
  const [open, setOpen] = useState(false);
  const [scriptId, setScriptId] = useState("neutral");
  const [compare, setCompare] = useState<string[]>([]);
  const [showOut, setShowOut] = useState(false);
  const [busy, setBusy] = useState(false);

  const spec: CastingSpec = character.cast ?? { version: 1 };
  const req = useMemo(() => requirementsOf(character), [character]);
  const ctx = casting.context();
  const ranked = useMemo(() => rank(req, library.map(profileOf), ctx), [req, library, project?.commercial]); // eslint-disable-line react-hooks/exhaustive-deps
  const offer = ranked.filter((m) => OFFERABLE.includes(m.status));
  const out = ranked.filter((m) => !OFFERABLE.includes(m.status));
  const approval = character.casting?.approval;
  const firstLine = project?.lines.find((l) => l.characterId === character.id && l.text.trim())?.text.replace(/\[[^\]]*\]/g, "").trim();
  const scripts = auditionScripts({ language: req.language?.value, accent: req.accent?.value, ...(firstLine ? { characterLine: firstLine } : {}) });
  const script = scripts.find((s) => s.id === scriptId) ?? scripts[0]!;
  const voiceOf = (id: string): VoiceEntry | undefined => library.find((v) => v.id === id);
  const current = character.voiceId ? voiceOf(character.voiceId) : undefined;

  const setSpec = (patch: Partial<CastingSpec>) => edit((p) => ({ ...p, characters: p.characters.map((c) => (c.id === character.id ? { ...c, cast: { ...(c.cast ?? { version: 1 as const }), ...patch } } : c)) }), "cast-spec");
  const toggleAge = (a: VocalAge) => { const cur = spec.vocalAge ?? []; const next = cur.includes(a) ? cur.filter((x) => x !== a) : [...cur, a]; setSpec({ vocalAge: next.length ? next : [] }); };
  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length < MAX_COMPARE ? [...c, id] : (toast(`Compare up to ${MAX_COMPARE} voices at a time.`), c)));

  const hearAll = async () => {
    setBusy(true);
    try {
      for (const id of compare) {
        const v = voiceOf(id);
        if (!v) continue;
        const url = await sample(v, script.text);
        await new Promise<void>((done) => void playUrl(url, done, v.name));
      }
    } catch { /* cancelled or failed: the sample hook already said so */ }
    finally { setBusy(false); }
  };

  const row = (m: MatchResult) => {
    const v = voiceOf(m.voiceId);
    if (!v) return null;
    const isApproved = approval?.voiceId === v.id;
    return (
      <li key={v.id} className={`cast-cand s-${m.status.toLowerCase()}`}>
        <div className="row between wrap">
          <span className="row">
            <input type="checkbox" aria-label={`Compare ${v.name}`} checked={compare.includes(v.id)} onChange={() => toggleCompare(v.id)} />
            <strong>{v.name}</strong>
            <span className="muted small">{ENGINES[v.provider].label}</span>
          </span>
          <span className={`status-chip s-${m.status.toLowerCase()}`} title={m.reasons.map((r) => r.text).join("\n")}>{isApproved ? "Approved" : STATUS_LABEL[m.status]}</span>
        </div>
        <p className="muted small">{summaryOf(m)}</p>
        <details className="cand-why"><summary className="small">Why</summary><IntegrityTable t={integrityOf(character, v, ctx)} /></details>
        <div className="row wrap">
          <PlayButton label="Hear" get={() => sample(v, script.text)} />
          {!isApproved && <button className="sm" onClick={() => void casting.assign(character.id, v)}>Use for now</button>}
          {!isApproved && <button className="sm primary" onClick={() => void casting.assign(character.id, v, { approve: true })}>Approve and lock</button>}
        </div>
      </li>
    );
  };

  return (
    <div className="casting-panel">
      <div className="row between wrap">
        <span className="row">
          <strong>Casting</strong>
          {approval
            ? <span className="status-chip s-verified_match" title={`Approved ${approval.approvedAt.slice(0, 10)}. Basis: ${STATUS_LABEL[approval.basis]}.`}>Locked: {approval.voiceName}</span>
            : <span className="status-chip s-unknown_metadata">Not approved</span>}
        </span>
        <span className="row">
          {approval && <button className="sm ghost" onClick={() => void casting.unlock(character.id)}>Unlock</button>}
          <button className="sm" aria-expanded={open} onClick={() => setOpen(!open)}>{open ? "Hide casting" : "Choose or check the voice"}</button>
        </span>
      </div>
      {current && <IntegrityCard character={character} voice={current} context={ctx} />}
      <ConsistencyCheck character={character} />
      {open && (
        <div className="stack">
          <fieldset className="cast-req">
            <legend>What this character needs</legend>
            <p className="muted small">Only what you state is used. A name, a picture, a nationality or a cultural background never decides a voice.</p>
            <div className="row wrap">
              <label className="field">Vocal presentation
                <select value={spec.vocalGender ?? ""} onChange={(e) => setSpec({ vocalGender: (e.target.value || undefined) as CastingSpec["vocalGender"] })}>
                  <option value="">Not stated</option><option value="any">Any</option><option value="masculine">Masculine</option><option value="feminine">Feminine</option>
                </select>
              </label>
              <label className="field">Spoken language
                <input type="text" value={spec.language ?? ""} placeholder="for example Yoruba" onChange={(e) => setSpec({ language: e.target.value })} />
              </label>
              <label className="field">Language is
                <select value={spec.languageStrictness ?? "required"} onChange={(e) => setSpec({ languageStrictness: e.target.value as CastingSpec["languageStrictness"] })}>
                  <option value="required">Required</option><option value="preferred">Preferred</option><option value="ignore">Ignore</option>
                </select>
              </label>
              <label className="field">Accent
                <input type="text" value={spec.accent ?? ""} placeholder="for example Nigerian English" onChange={(e) => setSpec({ accent: e.target.value })} />
              </label>
              <label className="field">Accent is
                <select value={spec.accentStrictness ?? "preferred"} onChange={(e) => setSpec({ accentStrictness: e.target.value as CastingSpec["accentStrictness"] })}>
                  <option value="preferred">Preferred</option><option value="required">Required</option><option value="ignore">Ignore</option>
                </select>
              </label>
            </div>
            <div className="row wrap" role="group" aria-label="Vocal age">
              <span className="muted small">Sounds like:</span>
              {AGES.map((a) => <label key={a.id} className="row small"><input type="checkbox" checked={(spec.vocalAge ?? []).includes(a.id)} onChange={() => toggleAge(a.id)} /> {a.label}</label>)}
            </div>
            <label className="field">Notes (never used to match)
              <input type="text" value={spec.culturalBackground ?? ""} placeholder="background, nationality, anything for your own reference" onChange={(e) => setSpec({ culturalBackground: e.target.value })} />
            </label>
            <p className="small" aria-live="polite">{describeRequirements(req).length ? describeRequirements(req).join(". ") + "." : "Nothing is required yet, so no voice can be proven to fit."}</p>
          </fieldset>

          <div className="row wrap">
            <label className="field">Audition script
              <select value={script.id} onChange={(e) => setScriptId(e.target.value)}>{scripts.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select>
            </label>
            <button disabled={compare.length < 2 || busy} onClick={() => void hearAll()}>{busy ? "Playing…" : `Hear ${compare.length || "the"} compared in turn`}</button>
            <button className="sm ghost" onClick={() => go("review")}>Record what I heard</button>
          </div>
          <p className="muted small">“{script.text}” {script.unchecked ? "(Written by Greenroom, not checked by a native speaker.) " : ""}{script.purpose}</p>

          {offer.length === 0 && <p className="note err" role="status">{ranked.length === 0 ? "Your voice library is empty." : "No voice in your library can be used for this character."} Nothing was substituted. Add a voice in Voices, or change what is required.</p>}
          <ul className="cast-cands">{offer.slice(0, 8).map(row)}</ul>
          {out.length > 0 && (
            <div>
              <button className="sm ghost" aria-expanded={showOut} onClick={() => setShowOut(!showOut)}>{showOut ? "Hide" : "Show"} {out.length} ruled out</button>
              {showOut && <ul className="cast-cands ruled-out">{out.map((m) => <li key={m.voiceId} className="cast-cand"><strong>{voiceOf(m.voiceId)?.name}</strong> <span className={`status-chip s-${m.status.toLowerCase()}`}>{STATUS_LABEL[m.status]}</span><p className="muted small">{summaryOf(m)}</p></li>)}</ul>}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
