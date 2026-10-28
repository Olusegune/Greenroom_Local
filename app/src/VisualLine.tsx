import { useEffect, useMemo, useRef, useState } from "react";
import { INSERT_GROUPS, insertTok, joinTokens, moveTok, removeTok, tagGroup, tokenize, type TagGroup } from "./direct";
import { Close, Plus } from "./icons";

const COLOR: Record<TagGroup, string> = {
  Reactions: "var(--accent)",
  "Effort and body": "var(--warm)",
  Voice: "#7cc7e8",
  Beats: "#a9b4ad",
  Other: "#c9a7ee",
};

/**
 * A line shown as words with small "+" spots between them. Click a spot to choose a sound; it appears as a coloured pill
 * you can drag to another spot or remove. The line is stored as ordinary text with [tags], so nothing else changes.
 */
export function VisualLine({ text, onChange, disabledNote, label }: { text: string; onChange: (t: string) => void; disabledNote?: string; label: string }) {
  const toks = useMemo(() => tokenize(text), [text]);
  const [open, setOpen] = useState<number | null>(null);
  const [drag, setDrag] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const [custom, setCustom] = useState("");

  useEffect(() => {
    if (open === null) return;
    const down = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(null);
    const key = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("mousedown", down);
      window.removeEventListener("keydown", key);
    };
  }, [open]);

  const commit = (next: typeof toks) => onChange(joinTokens(next));
  const pick = (tag: string) => {
    if (open === null) return;
    commit(insertTok(toks, open, tag));
    setOpen(null);
    setCustom("");
  };

  const gap = (at: number) => {
    const word = toks[at - 1]?.text ?? "";
    return (
      <button
        type="button"
        className={`vgap${open === at ? " on" : ""}${over === at ? " drop" : ""}${at === 0 || at === toks.length ? " edge" : ""}`}
        aria-label={at === 0 ? "Add a sound at the start" : `Add a sound after ${word}`}
        aria-expanded={open === at}
        onClick={() => setOpen(open === at ? null : at)}
        onDragOver={(e) => {
          if (drag === null) return;
          e.preventDefault();
          setOver(at);
        }}
        onDragLeave={() => setOver((o) => (o === at ? null : o))}
        onDrop={(e) => {
          e.preventDefault();
          if (drag !== null) commit(moveTok(toks, drag, at));
          setDrag(null);
          setOver(null);
        }}
      >
        <Plus size={11} />
      </button>
    );
  };

  return (
    <div className="vline-wrap" ref={wrap}>
      <div className="vline" role="group" aria-label={label}>
        {toks.length === 0 && <span className="muted small">Nothing to say yet. Switch to “Edit text” to type the words.</span>}
        {toks.length > 0 && gap(0)}
        {toks.map((t, i) => (
          <span key={i} className="vitem">
            {t.kind === "word" ? (
              <span className="vword">{t.text}</span>
            ) : (
              <span
                className={`vtag${drag === i ? " dragging" : ""}`}
                style={{ ["--tag" as string]: COLOR[tagGroup(t.text)] }}
                draggable
                onDragStart={(e) => {
                  setDrag(i);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", t.text);
                }}
                onDragEnd={() => {
                  setDrag(null);
                  setOver(null);
                }}
                title="Drag to move"
              >
                {t.text}
                <button type="button" className="vx" aria-label={`Remove ${t.text}`} onClick={() => commit(removeTok(toks, i))}>
                  <Close size={11} />
                </button>
              </span>
            )}
            {gap(i + 1)}
          </span>
        ))}
      </div>
      {open !== null && (
        <div className="vpicker card" role="dialog" aria-label="Choose a sound">
          {disabledNote && <p className="note warn small">{disabledNote}</p>}
          {INSERT_GROUPS.map((g) => (
            <div key={g.title} className="row wrap" style={{ alignItems: "flex-start" }}>
              <span className="small" style={{ width: 118, color: COLOR[g.title as TagGroup], fontWeight: 600 }}>
                {g.title}
              </span>
              <span className="chips" style={{ flex: 1 }}>
                {g.tags.map((c) => (
                  <button key={c.tag} type="button" className="chip" aria-pressed="false" title={c.verified ? "Heard and approved" : "Not yet listened to"} onClick={() => pick(c.tag)}>
                    {c.tag}
                    {c.verified ? "" : " ·"}
                  </button>
                ))}
              </span>
            </div>
          ))}
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              if (custom.trim()) pick(custom);
            }}
          >
            <input type="text" aria-label="Your own sound or direction" placeholder="Or your own: for example nervous laugh" value={custom} onChange={(e) => setCustom(e.target.value)} style={{ flex: 1 }} />
            <button className="sm" type="submit" disabled={!custom.trim()}>
              Add
            </button>
          </form>
          <p className="muted small">A dot means not yet listened to. Press Esc to close.</p>
        </div>
      )}
    </div>
  );
}
