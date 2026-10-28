import { useEffect, useMemo, useRef, useState } from "react";
import { api, toUrl } from "../api";
import { useApp } from "../ctx";
import { buildReport, CLIPS, countByProvider, PROVIDER_INFO, type Result } from "../lab";
import type { VoiceInfo } from "../types";

export default function Lab() {
  const { keys, go, confirmSpend } = useApp();
  const available = useMemo(() => CLIPS.filter((c) => keys[PROVIDER_INFO[c.provider].key]), [keys]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, Result>>({});
  const [voices, setVoices] = useState<VoiceInfo[]>([]);
  const [voice, setVoice] = useState("");
  const [voiceErr, setVoiceErr] = useState("");
  const [running, setRunning] = useState(false);
  const [saved, setSaved] = useState("");
  const stop = useRef(false);

  useEffect(() => setPicked(new Set(available.map((c) => c.id))), [available]);
  useEffect(() => {
    if (!keys.elevenlabs) return;
    api
      .voicesMine()
      .then((v) => {
        setVoices(v);
        setVoice((cur) => cur || v[0]?.id || "");
        setVoiceErr("");
      })
      .catch((e: Error) => setVoiceErr(e.message));
  }, [keys.elevenlabs]);

  const chosen = available.filter((c) => picked.has(c.id));
  const patch = (id: string, r: Partial<Result>) => setResults((all) => ({ ...all, [id]: { state: "idle", ...all[id], ...r } }));

  const run = async () => {
    const ok = await confirmSpend({ title: "Run these clips?", lines: countByProvider(chosen).map((s) => `${PROVIDER_INFO[s.provider].label}: ${s.n} clips, ${s.chars} characters`) });
    if (!ok) return;
    setRunning(true);
    stop.current = false;
    for (const c of chosen) {
      if (stop.current) break;
      patch(c.id, { state: "running", error: undefined });
      try {
        const out = await api.runClip({ provider: c.provider, text: c.text, voice });
        patch(c.id, { state: "done", url: toUrl(out), ms: out.ms });
      } catch (e) {
        patch(c.id, { state: "error", error: (e as Error).message });
      }
    }
    setRunning(false);
  };

  if (!keys.elevenlabs && !keys.kie) {
    return (
      <section>
        <h1>Voice lab</h1>
        <div className="empty">
          <h2>Add a key to begin</h2>
          <p className="muted">The lab asks each provider for the same short lines so you can hear which sounds most alive.</p>
          <button className="primary" onClick={() => go("settings")}>
            Open Settings
          </button>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div>
        <h1>Voice lab</h1>
        <p className="lede">The same lines from each provider and model. Play them, rate 1 to 5, then save the report. Nothing runs until you confirm. To compare accents, use Accent test under Voices.</p>
      </div>
      {keys.elevenlabs && (
        <div className="row">
          <label htmlFor="lab-voice" className="muted small">
            ElevenLabs voice
          </label>
          <select id="lab-voice" value={voice} onChange={(e) => setVoice(e.target.value)} disabled={voices.length === 0}>
            {voices.map((v) => (
              <option key={v.id} value={v.id}>
                {v.name}
              </option>
            ))}
          </select>
          {voiceErr && <span className="err-text small">{voiceErr}</span>}
        </div>
      )}
      {(["Speech with feeling", "Body sounds"] as const).map((g) => (
        <details key={g} className="card fold" open>
          <summary>
            <strong>{g}</strong> <span className="muted small">{CLIPS.filter((c) => c.group === g).length} clips</span>
          </summary>
          {CLIPS.filter((c) => c.group === g).map((c) => {
            const usable = keys[PROVIDER_INFO[c.provider].key];
            const r = results[c.id];
            return (
              <div key={c.id} style={{ borderTop: "1px solid var(--line)", padding: "12px 0", opacity: usable ? 1 : 0.5 }}>
                <label className="row">
                  <input type="checkbox" disabled={!usable || running} checked={picked.has(c.id)} onChange={(e) => setPicked((s) => { const n = new Set(s); if (e.target.checked) n.add(c.id); else n.delete(c.id); return n; })} />
                  <strong>{c.title}</strong> <span className="badge accent">{PROVIDER_INFO[c.provider].label}</span>
                </label>
                <p className="lab-line">{c.text}</p>
                <p className="muted small">Listen for: {c.listenFor}. {PROVIDER_INFO[c.provider].note}.</p>
                {r?.state === "running" && <p className="muted" role="status">Making this clip…</p>}
                {r?.state === "error" && <p className="err-text" role="alert">{r.error}</p>}
                {r?.state === "done" && r.url && (
                  <div className="row wrap">
                    <audio controls src={r.url} />
                    <span className="rate" role="group" aria-label={`Rate ${c.title}`}>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <button key={n} aria-pressed={r.rating === n} onClick={() => patch(c.id, { rating: n })}>
                          {n}
                        </button>
                      ))}
                    </span>
                    <input type="text" placeholder="Note" aria-label={`Note for ${c.title}`} value={r.note ?? ""} onChange={(e) => patch(c.id, { note: e.target.value })} style={{ flex: 1, minWidth: 140 }} />
                  </div>
                )}
              </div>
            );
          })}
        </details>
      ))}
      <div className="bar">
        <span className="muted">{chosen.length} clips selected</span>
        <span className="spacer" />
        {saved && <span className="muted small" role="status">{saved}</span>}
        <button onClick={async () => setSaved(await api.saveReport(buildReport(results, new Date().toISOString().slice(0, 10))).catch((e: Error) => e.message))} disabled={Object.keys(results).length === 0}>
          Save report
        </button>
        {running ? (
          <button onClick={() => (stop.current = true)}>Stop after this clip</button>
        ) : (
          <button className="primary" disabled={chosen.length === 0 || (chosen.some((c) => c.provider.startsWith("eleven") && c.provider !== "eleven-sfx") && !voice)} onClick={() => void run()}>
            Run {chosen.length} clips…
          </button>
        )}
      </div>
    </section>
  );
}
