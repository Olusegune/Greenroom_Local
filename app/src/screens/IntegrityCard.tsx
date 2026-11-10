import { integrityOf, type Integrity, type RowState } from "../casting/integrity";
import type { MatchContext } from "../casting/types";
import type { Character, VoiceEntry } from "../types";
import { CharacterMark } from "../voiceMark";

const ICON: Record<RowState, { glyph: string; word: string }> = {
  verified: { glyph: "✓", word: "Confirmed" },
  claimed: { glyph: "!", word: "Claimed, not heard" },
  unknown: { glyph: "?", word: "Unknown" },
  conflict: { glyph: "✕", word: "Conflicts" },
  limit: { glyph: "≈", word: "Close, with limits" },
  none: { glyph: "–", word: "Not required" },
};

/** The rows of the table: what the character requires, what the voice has, and whether that is proven. The glyph is always paired with a word. */
export function IntegrityTable({ t }: { t: Integrity }) {
  return (
    <table className="integrity-table">
      <caption className="sr-only">What {t.voiceName} can be shown to deliver against what the character requires</caption>
      <thead><tr><th scope="col">Requires</th><th scope="col">The voice</th><th scope="col"><span className="sr-only">Status</span></th></tr></thead>
      <tbody>
        {t.rows.map((r) => (
          <tr key={r.id} className={`it-${r.state}`} title={r.why || undefined}>
            <th scope="row"><span className="it-label">{r.label}</span><span className="it-req">{r.required}</span></th>
            <td>{r.has}</td>
            <td className="it-state"><span className={`it-icon it-${r.state}`} role="img" aria-label={ICON[r.state].word} title={ICON[r.state].word}>{r.id === "identity" && r.state === "verified" ? "🔒" : ICON[r.state].glyph}</span></td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** The Casting Integrity card: who the character is, the status in one word, the table, and one honest sentence. */
export default function IntegrityCard({ character, voice, context }: { character: Character; voice: VoiceEntry; context?: MatchContext }) {
  const t = integrityOf(character, voice, context);
  return (
    <section className="integrity-card" aria-label={`Casting integrity for ${character.name}`}>
      <header className="row between wrap">
        <span className="row">
          <CharacterMark name={character.name} size={36} />
          <span className="stack tight"><strong>{character.name}</strong><span className="muted small">Character casting profile · {voice.name}</span></span>
        </span>
        <span className={`status-chip s-${t.status.toLowerCase()}`}>{t.statusLabel}</span>
      </header>
      <IntegrityTable t={t} />
      <p className="small it-summary" aria-live="polite">{t.summary}</p>
    </section>
  );
}
