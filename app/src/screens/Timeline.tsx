import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { planTimeline, type Placed } from "../audio";
import { useApp } from "../ctx";
import { Play, Plus, Stop, Trash } from "../icons";
import { mixUrl } from "../mixcache";
import MakeMusic, { type Made } from "./MakeMusic";
import { remember } from "../media";
import { fpsOf, fpsValue, tcAt } from "../picture";
import { duckCurve, EDGE_FADE_IN, EDGE_FADE_OUT, formatClock, layoutRows, parseClock, rulerStep, snapTime } from "../timeline";
import { DEFAULT_MIX, type Line, type MixCfg, type MusicClip } from "../types";
import { uid } from "../script";
import { Empty, Note, useBusy } from "../ui";

const ROW = 36;
const LABEL = 132;
const COLORS = ["#52d68a", "#e9b85c", "#7cc7e8", "#c9a7ee", "#ff8a80", "#a9b4ad", "#f0a860", "#9af0b8"];

type Sel = { kind: "line"; id: string } | { kind: "music"; id: string } | null;

interface Clip {
  key: string;
  it: Placed;
  row: number;
  color: string;
  label: string;
  sel: Sel;
  /** A speech line or a music clip can be dragged; sound clips and the atmosphere move with their line. */
  draggable: boolean;
}

interface Lane {
  key: string;
  label: string;
  clips: Clip[];
  rows: number;
}

