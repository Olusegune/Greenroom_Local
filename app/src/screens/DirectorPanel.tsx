import { ACTING_PRESETS, applyPreset } from "../acting";
import { beatMode, beatsFor, type BeatSetting } from "../beats";
import { EMOTIONS } from "../direct";
import { ACTIVITIES, compilePerformance, DEFAULT_PERFORMANCE, isDefaultPerformance, migratePerformance, type PerformancePlan, type PerformancePoint } from "../performance";
import { referenceHint } from "../analysis";
import type { Line } from "../types";
import type { ActingReference } from "../voiceDna";

const ACTIVITY_LABEL: Record<(typeof ACTIVITIES)[number], string> = { still: "Standing still", walking: "Walking", running: "Running", lifting: "Lifting something heavy", pushing: "Pushing", fighting: "Fighting", injured: "Hurt", cold: "Freezing cold", custom: "Something else (describe it)" };

/**
 * The director's plan for one line: what the character wants, what is underneath, how the feeling moves and what the
 * body is doing. It is saved on the line and turned into words (and a pace) when a take is made. It never changes the
 * script text, the chips or the direction box.
 */
export function DirectorPanel({ line, patch, actsOnWords, engineLabel, isInworld = false, references = [], preferred = [] }: { line: Line; patch: (fn: (l: Line) => Line) => void; actsOnWords: boolean; engineLabel: string; isInworld?: boolean; references?: ActingReference[]; preferred?: string[] }) {
  const plan = migratePerformance(line.performance) ?? DEFAULT_PERFORMANCE;
  const set = (fn: (p: PerformancePlan) => PerformancePlan) =>
    patch((l) => {
      const next = fn(migratePerformance(l.performance) ?? DEFAULT_PERFORMANCE);
      return { ...l, performance: isDefaultPerformance(next) ? undefined : next };
    });
  const start: PerformancePoint = plan.arc[0] ?? DEFAULT_PERFORMANCE.arc[0]!;
  const end: PerformancePoint = plan.arc.length > 1 ? plan.arc[plan.arc.length - 1]! : start;
  const setArc = (s: PerformancePoint, e: PerformancePoint) => set((p) => ({ ...p, arc: [{ ...s, position: 0 }, { ...e, position: 1 }] }));
  const emotions = [{ tag: "neutral", label: "Neutral" }, ...EMOTIONS];
  const compiled = compilePerformance(plan);
  const beatsOn = (line.beats?.length ?? 0) > 0;
  const active = !isDefaultPerformance(plan);
  const names = [plan.objective && "objective", plan.subtext && "subtext", plan.arc.length > 1 && "arc", plan.physical.activity !== "still" && plan.physical.activity].filter(Boolean).join(", ");
  const slider = (label: string, v: number, min: number, max: number, step: number, on: (n: number) => void, show: (n: number) => string) => (
    <label className="row small muted" key={label}>
      {label}
      <input type="range" min={min} max={max} step={step} value={v} aria-label={label} onChange={(e) => on(Number(e.target.value))} />
      <span className="num">{show(v)}</span>
    </label>
  );
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const ph = plan.physical;
  const setPh = (patchPh: Partial<PerformancePlan["physical"]>) => set((p) => ({ ...p, physical: { ...p.physical, ...patchPh } }));

  return (
    <details className="finetune director-panel">
      <summary>Director{names ? ` · ${names}` : ""}</summary>
      <div className="stack">
        <p className="muted small">Plan what the character wants and what their body is doing. Greenroom turns it into plain words added after your own direction when a take is made. Your script and direction box are not changed.</p>
        <select
          aria-label="Start from an acting preset"
          value=""
          onChange={(e) => {
            const pr = ACTING_PRESETS.find((x) => x.id === e.target.value);
            if (pr) set((p) => applyPreset(p, pr));
          }}
        >
          <option value="">Start from an acting preset…</option>
          {[...ACTING_PRESETS].sort((a, b) => Number(preferred.includes(b.id)) - Number(preferred.includes(a.id))).map((pr) => (
            <option key={pr.id} value={pr.id}>
              {preferred.includes(pr.id) ? "★ " : ""}{pr.label} — {pr.blurb}
            </option>
          ))}
        </select>
        {references.length > 0 && (
          <div className="row wrap">
            <button
              className="sm"
              title="Sets pace, projection and the pause after from the measured take. An estimate to listen to and change."
              onClick={() => {
                const ref = references[0]!;
                const h = referenceHint(ref.stats);
                patch((l) => ({ ...l, direction: { ...l.direction, pauseAfter: h.pauseAfter }, performance: { ...(migratePerformance(l.performance) ?? DEFAULT_PERFORMANCE), pace: h.pace, projection: h.projection } }));
              }}
            >
              Match acting reference
            </button>
            <span className="muted small">
              from “{references[0]!.text.slice(0, 40)}”: {referenceHint(references[0]!.stats).pace.toFixed(2)}× pace, {Math.round(referenceHint(references[0]!.stats).projection * 100)}% projection, {referenceHint(references[0]!.stats).pauseAfter.toFixed(1)} s pause. Another engine will not copy the delivery exactly.
            </span>
          </div>
        )}
        <label className="field">
          Objective: what is the character trying to do?
          <input type="text" maxLength={160} value={plan.objective} placeholder="intimidate while appearing polite" onChange={(e) => set((p) => ({ ...p, objective: e.target.value }))} />
        </label>
        <label className="field">
          Subtext: what is underneath?
          <input type="text" maxLength={160} value={plan.subtext} placeholder="afraid of being found out" onChange={(e) => set((p) => ({ ...p, subtext: e.target.value }))} />
        </label>

        <span className="eyebrow">How the feeling moves through the line</span>
        <div className="row wrap">
          <label className="row small muted">
            Starts
            <select aria-label="Feeling at the start" value={start.emotion} onChange={(e) => setArc({ ...start, emotion: e.target.value }, end)}>
              {emotions.map((e) => (
                <option key={e.tag} value={e.tag}>{e.label}</option>
              ))}
            </select>
          </label>
          {slider("Strength at start", start.intensity, 0, 1, 0.05, (n) => setArc({ ...start, intensity: n }, end), pct)}
        </div>
        <div className="row wrap">
          <label className="row small muted">
            Ends
            <select aria-label="Feeling at the end" value={end.emotion} onChange={(e) => setArc(start, { ...end, emotion: e.target.value })}>
              {emotions.map((e) => (
                <option key={e.tag} value={e.tag}>{e.label}</option>
              ))}
            </select>
          </label>
          {slider("Strength at end", end.intensity, 0, 1, 0.05, (n) => setArc(start, { ...end, intensity: n }), pct)}
        </div>

        <span className="eyebrow">What the body is doing</span>
        <div className="row wrap">
          <select aria-label="Physical activity" value={ph.activity} onChange={(e) => setPh({ activity: e.target.value as PerformancePlan["physical"]["activity"] })}>
            {ACTIVITIES.map((a) => (
              <option key={a} value={a}>{ACTIVITY_LABEL[a]}</option>
            ))}
          </select>
          {ph.activity === "custom" && <input type="text" maxLength={120} aria-label="Describe the activity" placeholder="climbing a ladder" value={ph.note} onChange={(e) => setPh({ note: e.target.value })} />}
        </div>
        <div className="row wrap">
          {slider("Effort", ph.effort, 0, 1, 0.05, (n) => setPh({ effort: n }), pct)}
          {slider("Breathlessness", ph.breathlessness, 0, 1, 0.05, (n) => setPh({ breathlessness: n }), pct)}
          {slider("Fatigue", ph.fatigue, 0, 1, 0.05, (n) => setPh({ fatigue: n }), pct)}
          {slider("Pain", ph.pain, 0, 1, 0.05, (n) => setPh({ pain: n }), pct)}
        </div>

        <span className="eyebrow">The voice itself</span>
        <div className="row wrap">
          {slider("Pace", plan.pace, 0.7, 1.2, 0.05, (n) => set((p) => ({ ...p, pace: n })), (n) => `${n.toFixed(2)}×`)}
          {slider("Projection", plan.projection, 0, 1, 0.05, (n) => set((p) => ({ ...p, projection: n })), pct)}
          {slider("Tension", plan.tension, 0, 1, 0.05, (n) => set((p) => ({ ...p, tension: n })), pct)}
          {slider("Breathiness", plan.breathiness, 0, 1, 0.05, (n) => set((p) => ({ ...p, breathiness: n })), pct)}
        </div>

        <span className="eyebrow">Beats inside the line</span>
        <BeatEditor line={line} patch={patch} actsOnWords={actsOnWords} isInworld={isInworld} engineLabel={engineLabel} />

        <div className="dir-reach small" role="status">
          {!active && <span className="muted">{beatsOn ? "Only the beats above are set." : "Nothing planned yet."}</span>}
          {active && compiled.sentences.length > 0 && (
            <span>
              Added to the direction: <b>{compiled.sentences.join(" ")}</b>
              {compiled.sounds.length > 0 && <> Also adds the sound: {compiled.sounds.join(", ")}.</>}
            </span>
          )}
          {active && compiled.sentences.length === 0 && <span className="muted">The plan only changes pace so far ({plan.pace.toFixed(2)}×).</span>}
          {active && !actsOnWords && <p className="warn">{engineLabel} cannot act on written direction, so only the pace can change. Choose a voice that follows direction, or perform it yourself with Re-voice a recording.</p>}
        </div>
        {active && (
          <div>
            <button className="sm ghost" onClick={() => patch((l) => ({ ...l, performance: undefined }))}>Clear the plan</button>
          </div>
        )}
      </div>
    </details>
  );
}

