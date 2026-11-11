import { useEffect, useRef, useState } from "react";
import type { DesignPreview } from "../api";
import { DESIGN_ACCENTS } from "../accents";
import { fromBase64 } from "../audio";
import { useApp } from "../ctx";
import type { Character, Line } from "../types";
import { Note, useBusy } from "../ui";
import { AGES, buildDescription, NO_CHOICES, sampleFrom, TYPES, type BriefChoices } from "../voiceBrief";
import { defaultEngine, designFailure, keepPreview, makePreviews, type DesignEngine } from "../voiceDesigner";
import DesignEnginePicker, { useQwenReady } from "./DesignEnginePicker";

const VAULT = "greenroom-designed-voice-vault";

/** Designs a voice for one character, right from the script screen, with ElevenLabs (credits) or Qwen3-TTS on this PC (free).
 *  The result is saved to the library and given to the character. Cloud previews use credits, so it asks first. */
export default function DesignCharacterVoice({ character, lines, onClose, onUse }: { character: Character; lines: Line[]; onClose: () => void; onUse: (voiceId: string) => void }) {
  const { keys, confirmSpend, priceLines, addLedger, saveLibrary, toast } = useApp();
  const { busy, run } = useBusy();
  const qwenReady = useQwenReady();
  const [engine, setEngine] = useState<DesignEngine>(() => defaultEngine(keys.elevenlabs));
  const [problem, setProblem] = useState<{ text: string; offerLocal: boolean } | null>(null);
  const brief = lines.map((l) => ({ text: l.text, emotion: l.direction.emotion, note: l.direction.note }));
  const [choices, setChoices] = useState<BriefChoices>(NO_CHOICES);
  const [desc, setDesc] = useState(() => buildDescription(character.name, brief));
  const [touched, setTouched] = useState(false);
  const [sample, setSample] = useState(() => sampleFrom(brief));
  const [previews, setPreviews] = useState<{ p: DesignPreview; url: string; name: string; engine: DesignEngine }[]>([]);
  const urls = useRef<string[]>([]);
  useEffect(() => () => urls.current.forEach((u) => URL.revokeObjectURL(u)), []);
  const set = (next: Partial<BriefChoices>) => {
    const c = { ...choices, ...next };
    setChoices(c);
    if (!touched) setDesc(buildDescription(character.name, brief, c));
  };
  const ok = desc.trim().length >= 20 && desc.length <= 1000;
  const available = engine === "qwen" ? qwenReady === true : keys.elevenlabs;
  const switchTo = (e: DesignEngine) => { setEngine(e); setProblem(null); };

  const make = async () => {
    setProblem(null);
    if (engine === "elevenlabs") {
      const price = priceLines([{ kind: "design", count: 3 }]);
      const go_ = await confirmSpend({ title: `Design a voice for ${character.name}?`, lines: ["Makes up to 3 preview voices from your description", "Uses ElevenLabs credits for each preview. Saving a voice to your account needs a plan that allows it.", ...price.lines], warn: price.warn });
      if (!go_) return;
    }
    await run(async () => {
      try {
        const out = await makePreviews(engine, desc, sample);
        if (engine === "elevenlabs") addLedger({ kind: "design", engine: "ElevenLabs voice design", chars: desc.length, items: [{ kind: "design", count: out.length }] });
        const made = out.map(({ p, mime }, i) => { const url = URL.createObjectURL(new Blob([fromBase64(p.audioB64) as BlobPart], { type: mime })); urls.current.push(url); return { p, url, name: `${character.name} (designed ${i + 1})`, engine }; });
        setPreviews(made);
        // Cloud previews are kept on this computer, as in Voices, Design a voice, even if the voice is never saved.
        if (engine === "elevenlabs") try { const old = JSON.parse(localStorage.getItem(VAULT) ?? "[]"); localStorage.setItem(VAULT, JSON.stringify([...old, ...made.map((x) => ({ id: x.p.generatedVoiceId, name: x.name, description: desc, audioB64: x.p.audioB64, createdAt: new Date().toISOString() }))].slice(-24))); } catch { /* vault is a convenience */ }
      } catch (e) { setProblem(designFailure(engine, (e as Error).message, "make")); }
    });
  };

  const use = async (i: number) => {
    const it = previews[i]!;
    setProblem(null);
    try {
      const accent = DESIGN_ACCENTS.find((a) => a.label === choices.accent)?.label ?? "";
      const entry = await keepPreview(it.engine, it.p.generatedVoiceId, it.name, desc, accent);
      saveLibrary((l) => (l.some((x) => x.id === entry.id && x.provider === entry.provider) ? l : [...l, entry]));
      onUse(entry.id);
      toast(`${it.name} saved to your library and given to ${character.name}.`);
      onClose();
    } catch (e) { setProblem(designFailure(it.engine, (e as Error).message, "keep")); }
  };

  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="dcv-t" style={{ maxWidth: 640, width: "92vw", maxHeight: "90vh", overflow: "auto" }}>
        <div className="row between">
          <h2 id="dcv-t">Design a voice for {character.name}</h2>
          <button className="sm ghost" aria-label="Close" title="Close (Esc)" onClick={onClose}>✕</button>
        </div>
        <p className="muted small">Started from what your script says about {character.name} ({lines.length} line{lines.length === 1 ? "" : "s"}). Edit anything. The voice you keep goes into your library for future projects.</p>
        <DesignEnginePicker engine={engine} onChange={switchTo} qwenReady={qwenReady} onClose={onClose} />
        {problem && (
          <Note kind="err">
            {problem.text}
            <span className="row wrap" style={{ marginTop: 8 }}>
              {problem.offerLocal && engine === "elevenlabs" && <button className="sm primary" onClick={() => switchTo("qwen")}>Design it on this PC instead</button>}
              <button className="sm ghost" onClick={() => setProblem(null)}>Dismiss</button>
            </span>
          </Note>
        )}
        <div className="row wrap">
          <label className="field">Age<select value={choices.age} onChange={(e) => set({ age: e.target.value })}>{AGES.map((a) => <option key={a} value={a}>{a || "Not specified"}</option>)}</select></label>
          <label className="field">Voice<select value={choices.type} onChange={(e) => set({ type: e.target.value })}>{TYPES.map((t) => <option key={t} value={t}>{t || "Not specified"}</option>)}</select></label>
          <label className="field" style={{ flex: 1, minWidth: 180 }}>Accent<select value={choices.accent} onChange={(e) => set({ accent: e.target.value })}><option value="">No particular accent</option>{DESIGN_ACCENTS.map((a) => <option key={a.label} value={a.label}>{a.label}</option>)}</select></label>
        </div>
        <label className="field">Anything else (optional)<input type="text" maxLength={200} value={choices.extra} onChange={(e) => set({ extra: e.target.value })} placeholder="slightly husky, in her sixties, a smile in the voice" /></label>
        <label className="field">Description sent to the designer (20 to 1000 characters)
          <textarea rows={4} value={desc} onChange={(e) => { setDesc(e.target.value); setTouched(true); }} />
        </label>
        {sample && <label className="field">It will say (your lines, optional)<textarea rows={2} value={sample} onChange={(e) => setSample(e.target.value)} /></label>}
        <div className="row wrap">
          <button className="primary" disabled={!ok || busy || !available} onClick={() => void make()}>{busy ? "Designing…" : "Make 3 previews"}</button>
          <button onClick={onClose}>Close</button>
        </div>
        {previews.map((it, i) => (
          <div key={it.p.generatedVoiceId} className="card row wrap lit">
            <audio controls src={it.url} />
            <input type="text" aria-label={`Name for preview ${i + 1}`} value={it.name} onChange={(e) => setPreviews(previews.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ flex: 1, minWidth: 160 }} />
            <button className="primary" onClick={() => void use(i)}>Use for {character.name}</button>
            <span className="small muted">{it.engine === "qwen" ? "Made on this PC" : "ElevenLabs"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
