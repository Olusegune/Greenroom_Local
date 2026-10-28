import { useEffect, useRef, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, inApp } from "../api";
import { fromBase64 } from "../audio";
import { ALL_ACCENTS, SAMPLE_TEXT, average, describe, emptySheet, groupKey, groups, letter, parseSheet, reportCsv, reportMd, runSize, type Gender, type Sheet, type SheetSample } from "../accents";
import { useApp } from "../ctx";
import { uid } from "../script";
import type { VoiceEntry } from "../types";
import { APP_VERSION } from "../version";
import { Note, PlayButton, useBusy } from "../ui";

type AddVoice = (v: Omit<VoiceEntry, "notes" | "createdAt"> & Partial<Pick<VoiceEntry, "notes">>) => void;

const urls = new Map<string, string>();
async function sampleUrl(id: string): Promise<string> {
  const have = urls.get(id);
  if (have) return have;
  const a = await api.sheetAudioRead(id);
  const url = URL.createObjectURL(new Blob([fromBase64(a.audioB64) as BlobPart], { type: a.mime }));
  urls.set(id, url);
  return url;
}

function Scale({ label, value, onChange }: { label: string; value?: number; onChange: (v: number | undefined) => void }) {
  return (
    <span className="row small" role="group" aria-label={label}>
      <span className="muted" style={{ minWidth: 64 }}>
        {label}
      </span>
      <span className="rate">
        {[1, 2, 3, 4, 5].map((n) => (
          <button key={n} aria-pressed={value === n} aria-label={`${label} ${n} of 5`} onClick={() => onChange(value === n ? undefined : n)}>
            {n}
          </button>
        ))}
      </span>
    </span>
  );
}

