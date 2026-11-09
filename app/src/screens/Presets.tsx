import { useMemo, useState } from "react";
import { AGE_LABEL, type Age } from "../avatarLibrary";
import { useApp } from "../ctx";
import { engineLabel } from "../engineCaps";
import type { Engine } from "../engines";
import { ACCENT_QUALITY, ACCENT_QUALITY_LABEL, compatibleEngines, duplicatePreset, exportPresets, filterPresets, GENRE_LABEL, GENRES, importPresets, readiness, STARTER_PRESETS, type AccentQuality, type Gender, type Genre, type VoicePreset } from "../presets";
import { applyPreset, readyEnginesFrom, voicesFor } from "../presets/cast";
import { addCustom, loadState, markRecent, removeCustom, saveState, toggleFavorite, type PresetState } from "../presets/state";
import { Empty, Note, PlayButton } from "../ui";
import { useSample } from "../useSample";
import type { VoiceEntry } from "../types";

const MAX_COMPARE = 3;
const store = (): Storage | null => { try { return window.localStorage; } catch { return null; } };

export default function Presets() {
  const { project, library, keys, edit, go, toast } = useApp();
  const sample = useSample();
  const [state, setState] = useState<PresetState>(() => loadState(store()));
  const [genre, setGenre] = useState<Genre | null>(null);
  const [query, setQuery] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [age, setAge] = useState<Age | "">("");
  const [gender, setGender] = useState<Gender | "">("");
  const [quality, setQuality] = useState<AccentQuality | "">("");
  const [readyOnly, setReadyOnly] = useState(false);
  const [favOnly, setFavOnly] = useState(false);
  const [compare, setCompare] = useState<string[]>([]);
  const [casting, setCasting] = useState<string | null>(null);
  const [picked, setPicked] = useState<Record<string, string>>({});

  const all = useMemo(() => [...STARTER_PRESETS, ...state.custom], [state.custom]);
  const byId = useMemo(() => new Map(all.map((p) => [p.id, p])), [all]);
  const ready = useMemo(() => readyEnginesFrom(keys, library), [keys, library]);
  const libraryEngines = useMemo(() => [...new Set(library.map((v) => v.provider))] as Engine[], [library]);
  const kept = useMemo(() => new Set(state.favorites), [state.favorites]);

  const update = (next: PresetState) => {
    setState(next);
    if (!saveState(store(), next)) toast("Could not save this on this computer. It will be lost when Greenroom closes.", true);
  };

  const browsing = genre !== null || query.trim() !== "" || advanced || favOnly;
  const list = useMemo(() => {
    const base = filterPresets(all, { query, ...(genre ? { genre } : {}), ...(age ? { age } : {}), ...(gender ? { gender } : {}), ...(quality ? { accentQuality: quality } : {}), ...(favOnly ? { favoritesOnly: true } : {}) }, kept);
    return readyOnly ? base.filter((p) => readiness(p, ready, libraryEngines).state === "ready") : base;
  }, [all, query, genre, age, gender, quality, favOnly, readyOnly, kept, ready, libraryEngines]);

  const toggleCompare = (id: string) => setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : c.length >= MAX_COMPARE ? (toast(`Compare up to ${MAX_COMPARE} at a time.`), c) : [...c, id]));

  const speakers = project ? project.characters.filter((c) => project.lines.some((l) => l.characterId === c.id)) : [];
  const castPreset = casting ? byId.get(casting) : undefined;

  const doExport = (presets: VoicePreset[], name: string) => {
    const url = URL.createObjectURL(new Blob([exportPresets(presets)], { type: "application/json" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  const doImport = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 1_000_000) return toast("That file is too large to be a preset file.", true);
    const r = importPresets(await file.text(), new Set(all.map((p) => p.id)));
    if (r.presets.length) update(addCustom(state, r.presets));
    toast(`${r.presets.length} preset${r.presets.length === 1 ? "" : "s"} imported${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped[0]!.reason})` : ""}.`, r.presets.length === 0);
  };

  const card = (p: VoicePreset) => (
    <PresetCard
      key={p.id}
      preset={p}
      favorite={kept.has(p.id)}
      comparing={compare.includes(p.id)}
      ready={ready}
      libraryEngines={libraryEngines}
      voices={voicesFor(p, library, ready)}
      voiceId={picked[p.id]}
      onVoice={(id) => setPicked((s) => ({ ...s, [p.id]: id }))}
      onFavorite={() => update(toggleFavorite(state, p.id))}
      onCompare={() => toggleCompare(p.id)}
      onAudition={(v) => { update(markRecent(state, p.id)); return sample(v, p.audition); }}
      onCast={() => { update(markRecent(state, p.id)); setCasting(p.id); }}
      onDuplicate={() => { const d = duplicatePreset(p, new Set(all.map((x) => x.id))); update(addCustom(state, [d])); toast(`Copied as "${d.name}". Find it under its genre.`); }}
      onRemove={p.availability === "starter" ? undefined : () => { update(removeCustom(state, p.id)); setCompare((c) => c.filter((x) => x !== p.id)); }}
      go={go}
    />
  );

  return (
    <section className="presets">
      <div>
        <h1>Voice presets</h1>
        <p className="lede">Pick the kind of character you need. A preset describes a voice and how it acts; it carries no audio of its own. Pair it with a voice you have to hear it.</p>
      </div>

      <div className="row wrap preset-bar">
        <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search: noir, child, Nigerian, narrator…" aria-label="Search presets" />
        <button className="sm" aria-pressed={advanced} onClick={() => setAdvanced((a) => !a)}>{advanced ? "Hide filters" : "Advanced filters"}</button>
        <button className="sm" aria-pressed={favOnly} onClick={() => setFavOnly((f) => !f)}>★ Favorites{state.favorites.length ? ` (${state.favorites.length})` : ""}</button>
        <span className="grow" />
        <label className="sm ghost file-btn">Import<input type="file" accept="application/json,.json" hidden onChange={(e) => { void doImport(e.target.files?.[0]); e.target.value = ""; }} /></label>
        <button className="sm ghost" onClick={() => doExport(state.custom.length ? state.custom : filterPresets(all, {}), state.custom.length ? "my-voice-presets.json" : "voice-presets.json")} title={state.custom.length ? "Export the presets you made or imported" : "Export every preset"}>Export</button>
      </div>

      {advanced && (
        <div className="row wrap preset-filters" role="group" aria-label="Filters">
          <label>Age<select value={age} onChange={(e) => setAge(e.target.value as Age | "")}><option value="">Any</option>{(Object.keys(AGE_LABEL) as Age[]).map((a) => <option key={a} value={a}>{AGE_LABEL[a]}</option>)}</select></label>
          <label>Presentation<select value={gender} onChange={(e) => setGender(e.target.value as Gender | "")}><option value="">Any</option><option value="female">Female</option><option value="male">Male</option><option value="nonbinary">Nonbinary</option></select></label>
          <label>Accent review<select value={quality} onChange={(e) => setQuality(e.target.value as AccentQuality | "")}><option value="">Any</option>{ACCENT_QUALITY.map((q) => <option key={q} value={q}>{ACCENT_QUALITY_LABEL[q]}</option>)}</select></label>
          <label className="check"><input type="checkbox" checked={readyOnly} onChange={(e) => setReadyOnly(e.target.checked)} /> Only presets I can hear now</label>
        </div>
      )}

      {genre !== null && !query && (
        <div className="row"><button className="sm ghost" onClick={() => setGenre(null)}>← All genres</button><h2 className="grow">{GENRE_LABEL[genre]}</h2></div>
      )}

      {!browsing && (
        <>
          <h2>Start with a genre</h2>
          <div className="genre-grid">
            {GENRES.map((g) => (
              <button key={g} className="genre-tile" onClick={() => setGenre(g)}>
                <strong>{GENRE_LABEL[g]}</strong>
                <span className="muted">{all.filter((p) => p.genre === g).length} presets</span>
              </button>
            ))}
          </div>
          {state.recent.length > 0 && (
            <>
              <h2>Recently used</h2>
              <div className="grid preset-grid">{state.recent.map((id) => byId.get(id)).filter((p): p is VoicePreset => !!p).slice(0, 6).map(card)}</div>
            </>
          )}
        </>
      )}

      {browsing && (list.length === 0
        ? <Empty title="Nothing matches" action={<button className="sm" onClick={() => { setQuery(""); setGenre(null); setAge(""); setGender(""); setQuality(""); setReadyOnly(false); setFavOnly(false); }}>Clear filters</button>}>{readyOnly ? "No preset can be heard with the voices and engines you have now. Turn off “Only presets I can hear now” to see them all." : "Try fewer words or another genre."}</Empty>
        : <div className="grid preset-grid" aria-live="polite">{list.map(card)}</div>)}

      {compare.length > 0 && <CompareTable presets={compare.map((id) => byId.get(id)).filter((p): p is VoicePreset => !!p)} ready={ready} libraryEngines={libraryEngines} onClose={() => setCompare([])} />}

      {castPreset && (
        <CastPanel
          preset={castPreset}
          characters={speakers}
          voices={voicesFor(castPreset, library, ready)}
          hasProject={!!project}
          initialVoice={picked[castPreset.id]}
          go={go}
          onClose={() => setCasting(null)}
          onApply={(characterId, voice, replace) => {
            const c = speakers.find((x) => x.id === characterId);
            if (!c) return;
            const res = applyPreset(c, castPreset, { ...(voice ? { voice } : {}), replace });
            edit((p) => ({ ...p, characters: p.characters.map((x) => (x.id === characterId ? res.character : x)) }), "preset-apply");
            toast(`${c.name} now follows "${castPreset.name}". ${voice ? `Voice: ${voice.name}.` : "No voice chosen yet."} Press Undo to revert.`);
            setCasting(null);
          }}
        />
      )}
    </section>
  );
}

function statusOf(p: VoicePreset, ready: Engine[], libraryEngines: Engine[]) {
  const r = readiness(p, ready, libraryEngines);
  return r.state === "ready" ? { cls: "ok", label: "Ready to hear" } : r.state === "needs_voice" ? { cls: "warn", label: "Requires voice selection" } : { cls: "warn", label: "Needs an engine" };
}

function PresetCard(props: {
  preset: VoicePreset; favorite: boolean; comparing: boolean; ready: Engine[]; libraryEngines: Engine[]; voices: VoiceEntry[]; voiceId: string | undefined;
  onVoice: (id: string) => void; onFavorite: () => void; onCompare: () => void; onAudition: (v: VoiceEntry) => Promise<string>; onCast: () => void; onDuplicate: () => void; onRemove: (() => void) | undefined; go: (t: "voices" | "models") => void;
}) {
  const { preset: p, voices } = props;
  const st = statusOf(p, props.ready, props.libraryEngines);
  const r = readiness(p, props.ready, props.libraryEngines);
  const chosen = voices.find((v) => v.id === props.voiceId) ?? voices[0];
  const engines = compatibleEngines(p);
  return (
    <article className="card preset-card" aria-label={p.name}>
      <header className="row between top">
        <div>
          <h3>{p.name}</h3>
          <div className="muted small">{GENRE_LABEL[p.genre]}{p.availability !== "starter" ? ` · ${p.availability}` : ""}</div>
        </div>
        <button className="sm ghost" aria-pressed={props.favorite} aria-label={props.favorite ? `Remove ${p.name} from favorites` : `Add ${p.name} to favorites`} onClick={props.onFavorite}>{props.favorite ? "★" : "☆"}</button>
      </header>
      <p>{p.description}</p>
      <div className="row wrap preset-tags">
        <span className="badge">{p.language}</span>
        <span className="badge" title={ACCENT_QUALITY_LABEL[p.accent.quality]}>{p.accent.label}</span>
        <span className={p.accent.quality === "experimental" || p.accent.quality === "unsupported" ? "badge warn" : "badge"}>{ACCENT_QUALITY_LABEL[p.accent.quality]}</span>
        <span className="badge">{p.ageRange.map((a) => AGE_LABEL[a]).join(", ")}</span>
      </div>
      <div className="muted small">Works on: {engines.length ? engines.map(engineLabel).join(", ") : "no engine"}</div>
      <div className={`badge ${st.cls} status`}>{st.label}</div>
      {r.state === "ready" && voices.length > 0 && (
        <label className="small">Hear with
          <select value={chosen?.id ?? ""} onChange={(e) => props.onVoice(e.target.value)} aria-label={`Voice to hear ${p.name} with`}>
            {voices.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
          </select>
        </label>
      )}
      <div className="row wrap preset-actions">
        {r.state === "ready" && chosen
          ? <PlayButton label="Audition" get={() => props.onAudition(chosen)} />
          : r.state === "needs_voice"
            ? <button className="sm" onClick={() => props.go("voices")}>Pick a voice</button>
            : <button className="sm" onClick={() => props.go("models")}>Set up an engine</button>}
        <button className="sm primary" onClick={props.onCast}>Add to Cast</button>
        <button className="sm" aria-pressed={props.comparing} onClick={props.onCompare}>{props.comparing ? "Comparing" : "Compare"}</button>
        <details className="vc-more"><summary className="sm">More</summary>
          <div className="stack">
            <button className="sm ghost" onClick={props.onDuplicate}>Duplicate to edit</button>
            {props.onRemove && <button className="sm ghost" onClick={props.onRemove}>Remove this preset</button>}
          </div>
        </details>
      </div>
      {r.state === "ready" && <div className="muted small">The audition reads “{p.audition}” in a plain voice, without this preset's acting direction. Cloud voices ask before they spend.</div>}
    </article>
  );
}

function CompareTable({ presets, ready, libraryEngines, onClose }: { presets: VoicePreset[]; ready: Engine[]; libraryEngines: Engine[]; onClose: () => void }) {
  const rows: [string, (p: VoicePreset) => string][] = [
    ["Genre", (p) => GENRE_LABEL[p.genre]],
    ["Age", (p) => p.ageRange.map((a) => AGE_LABEL[a]).join(", ")],
    ["Language and accent", (p) => `${p.language}, ${p.accent.label} (${ACCENT_QUALITY_LABEL[p.accent.quality]})`],
    ["Pitch and pace", (p) => `${p.pitch}, pace ${p.acting.pace}`],
    ["Texture", (p) => p.texture],
    ["Emotional range", (p) => p.acting.emotionalRange.join(", ")],
    ["Works on", (p) => compatibleEngines(p).map(engineLabel).join(", ") || "no engine"],
    ["Status", (p) => statusOf(p, ready, libraryEngines).label],
  ];
  return (
    <div className="card lit compare" role="region" aria-label="Compare presets">
      <div className="row between"><h2>Compare</h2><button className="sm ghost" onClick={onClose}>Clear</button></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th scope="col"><span className="sr-only">Property</span></th>{presets.map((p) => <th key={p.id} scope="col">{p.name}</th>)}</tr></thead>
          <tbody>{rows.map(([label, f]) => <tr key={label}><th scope="row">{label}</th>{presets.map((p) => <td key={p.id}>{f(p)}</td>)}</tr>)}</tbody>
        </table>
      </div>
      {presets.length < 2 && <p className="muted small">Add another preset with Compare to see them side by side.</p>}
    </div>
  );
}

function CastPanel({ preset, characters, voices, hasProject, initialVoice, go, onClose, onApply }: { preset: VoicePreset; characters: { id: string; name: string }[]; voices: VoiceEntry[]; hasProject: boolean; initialVoice: string | undefined; go: (t: "write" | "home" | "voices") => void; onClose: () => void; onApply: (characterId: string, voice: VoiceEntry | undefined, replace: boolean) => void }) {
  const { project } = useApp();
  const [who, setWho] = useState(characters[0]?.id ?? "");
  const [voiceId, setVoiceId] = useState(initialVoice ?? "");
  const [replace, setReplace] = useState(false);
  const voice = voices.find((v) => v.id === voiceId);
  const character = project?.characters.find((c) => c.id === who);
  const preview = character ? applyPreset(character, preset, { ...(voice ? { voice } : {}), replace }) : null;
  return (
    <div className="card lit cast-panel" role="region" aria-label={`Add ${preset.name} to the cast`}>
      <div className="row between"><h2>Add “{preset.name}” to the cast</h2><button className="sm ghost" onClick={onClose}>Close</button></div>
      {!hasProject ? (
        <Note kind="warn">Open a project first. <button className="sm" onClick={() => go("home")}>Open Projects</button></Note>
      ) : characters.length === 0 ? (
        <Note kind="warn">This project has no speaking characters yet. <button className="sm" onClick={() => go("write")}>Write the script</button></Note>
      ) : (
        <>
          <div className="row wrap">
            <label>Character<select value={who} onChange={(e) => setWho(e.target.value)}>{characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
            <label>Voice<select value={voiceId} onChange={(e) => setVoiceId(e.target.value)}>
              <option value="">Decide later</option>
              {voices.map((v) => <option key={v.id} value={v.id}>{v.name} ({engineLabel(v.provider)})</option>)}
            </select></label>
            <label className="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} /> Replace what is already in the profile</label>
          </div>
          {voices.length === 0 && <Note>No voice in your library works with this preset yet. You can still apply the profile now and pick a voice later. <button className="sm" onClick={() => go("voices")}>Open Voices</button></Note>}
          {preview && (
            <div className="small" aria-live="polite">
              <div>Will fill in: {preview.filled.length ? preview.filled.join(", ") : "nothing new"}.</div>
              {preview.kept.length > 0 && <div className="muted">Kept as you wrote it: {preview.kept.join(", ")}.</div>}
              {preview.warnings.map((w) => <Note key={w} kind="warn">{w}</Note>)}
            </div>
          )}
          <div className="row"><button className="primary" disabled={!who} onClick={() => onApply(who, voice, replace)}>Apply to character</button><span className="muted small">You can undo this. Nothing is generated and nothing is spent.</span></div>
        </>
      )}
    </div>
  );
}
