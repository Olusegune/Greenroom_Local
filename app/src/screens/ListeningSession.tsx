import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "../ctx";
import { ENGINES } from "../engines";
import { playUrl, stopPlayback } from "../media";
import { KEYS, NO_PICK, applyPick, hasPick, sessionQueue, type AgePick, type GenderPick, type Pick } from "../casting/session";
import { profileOf } from "../casting/voiceProfile";
import { SAMPLE_LINE, useSample } from "../useSample";
import { VoiceFace } from "../voiceMark";

const GENDERS: { id: GenderPick; label: string; key: string }[] = [{ id: "masculine", label: "Masculine", key: "M" }, { id: "feminine", label: "Feminine", key: "F" }, { id: "androgynous", label: "Androgynous", key: "A" }, { id: "unsure", label: "Unsure", key: "U" }];
const AGES: { id: AgePick; label: string; key: string }[] = [{ id: "child", label: "Child", key: "1" }, { id: "teen", label: "Teen", key: "2" }, { id: "young", label: "Young adult", key: "3" }, { id: "mid", label: "Adult", key: "4" }, { id: "old", label: "Older", key: "5" }, { id: "unsure", label: "Unsure", key: "0" }];

/**
 * Confirm what voices sound like, one after another: the voice plays, you say what you hear, and it moves on. Only what you pick is
 * recorded, as confirmed by listening. "Unsure" records nothing. Cloud voices play their free provider sample, so nothing is spent.
 */
export default function ListeningSession({ engine, onClose }: { engine: string; onClose: () => void }) {
  const { library, saveLibrary, toast } = useApp();
  const sample = useSample();
  const queue = useMemo(() => sessionQueue(library, { engine }), []); // fixed at the start so the order does not shift as voices are confirmed
  const [i, setI] = useState(0);
  const [pick, setPick] = useState<Pick>(NO_PICK);
  const [saved, setSaved] = useState(0);
  const [auto, setAuto] = useState(true);
  const playing = useRef(0);
  const v = queue[i];

  const play = async () => {
    if (!v) return;
    const token = ++playing.current;
    try { const url = await sample(v, SAMPLE_LINE); if (token === playing.current) await playUrl(url, undefined, v.name); } catch { /* the hook already said why */ }
  };
  useEffect(() => { setPick(NO_PICK); if (auto && v) void play(); return () => { playing.current++; stopPlayback(); }; }, [i]); // eslint-disable-line react-hooks/exhaustive-deps

  const next = (save: boolean) => {
    if (save && v && hasPick(pick)) { const now = new Date().toISOString(); saveLibrary((l) => l.map((x) => (x.id === v.id && x.provider === v.provider ? applyPick(x, pick, now) : x))); setSaved((n) => n + 1); }
    if (i + 1 >= queue.length) { toast(`Listening session finished. ${save && v && hasPick(pick) ? saved + 1 : saved} voice${(save && v && hasPick(pick) ? saved + 1 : saved) === 1 ? "" : "s"} confirmed.`); onClose(); return; }
    setI(i + 1);
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();
      if (KEYS[key]) { e.preventDefault(); setPick((p) => ({ ...p, ...KEYS[key] }) as Pick); }
      else if (key === "enter") { e.preventDefault(); next(true); }
      else if (key === "s") { e.preventDefault(); next(false); }
      else if (key === "r") { e.preventDefault(); void play(); }
      else if (key === "b" && i > 0) { e.preventDefault(); setI(i - 1); }
      else if (key === "escape") onClose();
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  });

  if (queue.length === 0) return <div className="card stack"><p>Every voice in this list is already confirmed. Nothing to listen to.</p><button onClick={onClose}>Close</button></div>;
  if (!v) return null;
  const p = profileOf(v);
  return (
    <section className="card stack listening-session" aria-label="Listening session">
      <div className="row between wrap"><strong>Voice {i + 1} of {queue.length}</strong><span className="muted small">{saved} confirmed so far</span><button className="sm ghost" onClick={onClose}>End session</button></div>
      <div className="row"><VoiceFace voice={v} size={56} /><span className="stack tight"><strong>{v.name}</strong><span className="muted small">{ENGINES[v.provider].label}{v.provider !== "piper" && v.previewUrl ? " · free provider sample" : ""}</span></span></div>
      <p className="muted small">Plays: “{SAMPLE_LINE}”. Currently recorded: presentation {p.gender.value ?? "unknown"} ({p.gender.status}), sounds like {p.age.value ?? "unknown"} ({p.age.status}).</p>
      <div className="row wrap"><button className="primary" onClick={() => void play()}>▶ Hear again (R)</button><label className="row small"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Play each voice automatically</label></div>
      <fieldset className="ls-group"><legend>It sounds…</legend>
        <div className="row wrap" role="group" aria-label="Vocal presentation">{GENDERS.map((g) => <button key={g.id} className="sm" aria-pressed={pick.gender === g.id} onClick={() => setPick({ ...pick, gender: g.id })}>{g.label} <kbd>{g.key}</kbd></button>)}</div>
        <div className="row wrap" role="group" aria-label="How old it sounds">{AGES.map((a) => <button key={a.id} className="sm" aria-pressed={pick.age === a.id} onClick={() => setPick({ ...pick, age: a.id })}>{a.label} <kbd>{a.key}</kbd></button>)}</div>
      </fieldset>
      <div className="row wrap"><button className="primary" onClick={() => next(true)}>{hasPick(pick) ? "Confirm and next (Enter)" : "Next (Enter)"}</button><button onClick={() => next(false)}>Skip (S)</button><button className="ghost" disabled={i === 0} onClick={() => setI(i - 1)}>Back (B)</button></div>
      <p className="muted small">Pick only what you are sure of. "Unsure" saves nothing, so a voice stays unknown rather than guessed. Keys: M F A U for presentation, 1–5 for age, 0 for unsure.</p>
    </section>
  );
}
