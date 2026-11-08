import { useRef, useState, useSyncExternalStore } from "react";
import { useApp } from "../ctx";
import { applySuggestion, cleanWritten, describe, parseSceneDirections, sceneBatches, sceneDirectionSystem, type SceneDirection, isDirected, parseDirector, systemPrompt, userPrompt, writeDirectionSystem, writeDirectionUser, type DirectorResult } from "../director";
import { DirectorPanel } from "./DirectorPanel";
import { effectiveLine } from "../performance";
import { steers } from "../inworld";
import { applyPreset, chosenTake, cleanNote, ALL_SOUND_TAGS, EMOTIONS, hasStyle, MORE_SOUNDS, NOTE_MAX, PRESETS, pushHistory, SOUNDS, STYLES, toggleIn, toggleStyle, vkUnsupported } from "../direct";
import { VisualLine } from "../VisualLine";
import { api } from "../api";
import { Avatar } from "../avatar";
import { ENGINES, ENGINE_ORDER, directorReady, qualityFormat, soundEngineOf } from "../engines";
import { useLocalDirectorReady } from "../localDirector";
import { makeSound, makeTake, modelLabel, plan, type Model } from "../generate";
import ReVoiceDialog from "./ReVoiceDialog";
import { Pause, Play, Sparkle, Stop, Trash } from "../icons";
import { parsePlayback, pausePlayback, playbackSnapshot, resumePlayback, stopPlayback, subscribePlayback, takeUrl } from "../media";
import { audioPlan, previewScene } from "../preview";
import { uid } from "../script";
import type { Character, Line, Pronunciation, VoiceEntry } from "../types";
import { Empty, Note, PlayButton } from "../ui";
import { ledgerTotal, money, shortHash } from "../trust";
import type { Take } from "../types";

