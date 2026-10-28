import { useEffect, useMemo, useRef, useState } from "react";
import { api, type DesignPreview, type PiperVoice } from "../api";
import { useApp } from "../ctx";
import { ENGINES, ENGINE_ORDER, type Engine } from "../engines";
import { kieFor, piperFor, voicekillerFor, type Found } from "../finder";
import { Flag } from "../flags";
import { Plus, Trash } from "../icons";
import { ACCENTS, languageName, TILES, type Tile } from "../languages";
import { fromBase64 } from "../audio";
import type { Consent, ConsentBasis, LicenceUse, VoiceEntry } from "../types";
import { BASIS_LABEL, LICENCE_LABEL, rightsFor } from "../trust";
import { Note, PlayButton, Tabs, useBusy } from "../ui";
import { Avatar } from "../avatar";
import AccentSheet from "./AccentSheet";
import { DESIGN_ACCENTS } from "../accents";
import { useSample, voiceLine } from "../useSample";

type TabId = "mine" | "find" | "design" | "clone" | "accents";
const now = () => new Date().toISOString();

export default function Voices() {
  const [tab, setTab] = useState<TabId>("mine");
  const add = useAdd();
  return (
    <section>
      <div>
        <h1>Voices</h1>
        <p className="lede">Your library of voices from every engine. Every character in any project picks from here.</p>
      </div>
      <Tabs<TabId> value={tab} onChange={setTab} items={[["mine", "My library"], ["find", "Find a voice"], ["design", "Design a voice"], ["clone", "Clone a voice"], ["accents", "Accent test"]]} />
      {tab === "mine" && <Mine goFind={() => setTab("find")} />}
      {tab === "find" && <Find />}
      {tab === "design" && <Design />}
      {tab === "clone" && <Clone />}
      {tab === "accents" && <AccentSheet add={add} />}
    </section>
  );
}

function useAdd() {
  const { library, saveLibrary, toast } = useApp();
  return (v: Omit<VoiceEntry, "notes" | "createdAt"> & Partial<Pick<VoiceEntry, "notes">>) => {
    if (library.some((x) => x.id === v.id && x.provider === v.provider)) {
      toast(`${v.name} is already in your library.`);
      return;
    }
    saveLibrary((l) => (l.some((x) => x.id === v.id && x.provider === v.provider) ? l : [...l, { notes: "", createdAt: now(), ...v }]));
    toast(`${v.name} added to your library.`);
  };
}

/** "Fiona - chill, natural, real" becomes the name Fiona and the line "chill, natural, real". */
function shortName(name: string): string {
  const m = name.split(/\s+[-–—:|]\s+/)[0]?.trim();
  return m && m.length >= 2 ? m : name;
}
function tagline(v: VoiceEntry): string {
  const rest = v.name.split(/\s+[-–—:|]\s+/).slice(1).join(" · ").trim();
  return rest || v.notes.trim().slice(0, 90) || "No description yet";
}

