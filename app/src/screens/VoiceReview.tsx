import { useMemo, useState } from "react";
import { useApp } from "../ctx";
import { ENGINES } from "../engines";
import { playUrl } from "../media";
import { auditionScripts } from "../casting/auditionScripts";
import type { Fact, FactSource, FactStatus, VocalAge, VocalGender, VoiceAttribute } from "../casting/types";
import { applyMetaChange, profileOf, type MetaChange } from "../casting/voiceProfile";
import type { VoiceEntry } from "../types";
import { PlayButton } from "../ui";
import { useSample } from "../useSample";


const SOURCE_LABEL: Record<FactSource, string> = {
  owner_listening: "You listened and confirmed",
  owner_entered: "You entered it (not confirmed by listening)",
  provider_label: "The provider's label",
  model_config: "How the model or Greenroom's route works",
  engine_documentation: "The engine's documentation",
  corpus_documentation: "The recording corpus's documentation",
  name_table: "A table of names (not evidence)",
  description_text: "Words in a description (not evidence)",
  none: "Nobody has said",
};
const STATUS_WORD: Record<FactStatus, string> = { verified: "Verified", unverified: "Unverified", unknown: "Unknown", not_applicable: "Not applicable" };
const ATTRS: { id: VoiceAttribute; label: string }[] = [{ id: "gender", label: "Vocal presentation" }, { id: "age", label: "Sounds like (age)" }, { id: "languages", label: "Languages spoken" }, { id: "accent", label: "Accent" }, { id: "pitch", label: "Pitch" }, { id: "texture", label: "Texture" }];

const needsReview = (v: VoiceEntry) => { const p = profileOf(v); return [p.gender, p.age, p.languages, p.accent].some((f) => f.status !== "verified"); };

