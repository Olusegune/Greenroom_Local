import { CharacterMark } from "../voiceMark";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "../api";
import { Avatar } from "../avatar";
import { HERITAGE_CHOICES, lookLabel, type Heritage, addCustom, AGE_LABEL, AGES, assignAvatar, COLLECTION_LABEL, COLLECTIONS, EXPRESSIONS, expressionFor, facets, filterAvatars, isCustomId, progress, removeCustom, STYLE_LABEL, suggestAvatars, toggleFavorite, touchRecent, type AvatarEntry, type CustomAvatar, type Expression } from "../avatarLibrary";
import { currentFace, updateStore, useAvatars } from "../avatarState";
import { useApp } from "../ctx";
import { avatarPrompt, squareJpeg } from "../portrait";
import { PortraitImporter } from "./PortraitImporter";
import type { Character, VoiceEntry } from "../types";

/** One item in the browser, built-in or the owner's own. */
interface Item {
  id: string;
  name: string;
  thumb: string;
  card: string;
  meta: string;
  builtin?: AvatarEntry;
  custom?: CustomAvatar;
}

/** A character's face. Press it to choose, replace or remove the avatar. The voice is never touched. */
export function CharacterFace({ character, voice, size = 44, emotion, editable = true }: { character?: Character; voice?: VoiceEntry; size?: number; emotion?: string; editable?: boolean }) {
  useAvatars();
  const [open, setOpen] = useState(false);
  const face = currentFace(character?.avatarId, emotion ? expressionFor(emotion) : undefined);
  const src = face ? (size >= 96 ? face.card : size >= 48 ? face.small : face.thumb) : null;
  // A face is drawn only from what the owner STATED about this character (its look). Not from its name, a description, its language or its
  // voice: with nothing stated there is nothing to draw, so the character shows its initials.
  const look = character?.look;
  const described = !!(look?.gender || look?.age || look?.heritage);
  const cGender = look?.gender === "f" ? "female" : look?.gender === "m" ? "male" : undefined;
  const inner = src ? <img className="avatar" src={src} alt={character?.name ?? ""} width={size} height={size} decoding="async" style={{ objectFit: "cover", borderRadius: "50%" }} /> : described && character ? <Avatar seed={`char:${character.id}`} gender={cGender} size={size} own meta={{ age: look?.age, heritage: look?.heritage }} /> : <CharacterMark name={character?.name ?? voice?.name ?? "?"} size={size} />;
  if (!character || !editable) return inner;
  return (
    <>
      <button className="avatar-btn" aria-label={`Choose an avatar for ${character.name}`} title="Choose an avatar" onClick={() => setOpen(true)} style={{ background: "none", border: 0, cursor: "pointer", borderRadius: "50%" }}>
        {inner}
      </button>
      {open && createPortal(<AvatarBrowser character={character} voice={voice} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/** Only the rows in view are drawn, so a library of thousands scrolls as smoothly as one of twelve. */
function VirtualGrid<T>({ items, itemW, itemH, gap = 10, height, render, label }: { items: T[]; itemW: number; itemH: number; gap?: number; height: number; render: (t: T) => React.ReactNode; label: string }) {
  const box = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  const [top, setTop] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    setW(el.clientWidth || 600);
    const ro = new ResizeObserver(() => setW(el.clientWidth || 600));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const cols = Math.max(1, Math.floor((w + gap) / (itemW + gap)));
  const rows = Math.ceil(items.length / cols);
  const rowH = itemH + gap;
  const first = Math.max(0, Math.floor(top / rowH) - 2);
  const last = Math.min(rows, Math.ceil((top + height) / rowH) + 2);
  const shown = items.slice(first * cols, last * cols);
  return (
    <div ref={box} role="list" aria-label={label} style={{ height, overflow: "auto", position: "relative" }} onScroll={(e) => setTop(e.currentTarget.scrollTop)}>
      <div style={{ height: Math.max(0, rows * rowH - gap), position: "relative" }}>
        {shown.map((t, i) => {
          const idx = first * cols + i;
          return (
            <div key={idx} role="listitem" style={{ position: "absolute", left: (idx % cols) * (itemW + gap), top: Math.floor(idx / cols) * rowH, width: itemW, height: itemH }}>
              {render(t)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function AvatarBrowser({ character, voice, onClose }: { character: Character; voice?: VoiceEntry; onClose: () => void }) {
  const { edit, toast } = useApp();
  const { manifest, store, problems } = useAvatars();
  const builtin = manifest?.avatars ?? [];
  const [text, setText] = useState("");
  const [f, setF] = useState({ collection: "", period: "", genre: "", age: "", style: "", gender: "", heritage: "" });
  const [mode, setMode] = useState<"all" | "favorites" | "recent" | "mine">("all");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [sel, setSel] = useState<string | undefined>(character.avatarId);
  const [about, setAbout] = useState(() => [character.name, character.dna?.timbre, character.dna?.tendencies, character.dna?.range].filter(Boolean).join(". "));
  const [suggested, setSuggested] = useState<ReturnType<typeof suggestAvatars>>([]);
  const [create, setCreate] = useState(false);
  const [importing, setImporting] = useState(false);
  const fac = useMemo(() => facets(builtin), [builtin]);

  const items: Item[] = useMemo(() => {
    const filtersOn = !!(f.collection || f.period || f.genre || f.age || f.style || f.gender || f.heritage);
    const only = mode === "favorites" ? new Set(store.favorites) : mode === "recent" ? new Set(store.recent) : undefined;
    const b = mode === "mine" ? [] : filterAvatars(builtin, { text, collection: f.collection, period: f.period, genre: f.genre, age: f.age, style: f.style, ...(f.gender ? { gender: f.gender as "m" | "f" } : {}), ...(f.heritage ? { heritage: f.heritage as Heritage } : {}), only });
    const toItem = (a: AvatarEntry): Item => ({ id: a.id, name: a.name, thumb: `./avatars/${a.assets.thumbnail}`, card: `./avatars/${a.assets.card ?? a.assets.card_small}`, meta: `${COLLECTION_LABEL[a.collection]} · ${AGE_LABEL[a.age_category]}${lookLabel(a.id) ? ` · ${lookLabel(a.id)}` : ""}${a.tier === "preview" ? " · preview" : ""}`, builtin: a });
    const terms = text.toLowerCase().split(/\s+/).filter(Boolean);
    const c = (filtersOn || mode === "recent" && !only ? [] : store.custom)
      .filter((x) => (mode !== "favorites" || store.favorites.includes(x.id)) && (mode !== "recent" || store.recent.includes(x.id)))
      .filter((x) => terms.every((t) => `${x.name} ${x.tags.join(" ")}`.toLowerCase().includes(t)))
      .map((x): Item => ({ id: x.id, name: x.name, thumb: x.thumb, card: x.image, meta: x.source === "generated" ? "My avatar · made with AI" : "My avatar · imported", custom: x }));
    const order = mode === "recent" ? (i: Item) => store.recent.indexOf(i.id) : () => 0;
    return [...c, ...b.map(toItem)].sort((a, z) => order(a) - order(z));
  }, [builtin, store, text, f, mode]);

  const picked = items.find((i) => i.id === sel) ?? [...builtin.map((a): Item => ({ id: a.id, name: a.name, thumb: "", card: `./avatars/${a.assets.card ?? a.assets.card_small}`, meta: "", builtin: a })), ...store.custom.map((x): Item => ({ id: x.id, name: x.name, thumb: x.thumb, card: x.image, meta: "", custom: x }))].find((i) => i.id === sel);
  const fav = (id: string) => store.favorites.includes(id);

  const assign = (id: string | undefined) => {
    edit((p) => ({ ...p, characters: assignAvatar(p.characters, character.id, id) }));
    if (id) void updateStore((s) => touchRecent(s, id)).catch(() => undefined);
    toast(id ? `${character.name} now has the avatar ${items.find((i) => i.id === id)?.name ?? ""}. Their voice is unchanged.` : `${character.name} is back to the default face.`);
    onClose();
  };
  const save = (fn: Parameters<typeof updateStore>[0]) => void updateStore(fn).catch((e: Error) => toast(e.message, true));

  const cell = (i: Item) => (
    <button className="av-cell" aria-pressed={sel === i.id} onClick={() => setSel(i.id)} onDoubleClick={() => assign(i.id)} title={i.builtin && lookLabel(i.id) ? `${i.name} (${lookLabel(i.id)})` : i.name} style={{ width: "100%", height: "100%" }}>
      <img src={i.thumb} alt="" loading="lazy" decoding="async" width={view === "grid" ? 112 : 44} height={view === "grid" ? 112 : 44} />
      <span className="av-name">{i.name}</span>
      {character.avatarId === i.id && <span className="av-badge">In use</span>}
      {i.builtin?.tier === "preview" && <span className="av-preview-tag" title="Preview resolution (256 px)">Preview</span>}
      {fav(i.id) && <span className="av-star" aria-label="Favourite">★</span>}
    </button>
  );
  const p = progress(manifest);

  return (
    <div className="scrim" role="presentation">
      <div className="dialog av-dialog" role="dialog" aria-modal="true" aria-labelledby="avb-t" style={{ width: "min(1040px, 96vw)" }}>
        <div className="row between wrap">
          <h2 id="avb-t">Avatar for {character.name}</h2>
          <span className="muted small">Their voice{voice ? ` (${voice.name})` : ""} stays as it is.</span>
        </div>
        {problems.length > 0 && <p className="warn small" role="alert">Some avatars could not be read: {problems.slice(0, 2).join("; ")}</p>}

        <div className="row wrap">
          <input type="search" aria-label="Search avatars" placeholder="Search: elderly, blazer, cyberpunk, scholar…" value={text} onChange={(e) => setText(e.target.value)} style={{ flex: 1, minWidth: 220 }} />
          <span className="chips" role="group" aria-label="Show">
            {([["all", "All"], ["favorites", "Favourites"], ["recent", "Recently used"], ["mine", "My avatars"]] as const).map(([id, l]) => (
              <button key={id} className="chip" aria-pressed={mode === id} onClick={() => setMode(id)}>
                {l}
              </button>
            ))}
          </span>
          <span className="chips" role="group" aria-label="View">
            <button className="chip" aria-pressed={view === "grid"} onClick={() => setView("grid")}>Grid</button>
            <button className="chip" aria-pressed={view === "list"} onClick={() => setView("list")}>List</button>
          </span>
        </div>
        <div className="row wrap">
          <select aria-label="Collection" value={f.collection} onChange={(e) => setF({ ...f, collection: e.target.value })}>
            <option value="">All collections</option>
            {COLLECTIONS.map((c) => (
              <option key={c} value={c} disabled={!fac.collections.includes(c)}>
                {COLLECTION_LABEL[c]}{fac.collections.includes(c) ? "" : " (none yet)"}
              </option>
            ))}
          </select>
          <select aria-label="Historical period" value={f.period} onChange={(e) => setF({ ...f, period: e.target.value })}>
            <option value="">Any period</option>
            {fac.periods.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
          </select>
          <select aria-label="Genre" value={f.genre} onChange={(e) => setF({ ...f, genre: e.target.value })}>
            <option value="">Any genre</option>
            {fac.genres.map((x) => <option key={x} value={x}>{x.replace(/_/g, " ")}</option>)}
          </select>
          <select aria-label="Age" value={f.age} onChange={(e) => setF({ ...f, age: e.target.value })}>
            <option value="">Any age</option>
            {AGES.filter((a) => fac.ages.includes(a)).map((a) => <option key={a} value={a}>{AGE_LABEL[a]}</option>)}
          </select>
          <select aria-label="Looks like (gender)" value={f.gender} onChange={(e) => setF({ ...f, gender: e.target.value })}>
            <option value="">Any gender shown</option>
            <option value="f">Female</option>
            <option value="m">Male</option>
          </select>
          <select aria-label="Looks like (heritage)" value={f.heritage} onChange={(e) => setF({ ...f, heritage: e.target.value })}>
            {HERITAGE_CHOICES.map((c) => <option key={c.value} value={c.value}>{c.value ? c.label : "Any heritage shown"}</option>)}
          </select>
          <select aria-label="Visual style" value={f.style} onChange={(e) => setF({ ...f, style: e.target.value })}>
            <option value="">Any style</option>
            {fac.styles.map((x) => <option key={x} value={x}>{STYLE_LABEL[x] ?? x}</option>)}
          </select>
          {(f.collection || f.period || f.genre || f.age || f.style || f.gender || f.heritage || text) && <button className="sm ghost" onClick={() => { setF({ collection: "", period: "", genre: "", age: "", style: "", gender: "", heritage: "" }); setText(""); }}>Clear filters</button>}
        </div>

        <div className="row wrap" style={{ alignItems: "flex-end" }}>
          <label className="field" style={{ flex: 1, minWidth: 260 }}>
            Describe the character to get suggestions
            <input type="text" value={about} placeholder="An elderly bureaucrat, impeccably dressed, stern, quietly sinister" onChange={(e) => setAbout(e.target.value)} />
          </label>
          <button onClick={() => setSuggested(suggestAvatars(about, builtin))}>Suggest avatars</button>
        </div>
        {suggested.length > 0 && (
          <div className="row wrap" role="group" aria-label="Suggested avatars">
            <span className="muted small">Suggested from the description (matching its words, never an accent):</span>
            {suggested.map((s) => (
              <button key={s.entry.id} className="av-suggest" onClick={() => setSel(s.entry.id)} title={`Matched: ${s.why.join(", ")}`}>
                <img src={`./avatars/${s.entry.assets.thumbnail}`} alt={s.entry.name} width={56} height={56} loading="lazy" />
                <span className="small">{s.entry.name}</span>
              </button>
            ))}
          </div>
        )}
        {suggested.length === 0 && about.trim() && <span className="muted small">Press Suggest to see portraits that match. You can always choose any avatar yourself.</span>}

        <div className="av-body">
          <div className="av-list">
            {items.length === 0 ? (
              <p className="muted" style={{ padding: 16 }}>{mode === "mine" ? "You have no avatars of your own yet. Import a picture or make one below." : "Nothing matches. Clear a filter, or try a different word."}</p>
            ) : (
              <VirtualGrid items={items} itemW={view === "grid" ? 124 : 320} itemH={view === "grid" ? 150 : 56} height={360} label="Avatars" render={cell} />
            )}
            <p className="muted small">{items.length} shown · {p.missing > 0 ? `${p.have} of ${p.target} full-resolution portraits made (${p.missing} still to make)` : `${p.have} full-resolution portraits (the ${p.target} target is met)`}, plus {p.previews} at preview resolution. Double-press a face to use it.</p>
          </div>
          <div className="av-preview">
            {picked ? (
              <>
                <img src={picked.card} alt={picked.name} width={220} height={220} style={{ borderRadius: 16, objectFit: "cover" }} />
                <strong>{picked.name}</strong>
                {picked.builtin ? (
                  <>
                    <span className="muted small">{COLLECTION_LABEL[picked.builtin.collection]} · {picked.builtin.period.replace(/_/g, " ")} · {AGE_LABEL[picked.builtin.age_category]} · {STYLE_LABEL[picked.builtin.style] ?? picked.builtin.style}</span>
                    <span className="small">{picked.builtin.clothing}</span>
                    <span className="chips">{picked.builtin.tags.slice(0, 8).map((t) => <span key={t} className="chip static">{t}</span>)}</span>
                    {picked.builtin.tier === "preview" && <span className="warn small">Preview resolution: 256 px, cut from a contact sheet, with no 1024 master. Fine for cards and thumbnails; not for large prints.</span>}
                    <span className={picked.builtin.license.commercial_use === "confirmed" ? "muted small" : "warn small"}>Rights: commercial use {picked.builtin.license.commercial_use}. {picked.builtin.license.source}</span>
                  </>
                ) : (
                  <ExpressionEditor avatar={picked.custom!} save={save} />
                )}
                <div className="row wrap">
                  <button className="primary" onClick={() => assign(picked.id)} disabled={character.avatarId === picked.id}>
                    {character.avatarId === picked.id ? "In use" : character.avatarId ? "Replace with this" : `Use for ${character.name}`}
                  </button>
                  <button className="sm" aria-pressed={fav(picked.id)} onClick={() => save((s) => toggleFavorite(s, picked.id))}>{fav(picked.id) ? "★ Favourite" : "☆ Favourite"}</button>
                  {isCustomId(picked.id) && (
                    <button className="sm danger" onClick={() => { save((s) => removeCustom(s, picked.id)); if (character.avatarId === picked.id) edit((pr) => ({ ...pr, characters: assignAvatar(pr.characters, character.id, undefined) })); setSel(undefined); }}>
                      Delete
                    </button>
                  )}
                </div>
              </>
            ) : (
              <p className="muted">Choose a face on the left to preview it.</p>
            )}
          </div>
        </div>

        <div className="row wrap">
          <button type="button" onClick={() => setImporting(true)}>Add portraits…</button>
          <button onClick={() => setCreate(!create)} aria-expanded={create}>Create a custom avatar…</button>
          <span className="spacer" />
          {character.avatarId && <button className="ghost" onClick={() => assign(undefined)}>Remove the avatar</button>}
          <button className="primary" onClick={onClose}>Done</button>
        </div>
        {importing && <PortraitImporter onClose={() => setImporting(false)} onAdded={(ids) => { setMode("mine"); setSel(ids[0]); }} />}
        {create && <CreateAvatar onSaved={(a) => { setSel(a.id); setMode("mine"); setCreate(false); setText(""); setF({ collection: "", period: "", genre: "", age: "", style: "", gender: "", heritage: "" }); }} />}
      </div>
    </div>
  );
}

/** Other expressions of one custom character. They are only ever shown for that avatar, so a face is never swapped for another identity. */
function ExpressionEditor({ avatar, save }: { avatar: CustomAvatar; save: (fn: (s: ReturnType<typeof useAvatars>["store"]) => ReturnType<typeof useAvatars>["store"]) => void }) {
  const { toast } = useApp();
  const add = async (ex: Expression, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const v = await squareJpeg(file, 512, 0.86);
      save((s) => addCustom(s, { ...avatar, variants: { ...avatar.variants, [ex]: v } }));
    } catch {
      toast("Greenroom could not read that picture.", true);
    }
  };
  return (
    <details>
      <summary className="small">Expressions ({Object.keys(avatar.variants ?? {}).length} of {EXPRESSIONS.length} added)</summary>
      <p className="muted small">Add other pictures of this same character. Perform shows the one that matches a line's feeling, and the main picture when there is none.</p>
      <div className="row wrap">
        {EXPRESSIONS.map((ex) => (
          <label key={ex} className="small" style={{ cursor: "pointer" }}>
            <span className={avatar.variants?.[ex] ? "badge ok" : "badge"}>{ex}</span>
            <input type="file" accept="image/*" aria-label={`Add the ${ex} expression`} style={{ display: "none" }} onChange={(e) => void add(ex, e)} />
          </label>
        ))}
      </div>
    </details>
  );
}

/** Make a new avatar from a description with the owner's own Kie key. Only the text is sent, after a cost sheet. */
function CreateAvatar({ onSaved }: { onSaved: (a: CustomAvatar) => void }) {
  const { keys, confirmSpend, toast, go } = useApp();
  const [d, setD] = useState({ description: "", period: "", genre: "", style: "cinematic realism", clothing: "", expression: "", background: "" });
  const [prompt, setPrompt] = useState("");
  const [made, setMade] = useState<{ image: string; thumb: string } | null>(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const field = (k: keyof typeof d, label: string, ph: string) => (
    <label className="field" style={{ flex: 1, minWidth: 200 }}>
      {label}
      <input type="text" value={d[k]} placeholder={ph} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
    </label>
  );
  const make = async () => {
    const text = prompt.trim() || avatarPrompt(d);
    const ok = await confirmSpend({ title: "Make an avatar with AI?", lines: ["Sends only this written description to Kie's image model. No pictures, project text or voice data are sent.", "About 8 Kie credits (about USD 0.04) per picture, per the model page; Greenroom cannot see your price.", "A fictional person is asked for. You decide whether to keep the result."] });
    if (!ok) return;
    setBusy(true);
    try {
      const out = await api.avatarGenerate(text);
      const blob = await (await fetch(`data:${out.mime};base64,${out.imageB64}`)).blob();
      setPrompt(text);
      setMade({ image: await squareJpeg(blob, 512, 0.86), thumb: await squareJpeg(blob, 128, 0.8) });
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
  };
  return (
    <div className="card stack" aria-label="Create a custom avatar">
      <p className="muted small">Describe the character you want. Nothing is sent until you press Make and confirm the cost. Pictures you import never leave your computer.</p>
      <div className="row wrap">
        {field("description", "Character", "an elderly bureaucrat, stern, quietly sinister")}
        {field("period", "Historical period", "Victorian")}
        {field("genre", "Genre", "drama")}
      </div>
      <div className="row wrap">
        {field("style", "Visual style", "cinematic realism")}
        {field("clothing", "Clothing", "dark frock coat and high collar")}
        {field("expression", "Expression", "stern, faintly amused")}
        {field("background", "Background", "gaslight brown")}
      </div>
      <label className="field">
        The description that will be sent (you can edit it)
        <textarea rows={3} maxLength={1500} value={prompt || avatarPrompt(d)} onChange={(e) => setPrompt(e.target.value)} />
      </label>
      <div className="row wrap">
        <button className="primary" disabled={busy || !keys.kie || (d.description.trim().length < 3 && !prompt.trim())} onClick={() => void make()}>
          {busy ? "Making…" : "Make the picture (Kie)"}
        </button>
        {!keys.kie && <button className="sm" onClick={() => go("settings")}>Add your Kie key</button>}
      </div>
      {made && (
        <div className="row wrap" style={{ alignItems: "center" }}>
          <img src={made.image} alt="The new avatar" width={128} height={128} style={{ borderRadius: 12 }} />
          <input type="text" aria-label="Name for this avatar" placeholder="Name this avatar" value={name} onChange={(e) => setName(e.target.value)} />
          <button
            className="primary"
            disabled={!name.trim()}
            onClick={() => {
              const a: CustomAvatar = { id: `custom:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: name.trim().slice(0, 60), createdAt: new Date().toISOString(), image: made.image, thumb: made.thumb, source: "generated", prompt, tags: [d.description, d.period, d.genre].filter(Boolean).flatMap((x) => x.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2)).slice(0, 12) };
              void updateStore((s) => addCustom(s, a)).then(() => onSaved(a)).catch((e: Error) => toast(e.message, true));
            }}
          >
            Save to my avatars
          </button>
        </div>
      )}
    </div>
  );
}
