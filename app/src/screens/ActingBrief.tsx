import { useMemo } from "react";
import { compileActing, renderActing } from "../performanceCompiler";
import { engineLabel } from "../engineCaps";
import type { InworldModel } from "../engines";
import type { Line, VoiceEntry } from "../types";

const WORDS: Record<"sent" | "approximated" | "not_sent", string> = { sent: "Sent", approximated: "Approximated", not_sent: "Not sent" };

/**
 * The director's own words for a line, compiled for the chosen voice. It shows exactly what the voice will be given, what
 * is only approximated and what cannot be sent at all, before anything is made. The line's text is never changed.
 */
export default function ActingBrief({ line, voice, inworldModel, patch }: { line: Line; voice?: VoiceEntry; inworldModel?: InworldModel; patch: (fn: (l: Line) => Line) => void }) {
  const brief = line.acting ?? "";
  const render = useMemo(() => {
    if (!brief.trim() || !voice) return null;
    return renderActing(line, compileActing(brief, line.text), { engine: voice.provider, ...(inworldModel ? { inworldModel } : {}) });
  }, [brief, line, voice, inworldModel]);
  const draft = useMemo(() => (brief.trim() ? compileActing(brief, line.text) : null), [brief, line.text]);
  const phrased = line.beatMode === "assemble";
  return (
    <details className="acting-brief" open={!!brief}>
      <summary>Direct in your own words{brief ? " · set" : ""}</summary>
      <label className="small">What should happen in this line?
        <textarea
          rows={2}
          maxLength={600}
          value={brief}
          placeholder="Begins with impeccable politeness, clears his throat, chuckles quietly, pauses, then delivers the final sentence with restrained menace."
          onChange={(e) => patch((l) => ({ ...l, acting: e.target.value || undefined }))}
        />
      </label>
      {draft && draft.draft.unrecognized.length > 0 && <p className="dir-reach warn small">Not understood, so not used: {draft.draft.unrecognized.map((u) => `“${u}”`).join(", ")}.</p>}
      {draft?.warnings.filter((w) => !w.startsWith("Not understood")).map((w) => <p key={w} className="dir-reach warn small">{w}</p>)}
      {draft && draft.carried.length === 0 && null}
      {!voice && brief && <p className="muted small">Choose a voice in Cast to see what it can be given.</p>}
      {render && voice && (
        <div className="small" aria-live="polite">
          <strong>{engineLabel(voice.provider)} will get:</strong>
          <ul className="brief-items">
            {render.items.map((i, k) => (
              <li key={k}><span className={i.status === "sent" ? "badge ok" : "badge warn"}>{WORDS[i.status]}</span> {i.what} <span className="muted">· {i.how}</span></li>
            ))}
            {render.items.length === 0 && <li className="muted">Nothing it recognised.</li>}
          </ul>
          {render.suggestions.map((s) => <p key={s} className="muted">{s}</p>)}
          {render.compiled.beats.length > 0 || render.compiled.pauses.length > 0 ? (
            <button className="sm" aria-pressed={phrased} onClick={() => patch((l) => ({ ...l, beatMode: phrased ? "cues" : "assemble" }))}>
              {phrased ? `Phrase by phrase: on (${render.requests} requests)` : "Make it phrase by phrase"}
            </button>
          ) : null}
          <p className="muted">This only shapes what is sent. Nothing is generated or spent until you make a take.</p>
        </div>
      )}
    </details>
  );
}