export default function Perform() {
  const localDirector = useLocalDirectorReady();
  const { project, edit, library, confirmSpend, toast, go, engines, saveEngines, keys, priceLines, addLedger } = useApp();
  const model: Model = engines.elevenModel;
  const setModel = (m: Model) => saveEngines({ ...engines, elevenModel: m });
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const pb = parsePlayback(useSyncExternalStore(subscribePlayback, playbackSnapshot));
  const scenePaused = playing && pb.source === "scene" && pb.state === "paused";
  const [thinking, setThinking] = useState(false);
  const [review, setReview] = useState<DirectorResult | null>(null);
  const [sceneReview, setSceneReview] = useState<SceneDirection[] | null>(null);
  const [sceneThinking, setSceneThinking] = useState(false);
  const stop = useRef(false);
  if (!project) return <section><h1>Perform</h1><Empty title="Open a project first" action={<button className="primary" onClick={() => go("home")}>Open Projects</button>}>Create or open a project, then direct lines and generate takes here.</Empty></section>;

  const dict: Pronunciation[] = project.pronunciations ?? [];
  const charOf = (l: Line): Character | undefined => project.characters.find((c) => c.id === l.characterId);
  const voiceOf = (l: Line): VoiceEntry | undefined => library.find((v) => v.id === charOf(l)?.voiceId);
  const patchLine = (id: string, fn: (l: Line) => Line, key?: string) => edit((p) => ({ ...p, lines: p.lines.map((l) => (l.id === id ? fn(l) : l)) }), key);

  const spend = (lines: Line[]) => {
    const chars = lines.reduce((n, l) => n + (voiceOf(l) ? plan(l, voiceOf(l)!, model, dict, { inworldModel: engines.inworldModel }).text.length : 0), 0);
    return { chars, voices: [...new Set(lines.map((l) => voiceOf(l)?.name).filter(Boolean))].join(", ") };
  };

  const make = async (line: Line, count = 1): Promise<boolean> => {
    const voice = voiceOf(line);
    if (!voice) {
      toast("Choose a voice for this character on the Cast screen first.", true);
      return false;
    }
    const { chars } = spend([line]);
    const e = ENGINES[voice.provider];
    const pl = plan(line, voice, model, dict, { inworldModel: engines.inworldModel });
    const extra: string[] = voice.provider === "inworld" ? [`Character: ${charOf(line)?.name ?? "?"}`, `Model: ${pl.modelId}`, ...(pl.notSent ?? []).map((n) => `Not sent: ${n}`)] : !e.tags && vkUnsupported(effectiveLine(line)).length ? [`${e.label} cannot make: ${vkUnsupported(effectiveLine(line)).join(", ")}. Those will be left out.`] : [];
    if (!e.local) {
      const price = priceLines([{ kind: "speech", engine: voice.provider, chars: chars * count }]);
      const ok = await confirmSpend({ title: count > 1 ? `Make ${count} takes?` : "Make a take?", lines: [`${chars * count} characters (${count} take${count > 1 ? "s" : ""})`, `Voice: ${voice.name}`, ...extra, ...price.lines], warn: price.warn, skipKey: count > 1 ? undefined : "take" });
      if (!ok) return false;
    }
    try {
      for (let i = 0; i < count; i++) {
        const t = await makeTake(project.id, line, voice, model, dict, qualityFormat(engines.quality), { inworldModel: engines.inworldModel });
        patchLine(line.id, (l) => ({ ...l, takes: [...l.takes, t], chosen: t.id }), "~take");
        const sent = t.provenance?.chars ?? chars;
        addLedger({ kind: "speech", engine: e.label, chars: sent, items: [{ kind: "speech", engine: voice.provider, chars: sent }] });
      }
      return true;
    } catch (e2) {
      toast((e2 as Error).message, true);
      return false;
    }
  };

  const makeAll = async () => {
    const todo = project.lines.filter((l) => l.takes.length === 0 && voiceOf(l));
    if (todo.length === 0) return toast("Every line already has a take.");
    const paid = todo.filter((l) => !ENGINES[voiceOf(l)!.provider].local);
    if (paid.length > 0) {
      const s = spend(paid);
      const price = priceLines(paid.map((l) => ({ kind: "speech" as const, engine: voiceOf(l)!.provider, chars: plan(l, voiceOf(l)!, model, dict, { inworldModel: engines.inworldModel }).text.length })));
      const ok = await confirmSpend({ title: "Make all the missing takes?", lines: [`${paid.length} lines, ${s.chars} characters${paid.length < todo.length ? ` (${todo.length - paid.length} more run offline, free)` : ""}`, `Voices: ${s.voices}`, "One take per line. You can make more later.", ...price.lines], warn: price.warn });
      if (!ok) return;
    }
    stop.current = false;
    setRunning({ done: 0, total: todo.length });
    for (let i = 0; i < todo.length; i++) {
      if (stop.current) break;
      const line = todo[i]!;
      try {
        const v = voiceOf(line)!;
        const t = await makeTake(project.id, line, v, model, dict, qualityFormat(engines.quality), { inworldModel: engines.inworldModel });
        patchLine(line.id, (l) => ({ ...l, takes: [...l.takes, t], chosen: t.id }), "~take");
        const sent = t.provenance?.chars ?? 0;
        addLedger({ kind: "speech", engine: ENGINES[v.provider].label, chars: sent, items: [{ kind: "speech", engine: v.provider, chars: sent }] });
      } catch (e) {
        toast(`Stopped at line ${project.lines.indexOf(line) + 1}: ${(e as Error).message}`, true);
        break;
      }
      setRunning({ done: i + 1, total: todo.length });
    }
    setRunning(null);
  };

  const playAll = async () => {
    if (playing) {
      stopPlayback();
      return setPlaying(false);
    }
    const p = audioPlan(project);
    if (p.items.length === 0) return toast("Make at least one take first.", true);
    setPlaying(true);
    try {
      await previewScene(project, () => setPlaying(false));
    } catch (e) {
      toast((e as Error).message, true);
      setPlaying(false);
    }
  };

  const askDirector = async () => {
    const chars = userPrompt(project).length + systemPrompt().length;
    const local = engines.directorEngine === "local";
    const price = priceLines([{ kind: "director" }]);
    if (!local) {
      const ok = await confirmSpend({ title: "Ask the AI Director?", lines: [`Sends your script (${project.lines.length} lines, about ${chars} characters) to a Kie text model`, "It only suggests. You review everything before anything changes.", "Uses a small amount of Kie credit", ...price.lines], warn: price.warn });
      if (!ok) return;
    }
    setThinking(true);
    try {
      const reply = local ? await api.directorLocalComplete(systemPrompt(), userPrompt(project)) : await api.directorComplete(systemPrompt(), userPrompt(project));
      if (!local) addLedger({ kind: "director", engine: "Kie text model", chars, items: [{ kind: "director" }] });
      setReview(parseDirector(reply, project.lines.map((l) => l.id)));
    } catch (e) {
      toast((e as Error).message, true);
    }
    setThinking(false);
  };

  const askScene = async () => {
    const local = engines.directorEngine === "local";
    const sys = sceneDirectionSystem();
    const groups = sceneBatches(project.lines);
    const chars = groups.reduce((n, g) => n + userPrompt({ ...project, lines: g }).length + sys.length, 0);
    if (!local) {
      const price = priceLines(groups.map(() => ({ kind: "director" as const })));
      const ok = await confirmSpend({ title: "Direct the whole scene with AI?", lines: [`Sends your script (${project.lines.length} lines, about ${chars} characters in ${groups.length} request${groups.length === 1 ? "" : "s"}) to a Kie text model`, "It writes a full direction for every line. You review and edit them before anything changes.", "Uses a small amount of Kie credit", ...price.lines], warn: price.warn });
      if (!ok) return;
    }
    setSceneThinking(true);
    try {
      const found: SceneDirection[] = [];
      for (const g of groups) {
        const usr = userPrompt({ ...project, lines: g });
        const reply = local ? await api.directorLocalComplete(sys, usr) : await api.directorComplete(sys, usr);
        if (!local) addLedger({ kind: "director", engine: "Kie text model", chars: sys.length + usr.length, items: [{ kind: "director" }] });
        found.push(...parseSceneDirections(reply, g.map((l) => l.id)));
      }
      if (found.length === 0) throw new Error("The director did not write any directions. Try again.");
      setSceneReview(found);
    } catch (e) {
      toast((e as Error).message, true);
    }
    setSceneThinking(false);
  };

  if (project.lines.length === 0) {
    return (
      <section>
        <h1>Perform</h1>
        <Empty
          title="Nothing to direct yet"
          action={
            <button className="primary" onClick={() => go("write")}>
              Write the script
            </button>
          }
        >
          Add some lines first.
        </Empty>
      </section>
    );
  }

  const missing = project.lines.filter((l) => l.takes.length === 0).length;
  const noVoice = project.lines.filter((l) => !voiceOf(l)).length;

  return (
    <section>
      <div className="row between top">
        <div>
          <h1>Perform</h1>
          <p className="lede">Write how each line should be played, in your own words, then make takes and keep the best. Nothing is generated until you confirm.</p>
        </div>
        <div className="stack" style={{ minWidth: 220 }}>
          <label className="field">
            ElevenLabs model
            <select value={model} onChange={(e) => setModel(e.target.value as Model)}>
              <option value="eleven_v4">Eleven v4 (newest, best)</option>
              <option value="eleven_v3">Eleven v3</option>
            </select>
          </label>
          <button onClick={() => void askDirector()} disabled={thinking || !directorReady(engines, keys, localDirector)} title={directorReady(engines, keys, localDirector) ? "" : engines.directorEngine === "local" ? "Install the local Director in Model Center first" : "Add your Kie key in Settings first"}>
            <Sparkle size={16} /> {thinking ? "The director is reading…" : "Direct with AI"}
          </button>
          <button onClick={() => void askScene()} disabled={sceneThinking || !directorReady(engines, keys, localDirector)} title={directorReady(engines, keys, localDirector) ? "Writes a full direction for every line, following each character's feeling through the scene" : engines.directorEngine === "local" ? "Install the local Director in Model Center first" : "Add your Kie key in Settings first"}>
            <Sparkle size={16} /> {sceneThinking ? "Directing the scene…" : "Direct whole scene"}
          </button>
        </div>
      </div>
      {noVoice > 0 && (
        <Note kind="warn">
          {noVoice} line{noVoice === 1 ? " has" : "s have"} no voice yet.{" "}
          <button className="sm" onClick={() => go(library.length > 0 ? "cast" : "voices")}>
            {library.length > 0 ? "Auto-cast on the Cast screen" : "Find or make a voice"}
          </button>
        </Note>
      )}
      {project.scenes.map((title, si) => {
        const lines = project.lines.filter((l) => l.scene === si);
        if (lines.length === 0) return null;
        return (
          <div key={si} className="stack">
            <h3 className="scene-title">{title}</h3>
            {lines.map((line) => (
              <LineCard key={line.id} line={line} index={project.lines.indexOf(line) + 1} character={charOf(line)} voice={voiceOf(line)} model={model} dict={dict} patch={(fn) => patchLine(line.id, fn)} make={make} />
            ))}
          </div>
        );
      })}
      <div className="bar">
        {running ? (
          <>
            <div style={{ flex: 1 }}>
              <div className="progress" aria-hidden="true">
                <i style={{ width: `${(running.done / running.total) * 100}%` }} />
              </div>
              <span className="small muted" role="status">
                Making takes: {running.done} of {running.total}
              </span>
            </div>
            <button onClick={() => (stop.current = true)}>Stop after this one</button>
          </>
        ) : (
          <>
            <span className="muted">
              {project.lines.length - missing} of {project.lines.length} lines have takes
              {ledgerTotal(project.ledger) > 0 && <> · spent so far {money(ledgerTotal(project.ledger), engines.prices?.currency ?? "USD")}</>}
            </span>
            <span className="spacer" />
            {missing > 0 && (
              <button onClick={() => void makeAll()} disabled={noVoice > 0}>
                Make all {missing} missing take{missing === 1 ? "" : "s"}…
              </button>
            )}
            {playing && (
              <button onClick={() => (scenePaused ? resumePlayback() : pausePlayback())} aria-label={scenePaused ? "Resume the scene" : "Pause the scene"}>
                {scenePaused ? <Play size={14} /> : <Pause size={14} />} {scenePaused ? "Resume" : "Pause"}
              </button>
            )}
            <button className="primary" onClick={() => void playAll()} disabled={project.lines.length === missing}>
              {playing ? <Stop size={14} /> : <Play size={14} />} {playing ? "Stop" : "Play the scene"}
            </button>
            <button onClick={() => go("export")}>Export</button>
          </>
        )}
      </div>
      {review && <DirectorReview result={review} onClose={() => setReview(null)} />}
      {sceneReview && <SceneReview items={sceneReview} onClose={() => setSceneReview(null)} />}
    </section>
  );
}

