import { useRef, useState } from "react";
import { useApp } from "../ctx";
import { applySuggestion, describe, isDirected, parseDirector, systemPrompt, userPrompt, type DirectorResult } from "../director";
import { applyPreset, chosenTake, EMOTIONS, PRESETS, SOUNDS, toggleIn, vkUnsupported } from "../direct";
import { VisualLine } from "../VisualLine";
import { api } from "../api";
import { Avatar } from "../avatar";
import { ENGINES, ENGINE_ORDER, qualityFormat, soundEngineOf } from "../engines";
import { makeSound, makeTake, modelLabel, plan, type Model } from "../generate";
import { Plus, Play, Sparkle, Stop, Trash } from "../icons";
import { stopPlayback, takeUrl } from "../media";
import { audioPlan, previewScene } from "../preview";
import { uid } from "../script";
import type { Character, Line, Pronunciation, VoiceEntry } from "../types";
import { Empty, Note, PlayButton } from "../ui";
import { shortHash } from "../trust";
import type { Take } from "../types";

export default function Perform() {
  const { project, edit, library, confirmSpend, toast, go, engines, saveEngines, keys, priceLines, addLedger } = useApp();
  const model: Model = engines.elevenModel;
  const setModel = (m: Model) => saveEngines({ ...engines, elevenModel: m });
  const [running, setRunning] = useState<{ done: number; total: number } | null>(null);
  const [playing, setPlaying] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [review, setReview] = useState<DirectorResult | null>(null);
  const stop = useRef(false);
  if (!project) return null;

  const dict: Pronunciation[] = project.pronunciations ?? [];
  const charOf = (l: Line): Character | undefined => project.characters.find((c) => c.id === l.characterId);
  const voiceOf = (l: Line): VoiceEntry | undefined => library.find((v) => v.id === charOf(l)?.voiceId);
  const patchLine = (id: string, fn: (l: Line) => Line, key?: string) => edit((p) => ({ ...p, lines: p.lines.map((l) => (l.id === id ? fn(l) : l)) }), key);

  const spend = (lines: Line[]) => {
    const chars = lines.reduce((n, l) => n + (voiceOf(l) ? plan(l, voiceOf(l)!, model, dict).text.length : 0), 0);
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
    const extra: string[] = !e.tags && vkUnsupported(line).length ? [`${e.label} cannot make: ${vkUnsupported(line).join(", ")}. Those will be left out.`] : [];
    if (!e.local) {
      const price = priceLines([{ kind: "speech", engine: voice.provider, chars: chars * count }]);
      const ok = await confirmSpend({ title: count > 1 ? `Make ${count} takes?` : "Make a take?", lines: [`${chars * count} characters (${count} take${count > 1 ? "s" : ""})`, `Voice: ${voice.name}`, ...extra, ...price.lines], warn: price.warn, skipKey: count > 1 ? undefined : "take" });
      if (!ok) return false;
    }
    try {
      for (let i = 0; i < count; i++) {
        const t = await makeTake(project.id, line, voice, model, dict, qualityFormat(engines.quality));
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
      const price = priceLines(paid.map((l) => ({ kind: "speech" as const, engine: voiceOf(l)!.provider, chars: plan(l, voiceOf(l)!, model, dict).text.length })));
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
        const t = await makeTake(project.id, line, v, model, dict, qualityFormat(engines.quality));
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
    const price = priceLines([{ kind: "director" }]);
    const ok = await confirmSpend({ title: "Ask the AI Director?", lines: [`Sends your script (${project.lines.length} lines, about ${chars} characters) to a Kie text model`, "It only suggests. You review everything before anything changes.", "Uses a small amount of Kie credit", ...price.lines], warn: price.warn });
    if (!ok) return;
    setThinking(true);
    try {
      const reply = await api.directorComplete(systemPrompt(), userPrompt(project));
      addLedger({ kind: "director", engine: "Kie text model", chars, items: [{ kind: "director" }] });
      setReview(parseDirector(reply, project.lines.map((l) => l.id)));
    } catch (e) {
      toast((e as Error).message, true);
    }
    setThinking(false);
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
          <p className="lede">Direct each line: pick a style or write a note, add sounds like laughs, grunts or coughs, then make takes and choose the best. Nothing is generated until you confirm.</p>
        </div>
        <div className="stack" style={{ minWidth: 220 }}>
          <label className="field">
            ElevenLabs model
            <select value={model} onChange={(e) => setModel(e.target.value as Model)}>
              <option value="eleven_v4">Eleven v4 (newest, best)</option>
              <option value="eleven_v3">Eleven v3</option>
            </select>
          </label>
          <button onClick={() => void askDirector()} disabled={thinking || !keys.kie} title={keys.kie ? "" : "Add your Kie key in Settings first"}>
            <Sparkle size={16} /> {thinking ? "The director is reading…" : "Direct with AI"}
          </button>
        </div>
      </div>
      {noVoice > 0 && (
        <Note kind="warn">
          {noVoice} line{noVoice === 1 ? " has" : "s have"} no voice yet.{" "}
          <button className="sm" onClick={() => go("cast")}>
            Go to Cast
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
            </span>
            <span className="spacer" />
            <button onClick={() => void makeAll()} disabled={missing === 0 || noVoice > 0}>
              Make all {missing} missing takes…
            </button>
            <button className="primary" onClick={() => void playAll()} disabled={project.lines.length === missing}>
              {playing ? <Stop size={14} /> : <Play size={14} />} {playing ? "Stop" : "Play the scene"}
            </button>
            <button onClick={() => go("export")}>Export</button>
          </>
        )}
      </div>
      {review && <DirectorReview result={review} onClose={() => setReview(null)} />}
    </section>
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

function LineCard({ line, index, character, voice, model, dict, patch, make }: { line: Line; index: number; character?: Character; voice?: VoiceEntry; model: Model; dict: Pronunciation[]; patch: (fn: (l: Line) => Line) => void; make: (l: Line, n?: number) => Promise<boolean> }) {
  const { project, confirmSpend, toast, engines, priceLines, addLedger, library, edit, go: goTo } = useApp();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [editText, setEditText] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);
  const [snd, setSnd] = useState({ prompt: "", placement: "after" as "before" | "after", seconds: 2, loop: false, promptInfluence: 0.3 });
  const d = line.direction;
  const noTags = !!voice && !ENGINES[voice.provider].tags;
  const ignoresNote = !!voice && !ENGINES[voice.provider].tags && voice.provider !== "voicekiller";
  const sent = voice ? plan(line, voice, model, dict).text : line.text;
  const chosen = chosenTake(line);
  const summary = [d.emotion ? (EMOTIONS.find((e) => e.tag === d.emotion)?.label ?? d.emotion) : "", ...d.sounds.map((t) => SOUNDS.find((x) => x.tag === t)?.label ?? t), (d.note ?? "").trim() ? "note" : "", Math.abs(d.speed - 1) > 0.001 ? `${d.speed.toFixed(2)}×` : ""].filter(Boolean);

  const go = async (n: number) => {
    setBusy(true);
    await make(line, n);
    setBusy(false);
  };

  const addSound = async () => {
    if (!project || !snd.prompt.trim()) return;
    const price = priceLines([{ kind: "sound", count: 1 }]);
    const ok = await confirmSpend({ title: "Make a sound clip?", lines: [`"${snd.prompt.trim()}", about ${snd.seconds} seconds`, `Uses ${soundEngineOf(engines).label} credits`, ...price.lines], warn: price.warn, skipKey: "sound" });
    if (!ok) return;
    setBusy(true);
    try {
      const isEleven = soundEngineOf(engines).id === "elevenlabs";
      const options = isEleven ? { loop: snd.loop, promptInfluence: snd.promptInfluence, sfxModel: engines.elevenSfxModel ?? "eleven_text_to_sound_v3" } : {};
      const t = await makeSound(project.id, snd.prompt.trim(), snd.seconds, qualityFormat(engines.quality), soundEngineOf(engines).provider, options);
      addLedger({ kind: "sound", engine: soundEngineOf(engines).ledger, chars: snd.prompt.trim().length, items: [{ kind: "sound", count: 1 }], note: snd.prompt.trim().slice(0, 60) });
      patch((l) => ({ ...l, events: [...l.events, { id: "e-" + uid(), prompt: snd.prompt.trim(), placement: snd.placement, seconds: snd.seconds, loop: snd.loop, promptInfluence: snd.promptInfluence, model: options.sfxModel, take: t }] }));
      setSnd({ ...snd, prompt: "" });
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
  };

  return (
    <div className="linecard">
      <div className="row between">
        <span>
          <span className="muted num small">{index}</span> <Avatar seed={(voice?.id ?? character?.id ?? "x") + (voice?.name ?? character?.name ?? "")} gender={voice?.gender} size={30} /> <span className="speaker">{character?.name ?? "?"}</span>
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
        </span>
        {chosen ? <span className="badge ok">{line.takes.length} take{line.takes.length === 1 ? "" : "s"}</span> : <span className="badge">no take yet</span>}
      </div>
      {editText ? (
        <textarea aria-label={`Line ${index} text`} rows={2} value={line.text} onChange={(e) => patch((l) => ({ ...l, text: e.target.value }))} />
      ) : (
        <VisualLine label={`Line ${index}: click between words to add a sound`} text={line.text} onChange={(t) => patch((l) => ({ ...l, text: t }))} disabledNote={noTags ? `${ENGINES[voice!.provider].label} cannot make sounds. Pick an ElevenLabs voice, or add a sound clip below.` : undefined} />
      )}
      <div className="row wrap linetools">
        <button className="sm" aria-pressed={editText} onClick={() => setEditText(!editText)}>
          {editText ? "Back to the visual editor" : "Edit text"}
        </button>
        <button className="sm" aria-expanded={dirOpen} onClick={() => setDirOpen(!dirOpen)}>
          {dirOpen ? "Hide direction" : "Direct this line"}
        </button>
        {!dirOpen && summary.map((x) => (
          <span key={x} className="badge accent">
            {x}
          </span>
        ))}
      </div>
      {dirOpen && (
        <div className="direction stack">
          <div className="row wrap">
        <select
          aria-label="Style preset"
          value=""
          onChange={(e) => {
            const p = PRESETS.find((x) => x.id === e.target.value);
            if (p) patch((l) => ({ ...l, direction: applyPreset(l.direction, p) }));
          }}
        >
          <option value="">Style preset…</option>
          {PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <input type="text" aria-label={`Director's note for line ${index}`} placeholder="Director's note: how to say it, in plain words" value={d.note ?? ""} onChange={(e) => patch((l) => ({ ...l, direction: { ...l.direction, note: e.target.value } }))} style={{ flex: 1, minWidth: 220 }} />
                </div>
          <h3>How it is said</h3>
      <div className="chips" role="group" aria-label="How it is said">
        {EMOTIONS.map((e) => (
          <button key={e.tag} className="chip" aria-pressed={d.emotion === e.tag} title={e.verified ? "Heard and approved" : "Not yet listened to"} onClick={() => patch((l) => ({ ...l, direction: { ...l.direction, emotion: l.direction.emotion === e.tag ? "" : e.tag } }))}>
            {e.label}
          </button>
        ))}
        {d.emotion && !EMOTIONS.some((e) => e.tag === d.emotion) && (
          <button className="chip" aria-pressed="true" onClick={() => patch((l) => ({ ...l, direction: { ...l.direction, emotion: "" } }))}>
            {d.emotion}
          </button>
        )}
      </div>
          <h3>Sounds in the line</h3>
      <div className="chips" role="group" aria-label="Sounds in the line">
        {SOUNDS.map((s) => (
          <button key={s.tag} className="chip" aria-pressed={d.sounds.includes(s.tag)} title={noTags ? `${ENGINES[voice!.provider].label} cannot make this` : s.verified ? "Heard and approved" : "Not yet listened to"} onClick={() => patch((l) => ({ ...l, direction: { ...l.direction, sounds: toggleIn(l.direction.sounds, s.tag) } }))}>
            {s.label}
          </button>
        ))}
      </div>
      {noTags && vkUnsupported(line).length > 0 && <Note kind="warn">{ENGINES[voice!.provider].label} cannot make {vkUnsupported(line).join(", ")}. Pick an ElevenLabs voice, or add a sound clip below.</Note>}
      {ignoresNote && (d.note ?? "").trim() && <p className="muted small">{ENGINES[voice!.provider].label} ignores the director&apos;s note. ElevenLabs and VoiceKiller use it.</p>}
      <div className="row wrap">
        <label className="row small muted">
          Speed
          <input type="range" min={0.7} max={1.2} step={0.05} value={d.speed} aria-label="Speed" onChange={(e) => patch((l) => ({ ...l, direction: { ...l.direction, speed: Number(e.target.value) } }))} />
          <span className="num">{d.speed.toFixed(2)}×</span>
        </label>
        <label className="row small muted">
          Level
          <input type="range" min={-18} max={9} step={0.5} value={d.gain ?? 0} aria-label="Level in dB" onChange={(e) => patch((l) => ({ ...l, direction: { ...l.direction, gain: Number(e.target.value) } }))} onDoubleClick={() => patch((l) => ({ ...l, direction: { ...l.direction, gain: 0 } }))} title="Double-click to reset" />
          <span className="num">{(d.gain ?? 0) > 0 ? "+" : ""}{(d.gain ?? 0).toFixed(1)} dB</span>
        </label>
        <label className="row small muted">
          Pause after
          <input type="range" min={0} max={3} step={0.1} value={d.pauseAfter} aria-label="Pause after" onChange={(e) => patch((l) => ({ ...l, direction: { ...l.direction, pauseAfter: Number(e.target.value) } }))} />
          <span className="num">{d.pauseAfter.toFixed(1)}s</span>
        </label>
      </div>
      <p className="sent" aria-label="What is sent">
        Sent as: <b>{sent}</b>
      </p>
        </div>
      )}
      {line.takes.map((t, i) => (
        <div key={t.id} className="stack" style={{ gap: 4 }}>
        <div className={t.id === chosen?.id ? "take chosen" : "take"}>
          <PlayButton label={`Take ${i + 1}`} get={() => takeUrl(project!.id, t.id)} />
          <span className="muted small num">{t.seconds.toFixed(1)}s</span>
          <span className="badge">{modelLabel(t.model)}</span>
          <span className="spacer" />
          <label className="row small">
            <input type="radio" name={`use-${line.id}`} checked={t.id === chosen?.id} onChange={() => patch((l) => ({ ...l, chosen: t.id }))} /> Use this one
          </label>
        </div>
        <details className="small muted" style={{ paddingLeft: 12 }}>
          <summary>Where this take came from</summary>
          <TakeFacts t={t} />
        </details>
        </div>
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
      {!voice && (
        <div className="voice-needed" role="group" aria-label="Choose a voice for this line">
          <span>
            <strong>{character?.name ?? "This character"}</strong> needs a voice before you can make a take.
          </span>
          {library.length > 0 && character ? (
            <select
              aria-label={`Voice for ${character.name}`}
              value=""
              onChange={(e) => e.target.value && edit((p) => ({ ...p, characters: p.characters.map((c) => (c.id === character.id ? { ...c, voiceId: e.target.value } : c)) }))}
            >
              <option value="">Choose a voice…</option>
              {library.map((v) => (
                <option key={v.provider + v.id} value={v.id}>
                  {v.name} · {ENGINES[v.provider].label}
                </option>
              ))}
            </select>
          ) : (
            <button className="sm primary" onClick={() => goTo("voices")}>
              Find or make a voice
            </button>
          )}
        </div>
      )}
      <div className="row wrap">
        <button className="primary sm" disabled={busy || !voice} onClick={() => void go(1)}>
          {busy ? "Working…" : line.takes.length ? "Another take" : "Make a take"}
        </button>
        <button className="sm" disabled={busy || !voice} onClick={() => void go(3)}>
          Make 3 takes
        </button>
        <button className="sm ghost" onClick={() => setOpen(!open)} aria-expanded={open}>
          <Plus size={14} /> Sound clip (sneeze, door, heavy lift…)
        </button>
      </div>
      {open && (
        <div className="row wrap">
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
          {soundEngineOf(engines).id === "elevenlabs" && <label className="row small muted"><input type="checkbox" checked={snd.loop} onChange={(e) => setSnd({ ...snd, loop: e.target.checked })} /> Loop</label>}
          <button className="sm primary" disabled={!snd.prompt.trim() || busy} onClick={() => void addSound()}>
            Make sound
          </button>
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
