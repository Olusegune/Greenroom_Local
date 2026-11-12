import { useEffect, useState } from "react";
import { api, type LocalRuntimeStatus } from "../api";
import { useApp } from "../ctx";
import { checkLocalMusic, localMusicSource, MAX_SECONDS, MIN_SECONDS } from "../localMusic";
import { remember, takeUrl } from "../media";
import { Note, PlayButton, useBusy } from "../ui";
import type { Made } from "./MakeMusic";

/** Makes music on this computer with ACE-Step. Free and private. Every track is kept in the project as a take. */
export default function MakeMusicLocal({ onUse }: { onUse: (m: Made) => void }) {
  const { project, toast, go } = useApp();
  const { busy, run } = useBusy();
  const [status, setStatus] = useState<LocalRuntimeStatus | null>(null);
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [lyrics, setLyrics] = useState("");
  const [seconds, setSeconds] = useState(30);
  const [made, setMade] = useState<Made[]>([]);
  const [quick, setQuick] = useState<boolean | null>(null);
  useEffect(() => { void api.acestepReady().then(setQuick).catch(() => setQuick(false)); void api.acestepStatus().then(setStatus).catch(() => setStatus(null)); }, []);
  if (!project) return null;

  // The instant file check decides; the slower full check only supplies the wording of the warning.
  const ready = quick === true;
  const problem = checkLocalMusic(style, instrumental ? "" : lyrics, seconds);

  const make = async () => {
    await run(async () => {
      try {
        const out = await api.musicLocalGenerate(project.id, { title: title.trim() || "Local music", style: style.trim(), lyrics: instrumental ? "" : lyrics, seconds });
        const date = new Date().toISOString().slice(0, 10);
        const next: Made[] = [];
        for (const m of out) {
          const real = await remember(m.id, await api.takeRead(project.id, m.id));
          next.push({ ...m, real: real || m.seconds, source: localMusicSource(style, date) });
        }
        setMade((old) => [...next, ...old]);
        toast("Made a track on this computer. It is saved in the project.");
      } catch (e) { toast((e as Error).message, true); }
    });
  };

  return (
    <details className="card stack">
      <summary><strong>Make music on this PC</strong> <span className="muted small">ACE-Step, free, private, needs an NVIDIA card</span></summary>
      <p className="muted small">Describe the music and it is made on this computer, with no credits and nothing sent anywhere. A 30 second track takes about a minute on a mid-range graphics card. You hear it before choosing to put it on the timeline.</p>
      {quick === false && <Note kind="warn">{status?.detail ?? "Local music is not set up yet."} <button className="sm" onClick={() => go("models")}>Open Model Center</button></Note>}
      <div className="row wrap">
        <label className="field" style={{ flex: 1, minWidth: 200 }}>Title (optional)<input type="text" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Night market theme" /></label>
        <label className="field">Length (seconds)<input type="number" min={MIN_SECONDS} max={MAX_SECONDS} step={5} value={seconds} style={{ width: 110 }} onChange={(e) => setSeconds(Math.round(Number(e.target.value) || MIN_SECONDS))} /></label>
      </div>
      <label className="field">Style (up to 1000 characters)
        <textarea rows={2} maxLength={1000} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Warm afrobeat, light percussion, slow build, tense but hopeful, suitable under dialogue" /></label>
      <label className="row"><input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} /> No vocals (best under dialogue)</label>
      {!instrumental && <label className="field">Lyrics (optional, up to 2000 characters)<textarea rows={3} maxLength={2000} value={lyrics} onChange={(e) => setLyrics(e.target.value)} /></label>}
      {style.trim() !== "" && problem && <p className="muted small" role="status">{problem}</p>}
      <div className="row"><button className="primary" disabled={!ready || busy || !!problem} onClick={() => void make()}>{busy ? "Making music, about a minute…" : "Make music"}</button></div>
      {made.map((m) => (
        <div key={m.id} className="row wrap lit" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <PlayButton label="Hear it" get={() => takeUrl(project.id, m.id)} />
          <span style={{ flex: 1, minWidth: 160 }}>{m.name} <span className="muted small">{m.real.toFixed(1)} s</span></span>
          <button className="sm primary" onClick={() => onUse(m)}>Put on the timeline</button>
        </div>
      ))}
    </details>
  );
}
