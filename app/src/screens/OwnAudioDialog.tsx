import { useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { encodeWav, fromBase64, toBase64 } from "../audio";
import { useApp } from "../ctx";
import { remember, takeBuffer } from "../media";
import { checkExpression, expressionTake, mixExpression, ownTake, type Mode } from "../ownAudio";
import { uid } from "../script";
import { checkRecording, decodeToWav } from "../speechToSpeech";
import { sha256Hex } from "../trust";
import type { Character, Line, Take } from "../types";
import { APP_VERSION } from "../version";

type Source = { url: string; samples: Float32Array; rate: number; seconds: number; label: string; from: string };

/** mono samples of a decoded take */
const monoOf = (buf: AudioBuffer): Float32Array => {
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const ch = buf.getChannelData(c);
    for (let i = 0; i < buf.length; i++) out[i]! += ch[i]! / buf.numberOfChannels;
  }
  return out;
};

/**
 * Use your own audio for this line, as it is, and add expressions (a laugh, a sigh, a gasp) to it or to any take. The recording is
 * never changed in place: every result is a new take that says what it is made of. To change the VOICE of a recording, use
 * "Re-voice a recording"; to change how it is performed, record it again.
 */
export default function OwnAudioDialog({ line, character, projectId, startWith, onClose, onDone }: { line: Line; character?: Character; projectId: string; startWith: "own" | "take"; onClose: () => void; onDone: (t: Take) => void }) {
  const { toast } = useApp();
  const [source, setSource] = useState<Source | null>(null);
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [pick, setPick] = useState("");
  const [at, setAt] = useState(0);
  const [mode, setMode] = useState<Mode>("overlay");
  const [gain, setGain] = useState(0.9);
  const [clip, setClip] = useState<{ samples: Float32Array; rate: number; seconds: number } | null>(null);
  const [previewUrl, setPreviewUrl] = useState("");
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const urls = useRef<string[]>([]);
  const player = useRef<HTMLAudioElement>(null);

  // the expressions already made for this character, and clips already on this line: all free to reuse
  const expressions = useMemo(() => {
    const fromLibrary = (character?.reactions ?? []).map((r) => ({ key: "r:" + r.id, label: r.prompt || "an expression", take: r.take }));
    const fromLine = line.events.filter((e) => e.take).map((e) => ({ key: "e:" + e.id, label: e.prompt || "a sound", take: e.take! }));
    const seen = new Set<string>();
    return [...fromLibrary, ...fromLine].filter((x) => (seen.has(x.take.id) ? false : (seen.add(x.take.id), true)));
  }, [character?.reactions, line.events]);

  const track = (u: string) => {
    urls.current.push(u);
    return u;
  };
  useEffect(() => () => { stream.current?.getTracks().forEach((t) => t.stop()); urls.current.forEach((u) => URL.revokeObjectURL(u)); }, []);

  // starting from a take that already exists on the line
  useEffect(() => {
    if (startWith !== "take") return;
    const t = line.takes.find((x) => x.id === line.chosen) ?? line.takes[line.takes.length - 1];
    if (!t) { setError("This line has no take yet."); return; }
    void (async () => {
      try {
        const buf = await takeBuffer(projectId, t.id);
        const wav = encodeWav([monoOf(buf)], buf.sampleRate);
        setSource({ url: track(URL.createObjectURL(new Blob([wav], { type: "audio/wav" }))), samples: monoOf(buf), rate: buf.sampleRate, seconds: buf.duration, label: `take ${t.id.slice(2, 8)}`, from: `take ${t.id}` });
      } catch { setError("Greenroom could not open that take."); }
    })();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const load = async (data: ArrayBuffer, blob: Blob, label: string) => {
    try {
      const { seconds, samples, rate } = await decodeToWav(data);
      const problem = checkRecording(seconds);
      if (problem) { setError(problem); return; }
      setSource({ url: track(URL.createObjectURL(blob)), samples, rate, seconds, label, from: `my own audio (${label})` });
      setAt(0);
      setPreviewUrl("");
      setError("");
    } catch { setError("Greenroom could not read that audio. Try a WAV or MP3 file, or record again."); }
  };
  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!/^audio\//.test(f.type) && !/\.(wav|mp3|flac|ogg|m4a|aac)$/i.test(f.name)) { setError("Choose an audio file (WAV, MP3, FLAC, OGG or M4A)."); return; }
    if (f.size > 40_000_000) { setError("That file is too large. Use audio up to about 5 minutes."); return; }
    await load(await f.arrayBuffer(), f, `file ${f.name.replace(/[^\w .()-]/g, "").slice(0, 40)}`);
  };
  const start = async () => {
    setError("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = media;
      const chunks: Blob[] = [];
      const rec = new MediaRecorder(media);
      rec.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
      rec.onstop = () => { media.getTracks().forEach((t) => t.stop()); const blob = new Blob(chunks, { type: rec.mimeType }); void blob.arrayBuffer().then((buf) => load(buf, blob, "recorded on this computer")); };
      recorder.current = rec;
      rec.start();
      setRecording(true);
    } catch { setError("Greenroom could not use the microphone. Allow microphone access, or choose an audio file instead."); }
  };
  const stop = () => { recorder.current?.stop(); setRecording(false); };

  const chosen = expressions.find((x) => x.key === pick);
  useEffect(() => {
    setClip(null);
    setPreviewUrl("");
    if (!chosen) return;
    void takeBuffer(projectId, chosen.take.id).then((b) => setClip({ samples: monoOf(b), rate: b.sampleRate, seconds: b.duration })).catch(() => setError("Greenroom could not open that expression."));
  }, [pick]); // eslint-disable-line react-hooks/exhaustive-deps

  const mixed = (): Float32Array | null => {
    if (!source || !clip) return null;
    const problem = checkExpression(source.seconds, clip.seconds, at);
    if (problem) { setError(problem); return null; }
    setError("");
    return mixExpression(source.samples, source.rate, clip.samples, clip.rate, at, mode, gain);
  };
  const preview = () => {
    const m = mixed();
    if (m && source) setPreviewUrl(track(URL.createObjectURL(new Blob([encodeWav([m], source.rate)], { type: "audio/wav" }))));
  };

  const save = async (withExpression: boolean) => {
    if (!source) return;
    setBusy(true);
    try {
      const samples = withExpression ? mixed() : source.samples;
      if (!samples) return;
      const wav = encodeWav([samples], source.rate);
      const b64 = toBase64(wav);
      const id = "t-" + uid();
      await api.takeWrite(projectId, id, "wav", b64);
      const seconds = await remember(id, { audioB64: b64, mime: "audio/wav" });
      const sha256 = await sha256Hex(fromBase64(b64));
      const common = { id, at: new Date().toISOString(), seconds, sha256, appVersion: APP_VERSION, emotion: line.direction.emotion, note: line.direction.note ?? "", ...(character?.voiceId ? { voiceId: character.voiceId } : {}) };
      const t = withExpression && chosen ? expressionTake({ ...common, expression: chosen.label, atSeconds: at, mode, from: source.from }) : ownTake({ ...common, source: source.label });
      onDone(t);
      toast(withExpression ? "Added as a new take. Your original is unchanged." : "Your audio is now a take on this line.");
      onClose();
    } catch (e) {
      setError((e as Error).message || "Greenroom could not save that take.");
    } finally {
      setBusy(false);
    }
  };

  const seek = (v: number) => { setAt(v); if (player.current) player.current.currentTime = v; };
  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="oa-t" style={{ maxWidth: 620, width: "92vw", maxHeight: "92vh", overflow: "auto" }}>
        <h2 id="oa-t">{startWith === "take" ? "Add an expression to this take" : "Use my own audio"}</h2>
        <p className="muted small">
          {startWith === "take" ? "Add a laugh, a sigh or a gasp to this take at a point you choose. It becomes a new take; the original is never changed." : "Record or choose your own audio for this line and use it as it is, then add expressions if you like. Nothing is sent anywhere. To change the voice of a recording, use Re-voice a recording."}
        </p>
        <blockquote className="muted small" style={{ margin: "8px 0" }}>{line.text}</blockquote>
        {startWith === "own" && (
          <div className="row wrap">
            {!recording ? <button className="primary" disabled={busy} onClick={() => void start()}>Record</button> : <button className="primary" onClick={stop}>Stop recording</button>}
            <label className="sm" style={{ cursor: "pointer" }}>
              <button type="button" className="sm" disabled={busy || recording} onClick={(e) => (e.currentTarget.nextElementSibling as HTMLInputElement).click()}>Choose an audio file…</button>
              <input type="file" accept="audio/*,.wav,.mp3,.flac,.ogg,.m4a" aria-label="Choose an audio file" style={{ display: "none" }} onChange={(e) => void choose(e)} />
            </label>
            {recording && <span className="muted small" role="status">Recording… speak the line, then press Stop.</span>}
          </div>
        )}
        {source && (
          <div className="card stack lit">
            <div className="row wrap"><audio ref={player} controls src={source.url} /><span className="muted small">{source.seconds.toFixed(1)} s, {source.label}</span></div>
            <label className="field">
              Expression to add
              <select value={pick} onChange={(e) => setPick(e.target.value)} aria-label="Expression to add">
                <option value="">None (use it as it is)</option>
                {expressions.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
              </select>
            </label>
            {expressions.length === 0 && <p className="muted small">No expressions have been made for {character?.name ?? "this character"} yet. Make one with "Add a sound clip" on a line (a laugh, a sigh, a gasp) and it appears here to reuse on any line, free.</p>}
            {chosen && (
              <>
                <label className="field">
                  Where: {at.toFixed(2)} s into the audio
                  <input type="range" min={0} max={Math.max(0.1, source.seconds)} step={0.05} value={at} onChange={(e) => seek(Number(e.target.value))} aria-label="Where to put the expression" />
                </label>
                <fieldset className="row wrap" style={{ border: 0, padding: 0, gap: 16 }}>
                  <label className="row" style={{ gap: 6 }}><input type="radio" name="oa-mode" checked={mode === "overlay"} onChange={() => setMode("overlay")} /> Over the speech</label>
                  <label className="row" style={{ gap: 6 }}><input type="radio" name="oa-mode" checked={mode === "insert"} onChange={() => setMode("insert")} /> Pause the speech and put it in</label>
                </fieldset>
                <label className="field">
                  Loudness of the expression
                  <input type="range" min={0.2} max={1.5} step={0.05} value={gain} onChange={(e) => setGain(Number(e.target.value))} aria-label="Loudness of the expression" />
                </label>
                <div className="row wrap">
                  <button className="sm" disabled={!clip || busy} onClick={preview}>Hear it first</button>
                  {previewUrl && <audio controls src={previewUrl} />}
                </div>
              </>
            )}
            <div className="row wrap">
              {chosen && <button className="primary" disabled={busy || !clip} onClick={() => void save(true)}>Use it with the expression</button>}
              {startWith === "own" && <button className={chosen ? "" : "primary"} disabled={busy} onClick={() => void save(false)}>Use my audio as it is</button>}
            </div>
          </div>
        )}
        {error && <p role="alert" className="error small">{error}</p>}
        <div className="row"><button onClick={onClose} disabled={busy}>Close</button></div>
      </div>
    </div>
  );
}
