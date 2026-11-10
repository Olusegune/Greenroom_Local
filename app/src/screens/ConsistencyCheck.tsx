import { useState } from "react";
import { api } from "../api";
import { useApp } from "../ctx";
import { consistencyOf, type ConsistencyReport } from "../casting/consistency";
import type { Character } from "../types";

const WORD = { consistent: "Sounds like one voice", check: "Check by ear", different: "May be a different voice" } as const;

/** Measures whether a character's takes sound like one speaker. It compares voices only; whether the voice is right is for the owner's ears. */
export default function ConsistencyCheck({ character }: { character: Character }) {
  const { project, confirmSpend, toast } = useApp();
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ConsistencyReport | null>(null);
  const takes = (project?.lines ?? []).filter((l) => l.characterId === character.id).flatMap((l) => l.takes.map((t) => ({ takeId: t.id, lineId: l.id })));
  if (!project) return null;

  const run = async () => {
    setBusy(true);
    try {
      let st = await api.speakerStatus();
      if (!st.ready) {
        const ok = await confirmSpend({ title: "Install the speaker-similarity tool?", lines: ["A small download (about 100 MB, from PyPI) that runs on this PC.", "It only measures how alike voices are. Nothing is sent about you, and no credits are used."], download: true });
        if (!ok) return;
        st = await api.speakerInstall();
        if (!st.ready) { toast(st.detail, true); return; }
      }
      const rows = await api.speakerEmbed(project.id, takes.map((t) => t.takeId));
      const byTake = new Map(rows.filter((r) => r.embedding).map((r) => [r.take, r.embedding!]));
      setReport(consistencyOf(takes.filter((t) => byTake.has(t.takeId)).map((t) => ({ ...t, embedding: byTake.get(t.takeId)! }))));
    } catch (e) { toast(e instanceof Error ? e.message : "The check did not run.", true); } finally { setBusy(false); }
  };

  return (
    <div className="stack consistency">
      <div className="row wrap">
        <button className="sm" disabled={busy || takes.length < 2} onClick={() => void run()}>{busy ? "Measuring…" : "Check that these takes sound like one voice"}</button>
        {takes.length < 2 && <span className="small muted">Needs two or more takes of this character.</span>}
      </div>
      {report && (
        <div className="stack small" aria-live="polite">
          <p>{report.note}</p>
          {report.takes.length > 0 && <ul className="stack">{report.takes.map((t) => <li key={t.takeId}><strong>{WORD[t.verdict]}</strong> <span className="muted">similarity {t.similarity.toFixed(2)}</span></li>)}</ul>}
        </div>
      )}
    </div>
  );
}
