import { useState } from "react";
import { engineLabel } from "../engineCaps";
import { ACCENT_QUALITY_LABEL } from "../presets";
import { addReview, CRITERIA, earnedQuality, type AccentReview, type AccentTest, type Rating, type Relation, type Verdict } from "../presets/accentTests";
import type { AccentQuality } from "../presets";
import type { VoiceEntry } from "../types";
import { Note, PlayButton } from "../ui";

const RELATION: Record<Relation, string> = { native_speaker: "A native speaker of this accent", community_member: "A member of the community", other: "Someone else (does not change the label)" };

/**
 * A listening test for one advertised accent. The person listens to a voice say the phrases and records what they heard.
 * Greenroom never scores the audio: the label can only rise through the review recorded here.
 */
export default function AccentPanel({ test, base, voices, reviews, hear, onSave, onClose, onExport, onImport }: {
  test: AccentTest; base: AccentQuality; voices: VoiceEntry[]; reviews: AccentReview[];
  hear: (v: VoiceEntry, phrase: string) => Promise<string>;
  onSave: (r: AccentReview) => void; onClose: () => void; onExport: () => void; onImport: (f: File) => void;
}) {
  const [voiceId, setVoiceId] = useState(voices[0]?.id ?? "");
  const voice = voices.find((v) => v.id === voiceId);
  const [name, setName] = useState("");
  const [relation, setRelation] = useState<Relation>("native_speaker");
  const [verdict, setVerdict] = useState<Verdict>("partly");
  const [comment, setComment] = useState("");
  const [ratings, setRatings] = useState<Partial<Record<(typeof CRITERIA)[number]["id"], Rating>>>({});
  const earned = voice ? earnedQuality(reviews, test.id, voice.provider, voice.name, base) : null;
  const mine = reviews.filter((r) => r.testId === test.id && (!voice || (r.engine === voice.provider && r.voiceName === voice.name)));
  const required = CRITERIA.filter((c) => c.required).every((c) => ratings[c.id]);
  const save = () => {
    if (!voice || !name.trim() || !required) return;
    const date = new Date().toISOString();
    onSave({ id: `${test.id}:${voice.provider}:${voice.name}:${name.trim().toLowerCase()}:${date}`, testId: test.id, engine: voice.provider, voiceName: voice.name, reviewer: { name: name.trim().slice(0, 60), relation }, date, ratings, verdict, comment: comment.trim().slice(0, 600), imported: false });
    setComment("");
  };
  return (
    <div className="card lit accent-panel" role="region" aria-label={`Listening test: ${test.accent}`}>
      <div className="row between"><h2>Listening test: {test.accent} ({test.language})</h2><button className="sm ghost" onClick={onClose}>Close</button></div>
      <p className="muted small">{test.note} Greenroom cannot judge an accent. This label only changes when a person records a review below.</p>
      {voices.length === 0 ? <Note kind="warn">No voice in your library can be tested for this accent yet. Add one in Voices.</Note> : (
        <>
          <label className="small">Voice being tested
            <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>{voices.map((v) => <option key={v.id} value={v.id}>{v.name} ({engineLabel(v.provider)})</option>)}</select>
          </label>
          <ol className="phrases">
            {test.phrases.map((ph) => (
              <li key={ph} className="row"><span className="grow">{ph}</span>{voice && <PlayButton label="Play" get={() => hear(voice, ph)} />}</li>
            ))}
          </ol>
          {test.phrasesNeedReview && <Note kind="warn">The wording of these phrases has not been checked by a speaker. If a phrase is wrong, say so in your comment.</Note>}
          {earned && <p className="small" aria-live="polite"><strong>Label for this voice:</strong> {ACCENT_QUALITY_LABEL[earned.quality]} <span className="muted">({earned.because})</span></p>}

          <fieldset className="review-form">
            <legend>Record what you heard</legend>
            <div className="row wrap">
              <label className="small">Your name<input type="text" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="small">You are<select value={relation} onChange={(e) => setRelation(e.target.value as Relation)}>{(Object.keys(RELATION) as Relation[]).map((r) => <option key={r} value={r}>{RELATION[r]}</option>)}</select></label>
            </div>
            {CRITERIA.map((c) => (
              <label key={c.id} className="row small criterion">
                <span className="grow">{c.label}{c.required ? " *" : ""}</span>
                <select value={ratings[c.id] ?? ""} onChange={(e) => setRatings((r) => ({ ...r, [c.id]: (e.target.value || undefined) as Rating }))} aria-label={c.label}>
                  <option value="">Choose</option><option value="pass">Yes</option><option value="unsure">Not sure</option><option value="fail">No</option>
                </select>
              </label>
            ))}
            <label className="small">Overall, does this voice do this accent?
              <select value={verdict} onChange={(e) => setVerdict(e.target.value as Verdict)}><option value="supported">Yes</option><option value="partly">Partly</option><option value="not_supported">No</option></select>
            </label>
            <label className="small">Comment (region, what was off, wording of the phrases)<textarea rows={2} maxLength={600} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
            <p className="muted small">* required. A review marked supported needs every starred item answered Yes. One native speaker is enough for “native-speaker reviewed”; two community reviewers for “community reviewed”.</p>
            <button className="primary" disabled={!voice || !name.trim() || !required} onClick={save}>Save my review</button>
          </fieldset>
        </>
      )}
      {mine.length > 0 && (
        <details open><summary>Reviews for this accent{voice ? ` on ${voice.name}` : ""} ({mine.length})</summary>
          <ul className="small">{mine.map((r) => <li key={r.id}>{r.reviewer.name} ({r.reviewer.relation.replace("_", " ")}{r.imported ? ", from a file" : ""}, {r.date.slice(0, 10)}): {r.verdict.replace("_", " ")}{r.comment ? ` · ${r.comment}` : ""}</li>)}</ul>
        </details>
      )}
      <div className="row wrap">
        <button className="sm" onClick={onExport}>Export my reviews</button>
        <label className="sm ghost file-btn">Import reviews<input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) onImport(f); e.target.value = ""; }} /></label>
        <span className="muted small">Reviews from a file can raise a label to “community reviewed” at most, because Greenroom cannot check who wrote them.</span>
      </div>
    </div>
  );
}

export { addReview };
