import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api, videoUrl } from "../api";
import { encodeWav, planTimeline, renderPlan } from "../audio";
import { useApp } from "../ctx";
import { ChevronLeft, ChevronRight, Play, Stop, Upload } from "../icons";
import { takeBuffer } from "../media";
import { baseName, FPS_PRESETS, fpsLabel, fpsOf, fpsValue, frameToTc, secAtTc, secToFrame, snapToFrame, tcAt, tcToFrame } from "../picture";
import type { Line, Picture } from "../types";
import { Empty, Note, useBusy } from "../ui";

const COLORS = ["#52d68a", "#e9b85c", "#7cc7e8", "#c9a7ee", "#ff8a80", "#a9b4ad", "#f0a860", "#9af0b8"];

export default function PictureScreen() {
  const { project, edit, toast } = useApp();
  const vref = useRef<HTMLVideoElement>(null);
  const aref = useRef<HTMLAudioElement>(null);
  const stripRef = useRef<HTMLDivElement>(null);
  const mixRef = useRef<{ key: string; url: string } | null>(null);
  const dragRef = useRef<{ id: string; x0: number; s0: number; moved: boolean } | null>(null);
  const probing = useRef(false);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [sound, setSound] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [drag, setDrag] = useState<{ id: string; sec: number } | null>(null);
  const [missing, setMissing] = useState(false);
  const { busy, run } = useBusy();

  const pic = project?.picture;
  const f = pic ? fpsOf(pic) : { num: 24, den: 1 };
  const fps = fpsValue(f);
  const src = pic ? videoUrl(pic.path) : "";
  const plan = useMemo(() => (project ? planTimeline(project, undefined, { minTotal: pic?.duration }) : null), [project, pic?.duration]);
  // What is heard with the picture is exactly the picture's length, as it will be in the export.
  const heard = useMemo(() => (project && pic?.duration ? planTimeline(project, undefined, { exactTotal: pic.duration }) : plan), [project, pic?.duration, plan]);
  const total = Math.max(pic?.duration ?? 0, plan?.total ?? 0, 1);

  // Let the player read this one file (needed again after the app restarts).
  useEffect(() => {
    if (!pic) return;
    api.videoAllow(pic.path).then(() => setMissing(false)).catch(() => setMissing(true));
  }, [pic?.path]); // eslint-disable-line react-hooks/exhaustive-deps

  // While playing: follow the video's clock, and nudge the sound back into line if it drifts.
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const v = vref.current;
      const a = aref.current;
      if (v) {
        setT(v.currentTime);
        if (a && sound && !a.paused && Math.abs(a.currentTime - v.currentTime) > 0.035) a.currentTime = v.currentTime;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, sound]);

  useEffect(() => () => {
    vref.current?.pause();
    aref.current?.pause();
    if (mixRef.current) URL.revokeObjectURL(mixRef.current.url);
  }, []);

  const duration = pic?.duration || 0;
  const seek = useCallback(
    (sec: number) => {
      const v = vref.current;
      const s = Math.min(Math.max(0, sec), Math.max(duration, 0.001));
      if (v) v.currentTime = s;
      if (aref.current) aref.current.currentTime = s;
      setT(s);
    },
    [duration],
  );

  const pause = useCallback(() => {
    vref.current?.pause();
    aref.current?.pause();
    setPlaying(false);
  }, []);

  /** The mixed sound for the picture, rendered once and reused until a cue, take or level changes. */
  const ensureMix = async (): Promise<string> => {
    if (!project || !heard || heard.items.length === 0) return "";
    const key = JSON.stringify([heard.items.map((i) => [i.ref.id, Math.round(i.start * 1000), i.gainDb, i.kind]), project.bed.volume, Math.round(heard.total * 1000)]);
    if (mixRef.current?.key === key) return mixRef.current.url;
    const ch = await renderPlan(heard, project.bed.volume, (ref) => takeBuffer(project.id, ref.id), 48000);
    const url = URL.createObjectURL(new Blob([encodeWav(ch, 48000)], { type: "audio/wav" }));
    if (mixRef.current) URL.revokeObjectURL(mixRef.current.url);
    mixRef.current = { key, url };
    return url;
  };

  const play = () =>
    run(async () => {
      const v = vref.current;
      if (!v) return;
      try {
        const a = aref.current;
        if (a && sound) {
          const url = await ensureMix();
          if (url && a.dataset.url !== url) {
            a.src = url;
            a.dataset.url = url;
            await new Promise<void>((r) => {
              a.onloadeddata = () => r();
              a.load();
            });
          }
          if (url) a.currentTime = v.currentTime;
        }
        await v.play();
        if (a && sound && a.dataset.url) await a.play().catch(() => undefined);
        setPlaying(true);
      } catch (e) {
        toast((e as Error).message || "Could not play.", true);
      }
    });

  const stepFrames = (n: number) => {
    pause();
    const frame = secToFrame(vref.current?.currentTime ?? t, f);
    seek((frame + n) / fps + 0.0005);
  };

  /** Take the length and size from the player when the file did not state them. */
  const adoptLength = (v: HTMLVideoElement) => {
    if (!pic || pic.fpsKnown) return;
    if (Math.abs(v.duration - (pic.duration || 0)) > 0.01) patchPic({ duration: v.duration, width: pic.width || v.videoWidth, height: pic.height || v.videoHeight });
  };

  const patchPic = (p: Partial<Picture>) => edit((pr) => (pr.picture ? { ...pr, picture: { ...pr.picture, ...p } } : pr));

  const choose = () =>
    run(async () => {
      try {
        const path = await api.pickVideo();
        if (!path) return;
        const info = await api.videoProbe(path);
        await api.videoAllow(path);
        pause();
        edit((pr) => ({ ...pr, picture: { path, name: baseName(path), fpsNum: info.known ? info.fpsNum : 24, fpsDen: info.known ? info.fpsDen : 1, fpsKnown: info.known, duration: info.durationSec, width: info.width, height: info.height, startFrame: pr.picture?.startFrame ?? 0 } }));
        setMissing(false);
        toast(info.known ? `Frame rate read from the file: ${fpsLabel({ num: info.fpsNum, den: info.fpsDen })}.` : "This type of file does not say its frame rate. Choose it below.");
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  const setCue = (id: string, sec: number | undefined) =>
    edit((pr) => ({
      ...pr,
      lines: pr.lines.map((l) => {
        if (l.id !== id) return l;
        if (sec === undefined) {
          const { cue: _cue, ...rest } = l;
          void _cue;
          return rest as Line;
        }
        return { ...l, cue: Math.max(0, snapToFrame(sec, f)) };
      }),
    }));

  const lineUp = () => {
    if (!project) return;
    let cursor = snapToFrame(t, f);
    edit((pr) => ({
      ...pr,
      lines: pr.lines.map((l) => {
        const take = l.takes.find((x) => x.id === l.chosen) ?? l.takes[l.takes.length - 1];
        if (!take) return l;
        const start = cursor;
        cursor = snapToFrame(start + take.seconds + Math.max(0, l.direction.pauseAfter), f);
        return { ...l, cue: start };
      }),
    }));
    toast("Every line was lined up one after another from the playhead. Drag them to adjust.");
  };

  if (!project || !plan) return null;

  if (!pic) {
    return (
      <section>
        <h1>Picture</h1>
        <Empty
          title="Add a video to work to"
          action={
            <button className="primary" onClick={() => void choose()} disabled={busy}>
              <Upload size={16} /> Choose a video
            </button>
          }
        >
          Place each line at an exact timecode against the picture, listen to the sound with the video, and export audio that stays in sync. The video file stays where it is: Greenroom only remembers where it is.
        </Empty>
      </section>
    );
  }

  const nLines = project.lines.length;
  const spanOf = (id: string) => plan.spans.find((s) => s.lineId === id);
  const charIndex = (cid: string) => Math.max(0, project.characters.findIndex((c) => c.id === cid));
  const who = (l: Line) => project.characters.find((c) => c.id === l.characterId)?.name ?? "?";
  const cued = project.lines.filter((l) => typeof l.cue === "number").length;

  return (
    <section>
      <div className="row between top wrap">
        <div>
          <h1>Picture</h1>
          <p className="lede">Scrub to a moment, then set a line to start there. Drag lines on the strip to move them. Lines without a cue follow the line before them.</p>
        </div>
      </div>

      <div className="card stack">
        <div className="row between wrap">
          <span>
            <strong>{pic.name}</strong>{" "}
            <span className="muted small num">
              {pic.width && pic.height ? `${pic.width}×${pic.height} · ` : ""}
              {duration ? `${duration.toFixed(3)} s` : "length unknown"}
            </span>
          </span>
          <button className="sm" onClick={() => void choose()} disabled={busy}>
            Change video
          </button>
        </div>
        <div className="row wrap">
          <label className="field">
            Frame rate {pic.fpsKnown ? "(read from the file)" : "(choose: this file type does not say)"}
            <select value={FPS_PRESETS.find((p) => p.fps.num * pic.fpsDen === pic.fpsNum * p.fps.den)?.id ?? "custom"} disabled={pic.fpsKnown} onChange={(e) => { const p = FPS_PRESETS.find((x) => x.id === e.target.value); if (p) patchPic({ fpsNum: p.fps.num, fpsDen: p.fps.den }); }}>
              {pic.fpsKnown && !FPS_PRESETS.some((p) => p.fps.num * pic.fpsDen === pic.fpsNum * p.fps.den) && <option value="custom">{fpsLabel(f)}</option>}
              {FPS_PRESETS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Timecode of the first frame
            <input
              key={pic.startFrame + "-" + pic.fpsNum}
              type="text"
              defaultValue={frameToTc(pic.startFrame, f)}
              aria-label="Start timecode"
              onBlur={(e) => {
                const fr = tcToFrame(e.target.value, f);
                if (fr === null) {
                  toast("That timecode is not valid. Use HH:MM:SS:FF.", true);
                  e.target.value = frameToTc(pic.startFrame, f);
                } else patchPic({ startFrame: fr });
              }}
              onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              style={{ width: 130, fontFamily: "var(--font-mono)" }}
            />
          </label>
        </div>
        {!pic.fpsKnown && <p className="muted small">Greenroom reads the frame rate itself from MP4, MOV and M4V files. For other types, choose it here: a wrong rate puts timecodes and the exported timeline out of step.</p>}
      </div>

      {duration > 0 && plan.total > duration + 0.02 && (
        <Note kind="warn">
          {plan.spans.filter((s) => s.end > duration + 0.02).length} line{plan.spans.filter((s) => s.end > duration + 0.02).length === 1 ? " runs" : "s run"} past the end of the picture ({duration.toFixed(2)} s). Sound after the end is cut off in the export when &quot;match picture length&quot; is on. Move those lines earlier on the strip.
        </Note>
      )}

      {(missing || !src) && <Note kind="warn">Greenroom cannot play this video: {missing ? "the file may have been moved or deleted." : "no preview is available here."} Choose it again to reconnect it. Cues and exports still work from the saved frame rate and length.</Note>}

      <div className="card stack" tabIndex={0} aria-label="Player. Left and right arrows step one frame, Shift moves a second, Space plays." onKeyDown={(e) => {
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        if (e.key === "ArrowRight") { e.preventDefault(); e.shiftKey ? seek(t + 1) : stepFrames(1); }
        else if (e.key === "ArrowLeft") { e.preventDefault(); e.shiftKey ? seek(t - 1) : stepFrames(-1); }
        else if (e.key === " ") { e.preventDefault(); playing ? pause() : void play(); }
      }}>
        <div className="pic-stage">
          {/* The picture's own sound is muted: the sound shown here is Greenroom's mix. */}
          <video
            ref={vref}
            src={src || undefined}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              // Some files (screen recordings, browser WebM) do not state their length: jumping far past the end makes the player work it out.
              if (!Number.isFinite(v.duration)) {
                probing.current = true;
                v.currentTime = 1e6;
              } else adoptLength(v);
            }}
            onDurationChange={(e) => {
              const v = e.currentTarget;
              if (Number.isFinite(v.duration)) {
                adoptLength(v);
                if (probing.current || v.currentTime > v.duration) v.currentTime = 0;
                probing.current = false;
              }
            }}
            onEnded={pause}
            onSeeked={(e) => {
              const a = aref.current;
              if (a && a.dataset.url && Math.abs(a.currentTime - e.currentTarget.currentTime) > 0.05) a.currentTime = e.currentTarget.currentTime;
            }}
            onTimeUpdate={(e) => !playing && setT(e.currentTarget.currentTime)}
            onError={() => src && setMissing(true)}
          />
          <audio ref={aref} preload="auto" />
        </div>
        <div className="row wrap">
          <button className="primary" onClick={() => (playing ? pause() : void play())} disabled={busy || !src}>
            {playing ? <Stop size={14} /> : <Play size={14} />} {playing ? "Pause" : busy ? "Preparing…" : "Play"}
          </button>
          <button className="sm" onClick={() => stepFrames(-1)} aria-label="Back one frame" disabled={!src}>
            <ChevronLeft size={14} /> 1 frame
          </button>
          <button className="sm" onClick={() => stepFrames(1)} aria-label="Forward one frame" disabled={!src}>
            1 frame <ChevronRight size={14} />
          </button>
          <button className="sm ghost" onClick={() => seek(t - 1)} disabled={!src}>
            −1 s
          </button>
          <button className="sm ghost" onClick={() => seek(t + 1)} disabled={!src}>
            +1 s
          </button>
          <span className="spacer" />
          <code className="pic-tc" aria-live="off" title="Timecode at the playhead">
            {tcAt(t, pic)}
          </code>
          <label className="row small muted">
            <input type="checkbox" checked={sound} onChange={(e) => { setSound(e.target.checked); if (!e.target.checked) aref.current?.pause(); }} /> Play Greenroom&apos;s sound
          </label>
        </div>
        <input type="range" min={0} max={Math.max(duration, 0.001)} step={1 / fps} value={Math.min(t, Math.max(duration, 0.001))} aria-label="Position in the picture" onChange={(e) => { pause(); seek(Number(e.target.value)); }} style={{ width: "100%" }} disabled={!src} />
        <p className="muted small">The preview keeps sound and picture together to within about a twentieth of a second. Exports are sample-accurate.</p>
      </div>

      <div className="card stack">
        <div className="row between wrap">
          <h2>Where the lines sit</h2>
          <span className="row wrap small">
            <span className="badge">{cued} of {nLines} placed</span>
            <button className="sm" onClick={lineUp} disabled={project.lines.every((l) => l.takes.length === 0)} title="Place every line one after another, starting at the playhead">
              Line them up from the playhead
            </button>
          </span>
        </div>
        <div ref={stripRef} className="pic-strip" role="group" aria-label="Timeline of lines against the picture" onClick={(e) => {
          if ((e.target as HTMLElement).closest(".pic-block")) return;
          const r = e.currentTarget.getBoundingClientRect();
          pause();
          seek(((e.clientX - r.left) / r.width) * total);
        }}>
          {plan.spans.map((s) => {
            const l = project.lines.find((x) => x.id === s.lineId)!;
            const start = drag?.id === s.lineId ? drag.sec : s.start;
            const len = s.end - s.start;
            const isCued = typeof l.cue === "number" || drag?.id === s.lineId;
            return (
              <div
                key={s.lineId}
                className={`pic-block${isCued ? " cued" : ""}${selected === s.lineId ? " sel" : ""}`}
                style={{ left: `${(start / total) * 100}%`, width: `${Math.max((len / total) * 100, 0.5)}%`, ["--c" as string]: COLORS[charIndex(l.characterId) % COLORS.length] }}
                title={`${who(l)}: ${l.text.slice(0, 60)}\n${tcAt(start, pic)}`}
                onPointerDown={(e) => {
                  e.currentTarget.setPointerCapture(e.pointerId);
                  dragRef.current = { id: s.lineId, x0: e.clientX, s0: s.start, moved: false };
                }}
                onPointerMove={(e) => {
                  const d = dragRef.current;
                  const r = stripRef.current?.getBoundingClientRect();
                  if (!d || !r || d.id !== s.lineId) return;
                  if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
                  if (d.moved) setDrag({ id: d.id, sec: Math.min(Math.max(0, snapToFrame(d.s0 + ((e.clientX - d.x0) / r.width) * total, f)), Math.max(0, total - len)) });
                }}
                onPointerUp={() => {
                  const d = dragRef.current;
                  dragRef.current = null;
                  if (!d) return;
                  if (d.moved && drag) setCue(d.id, drag.sec);
                  else {
                    setSelected(d.id);
                    pause();
                    seek(s.start);
                  }
                  setDrag(null);
                }}
              />
            );
          })}
          <div className="pic-head" style={{ left: `${(Math.min(t, total) / total) * 100}%` }} aria-hidden="true" />
        </div>
        <div className="row between small muted num">
          <span>{tcAt(0, pic)}</span>
          <span>{tcAt(total, pic)}</span>
        </div>

        <div className="stack" style={{ gap: 4 }}>
          {project.lines.map((l, i) => {
            const s = spanOf(l.id);
            const has = l.takes.length > 0;
            const startSec = s?.start ?? 0;
            return (
              <div key={l.id} className={`take${selected === l.id ? " chosen" : ""}`} onClick={() => setSelected(l.id)} style={{ flexWrap: "wrap" }}>
                <span className="muted num small" style={{ width: 22 }}>{i + 1}</span>
                <span className="speaker" style={{ minWidth: 70 }}>{who(l)}</span>
                <span className="muted small" style={{ flex: 1, minWidth: 140, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.text}</span>
                {has ? (
                  <input
                    key={l.id + "-" + startSec.toFixed(4) + "-" + (typeof l.cue)}
                    type="text"
                    aria-label={`Start timecode for line ${i + 1}`}
                    defaultValue={tcAt(startSec, pic)}
                    style={{ width: 118, fontFamily: "var(--font-mono)", opacity: typeof l.cue === "number" ? 1 : 0.6 }}
                    onBlur={(e) => {
                      const sec = secAtTc(e.target.value, pic);
                      if (sec === null) {
                        toast("That timecode is not valid or is before the first frame.", true);
                        e.target.value = tcAt(startSec, pic);
                      } else if (Math.abs(sec - startSec) > 1e-6) setCue(l.id, sec);
                    }}
                    onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
                  />
                ) : (
                  <span className="badge">no take yet</span>
                )}
                <button className="sm" disabled={!has} onClick={() => setCue(l.id, vref.current?.currentTime ?? t)} title="Start this line at the playhead">
                  Set to playhead
                </button>
                <button className="sm ghost" disabled={!has} onClick={() => setCue(l.id, startSec - 1 / fps)} aria-label={`Move line ${i + 1} one frame earlier`}>
                  −1f
                </button>
                <button className="sm ghost" disabled={!has} onClick={() => setCue(l.id, startSec + 1 / fps)} aria-label={`Move line ${i + 1} one frame later`}>
                  +1f
                </button>
                <button className="sm ghost" disabled={typeof l.cue !== "number"} onClick={() => setCue(l.id, undefined)} title="Let this line follow the one before it">
                  Follow previous
                </button>
                <button
                  className="sm"
                  disabled={!has || !src}
                  onClick={() => {
                    pause();
                    seek(Math.max(0, startSec - 0.75));
                    void play();
                  }}
                >
                  <Play size={12} /> Hear
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