function Mine({ goFind }: { goFind: () => void }) {
  const { library, saveLibrary, keys, toast, project, edit, go } = useApp();
  const sample = useSample();
  const { busy, run } = useBusy();
  const [sure, setSure] = useState("");
  const [only, setOnly] = useState<Engine | "all">("all");
  const speakers = project ? project.characters.filter((c) => project.lines.some((l) => l.characterId === c.id)) : [];
  const usedBy = (v: VoiceEntry) => speakers.filter((c) => c.voiceId === v.id).map((c) => c.name);
  const useFor = (v: VoiceEntry, characterId: string) => {
    const c = speakers.find((x) => x.id === characterId);
    if (!c) return;
    edit((p) => ({ ...p, characters: p.characters.map((x) => (x.id === characterId ? { ...x, voiceId: v.id } : x)) }));
    toast(`${c.name} will now use ${v.name}.`);
  };

  const importAccount = () =>
    run(async () => {
      try {
        const mine = await api.voicesMine();
        let added = 0;
        saveLibrary((l) => {
          const fresh = mine.filter((m) => !l.some((x) => x.id === m.id && x.provider === "elevenlabs"));
          added = fresh.length;
          return [...l, ...fresh.map((m): VoiceEntry => ({ id: m.id, name: m.name, provider: "elevenlabs", source: "account", language: m.language, accent: m.accent, gender: m.gender, notes: m.description, previewUrl: m.previewUrl ?? undefined, createdAt: now() }))];
        });
        toast(added ? `Added ${added} voices from your ElevenLabs account.` : "Nothing new in your ElevenLabs account.");
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  const patch = (id: string, provider: string, p: Partial<VoiceEntry>) => saveLibrary((l) => l.map((v) => (v.id === id && v.provider === provider ? { ...v, ...p } : v)));
  const remove = (v: VoiceEntry) => saveLibrary((l) => l.filter((x) => !(x.id === v.id && x.provider === v.provider)));
  const deleteRemote = async (v: VoiceEntry) => {
    try {
      await api.voiceDelete(v.id);
      remove(v);
      toast(`${v.name} deleted from ElevenLabs.`);
    } catch (e) {
      toast((e as Error).message, true);
    }
    setSure("");
  };
  const shown = library.filter((v) => only === "all" || v.provider === only);
  const present = ENGINE_ORDER.filter((e) => library.some((v) => v.provider === e));

  return (
    <>
      <div className="row wrap">
        <button className="primary" onClick={goFind}>
          <Plus size={16} /> Find a voice
        </button>
        <button onClick={() => void importAccount()} disabled={busy || !keys.elevenlabs}>
          {busy ? "Importing…" : "Import from my ElevenLabs account"}
        </button>
        <span className="muted small">{library.length} voice{library.length === 1 ? "" : "s"}</span>
        {present.length > 1 && (
          <span className="chips" role="group" aria-label="Show engine">
            <button className="chip" aria-pressed={only === "all"} onClick={() => setOnly("all")}>
              All
            </button>
            {present.map((e) => (
              <button key={e} className="chip" aria-pressed={only === e} onClick={() => setOnly(e)}>
                {ENGINES[e].label}
              </button>
            ))}
          </span>
        )}
      </div>
      {library.length > 0 && (
        <div className="grid">
          {shown.map((v) => (
            <div key={v.provider + v.id} className={usedBy(v).length ? "card voice-card vc lit" : "card voice-card vc"}>
              <div className="vc-top">
                <span className="vc-face">
                  <Avatar seed={v.id + v.name} gender={v.gender} size={72} />
                  <PlayButton round label={`Hear ${shortName(v.name)}`} get={() => sample(v)} />
                </span>
                <div className="vc-id">
                  <h2 title={v.name}>{shortName(v.name)}</h2>
                  <p className="vc-tag">{tagline(v)}</p>
                </div>
              </div>
              <div className="vc-chips">
                <span className="badge accent">{ENGINES[v.provider].label}</span>
                {voiceLine(v) && <span className="badge">{voiceLine(v)}</span>}
                {usedBy(v).map((n) => (
                  <span key={n} className="badge ok">
                    Voice of {n}
                  </span>
                ))}
              </div>
              {project && speakers.length > 0 ? (
                <select className="vc-use" aria-label={`Use ${v.name} for a character`} value="" onChange={(e) => e.target.value && useFor(v, e.target.value)}>
                  <option value="">Use this voice for…</option>
                  {speakers.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {c.voiceId === v.id ? " (already)" : ""}
                    </option>
                  ))}
                </select>
              ) : project ? (
                <button className="sm" onClick={() => go("write")}>
                  Write a script to use this voice
                </button>
              ) : (
                <button className="sm" onClick={() => go("home")}>
                  Open a project to use this voice
                </button>
              )}
              <details className="vc-more">
                <summary>
                  More <span className={rightsFor(v, []).level === "clear" ? "dot ok" : "dot warn"} title={rightsFor(v, []).level === "clear" ? "Rights clear" : "Rights to review"} />
                </summary>
                <div className="stack">
                  <input type="text" aria-label={`Notes for ${v.name}`} placeholder="Notes, for example: good for Ada's older sister" value={v.notes} onChange={(e) => patch(v.id, v.provider, { notes: e.target.value })} />
                  <RightsEditor v={v} onChange={(p) => patch(v.id, v.provider, p)} />
                  <div className="row wrap">
                    <span className="spacer" />
                    {sure === v.provider + v.id ? (
                      <>
                        <button className="sm danger" onClick={() => void deleteRemote(v)}>
                          Really delete
                        </button>
                        <button className="sm ghost" onClick={() => setSure("")}>
                          Keep
                        </button>
                      </>
                    ) : (
                      <>
                        {v.provider === "elevenlabs" && (v.source === "designed" || v.source === "cloned") && (
                          <button className="sm ghost" onClick={() => setSure(v.provider + v.id)} title="Also deletes it from your ElevenLabs account">
                            Delete from ElevenLabs
                          </button>
                        )}
                        <button className="sm ghost" aria-label={`Remove ${v.name} from the library`} onClick={() => remove(v)}>
                          <Trash size={15} /> Remove from library
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </details>
            </div>
          ))}
        </div>
      )}
      <LocalVoiceShelf />
    </>
  );
}

/** Browse real Piper catalogue entries without creating fake or unusable saved voices. */
function LocalVoiceShelf() {
  const { confirmSpend, toast, library, project, edit, go } = useApp();
  const add = useAdd();
  const sample = useSample();
  const [voices, setVoices] = useState<PiperVoice[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [favorites, setFavorites] = useState<string[]>(() => { try { return JSON.parse(localStorage.getItem("greenroom-local-favorite-voices") || "[]"); } catch { return []; } });
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [playing, setPlaying] = useState("");
  const [selected, setSelected] = useState("");
  const player = useRef<HTMLAudioElement | null>(null);
  const audioUrl = useRef("");
  useEffect(() => () => { player.current?.pause(); if (audioUrl.current) URL.revokeObjectURL(audioUrl.current); }, []);
  const favorite = (key: string) => setFavorites((current) => { const next = current.includes(key) ? current.filter((id) => id !== key) : [...current, key]; localStorage.setItem("greenroom-local-favorite-voices", JSON.stringify(next)); return next; });
  const play = async (v: PiperVoice) => {
    if (playing === v.key) { player.current?.pause(); setPlaying(""); return; }
    if (selected === v.key && player.current && !player.current.ended) { try { await player.current.play(); setPlaying(v.key); } catch { toast("Could not play this voice.", true); } return; }
    const voice = library.find((x) => x.provider === "piper" && x.id === v.key);
    if (!voice) { toast("Add this voice first to generate a local sample."); return; }
    player.current?.pause();
    if (audioUrl.current) URL.revokeObjectURL(audioUrl.current);
    setBusy(v.key);
    try { const url = await sample(voice); audioUrl.current = url; const audio = new Audio(url); player.current = audio; setSelected(v.key); audio.onended = () => setPlaying(""); audio.onerror = () => { setPlaying(""); toast("Could not play this voice.", true); }; await audio.play(); setPlaying(v.key); }
    catch { setPlaying(""); }
    finally { setBusy(""); }
  };
  useEffect(() => {
    let active = true;
    api.piperCatalog().then((items) => { if (active) setVoices(items); }).catch((e: Error) => { if (active) setError(e.message); }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  const shown = voices.filter((v) => (!onlyFavorites || favorites.includes(v.key)) && `${v.name} ${v.language} ${v.country} ${v.code}`.toLowerCase().includes(query.toLowerCase().trim())).slice(0, 24);
  const download = async (v: PiperVoice) => {
    const ok = await confirmSpend({ title: `Download ${v.name}?`, lines: [`Voice download: approximately ${v.sizeMb} MB`, "If needed, Greenroom will also download the Piper speech engine.", "The voice runs on this computer after setup. Review its model licence before commercial use."], download: true });
    if (!ok) return;
    setBusy(v.key);
    try {
      const status = await api.piperStatus();
      if (!status.installed) await api.piperInstall();
      if (!status.voices.includes(v.key)) await api.piperInstallVoice(v.key);
      add({ id: v.key, name: v.name, provider: "piper", source: "library", language: v.language, accent: v.country, gender: "" });
    } catch (e) { toast((e as Error).message, true); }
    finally { setBusy(""); }
  };
  return <div className="local-shelf">
    <div className="shelf-heading"><div><span className="eyebrow">THE LOCAL COLLECTION</span><h2>Explore voices</h2><p className="muted">Add a voice, then play a sample generated on your computer. Portraits are illustrations.</p></div><div className="row wrap"><button aria-pressed={onlyFavorites} onClick={() => setOnlyFavorites(!onlyFavorites)}>{onlyFavorites ? "★ Favorites" : "☆ Favorites"}</button><input type="search" aria-label="Search local voices" placeholder="Search language, region or name" value={query} onChange={(e) => setQuery(e.target.value)} /></div></div>
    {loading && <p className="muted">Loading local voice catalogue…</p>}
    {error && <Note>Could not load the voice catalogue: {error}. Check your connection or try Find a voice.</Note>}
    {!loading && !error && shown.length === 0 && <p className="muted">No voices match your search.</p>}
    <div className="shelf-grid">{shown.map((v) => <article className={selected === v.key ? "shelf-voice selected" : "shelf-voice"} key={v.key}>
      <Avatar seed={v.key} size={54} />
      <div className="shelf-info"><strong>{v.name}</strong><span>{v.language} · {v.country}</span><small>{v.quality} · {v.sizeMb} MB</small>{project && library.some((x) => x.provider === "piper" && x.id === v.key) && <select aria-label={`Select character for ${v.name}`} value="" onChange={(e) => { const id = e.target.value; if (id) { edit((p) => ({ ...p, characters: p.characters.map((c) => c.id === id ? { ...c, voiceId: v.key } : c) })); toast(`${v.name} assigned.`); } }}><option value="">Assign to character…</option>{project.characters.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}</div>
      <div className="shelf-actions"><button className="shelf-icon" aria-label={`${favorites.includes(v.key) ? "Remove from" : "Add to"} favorites: ${v.name}`} aria-pressed={favorites.includes(v.key)} onClick={() => favorite(v.key)}>{favorites.includes(v.key) ? "★" : "☆"}</button><button className="shelf-icon" disabled={!!busy} aria-label={`${playing === v.key ? "Pause" : "Play"} ${v.name}`} title="Add the voice before playing a sample" onClick={() => void play(v)}>{playing === v.key ? "Ⅱ" : "▶"}</button>{library.some((x) => x.provider === "piper" && x.id === v.key) ? !project && <button className="sm" onClick={() => go("home")}>Select</button> : <button className="sm" disabled={!!busy} onClick={() => void download(v)}>{busy === v.key ? "Adding…" : "Add"}</button>}</div>
    </article>)}</div>
    {voices.length > 24 && <p className="muted small">Showing up to 24 matches. Search for a language or region to explore more.</p>}
  </div>;
}

// ---- Find a voice -------------------------------------------------------------------------------------------------

type Slot = { state: "idle" | "loading" | "done" | "error"; items: Found[]; error?: string; more?: boolean; page?: number };
const idle: Slot = { state: "idle", items: [] };

let vkCache: { name: string; language: string }[] | null = null;
let piperCache: PiperVoice[] | null = null;

function Find() {
  const { keys, toast, library, confirmSpend } = useApp();
  const add = useAdd();
  const [tile, setTile] = useState<Tile | null>(null);
  const [changing, setChanging] = useState(false);
  const [filter, setFilter] = useState("");
  const [gender, setGender] = useState("");
  const [accent, setAccent] = useState("");
  const [text, setText] = useState("");
  const [on, setOn] = useState<Record<Engine, boolean>>({ elevenlabs: true, voicekiller: true, kie: true, piper: true, local: false });
  const [slots, setSlots] = useState<Partial<Record<Engine, Slot>>>({});
  const [busyKey, setBusyKey] = useState("");
  const [expanded, setExpanded] = useState<Partial<Record<Engine, boolean>>>({});
  const token = useRef(0);

  const ready: Record<Engine, boolean> = { elevenlabs: keys.elevenlabs, voicekiller: keys.voicekiller, kie: keys.kie, piper: true, local: false };
  const set = (e: Engine, s: Slot) => setSlots((all) => ({ ...all, [e]: s }));

  const tiles = useMemo(() => TILES.filter((t) => t.name.toLowerCase().includes(filter.trim().toLowerCase())), [filter]);

  // Fetch from every ticked engine whenever the language or filters change.
  useEffect(() => {
    const my = ++token.current;
    const ok = (e: Engine) => on[e] && ready[e];
    const guard = (f: () => void) => token.current === my && f();
    const timer = setTimeout(() => {
      if (ok("elevenlabs")) {
        set("elevenlabs", { state: "loading", items: [] });
        api
          .voicesShared(text, tile?.lang ?? "", accent || tile?.accent || "", gender, 0)
          .then((r) => guard(() => set("elevenlabs", { state: "done", items: r.voices.map((v) => ({ engine: "elevenlabs" as const, id: v.id, name: v.name, language: v.language, accent: v.accent, gender: v.gender, description: v.description, previewUrl: v.previewUrl, owner: v.owner })), more: r.more, page: 0 })))
          .catch((e: Error) => guard(() => set("elevenlabs", { state: "error", items: [], error: e.message })));
      } else set("elevenlabs", idle);

      const needLang = (e: Engine, load: () => Promise<Found[]>) => {
        if (!ok(e)) return set(e, idle);
        if (!tile) return set(e, { state: "idle", items: [] });
        set(e, { state: "loading", items: [] });
        load()
          .then((items) => guard(() => set(e, { state: "done", items: items.filter((i) => (!gender || !i.gender || i.gender === gender) && (!text || i.name.toLowerCase().includes(text.toLowerCase()) || i.description.toLowerCase().includes(text.toLowerCase()))) })))
          .catch((err: Error) => guard(() => set(e, { state: "error", items: [], error: err.message })));
      };
      needLang("voicekiller", async () => voicekillerFor(tile!, (vkCache ??= await api.voicesVoiceKiller())));
      needLang("kie", async () => kieFor(tile!));
      needLang("piper", async () => piperFor(tile!, (piperCache ??= await api.piperCatalog())));
    }, 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tile, gender, accent, text, on, keys.elevenlabs, keys.voicekiller, keys.kie]);

  const more = async (e: "elevenlabs") => {
    const s = slots[e];
    if (!s) return;
    try {
      const r = await api.voicesShared(text, tile?.lang ?? "", accent || tile?.accent || "", gender, (s.page ?? 0) + 1);
      set(e, { ...s, items: [...s.items, ...r.voices.map((v) => ({ engine: "elevenlabs" as const, id: v.id, name: v.name, language: v.language, accent: v.accent, gender: v.gender, description: v.description, previewUrl: v.previewUrl, owner: v.owner }))], more: r.more, page: (s.page ?? 0) + 1 });
    } catch (err) {
      toast((err as Error).message, true);
    }
  };

  const toEntry = (f: Found, id = f.id): Omit<VoiceEntry, "notes" | "createdAt"> => ({ id, name: f.name, provider: f.engine, source: "library", language: f.language, accent: f.accent, gender: f.gender });
  const asVoice = (f: Found): VoiceEntry => ({ ...toEntry(f), notes: "", createdAt: "", previewUrl: f.previewUrl ?? undefined });
  const sample = useSample();

  const take = async (f: Found) => {
    const key = f.engine + f.id;
    setBusyKey(key);
    try {
      if (f.engine === "elevenlabs") {
        if (!f.owner) throw new Error("This voice cannot be added from here.");
        add(toEntry(f, await api.voiceAddShared(f.owner, f.id, f.name)));
      } else if (f.engine === "piper") {
        const have = (await api.piperStatus()).voices.includes(f.id);
        if (!have) {
          const ok = await confirmSpend({ title: "Download this voice?", lines: [`${f.sizeMb} MB from the public Piper voice catalogue`, "The first time, the Piper program (22 MB) is downloaded too", "Then it works offline and is free to use"], download: true });
          if (!ok) return;
          const st = await api.piperStatus();
          if (!st.installed) await api.piperInstall();
          await api.piperInstallVoice(f.id);
        }
        add(toEntry(f));
      } else add(toEntry(f));
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setBusyKey("");
    }
  };

  const inLib = (f: Found) => library.some((x) => x.id === f.id && x.provider === f.engine);
  const hear = (f: Found) => () => (f.engine === "piper" ? Promise.reject(new Error("Add this voice first to hear it.")) : sample(asVoice(f)));

  const engineList = ENGINE_ORDER.filter((e) => e !== "local");
  return (
    <>
      <p className="muted">Pick a language to see voices for it from every engine you have set up. No need to know a voice by name.</p>

      <div className="card stack">
        <div className="row wrap">
          <span className="muted small">Show voices from</span>
          <span className="chips" role="group" aria-label="Engines">
            {engineList.map((e) => (
              <button key={e} className="chip" aria-pressed={on[e] && ready[e]} disabled={!ready[e]} title={ready[e] ? "" : "Add its key in Settings first"} onClick={() => setOn({ ...on, [e]: !on[e] })}>
                {ENGINES[e].label}
              </button>
            ))}
          </span>
        </div>
        <div className="row wrap">
          <input type="search" aria-label="Find a language" placeholder="Find a language, for example Yoruba" value={filter} onChange={(e) => setFilter(e.target.value)} style={{ flex: 1, minWidth: 200 }} />
          <select aria-label="Gender" value={gender} onChange={(e) => setGender(e.target.value)}>
            <option value="">Any gender</option>
            <option value="female">Female</option>
            <option value="male">Male</option>
          </select>
          <select aria-label="Accent" value={accent} onChange={(e) => setAccent(e.target.value)}>
            <option value="">Any accent</option>
            {ACCENTS.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <input type="search" aria-label="Describe or name a voice (optional)" placeholder="Describe it (optional): warm, deep…" value={text} onChange={(e) => setText(e.target.value)} />
        </div>
      </div>

      {tile && !changing && (
        <div className="row wrap lang-bar">
          <span className="row">
            <Flag cc={tile.cc} />
            <strong>{tile.name}</strong>
          </span>
          <button className="sm" onClick={() => setChanging(true)}>
            Change language
          </button>
          <button className="sm ghost" onClick={() => setTile(null)}>
            Show popular instead
          </button>
        </div>
      )}
      <div className="tiles" role="group" aria-label="Languages" hidden={!!tile && !changing}>
        <button className="tile" aria-pressed={tile === null} onClick={() => (setTile(null), setChanging(false))}>
          <span className="flag-ph" style={{ width: 22, height: 16 }} aria-hidden="true" />
          Popular
        </button>
        {tiles.map((t) => (
          <button key={t.id} className="tile" aria-pressed={tile?.id === t.id} onClick={() => (setTile(t), setChanging(false))}>
            <Flag cc={t.cc} />
            {t.name}
          </button>
        ))}
        {tiles.length === 0 && <span className="muted">No language matches that.</span>}
      </div>

      <h3>{tile ? `Voices for ${tile.name}` : "Popular voices on ElevenLabs"}</h3>
      {!tile && <p className="muted small">Choose a language above to also see VoiceKiller, Kie and offline Piper voices.</p>}
      {tile?.mixed && <Note>{tile.name} has no language of its own. Write the lines the way they are spoken and pick a voice with a matching accent. Piper and Kie are not offered for it.</Note>}

      {engineList.map((e) => {
        const s = slots[e];
        if (!on[e] || !ready[e] || !s || s.state === "idle") return null;
        return (
          <div key={e} className="stack">
            <div className="row">
              <h2>{ENGINES[e].label}</h2>
              {ENGINES[e].local && <span className="badge ok">Offline, free</span>}
              {s.state === "done" && <span className="muted small">{s.items.length}{s.more ? "+" : ""} voices</span>}
            </div>
            {s.state === "loading" && <p className="muted">Looking…</p>}
            {s.state === "error" && <Note kind="err">{s.error}</Note>}
            {s.state === "done" && s.items.length === 0 && <p className="muted">No voices matched here. Try fewer filters.</p>}
            <div className="grid">
              {s.items.slice(0, expanded[e] ? s.items.length : 24).map((f) => (
                <div key={f.engine + f.id} className="card voice-card vc">
                  <div className="vc-top">
                    <span className="vc-face">
                      <Avatar seed={f.id + f.name} gender={f.gender} size={72} />
                      {f.engine !== "piper" && <PlayButton round label={`Hear ${shortName(f.name)}`} get={hear(f)} disabled={!f.previewUrl && f.engine === "elevenlabs"} />}
                    </span>
                    <div className="vc-id">
                      <h2 title={f.name}>{shortName(f.name)}</h2>
                      <p className="vc-tag">{f.name.split(/\s+[-–—:|]\s+/).slice(1).join(" · ").trim() || f.description || "No description"}</p>
                    </div>
                  </div>
                  <div className="vc-chips">
                    <span className="badge">{[languageName(f.language.split(/[-_]/)[0] ?? f.language), f.accent, f.gender].filter(Boolean).join(" · ") || f.language}</span>
                    {f.sizeMb ? <span className="badge">{f.sizeMb} MB</span> : null}
                    {f.engine === "piper" && <span className="badge">Hear it after adding</span>}
                  </div>
                  <div className="row">
                    <span className="spacer" />
                    <button className="sm primary" disabled={inLib(f) || busyKey === f.engine + f.id} onClick={() => void take(f)}>
                      {inLib(f) ? "In library" : busyKey === f.engine + f.id ? "Adding…" : (<><Plus size={14} /> {f.engine === "piper" ? "Download" : "Add"}</>)}
                    </button>
                  </div>
                </div>
              ))}
            </div>
            {s.items.length > 24 && !expanded[e] && (
              <div>
                <button onClick={() => setExpanded({ ...expanded, [e]: true })}>Show all {s.items.length}</button>
              </div>
            )}
            {e === "elevenlabs" && s.more && (
              <div>
                <button onClick={() => void more("elevenlabs")}>Show more</button>
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// ---- Design and clone ---------------------------------------------------------------------------------------------

const EXAMPLES = [
  "An older Nigerian man, warm and gravelly, speaking slowly with quiet authority",
  "A young Lagos woman, bright and quick, with a teasing laugh in her voice",
  "A gentle Korean grandmother, soft and a little shaky, kind",
  "A tired British detective, dry and low, weary after a long night",
];

function Design() {
  const { confirmSpend, toast, keys, priceLines, addLedger } = useApp();
  const add = useAdd();
  const { busy, run } = useBusy();
  const [desc, setDesc] = useState("");
  const [sample, setSample] = useState("");
  const [accent, setAccent] = useState("");
  const [previews, setPreviews] = useState<{ p: DesignPreview; url: string; name: string }[]>([]);
  const ok = desc.trim().length >= 20;
  const pick = (label: string) => {
    const old = DESIGN_ACCENTS.find((a) => a.label === accent);
    const next = DESIGN_ACCENTS.find((a) => a.label === label);
    let d = desc;
    if (old) d = d.split(old.phrase).join("").replace(/[,.\s]+$/, "").replace(/\s+,/g, ",").trim();
    if (next) d = `${d.replace(/[.\s]+$/, "")}${d.trim() ? ", " : ""}${next.phrase}.`.trim();
    setAccent(label);
    setDesc(d.slice(0, 1000));
  };

  const make = async () => {
    const price = priceLines([{ kind: "design", count: 3 }]);
    const go = await confirmSpend({ title: "Design a voice?", lines: ["Makes up to 3 preview voices from your description", "Uses ElevenLabs credits for each preview. Saving a voice to your account needs a plan that allows it.", ...price.lines], warn: price.warn });
    if (!go) return;
    await run(async () => {
      try {
        const out = await api.voiceDesign(desc, sample.trim() || undefined);
        addLedger({ kind: "design", engine: "ElevenLabs voice design", chars: desc.length, items: [{ kind: "design", count: out.length }] });
        setPreviews(out.map((p, i) => ({ p, url: URL.createObjectURL(new Blob([fromBase64(p.audioB64) as BlobPart], { type: "audio/mpeg" })), name: `Designed voice ${i + 1}` })));
      } catch (e) {
        toast((e as Error).message, true);
      }
    });
  };
  const save = async (i: number) => {
    const it = previews[i]!;
    try {
      const id = await api.voiceDesignSave(it.p.generatedVoiceId, it.name, desc);
      add({ id, name: it.name, provider: "elevenlabs", source: "designed", language: "", accent: accent, gender: "", notes: desc.slice(0, 160), consent: { speaker: "No real person: designed from a description", basis: "designed", reference: desc.slice(0, 120), date: new Date().toISOString().slice(0, 10) } });
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <>
      <p className="muted">Describe the voice you imagine, including age, accent, tone and pace. You get three previews to choose from. Keeping one in your account may need a paid ElevenLabs plan; if it does, the app will say so.</p>
      {!keys.elevenlabs && <Note kind="warn">Add your ElevenLabs key in Settings first.</Note>}
      <div className="card stack">
        <label className="field">
          Describe the voice (20 to 1000 characters)
          <textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={EXAMPLES[0]} />
        </label>
        <label className="field">
          Accent (adds a sentence to the description, which you can edit)
          <select value={accent} onChange={(e) => pick(e.target.value)}>
            <option value="">No particular accent</option>
            {DESIGN_ACCENTS.map((a) => (
              <option key={a.label} value={a.label}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        {accent && <p className="muted small">Whether the voice really sounds {accent} is not guaranteed: listen to all three previews before saving. For an exact accent, a cloned voice from a real speaker who gave permission is usually closer.</p>}
        <div className="chips" aria-label="Examples">
          {EXAMPLES.map((e) => (
            <button key={e} className="chip" aria-pressed={desc === e} onClick={() => setDesc(e)}>
              {e.slice(0, 38)}…
            </button>
          ))}
        </div>
        <label className="field">
          What it should say (optional, 100 to 1000 characters; leave empty for an automatic line)
          <textarea rows={2} value={sample} onChange={(e) => setSample(e.target.value)} />
        </label>
        <div className="row">
          <button className="primary" disabled={!ok || busy || !keys.elevenlabs} onClick={() => void make()}>
            {busy ? "Designing…" : "Make 3 previews"}
          </button>
          {!ok && desc.length > 0 && <span className="muted small">A little more detail, please.</span>}
        </div>
      </div>
      {previews.map((it, i) => (
        <div key={it.p.generatedVoiceId} className="card row wrap lit">
          <audio controls src={it.url} />
          <input type="text" aria-label={`Name for preview ${i + 1}`} value={it.name} onChange={(e) => setPreviews(previews.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} style={{ flex: 1, minWidth: 160 }} />
          <button className="primary" onClick={() => void save(i)}>
            Save this voice
          </button>
        </div>
      ))}
    </>
  );
}

function Clone() {
  const { keys, toast } = useApp();
  const add = useAdd();
  const { busy, run } = useBusy();
  const [name, setName] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [perm, setPerm] = useState(false);
  const [who, setWho] = useState("");
  const [basis, setBasis] = useState<ConsentBasis | "">("");
  const [ref, setRef] = useState("");
  const ready = name.trim() && file && perm && who.trim() && basis && keys.elevenlabs;

  const go = () =>
    run(async () => {
      if (!file) return;
      try {
        const buf = new Uint8Array(await file.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
        const id = await api.voiceClone(name.trim(), file.name, file.type || "audio/mpeg", btoa(s), perm);
        add({ id, name: name.trim(), provider: "elevenlabs", source: "cloned", language: "", accent: "", gender: "", notes: "Cloned in Greenroom", consent: { speaker: who.trim(), basis: basis as ConsentBasis, reference: ref.trim(), date: new Date().toISOString().slice(0, 10) } });
        setName("");
        setFile(null);
        setPerm(false);
        setWho("");
        setBasis("");
        setRef("");
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  return (
    <>
      <p className="muted">Make a voice from a recording. A clean minute or more of one person speaking, with no music or other voices, works best.</p>
      <div className="card stack">
        <label className="field">
          Name for this voice
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="For example: Mum" />
        </label>
        <label className="field">
          Recording (WAV, MP3, M4A, up to 30 MB)
          <input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </label>
        <div className="card stack" style={{ background: "var(--surface-1)" }}>
          <h3>Consent record</h3>
          <p className="muted small">Kept with the voice and written into your production report. Studios and platforms ask for this.</p>
          <div className="row wrap">
            <label className="field" style={{ flex: 1, minWidth: 180 }}>
              Whose voice is it?
              <input type="text" value={who} onChange={(e) => setWho(e.target.value)} placeholder="Full name of the speaker" />
            </label>
            <label className="field" style={{ flex: 1, minWidth: 220 }}>
              On what basis?
              <select value={basis} onChange={(e) => setBasis(e.target.value as ConsentBasis)}>
                <option value="">Choose…</option>
                {(["self", "permission", "licence", "other"] as ConsentBasis[]).map((b) => (
                  <option key={b} value={b}>
                    {BASIS_LABEL[b]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <label className="field">
            Reference (optional): a contract, release or email
            <input type="text" value={ref} onChange={(e) => setRef(e.target.value)} placeholder="Voice release signed 12 Oct 2026" />
          </label>
        </div>
        <label className="row">
          <input type="checkbox" checked={perm} onChange={(e) => setPerm(e.target.checked)} />
          <span>I have permission from the person whose voice this is to clone it.</span>
        </label>
        <p className="muted small">The recording is sent to ElevenLabs to create the voice. Cloning needs a plan that includes it.</p>
        <div>
          <button className="primary" disabled={!ready || busy} onClick={() => void go()}>
            {busy ? "Creating…" : "Create clone"}
          </button>
        </div>
      </div>
    </>
  );
}


/** Who agreed to a voice and what the licence allows. A record and a reminder: it never blocks anything. */
function RightsEditor({ v, onChange }: { v: VoiceEntry; onChange: (p: Partial<VoiceEntry>) => void }) {
  const r = rightsFor(v, []);
  const today = new Date().toISOString().slice(0, 10);
  const c: Consent = v.consent ?? { speaker: "", basis: "other", reference: "", date: today };
  const setConsent = (p: Partial<Consent>) => {
    const next = { ...c, ...p, date: v.consent?.date ?? today };
    onChange({ consent: next.speaker.trim() || next.reference.trim() ? next : undefined });
  };
  return (
    <details className="small">
      <summary>
        Rights and consent{" "}
        <span className={r.level === "clear" ? "badge ok" : r.level === "missing" ? "badge warn" : "badge"}>
          {r.level === "clear" ? "clear" : r.level === "missing" ? "consent needed" : "to review"}
        </span>
      </summary>
      <div className="stack" style={{ marginTop: 8 }}>
        {r.issues.map((i) => (
          <p key={i} className="muted small">
            {i}
          </p>
        ))}
        <div className="row wrap">
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            Commercial use
            <select value={v.licence ?? "unknown"} onChange={(e) => onChange({ licence: e.target.value as LicenceUse, licenceChecked: today })}>
              {(Object.keys(LICENCE_LABEL) as LicenceUse[]).map((k) => (
                <option key={k} value={k}>
                  {LICENCE_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="field" style={{ flex: 2, minWidth: 160 }}>
            Licence note
            <input type="text" value={v.licenceNote ?? ""} placeholder="Where you checked, and when" onChange={(e) => onChange({ licenceNote: e.target.value })} />
          </label>
        </div>
        <div className="row wrap">
          <label className="field" style={{ flex: 1, minWidth: 140 }}>
            Speaker
            <input type="text" value={c.speaker} onChange={(e) => setConsent({ speaker: e.target.value })} placeholder="Whose voice it is" />
          </label>
          <label className="field" style={{ flex: 1, minWidth: 160 }}>
            Basis
            <select value={c.basis} onChange={(e) => setConsent({ basis: e.target.value as ConsentBasis })}>
              {(Object.keys(BASIS_LABEL) as ConsentBasis[]).map((k) => (
                <option key={k} value={k}>
                  {BASIS_LABEL[k]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field">
          Reference
          <input type="text" value={c.reference} onChange={(e) => setConsent({ reference: e.target.value })} placeholder="Contract, release or email" />
        </label>
      </div>
    </details>
  );
}