/** One run of samples for every accent with the same description and passage, then A/B rating that is saved and exportable. */
export default function AccentSheet({ add }: { add: AddVoice }) {
  const { keys, confirmSpend, priceLines, addLedger, toast } = useApp();
  const { busy, run } = useBusy();
  const [sheet, setSheet] = useState<Sheet>(emptySheet());
  const ref = useRef<Sheet>(sheet);
  const [loaded, setLoaded] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(ALL_ACCENTS.map((a) => a.label)));
  const [gender, setGender] = useState<Gender>("female");
  const [progress, setProgress] = useState("");
  const [sure, setSure] = useState(false);
  const [saved, setSaved] = useState<string[]>([]);
  const stop = useRef(false);

  useEffect(() => {
    void api
      .sheetLoad()
      .then((j) => {
        const s = parseSheet(j);
        ref.current = s;
        setSheet(s);
      })
      .catch(() => undefined)
      .finally(() => setLoaded(true));
  }, []);

  const commit = (next: Sheet) => {
    ref.current = next;
    setSheet(next);
    api.sheetSave(JSON.stringify(next)).catch((e: Error) => toast(e.message, true));
  };
  const patch = (id: string, p: Partial<SheetSample>) => commit({ ...ref.current, samples: ref.current.samples.map((s) => (s.id === id ? { ...s, ...p } : s)) });

  const chosen = ALL_ACCENTS.filter((a) => picked.has(a.label));
  const size = runSize(chosen.length);

  const make = async () => {
    const price = priceLines([{ kind: "design", count: size.previews }]);
    const ok = await confirmSpend({
      title: "Make the accent samples?",
      lines: [`${chosen.length} accents, ${size.previews} previews in all (${size.previews / chosen.length} per accent), ${gender} voice, the same passage for each`, "Uses ElevenLabs voice-design credits for every preview. This one confirmation covers the whole run, which takes a few minutes.", ...price.lines],
      warn: price.warn,
    });
    if (!ok) return;
    stop.current = false;
    await run(async () => {
      let done = 0;
      for (const a of chosen) {
        if (stop.current) break;
        setProgress(`Designing ${a.label} (${done + 1} of ${chosen.length})…`);
        try {
          const desc = describe(a, gender);
          const previews = await api.voiceDesign(desc, SAMPLE_TEXT);
          addLedger({ kind: "design", engine: "ElevenLabs voice design", chars: desc.length, items: [{ kind: "design", count: previews.length }], note: `accent sheet: ${a.label}` });
          const made: SheetSample[] = [];
          for (const p of previews) {
            const id = "as-" + uid();
            await api.sheetAudioWrite(id, p.audioB64);
            made.push({ id, accent: a.label, gender, description: desc, generatedVoiceId: p.generatedVoiceId, seconds: p.seconds, createdAt: new Date().toISOString() });
          }
          commit({ ...ref.current, samples: [...ref.current.samples, ...made] });
          done++;
        } catch (e) {
          toast(`${a.label}: ${(e as Error).message} The earlier accents are saved.`, true);
          break;
        }
      }
      setProgress("");
      if (done > 0) toast(`Made samples for ${done} accent${done === 1 ? "" : "s"}. Listen and rate them below.`);
    });
  };

  const keep = async (s: SheetSample, i: number) => {
    try {
      const name = `${s.accent} ${s.gender} ${letter(i)}`;
      const id = await api.voiceDesignSave(s.generatedVoiceId, name, s.description);
      add({ id, name, provider: "elevenlabs", source: "designed", language: "", accent: s.accent, gender: s.gender, notes: s.description.slice(0, 160), consent: { speaker: "No real person: designed from a description", basis: "designed", reference: s.description.slice(0, 120), date: new Date().toISOString().slice(0, 10) } });
      patch(s.id, { savedAs: id });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  const exportAll = () =>
    run(async () => {
      try {
        const stamp = new Date().toISOString().slice(0, 16).replace("T", " ");
        const day = stamp.slice(0, 10);
        const md = await api.sheetExport(`Accent listening sheet ${day}.md`, reportMd(ref.current, stamp, APP_VERSION));
        const csv = await api.sheetExport(`Accent listening sheet ${day}.csv`, reportCsv(ref.current));
        setSaved([md, csv]);
        toast("Saved the report and the table.");
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  const reveal = async (p: string) => {
    if (!inApp()) return;
    try {
      await revealItemInDir(p);
    } catch {
      toast("Could not open the folder.", true);
    }
  };

  const gs = groups(sheet);
  const rated = sheet.samples.filter((s) => s.accentScore || s.naturalScore).length;

  return (
    <>
      <p className="muted">Hear every accent side by side. Greenroom designs the same kind of voice for each accent, speaking the same passage, so the only thing that changes is the accent. You rate them; nothing is claimed for you.</p>
      {!keys.elevenlabs && <Note kind="warn">Add your ElevenLabs key in Settings first.</Note>}

      <div className="card stack">
        <h2>Make the samples</h2>
        <div className="chips" role="group" aria-label="Accents to include">
          {ALL_ACCENTS.map((a) => (
            <button key={a.label} className="chip" aria-pressed={picked.has(a.label)} onClick={() => setPicked((p) => (p.has(a.label) ? new Set([...p].filter((x) => x !== a.label)) : new Set([...p, a.label])))}>
              {a.label}
            </button>
          ))}
        </div>
        <div className="row wrap">
          <label className="field">
            Voice
            <select value={gender} onChange={(e) => setGender(e.target.value as Gender)}>
              <option value="female">Woman in her forties</option>
              <option value="male">Man in his forties</option>
            </select>
          </label>
          <span className="spacer" />
          <span className="muted small">
            {chosen.length} accents × 3 = {size.previews} previews
          </span>
          {busy && progress ? (
            <button onClick={() => (stop.current = true)}>Stop after this accent</button>
          ) : null}
          <button className="primary" disabled={chosen.length === 0 || busy || !keys.elevenlabs} onClick={() => void make()}>
            {busy && progress ? progress : "Make the samples"}
          </button>
        </div>
        <details>
          <summary className="muted small">What is said, and what each voice is told</summary>
          <p className="small">“{SAMPLE_TEXT}”</p>
          <p className="muted small">Each voice is described as: {describe(ALL_ACCENTS[0]!, gender)} The other accents change only the last phrase. The last entry asks for no accent, as a control to compare against.</p>
        </details>
      </div>

      {loaded && gs.length === 0 && <p className="muted">No samples yet. Choose the accents above and make them; they are kept on this computer so you can rate them later.</p>}

      {gs.map((g) => {
        const best = sheet.best[g.key];
        const a = average(g.samples.map((s) => s.accentScore));
        const n = average(g.samples.map((s) => s.naturalScore));
        return (
          <div key={g.key} className="card stack">
            <div className="row between wrap">
              <h2>
                {g.accent} <span className="muted small">· {g.gender}</span>
              </h2>
              <span className="row small">
                {a !== null && <span className="badge accent">accent {a.toFixed(1)}</span>}
                {n !== null && <span className="badge">natural {n.toFixed(1)}</span>}
              </span>
            </div>
            {g.samples.map((s, i) => (
              <div key={s.id} className={best === s.id ? "sample lit" : "sample"}>
                <div className="row wrap">
                  <strong style={{ width: 20 }}>{letter(i)}</strong>
                  <PlayButton label="Hear it" get={() => sampleUrl(s.id)} />
                  <Scale label="Accent" value={s.accentScore} onChange={(v) => patch(s.id, { accentScore: v })} />
                  <Scale label="Natural" value={s.naturalScore} onChange={(v) => patch(s.id, { naturalScore: v })} />
                </div>
                <div className="row wrap">
                  <input type="text" aria-label={`Note for ${g.accent} ${letter(i)}`} placeholder="Note: what you hear" value={s.note ?? ""} maxLength={500} onChange={(e) => patch(s.id, { note: e.target.value })} style={{ flex: 1, minWidth: 200 }} />
                  <button className="chip" aria-pressed={best === s.id} onClick={() => commit({ ...ref.current, best: best === s.id ? Object.fromEntries(Object.entries(ref.current.best).filter(([k]) => k !== g.key)) : { ...ref.current.best, [groupKey(g.accent, g.gender)]: s.id } })}>
                    {best === s.id ? "Preferred" : "Prefer this one"}
                  </button>
                  <button className="sm" disabled={!!s.savedAs || busy} onClick={() => void keep(s, i)} title="Needs an ElevenLabs plan that allows saving voices">
                    {s.savedAs ? "Kept as a voice" : "Keep as a voice"}
                  </button>
                </div>
              </div>
            ))}
          </div>
        );
      })}

      {gs.length > 0 && (
        <div className="card stack">
          <h2>Save your ratings</h2>
          <p className="muted small">
            {rated} of {sheet.samples.length} samples rated. The report is a Markdown summary and the table is a CSV for a spreadsheet. Both are saved in Documents\Greenroom\accent-sheet\reports, and your ratings are kept automatically.
          </p>
          <div className="row wrap">
            <button className="primary" onClick={() => void exportAll()} disabled={busy}>
              Save report and table
            </button>
            {saved.map((p) => (
              <button key={p} className="sm" onClick={() => void reveal(p)}>
                Show {p.split(/[\\/]/).pop()}
              </button>
            ))}
            <span className="spacer" />
            {sure ? (
              <button className="sm danger" onClick={() => (commit(emptySheet()), setSure(false))}>
                Really clear the sheet
              </button>
            ) : (
              <button className="sm ghost" onClick={() => setSure(true)}>
                Clear the sheet
              </button>
            )}
          </div>
        </div>
      )}
    </>
  );
}
