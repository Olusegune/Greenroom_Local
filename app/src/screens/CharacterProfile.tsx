import { useState } from "react";
import { ACTING_PRESETS } from "../acting";
import { CAPS, engineLabel, suggestEngines } from "../engineCaps";
import { ENGINES, ENGINE_ORDER } from "../engines";
import { useApp } from "../ctx";
import type { Character, VoiceEntry } from "../types";
import { emptyProfile, profileCompatibility, touch, type ProfileExtra } from "../characterProfile";
import { duplicateCharacter, exportProfile, importProfile } from "../profileIO";
import { APP_VERSION } from "../version";
import { uid } from "../script";
import { emptyDna, identityWarning, migrateDna, removeReference, setIdentity, type VoiceDna } from "../voiceDna";

const parsePron = (t: string) =>
  t
    .split("\n")
    .map((l) => l.split("="))
    .map(([a, b]) => ({ from: (a ?? "").trim(), to: (b ?? "").trim() }))
    .filter((p) => p.from && p.to);

/**
 * A character's recurring profile (their Voice DNA). It travels with a saved cast, so a series keeps it from project to
 * project. It records what the owner approved and gives starting points; it cannot make a different engine sound the same.
 */
export function CharacterProfile({ character, voice, save }: { character: Character; voice?: VoiceEntry; save: (dna: VoiceDna) => void }) {
  const { engines, library, keys, edit, toast } = useApp();
  const dna = migrateDna(character.dna) ?? emptyDna();
  const [pron, setPron] = useState(() => dna.pronunciations.map((p) => `${p.from} = ${p.to}`).join("\n"));
  const set = (patch: Partial<VoiceDna>) => save({ ...dna, ...patch });
  const nowIso = () => new Date().toISOString();
  const extra = dna.profile ?? emptyProfile(nowIso(), APP_VERSION);
  const [sig, setSig] = useState(() => extra.signature.join("\n"));
  const setExtra = (patch: Partial<ProfileExtra>) => set({ profile: touch({ ...extra, ...patch }, nowIso(), APP_VERSION) });
  const compat = profileCompatibility(extra, dna);
  const exportIt = () => {
    const url = URL.createObjectURL(new Blob([exportProfile(character, voice, nowIso())], { type: "application/json" }));
    const a = document.createElement("a"); a.href = url; a.download = character.name.replace(/[^\w-]+/g, "_") + ".character.json"; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const importIt = async (f: File | undefined) => {
    if (!f) return;
    const r = importProfile(await f.text(), nowIso(), APP_VERSION);
    if (!r.ok) return toast(r.error, true);
    // Into this character: its voice and its approved identity stay as they are; nothing about rights comes in.
    save({ ...r.dna, identity: dna.identity, references: dna.references });
    setSig(r.dna.profile?.signature.join("\n") ?? "");
    toast(["Profile imported into " + character.name + ".", ...r.warnings].join(" "));
  };
  const duplicateIt = () => {
    const copy = duplicateCharacter(character, uid(), nowIso(), APP_VERSION);
    edit((p) => ({ ...p, characters: [...p.characters, copy] }));
    toast(copy.name + " added. It has no lines yet.");
  };
  const modelId = voice?.provider === "inworld" ? engines.inworldModel ?? "inworld-tts-2" : null;
  const warn = identityWarning(dna, voice, modelId);
  const ready = ENGINE_ORDER.filter((e) => (e === "elevenlabs" ? keys.elevenlabs : e === "voicekiller" ? keys.voicekiller : e === "inworld" ? keys.inworld : e === "kie" ? keys.kie : library.some((v) => v.provider === e)));
  const okWords = suggestEngines({ words: true }, ready, engines.inworldModel).filter((s) => s.ok).map((s) => engineLabel(s.engine));
  const filled = [dna.timbre, dna.tendencies, dna.range, dna.accent].filter(Boolean).length + dna.references.length + (dna.identity ? 1 : 0);

  return (
    <details className="finetune char-profile">
      <summary>Character profile{filled ? ` · ${filled} set` : ""}</summary>
      <div className="stack">
        <p className="muted small">What stays true about {character.name} across lines, episodes and projects. It is saved with a saved cast. It records what you approved and gives starting points; another engine can still sound like a different person.</p>
        {warn && <p className="dir-reach warn small" role="alert">{warn}</p>}
        <div className="row wrap">
          <label className="field" style={{ flex: 1, minWidth: 200 }}>
            Timbre
            <input type="text" value={dna.timbre} maxLength={200} placeholder="gravelly, warm, slightly nasal" onChange={(e) => set({ timbre: e.target.value })} />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            Accent
            <input type="text" value={dna.accent} maxLength={80} placeholder="Educated British" onChange={(e) => set({ accent: e.target.value })} />
          </label>
        </div>
        <label className="field">
          Performance tendencies
          <input type="text" value={dna.tendencies} maxLength={400} placeholder="speaks quietly, trails off, never rushes" onChange={(e) => set({ tendencies: e.target.value })} />
        </label>
        <label className="field">
          Emotional range
          <input type="text" value={dna.range} maxLength={300} placeholder="guarded; rarely shouts; softens around children" onChange={(e) => set({ range: e.target.value })} />
        </label>
        <span className="eyebrow">Acting presets that suit them</span>
        <div className="chips" role="group" aria-label="Preferred acting presets">
          {ACTING_PRESETS.map((p) => (
            <button key={p.id} className="chip" aria-pressed={dna.presets.includes(p.id)} title={p.blurb} onClick={() => set({ presets: dna.presets.includes(p.id) ? dna.presets.filter((x) => x !== p.id) : [...dna.presets, p.id] })}>
              {p.label}
            </button>
          ))}
        </div>
        <span className="eyebrow">About {character.name}</span>
        <label className="field">
          Background
          <textarea rows={2} maxLength={600} value={extra.background} placeholder="Who they are, where they come from, what they want" onChange={(e) => setExtra({ background: e.target.value })} />
        </label>
        <div className="row wrap">
          <label className="field">Age range
            <select value={extra.ageRange ?? ""} onChange={(e) => setExtra({ ageRange: (e.target.value || undefined) as ProfileExtra["ageRange"] })}>
              <option value="">Not stated</option>
              {["child", "teen", "young_adult", "adult", "middle_aged", "older_adult", "elderly", "ageless"].map((a) => <option key={a} value={a}>{a.replace("_", " ")}</option>)}
            </select>
          </label>
          <label className="field">Presentation
            <select value={extra.presentation ?? ""} onChange={(e) => setExtra({ presentation: (e.target.value || undefined) as ProfileExtra["presentation"] })}>
              <option value="">Not stated</option><option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Nonbinary</option>
            </select>
          </label>
          <label className="field">Pitch
            <select value={extra.pitch ?? ""} onChange={(e) => setExtra({ pitch: (e.target.value || undefined) as ProfileExtra["pitch"] })}>
              <option value="">Not stated</option><option value="low">Low</option><option value="mid">Mid</option><option value="high">High</option>
            </select>
          </label>
          <label className="field" style={{ flex: 1, minWidth: 140 }}>Voice texture
            <input type="text" maxLength={160} value={extra.texture} placeholder="smooth, dry" onChange={(e) => setExtra({ texture: e.target.value })} />
          </label>
        </div>
        <label className="field">
          Signature vocal behaviours (one per line)
          <textarea rows={2} value={sig} onChange={(e) => setSig(e.target.value)} onBlur={() => setExtra({ signature: sig.split("\n").map((s) => s.trim()).filter(Boolean).slice(0, 8) })} placeholder="a dry cough before bad news" />
        </label>
        <label className="field">
          Audition script
          <input type="text" maxLength={300} value={extra.audition} placeholder="A line that shows who they are" onChange={(e) => setExtra({ audition: e.target.value })} />
        </label>
        <label className="field">
          Rights and consent note
          <input type="text" maxLength={400} value={extra.consentNote} placeholder="Voice designed from text; no real person" onChange={(e) => setExtra({ consentNote: e.target.value })} />
          <span className="muted small">A note for you. It is not a consent record: consent for a cloned voice is recorded on the voice.</span>
        </label>
        <p className="muted small">
          Engines that can perform this profile: {compat.engines.map(engineLabel).join(", ") || "none"}. This is what each engine accepts, not how it sounds.
          {extra.provenance.source === "preset" && extra.provenance.presetId ? ` Began from the preset “${extra.provenance.presetId}” (version ${extra.provenance.presetVersion ?? "?"}).` : extra.provenance.source === "import" ? " Imported from a file." : ""}
          {extra.provenance.revision > 0 ? ` Revision ${extra.provenance.revision}.` : ""}
        </p>
        <div className="row wrap">
          <button className="sm" onClick={exportIt}>Export profile</button>
          <label className="sm ghost file-btn">Import profile<input type="file" accept="application/json,.json" hidden onChange={(e) => { void importIt(e.target.files?.[0]); e.target.value = ""; }} /></label>
          <button className="sm ghost" onClick={duplicateIt}>Duplicate character</button>
        </div>

        <label className="field">
          Pronunciations only for {character.name} (one per line: written = spoken)
          <textarea rows={2} value={pron} onChange={(e) => setPron(e.target.value)} onBlur={() => set({ pronunciations: parsePron(pron) })} placeholder="Nguyen = Win" />
        </label>

        <span className="eyebrow">Approved voice</span>
        <div className="row wrap">
          {dna.identity ? (
            <span className="small">
              {dna.identity.voiceName} on {ENGINES[dna.identity.engine].label}
              {dna.identity.modelId ? ` (${dna.identity.modelId})` : ""}
            </span>
          ) : (
            <span className="muted small">Not approved yet.</span>
          )}
          <button className="sm" disabled={!voice} onClick={() => voice && set(setIdentity(dna, voice, modelId))}>
            {dna.identity ? "Approve the current voice instead" : "Approve the current voice for this character"}
          </button>
        </div>
        {voice?.consent && <p className="muted small">Consent on record: {voice.consent.speaker} ({voice.consent.basis}, {voice.consent.date}).</p>}
        {voice && <p className="muted small">{engineLabel(voice.provider)}: {CAPS[voice.provider].note} Engines you have that follow written direction: {okWords.join(", ") || "none"}.</p>}

        <span className="eyebrow">Acting references</span>
        {dna.references.length === 0 && <p className="muted small">None yet. On Perform, choose a take you approve and press Use as acting reference.</p>}
        {dna.references.map((r) => (
          <div key={r.takeId} className="row between wrap small">
            <span>
              “{r.text.slice(0, 60)}” · {r.stats.wordsPerSecond ? `${r.stats.wordsPerSecond} words/s` : "pace unknown"} · {r.stats.pausesMs.length} pause{r.stats.pausesMs.length === 1 ? "" : "s"} · {r.stats.levelDb.toFixed(0)} dB{r.stats.pitchHz ? ` · pitch about ${r.stats.pitchHz} Hz` : ""}
            </span>
            <button className="sm ghost" onClick={() => set(removeReference(dna, r.takeId))}>
              Remove
            </button>
          </div>
        ))}
      </div>
    </details>
  );
}