/** Per-phrase acting. Each phrase of the line can carry its own emotion, intention, emphasis, pace and pause. */
function BeatEditor({ line, patch, actsOnWords, isInworld, engineLabel }: { line: Line; patch: (fn: (l: Line) => Line) => void; actsOnWords: boolean; isInworld: boolean; engineLabel: string }) {
  const ps = beatsFor(line);
  const mode = beatMode(line);
  const assemble = mode === "assemble";
  const setBeat = (text: string, f: (b: BeatSetting) => BeatSetting) =>
    patch((l) => {
      const list = (l.beats ?? []).filter((b) => b.text !== text);
      const cur = (l.beats ?? []).find((b) => b.text === text) ?? { text };
      const next = f(cur);
      const empty = !next.emotion && !next.intention && !next.emphasis && (next.pace === undefined || next.pace === 1) && !next.pauseAfter;
      const beats = empty ? list : [...list, next];
      return { ...l, beats: beats.length ? beats : undefined };
    });
  if (ps.length < 2) return <p className="muted small">This line is a single phrase. Beats need at least two: add a comma or a full stop to split it.</p>;
  return (
    <div className="stack">
      <p className="muted small">Each phrase can have its own feeling. {actsOnWords ? `${engineLabel} reads a cue written in front of the phrase.` : `${engineLabel} cannot act on written words, so use "Make each phrase separately" for pace and pauses.`}</p>
      <label className="row small">
        <input type="checkbox" checked={assemble} onChange={(e) => patch((l) => ({ ...l, beatMode: e.target.checked ? "assemble" : undefined }))} />
        <span>Make each phrase separately and join them (needed for pace and pauses; costs one request per phrase, and the joins may sound different from one continuous read)</span>
      </label>
      {ps.map((p, i) => {
        const s = p.setting ?? { text: p.text };
        return (
          <div key={p.text + i} className="card stack" style={{ background: "var(--surface-1)" }}>
            <span className="small">“{p.text}”</span>
            <div className="row wrap">
              <select aria-label={`Feeling for phrase ${i + 1}`} value={s.emotion ?? ""} onChange={(e) => setBeat(p.text, (b) => ({ ...b, emotion: e.target.value || undefined }))}>
                <option value="">No change of feeling</option>
                {EMOTIONS.map((e) => (
                  <option key={e.tag} value={e.tag}>{e.label}</option>
                ))}
              </select>
              <input type="text" aria-label={`Intention for phrase ${i + 1}`} maxLength={100} placeholder="intention: to warn her" value={s.intention ?? ""} onChange={(e) => setBeat(p.text, (b) => ({ ...b, intention: e.target.value || undefined }))} style={{ flex: 1, minWidth: 180 }} />
              <label className="row small" title={isInworld ? "Capitalises the key word, which Inworld reads as emphasis" : "Only Inworld voices act on emphasis"}>
                <input type="checkbox" checked={!!s.emphasis} onChange={(e) => setBeat(p.text, (b) => ({ ...b, emphasis: e.target.checked || undefined }))} />
                Emphasis
              </label>
            </div>
            <div className="row wrap">
              <label className="row small muted" title={assemble ? "" : "Only used when each phrase is made separately"}>
                Pace
                <input type="range" min={0.8} max={1.2} step={0.05} disabled={!assemble} value={s.pace ?? 1} aria-label={`Pace for phrase ${i + 1}`} onChange={(e) => setBeat(p.text, (b) => ({ ...b, pace: Number(e.target.value) }))} />
                <span className="num">{(s.pace ?? 1).toFixed(2)}×</span>
              </label>
              <label className="row small muted" title={assemble ? "" : "Only used when each phrase is made separately"}>
                Pause after
                <input type="range" min={0} max={2} step={0.1} disabled={!assemble || i === ps.length - 1} value={s.pauseAfter ?? 0} aria-label={`Pause after phrase ${i + 1}`} onChange={(e) => setBeat(p.text, (b) => ({ ...b, pauseAfter: Number(e.target.value) }))} />
                <span className="num">{(s.pauseAfter ?? 0).toFixed(1)}s</span>
              </label>
            </div>
          </div>
        );
      })}
      {assemble && <p className="small">This line will take {ps.length} requests.</p>}
    </div>
  );
}