/** The administrative review of what is recorded about each voice: every fact with its status and source, corrected without touching the code, with the old value kept as evidence. */
export default function VoiceReview() {
  const { library, saveLibrary, toast } = useApp();
  const sample = useSample();
  const [q, setQ] = useState("");
  const [onlyReview, setOnlyReview] = useState(false);
  const [selId, setSelId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [listened, setListened] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);

  const shown = useMemo(() => library.filter((v) => `${v.name} ${v.provider} ${v.language} ${v.accent}`.toLowerCase().includes(q.trim().toLowerCase()) && (!onlyReview || needsReview(v))), [library, q, onlyReview]);
  const sel = library.find((v) => v.id === selId);
  const prof = sel ? profileOf(sel) : undefined;
  const neutral = auditionScripts({})[0]!;

  const open = (v: VoiceEntry) => { setSelId(v.id); setDraft({}); setListened(false); setEvidence(""); };
  const val = (k: string, fallback: string) => (k in draft ? draft[k]! : fallback);

  const save = () => {
    if (!sel || !prof) return;
    const change: MetaChange = { listened, ...(evidence.trim() ? { evidence: evidence.trim() } : {}) };
    const cur = { gender: prof.gender.value ?? "", age: prof.age.value ?? "", languages: (prof.languages.value ?? []).join(", "), accent: prof.accent.value ?? "", pitch: prof.pitch.value ?? "", texture: prof.texture.value ?? "" };
    let n = 0;
    if ("gender" in draft && draft.gender !== cur.gender) { change.gender = (draft.gender || null) as VocalGender | null; n++; }
    if ("age" in draft && draft.age !== cur.age) { change.age = (draft.age || null) as VocalAge | null; n++; }
    if ("languages" in draft && draft.languages !== cur.languages) { change.languages = draft.languages!.split(",").map((s) => s.trim()).filter(Boolean); n++; }
    if ("accent" in draft && draft.accent !== cur.accent) { change.accent = draft.accent!.trim() || null; n++; }
    if ("pitch" in draft && draft.pitch !== cur.pitch) { change.pitch = (draft.pitch || null) as "low" | "mid" | "high" | null; n++; }
    if ("texture" in draft && draft.texture !== cur.texture) { change.texture = draft.texture!.trim() || null; n++; }
    if ("commercial" in draft) { change.commercial = { status: draft.commercial as "allowed" | "forbidden" | "unknown", ...(draft.commercialNote?.trim() ? { note: draft.commercialNote.trim() } : {}) }; n++; }
    // Confirming without changing anything is allowed: it makes the CURRENT values verified.
    if (n === 0 && listened) {
      if (prof.gender.value) change.gender = prof.gender.value;
      if (prof.age.value) change.age = prof.age.value;
      if (prof.languages.value) change.languages = prof.languages.value;
      if (prof.accent.value) change.accent = prof.accent.value;
      n = [change.gender, change.age, change.languages, change.accent].filter((x) => x !== undefined).length;
    }
    if (n === 0) return toast("Nothing to save: change a value, or tick \"I listened\" to confirm the current ones.");
    const next = applyMetaChange(sel, change, new Date().toISOString());
    saveLibrary((l) => l.map((x) => (x.id === sel.id && x.provider === sel.provider ? next : x)));
    setDraft({}); setListened(false); setEvidence("");
    toast(`Saved. ${listened ? "The values are now marked as confirmed by listening." : "Saved as entered, not yet confirmed by listening."}`);
  };

  const hearShown = async () => {
    setBusy(true);
    try {
      for (const v of shown.slice(0, 13)) { const url = await sample(v, neutral.text); await new Promise<void>((done) => void playUrl(url, done, v.name)); }
    } catch { /* cancelled */ } finally { setBusy(false); }
  };

  return (
    <section className="stack">
      <header><span className="eyebrow">VOICES</span><h1>Voice metadata</h1>
        <p className="lede">What Greenroom knows about each voice, and where it came from. Nothing is guessed from a voice's name. Listen, then record what you heard: only a fact you confirmed by listening is "verified".</p>
      </header>
      <div className="row wrap">
        <input type="search" aria-label="Search voices" placeholder="Search voices" value={q} onChange={(e) => setQ(e.target.value)} />
        <label className="row small"><input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> Only voices with something unconfirmed</label>
        <button disabled={busy || shown.length === 0} onClick={() => void hearShown()}>{busy ? "Playing…" : `Hear these ${Math.min(shown.length, 13)} in turn (same words)`}</button>
      </div>
      <div className="review-grid">
        <ul className="review-list" aria-label="Voices">
          {shown.length === 0 && <li className="muted">No voices match.</li>}
          {shown.map((v) => {
            const p = profileOf(v);
            const all = [p.gender, p.age, p.languages, p.accent];
            return (
              <li key={v.provider + v.id}>
                <button className={selId === v.id ? "review-item sel" : "review-item"} aria-pressed={selId === v.id} onClick={() => open(v)}>
                  <strong>{v.name}</strong>
                  <span className="muted small">{ENGINES[v.provider].label}</span>
                  <span className="small">{all.filter((f) => f.status === "verified").length} confirmed · {all.filter((f) => f.status === "unverified").length} claimed · {all.filter((f) => f.status === "unknown").length} unknown</span>
                </button>
              </li>
            );
          })}
        </ul>
        {sel && prof ? (
          <div className="card stack review-detail" aria-live="polite">
            <div className="row between wrap"><h2>{sel.name}</h2><PlayButton label="Hear the neutral line" get={() => sample(sel, neutral.text)} /></div>
            <p className="muted small">{ENGINES[sel.provider].label}{prof.speakerId ? ` · speaker ${prof.speakerId}` : ""}{prof.modelId ? ` · ${prof.modelId}` : ""} · {prof.commercial.status === "forbidden" ? "Not for commercial use" : prof.commercial.status === "allowed" ? "Commercial use allowed" : "Commercial use unknown"}{prof.commercial.note ? `: ${prof.commercial.note}` : ""}</p>
            {ATTRS.map((a) => {
              const f = prof[a.id] as Fact<unknown>;
              const current = a.id === "languages" ? ((f.value as string[] | null) ?? []).join(", ") : ((f.value as string | null) ?? "");
              return (
                <div key={a.id} className="review-fact">
                  <div className="row between wrap"><label htmlFor={`rv-${a.id}`}><strong>{a.label}</strong></label><span className={`status-chip s-fact-${f.status}`}>{STATUS_WORD[f.status]}</span></div>
                  {a.id === "gender" && <select id="rv-gender" value={val("gender", current)} onChange={(e) => setDraft({ ...draft, gender: e.target.value })}><option value="">Unknown</option><option value="masculine">Masculine</option><option value="feminine">Feminine</option><option value="androgynous">Androgynous</option></select>}
                  {a.id === "age" && <select id="rv-age" value={val("age", current)} onChange={(e) => setDraft({ ...draft, age: e.target.value })}><option value="">Unknown</option><option value="child">Child</option><option value="teen">Teen</option><option value="young">Young adult</option><option value="mid">Adult</option><option value="old">Older</option></select>}
                  {a.id === "pitch" && <select id="rv-pitch" value={val("pitch", current)} onChange={(e) => setDraft({ ...draft, pitch: e.target.value })}><option value="">Unknown</option><option value="low">Low</option><option value="mid">Middle</option><option value="high">High</option></select>}
                  {(a.id === "languages" || a.id === "accent" || a.id === "texture") && <input type="text" id={`rv-${a.id}`} value={val(a.id, current)} placeholder={a.id === "languages" ? "for example english, yoruba" : ""} onChange={(e) => setDraft({ ...draft, [a.id]: e.target.value })} />}
                  <p className="muted small">{SOURCE_LABEL[f.source]}{f.checkedAt ? ` · ${f.checkedAt.slice(0, 10)}` : ""}{f.note ? ` · ${f.note}` : ""}</p>
                </div>
              );
            })}
            <div className="review-fact">
              <label htmlFor="rv-comm"><strong>Commercial use</strong></label>
              <select id="rv-comm" value={val("commercial", prof.commercial.status)} onChange={(e) => setDraft({ ...draft, commercial: e.target.value })}><option value="unknown">Unknown</option><option value="allowed">Allowed</option><option value="forbidden">Not allowed</option></select>
              {"commercial" in draft && <input type="text" aria-label="Licence note" placeholder="where the licence says so" value={val("commercialNote", "")} onChange={(e) => setDraft({ ...draft, commercialNote: e.target.value })} />}
            </div>
            <label className="row"><input type="checkbox" checked={listened} onChange={(e) => setListened(e.target.checked)} /> I listened to this voice and confirm what I have entered</label>
            <label className="field">Evidence (optional)<input type="text" value={evidence} placeholder="for example: heard the neutral and emotional lines, 10 Nov" onChange={(e) => setEvidence(e.target.value)} /></label>
            <p className="muted small">Automatic classification is never presented as proof of anyone's age, gender, race or ethnicity: these are how a VOICE sounds to you.</p>
            <div className="row"><button className="primary" onClick={save}>{listened ? "Save as confirmed" : "Save as entered"}</button><button className="ghost" onClick={() => setDraft({})}>Discard changes</button></div>
            {prof.revisions.length > 0 && (
              <details><summary>History ({prof.revisions.length})</summary>
                <ul className="small">{[...prof.revisions].reverse().map((r, i) => <li key={i}>{r.at.slice(0, 16).replace("T", " ")}: {r.summary}{r.evidence ? ` (${r.evidence})` : ""}</li>)}</ul>
              </details>
            )}
          </div>
        ) : <div className="card muted">Choose a voice to see and correct what is recorded about it.</div>}
      </div>
    </section>
  );
}
