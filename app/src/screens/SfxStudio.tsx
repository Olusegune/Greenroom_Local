import { useMemo, useState } from "react";
import { useApp } from "../ctx";
import { qualityFormat, soundEngineOf } from "../engines";
import { makeSound } from "../generate";
import { takeUrl } from "../media";
import { uid } from "../script";
import { Empty, PlayButton, useBusy } from "../ui";

const IDEAS = [
  ["Foley", "Heavy canvas bag placed on a wooden floor, close microphone"],
  ["Character", "A tired person grunts softly while lifting a heavy box"],
  ["Place", "Rain against a quiet apartment window at night, distant traffic"],
  ["Transition", "Short futuristic interface sweep, warm and optimistic"],
  ["Impact", "Wooden door closes with a soft latch in a quiet hallway"],
  ["World", "Busy Lagos street market ambience, voices distant, no music"],
] as const;

export default function SfxStudio() {
  const { project, engines, keys, confirmSpend, priceLines, addLedger, edit, go, toast } = useApp();
  const [prompt, setPrompt] = useState<string>(IDEAS[0][1]);
  const [lineId, setLineId] = useState("");
  const [placement, setPlacement] = useState<"before" | "after">("after");
  const [seconds, setSeconds] = useState(3);
  const [loop, setLoop] = useState(false);
  const [influence, setInfluence] = useState(0.3);
  const [last, setLast] = useState<{ id: string; prompt: string } | null>(null);
  const { busy, run } = useBusy();
  const engine = soundEngineOf(engines);
  const target = useMemo(() => project?.lines.find((line) => line.id === lineId) ?? project?.lines[0], [project, lineId]);
  const eleven = engine.id === "elevenlabs";

  if (!project) return <section className="sfx-page"><Empty title="Open a project to build a sound world" action={<button className="primary" onClick={() => go("home")}>Open a project</button>}>SFX Studio keeps each effect on the exact line where it belongs.</Empty></section>;

  const generate = async () => {
    if (!prompt.trim() || !target) return;
    const price = priceLines([{ kind: "sound", count: 1 }]);
    const model = engines.elevenSfxModel ?? "eleven_text_to_sound_v3";
    const ok = await confirmSpend({
      title: "Generate this sound effect?",
      lines: [
        `“${prompt.trim()}” · ${seconds} seconds${loop ? " · looped" : ""}`,
        eleven ? `ElevenLabs Sound Effects ${model.endsWith("v3") ? "v3" : "v2"}` : engine.label,
        target ? `Placed ${placement} ${target.characterId ? "the selected script line" : "a script line"}` : "",
        ...price.lines,
      ].filter(Boolean),
      warn: price.warn,
      skipKey: "sound",
    });
    if (!ok) return;
    await run(async () => {
      try {
        const options = eleven ? { loop, promptInfluence: influence, sfxModel: model } : {};
        const take = await makeSound(project.id, prompt.trim(), seconds, qualityFormat(engines.quality), engine.provider, options);
        const event = { id: "e-" + uid(), prompt: prompt.trim(), placement, seconds, loop, promptInfluence: influence, model: options.sfxModel, take };
        edit((p) => ({ ...p, lines: p.lines.map((line) => line.id === target.id ? { ...line, events: [...line.events, event] } : line) }), "~sfx");
        addLedger({ kind: "sound", engine: engine.ledger, chars: prompt.trim().length, items: [{ kind: "sound", count: 1 }], note: prompt.trim().slice(0, 60) });
        setLast({ id: take.id, prompt: prompt.trim() });
        toast("Sound effect added to the timeline.");
      } catch (error) { toast((error as Error).message, true); }
    });
  };

  return <section className="sfx-page">
    <header className="sfx-hero">
      <div><span className="eyebrow">SOUND DESIGN, PLACED</span><h1>SFX Studio</h1><p className="lede">Turn a direction into a usable effect, audition it, then place it beside the exact line in your script.</p></div>
      <div className="sfx-orbit" aria-hidden="true"><i /><i /><i /><i /><span>SFX</span></div>
    </header>
    <div className="sfx-engine-line"><span className="status-dot" /> <strong>{engine.label}</strong><span className="muted small">{eleven ? `Sound Effects ${engines.elevenSfxModel === "eleven_text_to_sound_v2" ? "v2 fallback" : "v3"}` : "Selected in Engines"}</span>{!keys[engine.key] && <button className="sm" onClick={() => go("settings")}>Add key</button>}</div>
    <div className="sfx-layout">
      <div className="sfx-console card">
        <div className="sfx-console-head"><div><span className="eyebrow">CREATE</span><h2>Describe the moment</h2></div>{last && <PlayButton label={`Play ${last.prompt}`} get={() => takeUrl(project.id, last.id)} />}</div>
        <textarea aria-label="Sound effect description" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Describe a sound, the material, distance and mood…" />
        <div className="sfx-templates" aria-label="Sound starting points">{IDEAS.map(([title, idea]) => <button key={title} className={prompt === idea ? "on" : ""} onClick={() => setPrompt(idea)}><b>{title}</b><span>{idea}</span></button>)}</div>
        <div className="sfx-controls">
          <label className="field">Place on line<select value={target?.id ?? ""} onChange={(e) => setLineId(e.target.value)}>{project.lines.map((line, index) => <option key={line.id} value={line.id}>Line {index + 1}: {line.text.slice(0, 42)}{line.text.length > 42 ? "…" : ""}</option>)}</select></label>
          <label className="field">Timing<select value={placement} onChange={(e) => setPlacement(e.target.value as "before" | "after")}><option value="after">After dialogue</option><option value="before">Before dialogue</option></select></label>
          <label className="field">Duration<select value={seconds} onChange={(e) => setSeconds(Number(e.target.value))}>{[1, 2, 3, 5, 8, 15, 30].map((s) => <option key={s} value={s}>{s} seconds</option>)}</select></label>
        </div>
        {eleven && <div className="sfx-advanced"><label className="row small"><input type="checkbox" checked={loop} onChange={(e) => setLoop(e.target.checked)} /> Seamless loop</label><label className="influence">Prompt influence <input type="range" min={0} max={1} step={0.05} value={influence} onChange={(e) => setInfluence(Number(e.target.value))} /><span>{Math.round(influence * 100)}%</span></label></div>}
        <div className="sfx-submit"><div className="muted small">{eleven ? "v3 follows your direction more closely at higher influence." : "Switch to ElevenLabs in Engines to use v3 controls."}</div><button className="primary" disabled={!prompt.trim() || !target || busy || !keys[engine.key]} onClick={() => void generate()}>{busy ? "Generating…" : "Generate & place"}</button></div>
      </div>
      <aside className="sfx-side"><div className="card sfx-story"><span className="eyebrow">THE DIRECTOR'S EAR</span><h2>Make the invisible felt</h2><p>For believable foley, name the object, material, distance, pace and emotional energy. “Heavy canvas bag, close mic” is more useful than “bag sound.”</p><div className="sfx-quote">“A shaky breath after carrying something too heavy.”</div></div><div className="card sfx-tip"><strong>Saved with your project</strong><p className="muted small">The prompt, duration, model and placement remain attached to the line for future edits and export.</p></div></aside>
    </div>
  </section>;
}
