import { useEffect, useState } from "react";
import { analyzeSamples, waveformPeaks, wordCount, type TakeStats } from "../analysis";
import { takeBuffer, takeUrl } from "../media";
import type { Line, Take } from "../types";
import { PlayButton } from "../ui";

interface Loaded {
  stats: TakeStats;
  peaks: number[];
}

const label = (t: Take, i: number) => `Take ${i + 1}${t.provenance?.variation ? ` (${t.provenance.variation})` : ""} · ${t.seconds.toFixed(1)} s`;

/** Two takes of one line side by side: listen to each, see them on one time axis, and compare their measured timing. */
export function TakeCompare({ projectId, line, onClose }: { projectId: string; line: Line; onClose: () => void }) {
  const [a, setA] = useState(line.takes[line.takes.length - 2]?.id ?? line.takes[0]!.id);
  const [b, setB] = useState(line.takes[line.takes.length - 1]!.id);
  const [data, setData] = useState<Record<string, Loaded>>({});
  const words = wordCount(line.text);

  useEffect(() => {
    let live = true;
    for (const id of [a, b]) {
      if (data[id]) continue;
      void takeBuffer(projectId, id)
        .then((buf) => {
          const x = buf.getChannelData(0);
          if (live) setData((d) => ({ ...d, [id]: { stats: analyzeSamples(x, buf.sampleRate, words), peaks: waveformPeaks(x, 400) } }));
        })
        .catch(() => undefined);
    }
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a, b]);

  const ta = line.takes.find((t) => t.id === a);
  const tb = line.takes.find((t) => t.id === b);
  const longest = Math.max(ta?.seconds ?? 0, tb?.seconds ?? 0, 0.1);
  const wave = (id: string, seconds: number, tone: string) => {
    const d = data[id];
    const w = Math.max(8, Math.round((seconds / longest) * 400));
    return (
      <svg viewBox="0 0 400 56" preserveAspectRatio="none" style={{ width: "100%", height: 56, background: "var(--surface-1)", borderRadius: 4 }} aria-label="Waveform">
        {d && (
          <g transform={`scale(${w / 400} 1)`}>
            {d.peaks.map((p, i) => (
              <line key={i} x1={i} x2={i} y1={28 - p * 26} y2={28 + p * 26} stroke={tone} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
            ))}
          </g>
        )}
      </svg>
    );
  };
  const col = (id: string, set: (v: string) => void, tone: string) => {
    const t = line.takes.find((x) => x.id === id)!;
    return (
      <div className="stack" style={{ flex: 1, minWidth: 280 }}>
        <select aria-label="Take" value={id} onChange={(e) => set(e.target.value)}>
          {line.takes.map((x, i) => (
            <option key={x.id} value={x.id}>
              {label(x, i)}
            </option>
          ))}
        </select>
        <PlayButton label={label(t, line.takes.indexOf(t))} get={() => takeUrl(projectId, t.id)} />
        {wave(id, t.seconds, tone)}
      </div>
    );
  };
  const sa = data[a]?.stats;
  const sb = data[b]?.stats;
  const row = (name: string, f: (s: TakeStats) => string, diff?: (x: TakeStats, y: TakeStats) => string) => (
    <tr key={name}>
      <th scope="row">{name}</th>
      <td>{sa ? f(sa) : "…"}</td>
      <td>{sb ? f(sb) : "…"}</td>
      <td className="muted">{sa && sb && diff ? diff(sa, sb) : ""}</td>
    </tr>
  );
  const d1 = (n: number, u = "") => `${n > 0 ? "+" : ""}${n.toFixed(2)}${u}`;

  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="cmp-t" style={{ width: "min(900px, 95vw)" }}>
        <h2 id="cmp-t">Compare two takes</h2>
        <p className="muted small">“{line.text.slice(0, 90)}” Both waveforms share one time scale, so a longer take looks longer. These are measurements; which one is better is for your ears.</p>
        <div className="row wrap" style={{ alignItems: "flex-start" }}>
          {col(a, setA, "var(--accent, #4ade80)")}
          {col(b, setB, "#8ab4ff")}
        </div>
        <table className="small" style={{ width: "100%", marginTop: 12 }}>
          <thead>
            <tr>
              <th />
              <th>First</th>
              <th>Second</th>
              <th>Difference</th>
            </tr>
          </thead>
          <tbody>
            {row("Length", (s) => `${s.seconds.toFixed(2)} s`, (x, y) => d1(y.seconds - x.seconds, " s"))}
            {row("Speaking time", (s) => `${s.speechSeconds.toFixed(2)} s`, (x, y) => d1(y.speechSeconds - x.speechSeconds, " s"))}
            {row("Pace", (s) => (s.wordsPerSecond ? `${s.wordsPerSecond} words/s` : "n/a"), (x, y) => (x.wordsPerSecond && y.wordsPerSecond ? d1(y.wordsPerSecond - x.wordsPerSecond) : ""))}
            {row("Pauses inside", (s) => `${s.pausesMs.length}${s.pausesMs.length ? ` (${s.pausesMs.map((p) => `${p} ms`).join(", ")})` : ""}`)}
            {row("Silence before / after", (s) => `${s.leadSilence.toFixed(2)} s / ${s.trailSilence.toFixed(2)} s`)}
            {row("Level", (s) => `${s.levelDb.toFixed(1)} dB`, (x, y) => d1(y.levelDb - x.levelDb, " dB"))}
            {row("Liveliness", (s) => `${s.liveliness.toFixed(1)} dB`, (x, y) => d1(y.liveliness - x.liveliness, " dB"))}
            {row("Pitch", (s) => (s.pitchHz ? `about ${s.pitchHz} Hz, range ${s.pitchRangeSemitones ?? "n/a"} semitones` : "not measured"))}
          </tbody>
        </table>
        <div className="row end" style={{ marginTop: 16 }}>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
