import { useState } from "react";
import { api, type MadeMusic, type MusicReq } from "../api";
import { useApp } from "../ctx";
import { remember, takeUrl } from "../media";
import { Note, PlayButton, useBusy } from "../ui";

const VERSIONS: { id: string; label: string }[] = [
  { id: "V6", label: "Suno V6 (best quality)" },
  { id: "V6_MINI", label: "Suno V6 Mini (faster)" },
  { id: "V6_WILD", label: "Suno V6 Wild (more adventurous)" },
];

export interface Made extends MadeMusic {
  /** The real length, read from the audio. */
  real: number;
  /** One sentence for the production report: what made it, and with what. */
  source: string;
}

/** Makes music with Suno through Kie. Everything it returns is kept in the project; the owner chooses what goes on the timeline. */
export default function MakeMusic({ onUse }: { onUse: (m: Made) => void }) {
  const { project, keys, confirmSpend, priceLines, addLedger, toast, go } = useApp();
  const { busy, run } = useBusy();
  const [title, setTitle] = useState("");
  const [style, setStyle] = useState("");
  const [instrumental, setInstrumental] = useState(true);
  const [lyrics, setLyrics] = useState("");
  const [version, setVersion] = useState("V6");
  const [avoid, setAvoid] = useState("");
  const [gender, setGender] = useState("");
  const [seconds, setSeconds] = useState(0);
  const [made, setMade] = useState<Made[]>([]);
  if (!project) return null;

  const ready = title.trim().length > 0 && style.trim().length > 0 && (seconds === 0 || (seconds >= 10 && seconds <= 360));

  const make = async () => {
    const price = priceLines([{ kind: "music" }]);
    const ok = await confirmSpend({
      title: "Make music with Suno?",
      lines: [`"${title.trim()}": ${style.trim().slice(0, 80)}`, `${VERSIONS.find((v) => v.id === version)?.label ?? version}, ${instrumental ? "no vocals" : "with vocals"}${seconds ? `, about ${seconds} seconds` : ""}`, "Usually returns two tracks and takes a few minutes. Uses Kie credits.", ...price.lines],
      warn: price.warn,
    });
    if (!ok) return;
    const req: MusicReq = { title: title.trim(), style: style.trim(), lyrics: instrumental ? "" : lyrics, instrumental, version, negativeTags: avoid.trim(), vocalGender: instrumental ? "" : gender, duration: seconds };
    await run(async () => {
      try {
        const out = await api.musicGenerate(project.id, req);
        addLedger({ kind: "music", engine: "Kie Suno " + version, chars: style.length, items: [{ kind: "music" }], note: title.trim().slice(0, 60) });
        const date = new Date().toISOString().slice(0, 10);
        const next: Made[] = [];
        for (const m of out) {
          const real = await remember(m.id, await api.takeRead(project.id, m.id));
          next.push({ ...m, real: real || m.seconds, source: `Made with Suno ${version} through Kie on ${date}. Style prompt: ${style.trim().slice(0, 200)}. Check Kie's and Suno's terms for how you may use it.` });
        }
        setMade((old) => [...next, ...old]);
        toast(`Made ${next.length} track${next.length === 1 ? "" : "s"}. They are saved in the project.`);
      } catch (e) {
        toast((e as Error).message, true);
      }
    });
  };

  return (
    <details className="card stack">
      <summary>
        <strong>Make music with Suno</strong> <span className="muted small">through Kie, costs credits</span>
      </summary>
      <p className="muted small">Describe the music and Suno writes it. You hear every track before choosing which goes on the timeline. Music made this way is not cleared for you: its terms depend on your Kie and Suno plans, so Greenroom saves how it was made in the production report.</p>
      {!keys.kie && (
        <Note kind="warn">
          Add your Kie key in Settings first.{" "}
          <button className="sm" onClick={() => go("settings")}>
            Open Settings
          </button>
        </Note>
      )}
      <div className="row wrap">
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          Title (up to 80 characters)
          <input type="text" maxLength={80} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Night market theme" />
        </label>
        <label className="field">
          Version
          <select value={version} onChange={(e) => setVersion(e.target.value)}>
            {VERSIONS.map((v) => (
              <option key={v.id} value={v.id}>
                {v.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Length (seconds, 0 lets Suno decide)
          <input type="number" min={0} max={360} step={5} value={seconds} style={{ width: 110 }} onChange={(e) => setSeconds(Math.max(0, Math.min(360, Number(e.target.value) || 0)))} />
        </label>
      </div>
      <label className="field">
        Style (up to 1000 characters)
        <textarea rows={2} maxLength={1000} value={style} onChange={(e) => setStyle(e.target.value)} placeholder="Warm afrobeat, light percussion, slow build, tense but hopeful, suitable under dialogue" />
      </label>
      <div className="row wrap">
        <label className="row">
          <input type="checkbox" checked={instrumental} onChange={(e) => setInstrumental(e.target.checked)} /> No vocals (best under dialogue)
        </label>
        {!instrumental && (
          <label className="field">
            Singer
            <select value={gender} onChange={(e) => setGender(e.target.value)}>
              <option value="">Any</option>
              <option value="f">Female</option>
              <option value="m">Male</option>
            </select>
          </label>
        )}
        <label className="field" style={{ flex: 1, minWidth: 200 }}>
          Avoid (optional)
          <input type="text" maxLength={200} value={avoid} onChange={(e) => setAvoid(e.target.value)} placeholder="heavy drums, distorted guitar" />
        </label>
      </div>
      {!instrumental && (
        <label className="field">
          Lyrics (optional, up to 5000 characters)
          <textarea rows={3} maxLength={5000} value={lyrics} onChange={(e) => setLyrics(e.target.value)} />
        </label>
      )}
      <div className="row">
        <button className="primary" disabled={!ready || busy || !keys.kie} onClick={() => void make()}>
          {busy ? "Making music, this takes a few minutes…" : "Make music"}
        </button>
      </div>
      {made.map((m) => (
        <div key={m.id} className="row wrap lit" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
          <PlayButton label="Hear it" get={() => takeUrl(project.id, m.id)} />
          <span style={{ flex: 1, minWidth: 160 }}>
            {m.name} <span className="muted small">{m.real.toFixed(1)} s</span>
          </span>
          <button className="sm primary" onClick={() => onUse(m)}>
            Put on the timeline
          </button>
        </div>
      ))}
    </details>
  );
}
