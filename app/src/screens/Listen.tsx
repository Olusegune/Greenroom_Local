import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "../api";
import { textBase64 } from "../audio";
import { useApp } from "../ctx";
import { heard, nextUnheard, queue, reportMarkdown, summarise, takeToHear, todoList, voiceComplaints, VERDICTS, verdictInfo, withNote, withVerdict, type QueueFilter, type Verdict } from "../listen";
import { pausePlayback, playToggle, playUrl, resumePlayback, stopPlayback, takeUrl } from "../media";
import { Empty, Note } from "../ui";
import { APP_VERSION } from "../version";
import { CharacterFace } from "./AvatarBrowser";

const AUTO_KEY = "greenroom-listen-auto";
const loadAuto = (): boolean => {
  try {
    return localStorage.getItem(AUTO_KEY) !== "off";
  } catch {
    return true;
  }
};

/** The listening pass: play each line, press a key for what you hear, and get a to-do list. Greenroom records your verdicts; it never judges the audio. */
export default function Listen() {
  const { project, library, edit, go, toast } = useApp();
  const [filter, setFilter] = useState<QueueFilter>("all");
  const [cur, setCur] = useState(0);
  const [auto, setAuto] = useState(loadAuto);
  const [state, setState] = useState<"idle" | "loading" | "playing" | "paused">("idle");
  const [noteDraft, setNoteDraft] = useState("");
  const [saved, setSaved] = useState("");
  const alive = useRef(true);
  const stateRef = useRef(state);
  stateRef.current = state;
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      stopPlayback();
    };
  }, []);

  const lines = project?.lines ?? [];
  const characters = project?.characters ?? [];
  const ids = useMemo(() => queue(lines, filter), [lines, filter]);
  const sum = useMemo(() => summarise(lines), [lines]);
  const todo = useMemo(() => todoList(lines, characters), [lines, characters]);
  const complaints = useMemo(() => voiceComplaints(todo), [todo]);

  // keep the current line inside the queue (the filter or the lines may have changed)
  const at = ids.includes(cur) ? cur : (ids[0] ?? -1);
  const line = at >= 0 ? lines[at] : undefined;
  const character = line ? characters.find((c) => c.id === line.characterId) : undefined;
  const voice = character ? library.find((v) => v.id === character.voiceId) : undefined;
  const take = line ? takeToHear(line) : undefined;
  const verdict = line ? heard(line) : undefined;
  useEffect(() => {
    setNoteDraft(verdict?.note ?? "");
  }, [line?.id, verdict?.note, verdict?.takeId]);

  const play = useCallback(async () => {
    if (!project || !take) return;
    const what = playToggle(stateRef.current);
    if (what === "pause") {
      pausePlayback();
      return setState("paused");
    }
    if (what === "resume") {
      resumePlayback();
      return setState("playing");
    }
    if (what === "wait") return;
    setState("loading");
    try {
      const url = await takeUrl(project.id, take.id);
      if (!alive.current) return;
      setState("playing");
      await playUrl(url, () => alive.current && setState("idle"), "listen");
    } catch (e) {
      if (alive.current) setState("idle");
      toast((e as Error).message, true);
    }
  }, [project, take, toast]);

  const go1 = useCallback(
    (index: number, andPlay = false) => {
      stopPlayback();
      setState("idle");
      setCur(index);
      if (andPlay) setTimeout(() => void playRef.current(), 0);
    },
    [],
  );
  const playRef = useRef(play);
  playRef.current = play;

  const step = (d: 1 | -1) => {
    if (ids.length === 0) return;
    const pos = Math.max(0, ids.indexOf(at));
    go1(ids[(pos + d + ids.length) % ids.length]!);
  };

  const mark = (v: Verdict) => {
    if (!project || !line || !take) return;
    const now = new Date().toISOString().slice(0, 16).replace("T", " ");
    const updated = lines.map((l) => (l.id === line.id ? withVerdict(l, v, now) : l));
    edit((p) => ({ ...p, lines: p.lines.map((l) => (l.id === line.id ? withVerdict(l, v, now) : l)) }), "~listen");
    // moving on is for a verdict just given, not one taken back
    const gave = heard(updated[at]!)?.verdict === v;
    if (auto && gave && filter !== "flagged") {
      const next = nextUnheard(updated, at);
      if (next >= 0 && next !== at) go1(next, true);
      else if (next < 0) toast("Every line has been heard.");
    }
  };

  const saveNote = () => {
    if (!line || !verdict) return;
    if ((verdict.note ?? "") === noteDraft.trim()) return;
    edit((p) => ({ ...p, lines: p.lines.map((l) => (l.id === line.id ? withNote(l, noteDraft) : l)) }), "~listen");
  };

  // keys: space plays, 1-4 record what you hear, arrows or N and P move, U jumps to the next line not heard yet
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      const tag = t?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t?.isContentEditable) return;
      if (e.key === " " && tag !== "BUTTON") {
        e.preventDefault();
        void playRef.current();
      } else if (e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        markRef.current(VERDICTS[Number(e.key) - 1]!.id);
      } else if (e.key === "ArrowRight" || e.key.toLowerCase() === "n") {
        e.preventDefault();
        stepRef.current(1);
      } else if (e.key === "ArrowLeft" || e.key.toLowerCase() === "p") {
        e.preventDefault();
        stepRef.current(-1);
      } else if (e.key.toLowerCase() === "u") {
        e.preventDefault();
        const next = nextUnheard(linesRef.current, atRef.current);
        if (next >= 0) go1(next, true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go1]);
  const markRef = useRef(mark);
  markRef.current = mark;
  const stepRef = useRef(step);
  stepRef.current = step;
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const atRef = useRef(at);
  atRef.current = at;

  if (!project) {
    return (
      <section>
        <h1>Listen</h1>
        <Empty title="Open a project first" action={<button className="primary" onClick={() => go("home")}>Go to Projects</button>}>
          Listening notes belong to a project.
        </Empty>
      </section>
    );
  }
  if (sum.withTake === 0) {
    return (
      <section>
        <h1>Listen</h1>
        <Empty title="No takes to listen to yet" action={<button className="primary" onClick={() => go("perform")}>Go to Perform</button>}>
          Make takes on Perform, then come back and play them one by one.
        </Empty>
      </section>
    );
  }

  const copy = async () => {
    const text = todo.length
      ? todo.map((t) => `Line ${t.lineNumber} (${t.character}): ${verdictInfo(t.verdict).label}${t.note ? ` - ${t.note}` : ""}. ${t.todo}`).join("\n")
      : "Nothing to do.";
    try {
      await navigator.clipboard.writeText(text);
      toast("To-do list copied.");
    } catch {
      toast("Could not copy. Use Save the listening notes instead.", true);
    }
  };
  const save = async () => {
    try {
      const stem = project.name.replace(/[^\p{L}\p{N} _-]+/gu, "").trim() || "Greenroom";
      const md = reportMarkdown(project, { now: new Date().toISOString().slice(0, 16).replace("T", " "), appVersion: APP_VERSION });
      const where = await api.exportWrite(project.id, "", `${stem} - listening notes.md`, textBase64(md));
      setSaved(where);
      toast("Listening notes saved.");
    } catch (e) {
      toast((e as Error).message, true);
    }
  };
  const toggleAuto = (v: boolean) => {
    setAuto(v);
    try {
      localStorage.setItem(AUTO_KEY, v ? "on" : "off");
    } catch {
      /* the choice is just not remembered */
    }
  };

  const pos = ids.indexOf(at);
  return (
    <section>
      <div>
        <h1>Listen</h1>
        <p className="lede">Play each line and press a key for what you hear. Greenroom only records your verdicts; it never judges the audio. They become a to-do list.</p>
      </div>

      <div className="stats" role="group" aria-label="Listening progress">
        <div className="stat">
          <span className="stat-n">{sum.heard}<span className="muted small"> / {sum.withTake}</span></span>
          <span className="stat-l">lines heard</span>
          <span className="stat-s" role="status">{sum.unheard === 0 ? "all heard" : `${sum.unheard} to go`}</span>
        </div>
        <div className="stat">
          <span className="stat-n">{sum.good}</span>
          <span className="stat-l">good</span>
        </div>
        <div className={sum.voice + sum.delivery + sum.glitch ? "stat warn" : "stat"}>
          <span className="stat-n">{sum.voice + sum.delivery + sum.glitch}</span>
          <span className="stat-l">to fix</span>
          <span className="stat-s">{sum.voice} voice, {sum.delivery} delivery, {sum.glitch} glitch</span>
        </div>
      </div>

      <div className="row wrap">
        <label className="row small">
          Show
          <select value={filter} onChange={(e) => { setFilter(e.target.value as QueueFilter); setSaved(""); }} aria-label="Which lines to listen to">
            <option value="all">All lines with a take</option>
            <option value="unheard">Not heard yet</option>
            <option value="flagged">Marked wrong</option>
          </select>
        </label>
        <label className="row small">
          <input type="checkbox" checked={auto} onChange={(e) => toggleAuto(e.target.checked)} />
          Play the next unheard line after each verdict
        </label>
        <span className="spacer" />
        <button className="sm" onClick={() => { const n = nextUnheard(lines, at); if (n >= 0) go1(n, true); else toast("Every line has been heard."); }} disabled={sum.unheard === 0}>Next not heard yet (U)</button>
      </div>

      {!line || !take ? (
        <Note kind="info">No lines match this view. Choose another view above.</Note>
      ) : (
        <div className="card stack" aria-label={`Line ${at + 1}`}>
          <div className="row">
            <CharacterFace character={character} voice={voice} size={64} editable={false} />
            <span className="stack tight">
              <strong>{character?.name ?? "?"}</strong>
              <span className="muted small">Line {at + 1} of {lines.length}{voice ? ` · ${voice.name}` : ""}{pos >= 0 ? ` · ${pos + 1} of ${ids.length} in this view` : ""}</span>
            </span>
            <span className="spacer" />
            {verdict && <span className={verdict.verdict === "good" ? "badge ok" : "badge warn"}>{verdictInfo(verdict.verdict).label}</span>}
          </div>
          <p className="listen-line" style={{ fontSize: "1.25rem", margin: "6px 0" }}>{line.text}</p>
          <p className="muted small" title="Exactly what was sent to the voice">Sent to the voice: {take.sent}</p>
          <div className="row wrap">
            <button className="primary" onClick={() => void play()} aria-keyshortcuts="Space">
              {state === "playing" ? "Pause" : state === "paused" ? "Resume" : state === "loading" ? "Loading…" : "Play (Space)"}
            </button>
            <button onClick={() => step(-1)} aria-keyshortcuts="ArrowLeft P">Previous (P)</button>
            <button onClick={() => step(1)} aria-keyshortcuts="ArrowRight N">Next (N)</button>
            {line.takes.length > 1 && <span className="muted small">This line has {line.takes.length} takes; the chosen one plays.</span>}
          </div>
          <div className="row wrap" role="group" aria-label="What do you hear?">
            {VERDICTS.map((v) => (
              <button key={v.id} className={verdict?.verdict === v.id ? "primary" : ""} aria-pressed={verdict?.verdict === v.id} aria-keyshortcuts={v.key} title={v.hint} onClick={() => mark(v.id)}>
                {v.label} ({v.key})
              </button>
            ))}
          </div>
          <label className="stack tight small">
            Your note (optional){verdict ? "" : ": press a verdict first"}
            <input type="text" value={noteDraft} maxLength={300} disabled={!verdict} placeholder="For example: sounds too young, laughs too early" onChange={(e) => setNoteDraft(e.target.value)} onBlur={saveNote} onKeyDown={(e) => { if (e.key === "Enter") saveNote(); }} />
          </label>
        </div>
      )}

      <h2>To do</h2>
      {todo.length === 0 ? (
        <p className="muted">{sum.heard === 0 ? "Nothing yet. Press Play, then 1 to 4 for what you hear." : "Nothing to fix so far."}</p>
      ) : (
        <div className="stack">
          {complaints.map((c) => (
            <Note kind="warn" key={c.characterId}>
              <strong>{c.character}</strong>: wrong voice on {c.lines} line{c.lines === 1 ? "" : "s"}.{" "}
              <button className="sm" onClick={() => go("cast")}>Choose another voice (Cast)</button>
            </Note>
          ))}
          <ul className="plain stack tight" aria-label="Lines to fix">
            {todo.map((t) => (
              <li key={t.index} className="row wrap">
                <button className="sm" onClick={() => { setFilter("all"); go1(t.index); }} aria-label={`Go to line ${t.lineNumber}`}>Line {t.lineNumber}</button>
                <strong>{t.character}</strong>
                <span className="badge warn">{verdictInfo(t.verdict).label}</span>
                <span className="muted small">{t.note ? `"${t.note}". ` : ""}{t.todo}</span>
              </li>
            ))}
          </ul>
          <div className="row wrap">
            <button className="sm" onClick={() => go("perform")}>Go to Perform</button>
          </div>
        </div>
      )}

      <div className="row wrap">
        <button onClick={() => void copy()} disabled={sum.heard === 0}>Copy the to-do list</button>
        <button onClick={() => void save()} disabled={sum.heard === 0}>Save the listening notes</button>
        {saved && <span className="muted small" role="status">Saved: {saved}</span>}
      </div>

      <h2>All lines</h2>
      <ol className="plain stack tight" aria-label="Every line with a take" style={{ maxHeight: 360, overflow: "auto" }}>
        {lines.map((l, i) => {
          if (!takeToHear(l)) return null;
          const h = heard(l);
          const name = characters.find((c) => c.id === l.characterId)?.name ?? "?";
          return (
            <li key={l.id} className="row">
              <button className={i === at ? "sm primary" : "sm"} onClick={() => { setFilter("all"); go1(i); }} aria-label={`Line ${i + 1}, ${name}`} aria-current={i === at ? "true" : undefined}>{i + 1}</button>
              <strong>{name}</strong>
              <span className="muted small" style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.text}</span>
              <span className={!h ? "badge" : h.verdict === "good" ? "badge ok" : "badge warn"}>{h ? verdictInfo(h.verdict).label : "not heard"}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