export default function Timeline() {
  const { project, edit, toast, go, undo, redo, canUndo, canRedo } = useApp();
  const { busy, run } = useBusy();
  const scroller = useRef<HTMLDivElement>(null);
  const audio = useRef<HTMLAudioElement>(null);
  const dragRef = useRef<{ key: string; mode: "move" | "trimL" | "trimR"; x0: number; start0: number; trim0: number; len0: number; moved: boolean } | null>(null);
  const [px, setPx] = useState(60);
  const [snap, setSnap] = useState(true);
  const [sel, setSel] = useState<Sel>(null);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [drag, setDrag] = useState<{ key: string; start: number; trim?: number; len?: number } | null>(null);

  const pic = project?.picture;
  const plan = useMemo(() => (project ? planTimeline(project, undefined, { minTotal: pic?.duration }) : null), [project, pic?.duration]);
  const total = Math.max(plan?.total ?? 0, 8);
  const mix: MixCfg = { ...DEFAULT_MIX, ...(project?.mix ?? {}) };
  const frame = pic ? 1 / fpsValue(fpsOf(pic)) : 0;

  const lanes = useMemo<Lane[]>(() => {
    if (!project || !plan) return [];
    const out: Lane[] = [];
    const build = (key: string, label: string, items: Placed[], colorOf: (i: Placed) => string, labelOf: (i: Placed) => string, selOf: (i: Placed) => Sel, draggable: (i: Placed) => boolean) => {
      if (items.length === 0) return;
      const rows = layoutRows(items.map((i) => ({ start: i.start, end: i.start + i.seconds })));
      out.push({ key, label, rows: Math.max(1, ...rows.map((r) => r + 1)), clips: items.map((it, n) => ({ key: `${key}:${it.ref.id}:${it.start.toFixed(4)}:${n}`, it, row: rows[n]!, color: colorOf(it), label: labelOf(it), sel: selOf(it), draggable: draggable(it) })) });
    };
    project.characters.forEach((c, ci) => {
      const items = plan.items.filter((i) => i.kind === "speech" && i.characterId === c.id);
      build("c-" + c.id, c.name, items, () => COLORS[ci % COLORS.length]!, (i) => `${project.lines.findIndex((l) => l.id === i.lineId) + 1} ${project.lines.find((l) => l.id === i.lineId)?.text ?? ""}`, (i) => (i.lineId ? { kind: "line", id: i.lineId } : null), () => true);
    });
    build("events", "Sound clips", plan.items.filter((i) => i.kind === "event"), () => "#a9b4ad", () => "sound", () => null, () => false);
    build("bed", "Atmosphere", plan.items.filter((i) => i.kind === "bed"), () => "#7cc7e8", () => project.bed.prompt || "atmosphere", () => null, () => false);
    build(
      "music",
      "Music",
      plan.items.filter((i) => i.kind === "music"),
      () => "#c9a7ee",
      (i) => project.music?.find((m) => m.take.id === i.ref.id)?.name ?? "Music",
      (i) => {
        const m = project.music?.find((x) => x.take.id === i.ref.id && Math.abs(x.start - i.start) < 1e-6);
        return m ? { kind: "music", id: m.id } : null;
      },
      () => true,
    );
    return out;
  }, [project, plan]);

  const ducking = useMemo(() => (plan?.duck && plan.total > 0 ? duckCurve(plan.spans, plan.total, plan.duck) : null), [plan]);

  // ---- playback -------------------------------------------------------------------------------------------------
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = () => {
      const a = audio.current;
      if (a) {
        setT(a.currentTime);
        const s = scroller.current;
        const x = a.currentTime * px;
        if (s && (x > s.scrollLeft + s.clientWidth - LABEL - 40 || x < s.scrollLeft)) s.scrollLeft = Math.max(0, x - 80);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, px]);

  useEffect(() => () => audio.current?.pause(), []);

  const stop = useCallback(() => {
    audio.current?.pause();
    setPlaying(false);
  }, []);

  const play = () =>
    run(async () => {
      if (!project || !plan || !audio.current) return;
      try {
        const url = await mixUrl(project, plan);
        if (!url) return toast("Make at least one take first.", true);
        const a = audio.current;
        if (a.dataset.url !== url) {
          a.src = url;
          a.dataset.url = url;
          await new Promise<void>((r) => {
            a.onloadeddata = () => r();
            a.load();
          });
        }
        a.currentTime = Math.min(t, a.duration || t);
        await a.play();
        setPlaying(true);
      } catch (e) {
        toast((e as Error).message || "Could not play.", true);
      }
    });

  const seek = (sec: number) => {
    const s = Math.min(Math.max(0, sec), total);
    if (audio.current && audio.current.dataset.url) audio.current.currentTime = s;
    setT(s);
  };
  const seekFromX = (clientX: number) => {
    const s = scroller.current;
    if (!s) return;
    const r = s.getBoundingClientRect();
    seek((clientX - r.left + s.scrollLeft - LABEL) / px);
  };

  // ---- editing --------------------------------------------------------------------------------------------------
  /** Every change on this screen is an undo step; quick runs with the same key (a slider, arrow nudges) are one. */
  const change = (key: string, fn: (p: NonNullable<typeof project>) => NonNullable<typeof project>) => edit(fn, key);
  const setCue = (id: string, sec: number | undefined) =>
    change(`cue:${id}`, (p) => ({
      ...p,
      lines: p.lines.map((l) => {
        if (l.id !== id) return l;
        if (sec === undefined) {
          const { cue: _c, ...rest } = l;
          void _c;
          return rest as Line;
        }
        return { ...l, cue: Math.max(0, sec) };
      }),
    }));
  const patchLine = (id: string, fn: (l: Line) => Line) => change(`line:${id}`, (p) => ({ ...p, lines: p.lines.map((l) => (l.id === id ? fn(l) : l)) }));
  const patchMusic = (id: string, patch: Partial<MusicClip>) => change(`music:${id}`, (p) => ({ ...p, music: (p.music ?? []).map((m) => (m.id === id ? { ...m, ...patch } : m)) }));
  const setMix = (patch: Partial<MixCfg>) => change("mix", (p) => ({ ...p, mix: { ...(p.mix ?? {}), ...patch } }));

  const snapped = (sec: number, self: Clip, shift: boolean) => {
    if (!snap || shift || !plan) return sec;
    const targets = [0, t, ...plan.items.filter((i) => i !== self.it).flatMap((i) => [i.start, i.start + i.seconds])];
    return snapTime(sec, targets, 8 / px, frame || undefined);
  };

  const onDown = (e: React.PointerEvent, c: Clip, mode: "move" | "trimL" | "trimR" = "move") => {
    e.stopPropagation();
    if (c.sel) setSel(c.sel);
    if (!c.draggable) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const m = c.sel?.kind === "music" ? project?.music?.find((x) => x.id === (c.sel as { id: string }).id) : undefined;
    dragRef.current = { key: c.key, mode, x0: e.clientX, start0: c.it.start, trim0: m?.trimIn ?? 0, len0: m?.length ?? c.it.seconds, moved: false };
  };
  const onMove = (e: React.PointerEvent, c: Clip) => {
    const d = dragRef.current;
    if (!d || d.key !== c.key) return;
    const dx = (e.clientX - d.x0) / px;
    if (Math.abs(e.clientX - d.x0) > 3) d.moved = true;
    if (!d.moved) return;
    if (d.mode === "move") setDrag({ key: c.key, start: Math.max(0, snapped(d.start0 + dx, c, e.shiftKey)) });
    else if (d.mode === "trimL") {
      const m = project?.music?.find((x) => c.sel?.kind === "music" && x.id === c.sel.id);
      if (!m) return;
      const shift = Math.min(Math.max(dx, -d.trim0, -d.start0), d.len0 - 0.2);
      setDrag({ key: c.key, start: d.start0 + shift, trim: d.trim0 + shift, len: d.len0 - shift });
    } else {
      const m = project?.music?.find((x) => c.sel?.kind === "music" && x.id === c.sel.id);
      if (!m) return;
      setDrag({ key: c.key, start: d.start0, len: Math.min(Math.max(d.len0 + dx, 0.2), m.take.seconds - d.trim0) });
    }
  };
  const onUp = (c: Clip) => {
    const d = dragRef.current;
    dragRef.current = null;
    const cur = drag;
    setDrag(null);
    if (!d || !d.moved || !cur || cur.key !== c.key || !c.sel) return;
    if (c.sel.kind === "line") setCue(c.sel.id, cur.start);
    else patchMusic(c.sel.id, { start: cur.start, ...(cur.trim !== undefined ? { trimIn: cur.trim } : {}), ...(cur.len !== undefined ? { length: cur.len } : {}) });
  };

  const importMusic = () =>
    run(async () => {
      if (!project) return;
      try {
        const path = await api.pickAudio();
        if (!path) return;
        const imp = await api.audioImport(project.id, path);
        const seconds = await remember(imp.id, await api.takeRead(project.id, imp.id));
        const clip: MusicClip = { id: "mu-" + uid(), name: imp.name.replace(/\.[^.]+$/, ""), take: { id: imp.id, ext: imp.ext, seconds, sha256: imp.sha256, bytes: imp.bytes }, start: Math.max(0, t), gainDb: -10, fadeIn: 0.5, fadeOut: 2, trimIn: 0, length: seconds, duck: true, source: "" };
        change("", (p) => ({ ...p, music: [...(p.music ?? []), clip] }));
        setSel({ kind: "music", id: clip.id });
        toast("Music added. Note where it came from and its licence in the panel below: it goes in the production report.");
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  const useMade = (m: Made) => {
    const clip: MusicClip = { id: "mu-" + uid(), name: m.name, take: { id: m.id, ext: m.ext, seconds: m.real, sha256: m.sha256, bytes: m.bytes }, start: Math.max(0, t), gainDb: -10, fadeIn: 0.5, fadeOut: 2, trimIn: 0, length: m.real, duck: true, source: m.source };
    change("", (p) => ({ ...p, music: [...(p.music ?? []), clip] }));
    setSel({ kind: "music", id: clip.id });
  };

  const removeMusic = (id: string) => {
    change("", (p) => ({ ...p, music: (p.music ?? []).filter((m) => m.id !== id) }));
    setSel(null);
  };

  const nudge = (secs: number) => {
    if (!sel || !project) return;
    if (sel.kind === "line") {
      const it = plan?.spans.find((s) => s.lineId === sel.id);
      if (it) setCue(sel.id, Math.max(0, it.start + secs));
    } else {
      const m = project.music?.find((x) => x.id === sel.id);
      if (m) patchMusic(sel.id, { start: Math.max(0, m.start + secs) });
    }
  };

  if (!project || !plan) return null;

  if (project.lines.every((l) => l.takes.length === 0) && !(project.music ?? []).length) {
    return (
      <section>
        <h1>Timeline</h1>
        <Empty
          title="No takes to arrange yet"
          action={
            <button className="primary" onClick={() => go("perform")}>
              Go to Perform
            </button>
          }
        >
          Make takes first, then arrange them here: drag lines, overlap dialogue, add music that dips under the voices.
        </Empty>
      </section>
    );
  }

  const selLine = sel?.kind === "line" ? project.lines.find((l) => l.id === sel.id) : undefined;
  const selMusic = sel?.kind === "music" ? project.music?.find((m) => m.id === sel.id) : undefined;
  const selSpan = selLine ? plan.spans.find((s) => s.lineId === selLine.id) : undefined;
  const selItem = selLine ? plan.items.find((i) => i.kind === "speech" && i.lineId === selLine.id) : undefined;
  const clock = (sec: number) => (pic ? tcAt(sec, pic) : formatClock(sec));
  const step = rulerStep(px);
  const width = LABEL + total * px + 60;

  return (
    <section    >
      <div>
        <h1>Timeline</h1>
        <p className="lede">Arrange the performance: drag a line to move it, let dialogue overlap, and add music that dips under the voices. Lines that cross each other from the same character crossfade by themselves.</p>
      </div>

      <div className="card stack">
        <div className="row wrap">
          <button className="primary" onClick={() => (playing ? stop() : void play())} disabled={busy}>
            {playing ? <Stop size={14} /> : <Play size={14} />} {playing ? "Pause" : busy ? "Preparing…" : "Play"}
          </button>
          <code className="pic-tc" title="Playhead">{clock(t)}</code>
          <span className="spacer" />
          <button className="sm" onClick={undo} disabled={!canUndo} title="Undo (Ctrl+Z)">
            Undo
          </button>
          <button className="sm" onClick={redo} disabled={!canRedo} title="Redo (Ctrl+Shift+Z)">
            Redo
          </button>
          <label className="row small muted">
            <input type="checkbox" checked={snap} onChange={(e) => setSnap(e.target.checked)} /> Snap to edges{pic ? " and frames" : ""}
          </label>
          <button className="sm" onClick={() => setPx((p) => Math.max(8, p / 1.5))} aria-label="Zoom out">
            −
          </button>
          <button className="sm" onClick={() => setPx((p) => Math.min(600, p * 1.5))} aria-label="Zoom in">
            +
          </button>
          <button className="sm" onClick={() => setPx(Math.max(8, ((scroller.current?.clientWidth ?? 900) - LABEL - 40) / total))}>
            Fit
          </button>
          <button onClick={() => void importMusic()} disabled={busy}>
            <Plus size={14} /> Add music…
          </button>
        </div>
        <audio ref={audio} preload="auto" onEnded={() => setPlaying(false)} />

        <div
          ref={scroller}
          className="tl-scroll"
          tabIndex={0}
          aria-label="Timeline. Space plays. Arrow keys nudge the selected clip, Shift for larger steps. Delete removes selected music."
          onKeyDown={(e) => {
            if ((e.target as HTMLElement).tagName === "INPUT" || (e.target as HTMLElement).tagName === "TEXTAREA") return;
            if (e.key === " ") { e.preventDefault(); playing ? stop() : void play(); }
            else if (e.key === "ArrowLeft") { e.preventDefault(); nudge(-(e.altKey && frame ? frame : e.shiftKey ? 0.1 : 0.01)); }
            else if (e.key === "ArrowRight") { e.preventDefault(); nudge(e.altKey && frame ? frame : e.shiftKey ? 0.1 : 0.01); }
            else if ((e.key === "Delete" || e.key === "Backspace") && selMusic) { e.preventDefault(); removeMusic(selMusic.id); }
          }}
        >
          <div className="tl-canvas" style={{ width }}>
            <div className="tl-ruler" onPointerDown={(e) => { stop(); seekFromX(e.clientX); }}>
              {Array.from({ length: Math.ceil(total / step) + 1 }, (_, i) => i * step).map((s) => (
                <span key={s} className="tl-tick" style={{ left: LABEL + s * px }}>
                  {clock(s)}
                </span>
              ))}
            </div>
            {lanes.map((lane) => (
              <div key={lane.key} className="tl-lane" style={{ height: lane.rows * ROW + 6 }}>
                <div className="tl-label" style={{ width: LABEL }}>
                  {lane.label}
                </div>
                <div className="tl-track" style={{ left: LABEL, width: total * px }} onPointerDown={(e) => { if (e.target === e.currentTarget) { setSel(null); seekFromX(e.clientX); } }}>
                  {lane.clips.map((c) => {
                    const dragging = drag?.key === c.key;
                    const start = dragging ? drag!.start : c.it.start;
                    const len = dragging && drag!.len !== undefined ? drag!.len : c.it.seconds;
                    const selected = !!c.sel && !!sel && c.sel.kind === sel.kind && c.sel.id === sel.id;
                    const fi = Math.min(c.it.fadeIn, len / 2);
                    const fo = Math.min(c.it.fadeOut, len / 2);
                    const showFade = (v: number, edge: number) => v * px >= 3 && v > edge * 1.5;
                    return (
                      <div
                        key={c.key}
                        role="button"
                        tabIndex={-1}
                        aria-label={`${lane.label}: ${c.label.slice(0, 40)}, starts ${clock(start)}`}
                        aria-pressed={selected}
                        className={`tl-clip${selected ? " sel" : ""}${dragging ? " dragging" : ""}${c.draggable ? "" : " fixed"}`}
                        style={{ left: start * px, width: Math.max(len * px, 5), top: c.row * ROW + 3, height: ROW - 4, ["--c" as string]: c.color }}
                        title={`${c.label}\n${clock(start)}${c.draggable ? "" : "\nMoves with its line"}`}
                        onPointerDown={(e) => onDown(e, c)}
                        onPointerMove={(e) => onMove(e, c)}
                        onPointerUp={() => onUp(c)}
                      >
                        {showFade(fi, EDGE_FADE_IN) && <i className="tl-fade in" style={{ width: fi * px }} />}
                        {showFade(fo, EDGE_FADE_OUT) && <i className="tl-fade out" style={{ width: fo * px }} />}
                        {c.it.kind === "music" && c.it.duck && ducking && (
                          <svg className="tl-duck" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                            <polyline fill="none" points={duckPoints(ducking, c.it.start, len)} />
                          </svg>
                        )}
                        <span className="tl-text">{c.label}</span>
                        {c.it.kind === "music" && c.draggable && (
                          <>
                            <b className="tl-handle l" onPointerDown={(e) => onDown(e, c, "trimL")} onPointerMove={(e) => onMove(e, c)} onPointerUp={() => onUp(c)} aria-hidden="true" />
                            <b className="tl-handle r" onPointerDown={(e) => onDown(e, c, "trimR")} onPointerMove={(e) => onMove(e, c)} onPointerUp={() => onUp(c)} aria-hidden="true" />
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
            <div className="tl-head" style={{ left: LABEL + Math.min(t, total) * px }} aria-hidden="true" />
          </div>
        </div>
        <p className="muted small">Fades show as shaded corners; the line inside a music clip is how far it dips under dialogue. Sound clips and the atmosphere move with their line.</p>
      </div>

      <MakeMusic onUse={useMade} />

      {selLine && selSpan && selItem && (
        <div className="card stack lit">
          <div className="row between wrap">
            <h2>
              Line {project.lines.indexOf(selLine) + 1}: {project.characters.find((c) => c.id === selLine.characterId)?.name}
            </h2>
            <span className="muted small">{selLine.text.slice(0, 80)}</span>
          </div>
          <div className="row wrap">
            <label className="field">
              Starts at
              <input key={selSpan.start.toFixed(4)} type="text" defaultValue={formatClock(selSpan.start)} aria-label="Start time" style={{ width: 120, fontFamily: "var(--font-mono)" }} onBlur={(e) => { const v = parseClock(e.target.value); if (v === null) { toast("Write a time like 1:23.5 or 83.5.", true); e.target.value = formatClock(selSpan.start); } else if (Math.abs(v - selSpan.start) > 1e-6) setCue(selLine.id, v); }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            </label>
            {pic && <span className="badge accent" title="Timecode in the picture">{tcAt(selSpan.start, pic)}</span>}
            <button className="sm" onClick={() => nudge(-0.1)}>−100 ms</button>
            <button className="sm" onClick={() => nudge(-0.01)}>−10 ms</button>
            <button className="sm" onClick={() => nudge(0.01)}>+10 ms</button>
            <button className="sm" onClick={() => nudge(0.1)}>+100 ms</button>
            <button className="sm ghost" disabled={typeof selLine.cue !== "number"} onClick={() => setCue(selLine.id, undefined)}>
              Follow previous
            </button>
          </div>
          <div className="row wrap">
            <label className="row small muted">
              Level
              <input type="range" min={-18} max={9} step={0.5} value={selLine.direction.gain ?? 0} aria-label="Level in dB" onChange={(e) => patchLine(selLine.id, (l) => ({ ...l, direction: { ...l.direction, gain: Number(e.target.value) } }))} />
              <span className="num">{(selLine.direction.gain ?? 0).toFixed(1)} dB</span>
            </label>
            <label className="field">
              Fade in (ms)
              <input type="number" min={0} max={3000} step={5} value={Math.round((selLine.fadeIn ?? EDGE_FADE_IN) * 1000)} aria-label="Fade in in milliseconds" style={{ width: 90 }} onChange={(e) => patchLine(selLine.id, (l) => ({ ...l, fadeIn: Math.max(0, Number(e.target.value)) / 1000 }))} />
            </label>
            <label className="field">
              Fade out (ms)
              <input type="number" min={0} max={3000} step={5} value={Math.round((selLine.fadeOut ?? EDGE_FADE_OUT) * 1000)} aria-label="Fade out in milliseconds" style={{ width: 90 }} onChange={(e) => patchLine(selLine.id, (l) => ({ ...l, fadeOut: Math.max(0, Number(e.target.value)) / 1000 }))} />
            </label>
          </div>
          {selItem.fadeIn > (selLine.fadeIn ?? EDGE_FADE_IN) + 1e-6 && <p className="muted small">This line crossfades in over {Math.round(selItem.fadeIn * 1000)} ms where it overlaps the same character&apos;s previous line.</p>}
          {selItem.fadeOut > (selLine.fadeOut ?? EDGE_FADE_OUT) + 1e-6 && <p className="muted small">This line crossfades out over {Math.round(selItem.fadeOut * 1000)} ms where the same character&apos;s next line overlaps it.</p>}
        </div>
      )}

      {selMusic && (
        <div className="card stack lit">
          <div className="row between wrap">
            <h2>Music: {selMusic.name}</h2>
            <button className="sm danger" onClick={() => removeMusic(selMusic.id)}>
              <Trash size={14} /> Remove from the timeline
            </button>
          </div>
          <div className="row wrap">
            <label className="field" style={{ flex: 1, minWidth: 160 }}>
              Name
              <input type="text" value={selMusic.name} onChange={(e) => patchMusic(selMusic.id, { name: e.target.value })} />
            </label>
            <label className="field">
              Starts at
              <input key={selMusic.start.toFixed(4)} type="text" defaultValue={formatClock(selMusic.start)} aria-label="Music start time" style={{ width: 120, fontFamily: "var(--font-mono)" }} onBlur={(e) => { const v = parseClock(e.target.value); if (v === null) { toast("Write a time like 1:23.5 or 83.5.", true); e.target.value = formatClock(selMusic.start); } else patchMusic(selMusic.id, { start: v }); }} onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()} />
            </label>
            <label className="field">
              Skip the first (s)
              <input type="number" min={0} max={Math.max(0, selMusic.take.seconds - 0.2)} step={0.1} value={+selMusic.trimIn.toFixed(2)} style={{ width: 100 }} onChange={(e) => { const v = Math.min(Math.max(0, Number(e.target.value)), selMusic.take.seconds - 0.2); patchMusic(selMusic.id, { trimIn: v, length: Math.min(selMusic.length, selMusic.take.seconds - v) }); }} />
            </label>
            <label className="field">
              Plays for (s)
              <input type="number" min={0.2} max={selMusic.take.seconds - selMusic.trimIn} step={0.1} value={+selMusic.length.toFixed(2)} style={{ width: 100 }} onChange={(e) => patchMusic(selMusic.id, { length: Math.min(Math.max(0.2, Number(e.target.value)), selMusic.take.seconds - selMusic.trimIn) })} />
            </label>
          </div>
          <div className="row wrap">
            <label className="row small muted">
              Level
              <input type="range" min={-30} max={6} step={0.5} value={selMusic.gainDb} aria-label="Music level in dB" onChange={(e) => patchMusic(selMusic.id, { gainDb: Number(e.target.value) })} />
              <span className="num">{selMusic.gainDb.toFixed(1)} dB</span>
            </label>
            <label className="field">
              Fade in (s)
              <input type="number" min={0} max={30} step={0.1} value={selMusic.fadeIn} style={{ width: 90 }} onChange={(e) => patchMusic(selMusic.id, { fadeIn: Math.max(0, Number(e.target.value)) })} />
            </label>
            <label className="field">
              Fade out (s)
              <input type="number" min={0} max={30} step={0.1} value={selMusic.fadeOut} style={{ width: 90 }} onChange={(e) => patchMusic(selMusic.id, { fadeOut: Math.max(0, Number(e.target.value)) })} />
            </label>
            <label className="row small">
              <input type="checkbox" checked={selMusic.duck} onChange={(e) => patchMusic(selMusic.id, { duck: e.target.checked })} /> Dip under dialogue
            </label>
          </div>
          <label className="field">
            Where it came from and its licence
            <input type="text" value={selMusic.source} placeholder="For example: licensed from Studio X, invoice 41, film and web use" onChange={(e) => patchMusic(selMusic.id, { source: e.target.value })} />
          </label>
          {!selMusic.source.trim() && <Note kind="warn">No source or licence noted. The production report will say so. Make sure you have the right to use this music.</Note>}
        </div>
      )}

      <details className="card stack fold">
        <summary>
          <strong>Ducking</strong> <span className="muted small">{mix.duck ? `music dips ${Math.abs(mix.amountDb)} dB under dialogue` : "off"}</span>
        </summary>
        <div className="row wrap">
          <label className="row">
            <input type="checkbox" checked={mix.duck} onChange={(e) => setMix({ duck: e.target.checked })} /> Dip music while someone speaks
          </label>
          <label className="row small">
            <input type="checkbox" checked={mix.duckAtmosphere} disabled={!mix.duck} onChange={(e) => setMix({ duckAtmosphere: e.target.checked })} /> Dip the atmosphere too
          </label>
        </div>
        <div className="row wrap" aria-disabled={!mix.duck} style={{ opacity: mix.duck ? 1 : 0.5 }}>
          <label className="row small muted">
            Dip by
            <input type="range" min={-30} max={-3} step={1} value={mix.amountDb} disabled={!mix.duck} aria-label="Dip amount in dB" onChange={(e) => setMix({ amountDb: Number(e.target.value) })} />
            <span className="num">{mix.amountDb} dB</span>
          </label>
          <label className="row small muted">
            Starts before the line
            <input type="range" min={0} max={1} step={0.05} value={mix.attack} disabled={!mix.duck} aria-label="Attack in seconds" onChange={(e) => setMix({ attack: Number(e.target.value) })} />
            <span className="num">{Math.round(mix.attack * 1000)} ms</span>
          </label>
          <label className="row small muted">
            Held after
            <input type="range" min={0} max={2} step={0.05} value={mix.hold} disabled={!mix.duck} aria-label="Hold in seconds" onChange={(e) => setMix({ hold: Number(e.target.value) })} />
            <span className="num">{Math.round(mix.hold * 1000)} ms</span>
          </label>
          <label className="row small muted">
            Comes back over
            <input type="range" min={0.05} max={3} step={0.05} value={mix.release} disabled={!mix.duck} aria-label="Release in seconds" onChange={(e) => setMix({ release: Number(e.target.value) })} />
            <span className="num">{Math.round(mix.release * 1000)} ms</span>
          </label>
        </div>
        <p className="muted small">The dip is worked out from where the lines are, so it follows them when you move them. It applies to music clips set to dip, and to the atmosphere if you tick it. Exports and stems include it.</p>
      </details>
    </section>
  );
}

/** The ducking envelope as points for a small graph inside one music clip. */
function duckPoints(g: Float32Array, start: number, len: number): string {
  const rate = 100;
  const pts: string[] = [];
  const n = Math.max(2, Math.min(200, Math.round(len * 10)));
  for (let i = 0; i <= n; i++) {
    const sec = start + (i / n) * len;
    const v = g[Math.min(g.length - 1, Math.max(0, Math.round(sec * rate)))] ?? 1;
    pts.push(`${((i / n) * 100).toFixed(2)},${(12 + (1 - v) * 76).toFixed(2)}`);
  }
  return pts.join(" ");
}