function SceneReview({ items, onClose }: { items: SceneDirection[]; onClose: () => void }) {
  const { project, edit, toast } = useApp();
  const lineOf = (id: string) => project!.lines.find((l) => l.id === id)!;
  const [text, setText] = useState<Record<string, string>>(() => Object.fromEntries(items.map((i) => [i.id, i.direction])));
  const [keepMine, setKeepMine] = useState(true);
  const mine = (id: string) => !!(lineOf(id).direction.note ?? "").trim();
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.filter((i) => !mine(i.id)).map((i) => i.id)));
  const apply = () => {
    edit((p) => ({ ...p, lines: p.lines.map((l) => (picked.has(l.id) && cleanNote(text[l.id]) ? { ...l, direction: { ...l.direction, note: cleanNote(text[l.id]) } } : l)) }));
    toast(`Wrote direction for ${picked.size} line${picked.size === 1 ? "" : "s"}. Nothing was generated.`);
    onClose();
  };
  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="scene-t" style={{ width: "min(820px, 94vw)" }}>
        <h2 id="scene-t">The director&apos;s scene notes</h2>
        <p className="muted small">Edit anything you like, tick the lines you want, then press Apply. Nothing is spoken or paid for until you make a take.</p>
        <label className="row small" style={{ margin: "8px 0" }}>
          <input
            type="checkbox"
            checked={keepMine}
            onChange={(e) => {
              setKeepMine(e.target.checked);
              setPicked(new Set(items.filter((i) => !(e.target.checked && mine(i.id))).map((i) => i.id)));
            }}
          />
          Leave lines where I already wrote a direction alone
        </label>
        <div className="stack" style={{ maxHeight: "52vh", overflow: "auto" }}>
          {items.map((i) => {
            const l = lineOf(i.id);
            const who = project!.characters.find((c) => c.id === l.characterId)?.name ?? "?";
            return (
              <div key={i.id} className="take" style={{ alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  aria-label={`Use the direction for ${who}: ${l.text.slice(0, 30)}`}
                  checked={picked.has(i.id)}
                  onChange={(e) =>
                    setPicked((set) => {
                      const n = new Set(set);
                      if (e.target.checked) n.add(i.id);
                      else n.delete(i.id);
                      return n;
                    })
                  }
                  style={{ marginTop: 6 }}
                />
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                  <span>
                    <span className="speaker">{who}</span> <span className="muted small">{l.text.slice(0, 90)}</span>
                    {mine(i.id) && <span className="badge warn" style={{ marginLeft: 8 }}>already has a direction</span>}
                  </span>
                  <textarea rows={2} aria-label={`Direction for ${who}`} value={text[i.id] ?? ""} maxLength={300} onChange={(e) => setText((t) => ({ ...t, [i.id]: e.target.value }))} />
                </span>
              </div>
            );
          })}
        </div>
        <div className="row end" style={{ marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={picked.size === 0} onClick={apply}>
            Apply to {picked.size} line{picked.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

function DirectorReview({ result, onClose }: { result: DirectorResult; onClose: () => void }) {
  const { project, edit, toast } = useApp();
  const [keepMine, setKeepMine] = useState(true);
  const lineOf = (id: string) => project!.lines.find((l) => l.id === id)!;
  const defaults = (keep: boolean) => new Set(result.suggestions.filter((s) => !(keep && isDirected(lineOf(s.id).direction))).map((s) => s.id));
  const [picked, setPicked] = useState<Set<string>>(() => defaults(true));
  const [atmos, setAtmos] = useState(!!result.atmosphere && !project!.bed.prompt.trim());

  const apply = () => {
    edit((p) => ({
      ...p,
      lines: p.lines.map((l) => {
        const s = result.suggestions.find((x) => x.id === l.id);
        return s && picked.has(l.id) ? { ...l, direction: applySuggestion(l.direction, s) } : l;
      }),
      bed: atmos && result.atmosphere ? { ...p.bed, prompt: result.atmosphere } : p.bed,
    }));
    toast(`Applied to ${picked.size} line${picked.size === 1 ? "" : "s"}. Nothing was generated.`);
    onClose();
  };

  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dir-t" style={{ width: "min(720px, 94vw)" }}>
        <h2 id="dir-t">The director&apos;s suggestions</h2>
        <p className="muted small">Tick the lines you want. Nothing changes until you press Apply, and nothing is spoken or paid for yet.</p>
        <label className="row small" style={{ margin: "8px 0" }}>
          <input
            type="checkbox"
            checked={keepMine}
            onChange={(e) => {
              setKeepMine(e.target.checked);
              setPicked(defaults(e.target.checked));
            }}
          />
          Leave lines I have already directed alone
        </label>
        <div className="stack" style={{ maxHeight: "50vh", overflow: "auto" }}>
          {result.suggestions.map((s) => {
            const l = lineOf(s.id);
            const who = project!.characters.find((c) => c.id === l.characterId)?.name ?? "?";
            return (
              <label key={s.id} className="take" style={{ alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  checked={picked.has(s.id)}
                  onChange={(e) =>
                    setPicked((set) => {
                      const n = new Set(set);
                      if (e.target.checked) n.add(s.id);
                      else n.delete(s.id);
                      return n;
                    })
                  }
                  style={{ marginTop: 4 }}
                />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span className="speaker">{who}</span> <span className="muted small">{l.text.slice(0, 80)}</span>
                  <br />
                  <span className="small">{describe(s)}</span>
                  {isDirected(l.direction) && (
                    <span className="badge warn" style={{ marginLeft: 8 }}>
                      already directed
                    </span>
                  )}
                </span>
              </label>
            );
          })}
        </div>
        {result.atmosphere && (
          <label className="row small" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={atmos} onChange={(e) => setAtmos(e.target.checked)} />
            Use “{result.atmosphere}” as the atmosphere idea on the Export screen
          </label>
        )}
        <div className="row end" style={{ marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={picked.size === 0 && !atmos} onClick={apply}>
            Apply to {picked.size} line{picked.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}

const QUICK_SOUNDS = ["laughs", "sighs", "gasps", "coughs"];
const HIST_KEY = "greenroom.directions";
const loadHistory = (): string[] => {
  try {
    const v = JSON.parse(localStorage.getItem(HIST_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 8) : [];
  } catch {
    return [];
  }
};
const saveHistory = (h: string[]) => {
  try {
    localStorage.setItem(HIST_KEY, JSON.stringify(h));
  } catch {
    /* private mode or blocked storage: history just is not kept */
  }
};

function LineCard({ line, index, character, voice, model, dict, patch, make }: { line: Line; index: number; character?: Character; voice?: VoiceEntry; model: Model; dict: Pronunciation[]; patch: (fn: (l: Line) => Line) => void; make: (l: Line, n?: number) => Promise<boolean> }) {
  const { project, confirmSpend, toast, engines, priceLines, addLedger, library, edit, go: goTo, keys } = useApp();
  const localDirector = useLocalDirectorReady();
  const [writing, setWriting] = useState(false);
  const [recent, setRecent] = useState<string[]>(loadHistory);
  const [busy, setBusy] = useState(false);
  const [soundOpen, setSoundOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [editText, setEditText] = useState(false);
  const [revoice, setRevoice] = useState(false);
  const [snd, setSnd] = useState({ prompt: "", placement: "after" as "before" | "after", seconds: 2, loop: false, promptInfluence: 0.3 });
  const d = line.direction;
  const note = d.note ?? "";
  const noTags = !!voice && !ENGINES[voice.provider].tags && voice.provider !== "inworld";
  const planned = voice ? plan(line, voice, model, dict, { inworldModel: engines.inworldModel }) : null;
  const sent = planned ? planned.text : line.text;
  const chosen = chosenTake(line);
  const label = (list: { tag: string; label: string }[], t: string) => list.find((x) => x.tag === t)?.label ?? t;
  const setDir = (fn: (x: typeof d) => typeof d) => patch((l) => ({ ...l, direction: fn(l.direction) }));
  const chip = (t: string, on: boolean, text: string, click: () => void, title?: string) => (
    <button key={t} className="chip" aria-pressed={on} title={title} onClick={click}>
      {text}
    </button>
  );
  const fineNames = [d.emotion ? label(EMOTIONS, d.emotion) : "", ...d.sounds.filter((t) => !QUICK_SOUNDS.includes(t)).map((t) => label(ALL_SOUND_TAGS, t)), Math.abs(d.speed - 1) > 0.001 ? `${d.speed.toFixed(2)}×` : "", (d.gain ?? 0) !== 0 ? `${(d.gain ?? 0) > 0 ? "+" : ""}${(d.gain ?? 0).toFixed(1)} dB` : ""].filter(Boolean).slice(0, 3);

  // Written direction reaches every engine that can act on words; the line below says honestly which this voice is.
  const reach = !voice || !note.trim() ? null : ENGINES[voice.provider].tags ? "ok" : voice.provider === "voicekiller" ? "ok" : voice.provider === "inworld" ? ((planned?.steering?.length ?? 0) > 0 ? "ok" : "inworld-flash") : "none";

  const writeIt = async () => {
    const local = engines.directorEngine === "local";
    const sys = writeDirectionSystem();
    const usr = writeDirectionUser(character?.name ?? "?", line.text, note);
    if (!local) {
      const price = priceLines([{ kind: "director" }]);
      const ok = await confirmSpend({ title: "Write this direction with AI?", lines: [`Sends this one line and your idea (about ${sys.length + usr.length} characters) to a Kie text model`, "The result lands in the Direction box for you to edit. Nothing is spoken yet.", ...price.lines], warn: price.warn, skipKey: "write-direction" });
      if (!ok) return;
    }
    setWriting(true);
    try {
      const reply = local ? await api.directorLocalComplete(sys, usr) : await api.directorComplete(sys, usr);
      if (!local) addLedger({ kind: "director", engine: "Kie text model", chars: sys.length + usr.length, items: [{ kind: "director" }] });
      const out = cleanWritten(reply);
      if (!out) throw new Error("The director sent back nothing usable. Try again.");
      setDir((x) => ({ ...x, note: out }));
    } catch (e) {
      toast((e as Error).message, true);
    }
    setWriting(false);
  };

  const go = async (n: number) => {
    if (note.trim()) {
      const h = pushHistory(loadHistory(), note);
      saveHistory(h);
      setRecent(h);
    }
    setBusy(true);
    setMenuOpen(false);
    await make(line, n);
    setBusy(false);
  };

  const addSound = async () => {
    if (!project || !snd.prompt.trim()) return;
    const free = !!soundEngineOf(engines).free;
    const price = free ? { lines: [] as string[], warn: undefined } : priceLines([{ kind: "sound", count: 1 }]);
    if (!free) {
      const ok = await confirmSpend({ title: "Make a sound clip?", lines: [`"${snd.prompt.trim()}", about ${snd.seconds} seconds`, `Uses ${soundEngineOf(engines).label} credits`, ...price.lines], warn: price.warn, skipKey: "sound" });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const isEleven = soundEngineOf(engines).id === "elevenlabs";
      const options = isEleven ? { loop: snd.loop, promptInfluence: snd.promptInfluence, sfxModel: engines.elevenSfxModel ?? "eleven_text_to_sound_v3" } : {};
      const t = await makeSound(project.id, snd.prompt.trim(), snd.seconds, qualityFormat(engines.quality), soundEngineOf(engines).provider, options);
      if (!free) addLedger({ kind: "sound", engine: soundEngineOf(engines).ledger, chars: snd.prompt.trim().length, items: [{ kind: "sound", count: 1 }], note: snd.prompt.trim().slice(0, 60) });
      patch((l) => ({ ...l, events: [...l.events, { id: "e-" + uid(), prompt: snd.prompt.trim(), placement: snd.placement, seconds: snd.seconds, loop: snd.loop, promptInfluence: snd.promptInfluence, model: options.sfxModel, take: t }] }));
      setSnd({ ...snd, prompt: "" });
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
  };

  return (
    <div className="linecard">
      <div className="lc-head">
        <span className="muted num small">{index}</span>
        <Avatar seed={(voice?.id ?? character?.id ?? "x") + (voice?.name ?? character?.name ?? "")} gender={voice?.gender} size={30} />
        <span className="speaker">{character?.name ?? "?"}</span>
        {character && library.length > 0 && (
          <select
            className="voice-switch"
            aria-label={`Voice and engine for ${character.name}`}
            value={voice?.id ?? ""}
            onChange={(e) => {
              if (e.target.value === "__more") return goTo("voices");
              if (e.target.value) edit((p) => ({ ...p, characters: p.characters.map((c) => (c.id === character.id ? { ...c, voiceId: e.target.value } : c)) }));
            }}
          >
            {!voice && <option value="">Choose a voice…</option>}
            {ENGINE_ORDER.filter((en) => library.some((v) => v.provider === en)).map((en) => (
              <optgroup key={en} label={ENGINES[en].label}>
                {library.filter((v) => v.provider === en).map((v) => (
                  <option key={v.provider + v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </optgroup>
            ))}
            <option value="__more">More engines and voices…</option>
          </select>
        )}
        <span className="spacer" />
        <button className="sm ghost" aria-pressed={editText} onClick={() => setEditText(!editText)}>
          {editText ? "Done editing" : "Edit words"}
        </button>
      </div>

      {editText ? (
        <textarea aria-label={`Line ${index} text`} rows={2} value={line.text} onChange={(e) => patch((l) => ({ ...l, text: e.target.value }))} />
      ) : (
        <VisualLine label={`Line ${index}: click between words to add a sound`} text={line.text} onChange={(t) => patch((l) => ({ ...l, text: t }))} disabledNote={noTags ? `${ENGINES[voice!.provider].label} cannot make sounds. Pick an ElevenLabs voice, or add a sound clip below.` : undefined} />
      )}

      <div className="dir-box">
        <div className="dir-head">
          <label className="dir-label" htmlFor={`dir-${line.id}`}>
            Direction
          </label>
          {recent.length > 0 && (
            <select className="dir-recent" aria-label="Reuse a recent direction" value="" onChange={(e) => e.target.value && setDir((x) => ({ ...x, note: e.target.value }))}>
              <option value="">Recent…</option>
              {recent.map((r) => (
                <option key={r} value={r}>
                  {r.length > 60 ? r.slice(0, 57) + "…" : r}
                </option>
              ))}
            </select>
          )}
          <button className="sm ghost dir-ai" disabled={writing || !directorReady(engines, keys, localDirector)} onClick={() => void writeIt()} title={directorReady(engines, keys, localDirector) ? "Type a few words of an idea, then let the AI turn it into full direction" : engines.directorEngine === "local" ? "Install the local Director in Model Center first" : "Add your Kie key in Settings first"}>
            <Sparkle size={14} /> {writing ? "Writing…" : note.trim() ? "Expand with AI" : "Write it for me"}
          </button>
        </div>
        <textarea
          id={`dir-${line.id}`}
          className="dir-input"
          rows={2}
          maxLength={NOTE_MAX}
          placeholder="Tell the voice how to play it, in your own words. For example: quietly furious, holding back tears, a long beat before the last word."
          value={note}
          onChange={(e) => setDir((x) => ({ ...x, note: e.target.value }))}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter" && voice && !busy) void go(1);
          }}
        />
        <div className="dir-foot">
          <span className="chips dir-quick" role="group" aria-label="Quick styles">
            {STYLES.map((st) => chip(st.id, hasStyle(note, st), st.label, () => setDir((x) => ({ ...x, note: toggleStyle(x.note, st) })), st.sentence))}
            {QUICK_SOUNDS.map((t) => chip(t, d.sounds.includes(t), label(SOUNDS, t), () => setDir((x) => ({ ...x, sounds: toggleIn(x.sounds, t) }))))}
          </span>
          {note.length > 300 && <span className="muted small num">{note.length}/{NOTE_MAX}</span>}
        </div>
        {reach === "ok" && <p className="dir-reach ok small">{ENGINES[voice!.provider].label} will act on your direction.</p>}
        {reach === "none" && (
          <p className="dir-reach warn small">
            {ENGINES[voice!.provider].label} cannot act on written direction. Use Re-voice a recording to perform it yourself, or choose an ElevenLabs or VoiceKiller voice.
          </p>
        )}
        {reach === "inworld-flash" && <p className="dir-reach warn small">{engines.inworldModel === "inworld-tts-2-flash" ? "Inworld TTS 2 Flash does not follow written direction. Switch to Inworld TTS 2 in Voices, or choose another voice." : "Inworld could not use that direction."}</p>}
        {voice?.provider === "inworld" && (planned?.notSent?.length ?? 0) > 0 && <p className="dir-reach warn small">Inworld will not get: {planned!.notSent!.join("; ")}.</p>}
        {noTags && vkUnsupported(line).length > 0 && <p className="dir-reach warn small">{ENGINES[voice!.provider].label} cannot make {vkUnsupported(line).join(", ")}. Add a sound clip instead.</p>}
      </div>

      <details className="finetune">
        <summary>Fine-tune{fineNames.length > 0 ? ` · ${fineNames.join(", ")}` : ""}</summary>
        <div className="stack">
          <select
            aria-label="Start from a situation"
            value=""
            onChange={(e) => {
              const p = PRESETS.find((x) => x.id === e.target.value);
              if (p) patch((l) => ({ ...l, direction: applyPreset(l.direction, p) }));
            }}
          >
            <option value="">Start from a situation…</option>
            {PRESETS.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}
              </option>
            ))}
          </select>
          <span className="eyebrow">How it is said</span>
          <div className="chips" role="group" aria-label="How it is said">
            {EMOTIONS.map((e) => chip(e.tag, d.emotion === e.tag, e.label, () => setDir((x) => ({ ...x, emotion: x.emotion === e.tag ? "" : e.tag })), e.verified ? "Heard and approved" : "Not yet listened to"))}
          </div>
          <span className="eyebrow">Sounds in the line</span>
          <div className="chips" role="group" aria-label="Sounds in the line">
            {SOUNDS.map((s) => chip(s.tag, d.sounds.includes(s.tag), s.label, () => setDir((x) => ({ ...x, sounds: toggleIn(x.sounds, s.tag) })), noTags ? `${ENGINES[voice!.provider].label} cannot make this` : s.verified ? "Heard and approved" : "Not yet listened to"))}
          </div>
          <details className="more-sounds">
            <summary>More expressions{d.sounds.some((t) => MORE_SOUNDS.some((g) => g.sounds.some((x) => x.tag === t))) ? " (some chosen)" : ""}</summary>
            {MORE_SOUNDS.map((g) => (
              <div key={g.name} className="stack-s">
                <span className="eyebrow">{g.name}</span>
                <div className="chips" role="group" aria-label={g.name}>
                  {g.sounds.map((s) => chip(s.tag, d.sounds.includes(s.tag), s.label, () => setDir((x) => ({ ...x, sounds: toggleIn(x.sounds, s.tag) })), noTags ? `${ENGINES[voice!.provider].label} cannot make this` : "Not yet listened to. Works on ElevenLabs v3 and v4."))}
                </div>
              </div>
            ))}
          </details>
          <div className="row wrap">
            <label className="row small muted">
              Speed
              <input type="range" min={0.7} max={1.2} step={0.05} value={d.speed} aria-label="Speed" onChange={(e) => setDir((x) => ({ ...x, speed: Number(e.target.value) }))} />
              <span className="num">{d.speed.toFixed(2)}×</span>
            </label>
            <label className="row small muted">
              Level
              <input type="range" min={-18} max={9} step={0.5} value={d.gain ?? 0} aria-label="Level in dB" onChange={(e) => setDir((x) => ({ ...x, gain: Number(e.target.value) }))} onDoubleClick={() => setDir((x) => ({ ...x, gain: 0 }))} title="Double-click to reset" />
              <span className="num">{(d.gain ?? 0) > 0 ? "+" : ""}{(d.gain ?? 0).toFixed(1)} dB</span>
            </label>
            <label className="row small muted">
              Pause after
              <input type="range" min={0} max={3} step={0.1} value={d.pauseAfter} aria-label="Pause after" onChange={(e) => setDir((x) => ({ ...x, pauseAfter: Number(e.target.value) }))} />
              <span className="num">{d.pauseAfter.toFixed(1)}s</span>
            </label>
          </div>
          <p className="sent" aria-label="What is sent">
            Sent as: <b>{sent}</b>
          </p>
        </div>
      </details>

      {voice && (
        <DirectorPanel
          line={line}
          patch={patch}
          engineLabel={ENGINES[voice.provider].label}
          actsOnWords={ENGINES[voice.provider].tags || voice.provider === "voicekiller" || (voice.provider === "inworld" && steers(engines.inworldModel))}
        />
      )}

      {line.takes.map((t, i) => (
        <TakeRow key={t.id} t={t} n={i + 1} lineId={line.id} projectId={project!.id} chosen={t.id === chosen?.id} choose={() => patch((l) => ({ ...l, chosen: t.id }))} />
      ))}
      {line.events.map((e) => (
        <div key={e.id} className="take">
          <PlayButton label={e.prompt.slice(0, 22)} get={() => takeUrl(project!.id, e.take!.id)} disabled={!e.take} />
          <span className="badge">sound {e.placement === "before" ? "before" : "after"}</span>
          <span className="spacer" />
          <button className="sm icon ghost" aria-label={`Remove sound ${e.prompt}`} onClick={() => patch((l) => ({ ...l, events: l.events.filter((x) => x.id !== e.id) }))}>
            <Trash size={14} />
          </button>
        </div>
      ))}

      <div className="lc-actions">
        <button className="primary" disabled={busy || !voice} onClick={() => void go(1)} title={voice ? "Ctrl+Enter in the direction box does the same" : "Choose a voice for this character first"}>
          {busy ? "Working…" : line.takes.length ? "Another take" : "Make a take"}
        </button>
        <div className="more-wrap">
          <button className="ghost" aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
            More ▾
          </button>
          {menuOpen && (
            <div className="more-menu" role="menu" onMouseLeave={() => setMenuOpen(false)}>
              <button role="menuitem" disabled={busy || !voice} onClick={() => void go(3)}>
                Make 3 takes
              </button>
              <button
                role="menuitem"
                disabled={busy || !voice}
                onClick={() => {
                  setMenuOpen(false);
                  setRevoice(true);
                }}
                title="Perform the line yourself, then hear it in this character's voice"
              >
                Re-voice a recording
              </button>
              <button
                role="menuitem"
                onClick={() => {
                  setMenuOpen(false);
                  setSoundOpen(true);
                }}
              >
                Add a sound clip
              </button>
            </div>
          )}
        </div>
      </div>
      {revoice && voice && project && <ReVoiceDialog line={line} character={character} voice={voice} projectId={project.id} onClose={() => setRevoice(false)} onDone={(t) => patch((l) => ({ ...l, takes: [...l.takes, t], chosen: t.id }))} />}
      {soundOpen && (
        <div className="row wrap sound-form">
          <input type="text" aria-label="Describe the sound" placeholder="A man grunting as he lifts a heavy box" value={snd.prompt} onChange={(e) => setSnd({ ...snd, prompt: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
          <select aria-label="Where" value={snd.placement} onChange={(e) => setSnd({ ...snd, placement: e.target.value as "before" | "after" })}>
            <option value="after">after the line</option>
            <option value="before">before the line</option>
          </select>
          <select aria-label="Length" value={snd.seconds} onChange={(e) => setSnd({ ...snd, seconds: Number(e.target.value) })}>
            {[1, 2, 3, 5, 8].map((s) => (
              <option key={s} value={s}>
                {s}s
              </option>
            ))}
          </select>
          {soundEngineOf(engines).id === "elevenlabs" && (
            <label className="row small muted">
              <input type="checkbox" checked={snd.loop} onChange={(e) => setSnd({ ...snd, loop: e.target.checked })} /> Loop
            </label>
          )}
          <button className="sm primary" disabled={!snd.prompt.trim() || busy} onClick={() => void addSound()}>
            Make sound
          </button>
          <button className="sm ghost" onClick={() => setSoundOpen(false)}>
            Close
          </button>
        </div>
      )}
    </div>
  );
}

function TakeRow({ t, n, lineId, projectId, chosen, choose }: { t: Take; n: number; lineId: string; projectId: string; chosen: boolean; choose: () => void }) {
  const [info, setInfo] = useState(false);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className={chosen ? "take chosen" : "take"}>
        <PlayButton label={`Take ${n}`} get={() => takeUrl(projectId, t.id)} />
        <span className="muted small num">{t.seconds.toFixed(1)}s</span>
        <span className="badge">{modelLabel(t.model)}</span>
        <button className="sm ghost" aria-expanded={info} onClick={() => setInfo(!info)} title="Where this take came from">
          Details
        </button>
        <span className="spacer" />
        <label className="row small">
          <input type="radio" name={`use-${lineId}`} checked={chosen} onChange={choose} /> Use this one
        </label>
      </div>
      {info && (
        <div className="small muted" style={{ paddingLeft: 12 }}>
          <TakeFacts t={t} />
        </div>
      )}
    </div>
  );
}


function TakeFacts({ t }: { t: Take }) {
  const p = t.provenance;
  return (
    <div className="stack" style={{ gap: 2, marginTop: 4 }}>
      <span>
        Made {t.at.slice(0, 19).replace("T", " ")} with {p ? ENGINES[p.engine].label : "an engine"} ({modelLabel(t.model)}) using the voice {p?.voiceName ?? t.voiceId}.
      </span>
      {(p?.note || p?.emotion || (p?.sounds?.length ?? 0) > 0) && <span>Direction: {[p?.emotion, ...(p?.sounds ?? []), p?.note ? `“${p.note}”` : ""].filter(Boolean).join(" · ")}</span>}
      {p?.quality && <span>Audio quality asked for: {p.quality}.</span>}
      <span>
        Sent: <code>{t.sent}</code>
      </span>
      {p && (
        <span>
          {p.chars} characters, speed {p.speed.toFixed(2)}×, {p.pronunciations} pronunciation rule{p.pronunciations === 1 ? "" : "s"}. Fingerprint <code>{shortHash(p.sha256)}</code> (Greenroom {p.appVersion}).
        </span>
      )}
      {!p && <span>This take was made before Greenroom recorded where takes come from.</span>}
    </div>
  );
}
