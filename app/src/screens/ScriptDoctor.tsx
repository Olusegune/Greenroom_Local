import { useMemo, useState } from "react";
import { useApp } from "../ctx";
import { diagnose, type Finding } from "../scriptDoctor";
import { foleyPlan, type FoleyIdea } from "../foley";
import { qualityFormat, soundEngineOf } from "../engines";
import { makeSound } from "../generate";
import { uid } from "../script";

const KIND: Record<Finding["kind"], string> = { breath: "Breath", pronunciation: "Pronunciation", emphasis: "Emphasis", rhythm: "Rhythm" };

/**
 * Suggestions about how the script will be spoken. Nothing changes until you press Apply on one suggestion, and the
 * original wording is shown beside any rewrite. It cannot say how a name is pronounced: it asks you.
 */
export function ScriptDoctor({ onClose, inworld }: { onClose: () => void; inworld: (lineId: string) => boolean }) {
  const { project, edit, toast, engines, confirmSpend, priceLines, addLedger } = useApp();
  const result = useMemo(() => diagnose(project!.lines, project!.pronunciations ?? []), [project]);
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [spoken, setSpoken] = useState<Record<string, string>>({});
  const items = result.findings.filter((f) => !skipped.has(f.id));
  const ideas = useMemo(() => foleyPlan(project!.script, project!.lines), [project]);
  const [made, setMade] = useState<Set<string>>(new Set());
  const [working, setWorking] = useState("");

  // One sound clip from a stage direction. It is a normal sound clip: confirmed first, paid for like any other, kept as a take.
  const makeIdea = async (i: FoleyIdea) => {
    const eng = soundEngineOf(engines);
    const free = !!eng.free;
    const price = free ? { lines: [] as string[], warn: undefined } : priceLines([{ kind: "sound", count: 1 }]);
    if (!free) {
      const ok = await confirmSpend({ title: "Make a sound clip?", lines: [`"${i.prompt}", about ${i.seconds} seconds`, `From the stage direction: ${i.source}`, `Uses ${eng.label} credits`, ...price.lines], warn: price.warn });
      if (!ok) return;
    }
    setWorking(i.id);
    try {
      const isEleven = eng.id === "elevenlabs";
      const options = isEleven ? { loop: false, promptInfluence: 0.3, sfxModel: engines.elevenSfxModel ?? "eleven_text_to_sound_v3" } : {};
      const t = await makeSound(project!.id, i.prompt, i.seconds, qualityFormat(engines.quality), eng.provider, options);
      if (!free) addLedger({ kind: "sound", engine: eng.ledger, chars: i.prompt.length, items: [{ kind: "sound", count: 1 }], note: i.prompt.slice(0, 60) });
      edit((p) => ({ ...p, lines: p.lines.map((l) => (l.id === i.lineId ? { ...l, events: [...l.events, { id: "e-" + uid(), prompt: i.prompt, placement: i.placement, seconds: i.seconds, ...options, take: t }] } : l)) }));
      setMade((s) => new Set(s).add(i.id));
      toast("Added the sound to that line.");
    } catch (e) {
      toast((e as Error).message, true);
    }
    setWorking("");
  };
  const lineOf = (id: string) => project!.lines.find((l) => l.id === id);
  const who = (id: string) => project!.characters.find((c) => c.id === lineOf(id)?.characterId)?.name ?? "";
  const skip = (id: string) => setSkipped((s) => new Set(s).add(id));

  const applyRewrite = (f: Finding) => {
    if (!f.rewrite) return;
    edit((p) => ({ ...p, lines: p.lines.map((l) => (l.id === f.lineId ? { ...l, text: f.rewrite! } : l)) }));
    toast("Changed that line. Undo brings it back.");
  };
  const addRule = (f: Finding) => {
    const to = (spoken[f.id] ?? "").trim();
    if (!to || !f.word) return;
    edit((p) => ({ ...p, pronunciations: [...(p.pronunciations ?? []), { from: f.word!, to }] }));
    toast(`Added: ${f.word} is spoken as "${to}". The script text is unchanged.`);
  };

  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="doc-t" style={{ width: "min(840px, 94vw)" }}>
        <h2 id="doc-t">Script Doctor</h2>
        <p className="muted small">
          {result.rhythm.sentences} sentences, about {result.rhythm.averageWords} words each (shortest {result.rhythm.shortest}, longest {result.rhythm.longest}). These are suggestions: your script changes only when you press Apply.
        </p>
        <div className="stack" style={{ maxHeight: "56vh", overflow: "auto" }}>
          {items.length === 0 && <p className="muted">Nothing to suggest. The script reads well for a voice.</p>}
          {items.map((f) => {
            const l = lineOf(f.lineId);
            return (
              <div key={f.id} className="take" style={{ alignItems: "flex-start" }}>
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                  <span>
                    <span className="badge">{KIND[f.kind]}</span> {l && <span className="speaker">{who(l.id)}</span>} {l && <span className="muted small">{l.text.slice(0, 80)}</span>}
                  </span>
                  <span className="small">{f.message}</span>
                  {f.rewrite && l && (
                    <span className="small muted">
                      Now: {l.text}
                      <br />
                      Suggested: <b>{f.rewrite}</b>
                    </span>
                  )}
                  {f.kind === "pronunciation" && (
                    <span className="row wrap">
                      <input type="text" aria-label={`How ${f.word} is spoken`} placeholder="how it is spoken, e.g. Win" value={spoken[f.id] ?? ""} onChange={(e) => setSpoken((s) => ({ ...s, [f.id]: e.target.value }))} style={{ minWidth: 220 }} />
                      <button className="sm" disabled={!(spoken[f.id] ?? "").trim()} onClick={() => addRule(f)}>
                        Add pronunciation
                      </button>
                    </span>
                  )}
                  <span className="row">
                    {f.rewrite && (
                      <button className="sm" disabled={f.kind === "emphasis" && !inworld(f.lineId)} title={f.kind === "emphasis" && !inworld(f.lineId) ? "Only offered for Inworld voices" : ""} onClick={() => applyRewrite(f)}>
                        Apply
                      </button>
                    )}
                    <button className="sm ghost" onClick={() => skip(f.id)}>
                      Dismiss
                    </button>
                  </span>
                </span>
              </div>
            );
          })}
        </div>
        <h3 style={{ marginTop: 16 }}>Sound ideas from your stage directions</h3>
        <p className="muted small">Read from the lines in your script that are not spoken. Each is only a suggestion: nothing is made until you press the button and confirm the cost.</p>
        <div className="stack" style={{ maxHeight: "26vh", overflow: "auto" }}>
          {ideas.length === 0 && <p className="muted small">No sound cues found. Stage directions such as "(The door slams.)" on their own line, after a blank line, are read for sounds.</p>}
          {ideas.map((i) => {
            const l = lineOf(i.lineId);
            return (
              <div key={i.id} className="take" style={{ alignItems: "flex-start" }}>
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 4 }}>
                  <span className="small"><b>{i.prompt}</b> · about {i.seconds} s · {i.placement} {l ? `${who(l.id)}: “${l.text.slice(0, 40)}”` : "a line"}</span>
                  <span className="muted small">From: {i.source}</span>
                </span>
                <button className="sm" disabled={working !== "" || made.has(i.id)} onClick={() => void makeIdea(i)}>
                  {made.has(i.id) ? "Added" : working === i.id ? "Making…" : "Make this sound"}
                </button>
              </div>
            );
          })}
        </div>
        <div className="row end" style={{ marginTop: 16 }}>
          <button className="primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
