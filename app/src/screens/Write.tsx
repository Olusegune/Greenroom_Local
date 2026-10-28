import { Avatar } from "../avatar";
import { useApp } from "../ctx";
import { ENGINES } from "../engines";
import { ChevronRight } from "../icons";
import { NARRATOR, parseScript, SAMPLE_SCRIPT } from "../script";
import { Empty } from "../ui";
import { voiceLine } from "../useSample";

export default function Write() {
  const { project, edit, go, library } = useApp();
  if (!project) return null;

  const set = (script: string) =>
    edit((p) => {
      const parsed = parseScript(script, p.characters, p.lines);
      return { ...p, script, ...parsed };
    });

  const used = new Set(project.lines.map((l) => l.characterId));
  const cast = project.characters.filter((c) => used.has(c.id));
  const counts = new Map<string, number>();
  project.lines.forEach((l) => counts.set(l.characterId, (counts.get(l.characterId) ?? 0) + 1));
  const onlyNarrator = cast.length === 1 && cast[0]!.name === NARRATOR;
  const ready = project.lines.length > 0;
  const voiceless = cast.filter((c) => !library.some((v) => v.id === c.voiceId)).length;
  const patch = (id: string, voiceId: string) => edit((p) => ({ ...p, characters: p.characters.map((c) => (c.id === id ? { ...c, voiceId: voiceId || undefined } : c)) }));

  return (
    <section>
      <div>
        <h1>Script</h1>
        <p className="lede">Type what is said, in any language. For one voice, just write the words. For a conversation, start each line with the speaker.</p>
        <div className="chips" aria-label="Ways to write a line">
          <span className="syntax"><code>ADA: Hello there.</code> a speaker</span>
          <span className="syntax"><code>ADA (whispering): Keep quiet.</code> a direction</span>
          <span className="syntax"><code># Title</code> a new scene</span>
        </div>
      </div>
      <div className="row top" style={{ gap: 24 }}>
        <div style={{ flex: 1, minWidth: 0 }} className="stack">
          <textarea className="script-area" aria-label="Script" spellCheck={false} value={project.script} onChange={(e) => set(e.target.value)} placeholder={"Just type a line, or:\n\n# Scene 1\nADA: Hello there.\nTUNDE (laughing): Hello yourself!"} />
          <div className="row wrap">
            <button className="sm" onClick={() => set(SAMPLE_SCRIPT)} disabled={project.script.trim().length > 0}>
              Insert a sample scene
            </button>
            <span className="muted small">Saved automatically.</span>
            <span className="spacer" />
            <button className="primary" disabled={!ready} onClick={() => go(voiceless > 0 ? "cast" : "perform")}>
              {voiceless > 0 ? "Done, choose voices" : "Done, direct the performance"} <ChevronRight size={16} />
            </button>
          </div>
        </div>
        <aside className="card stack" style={{ width: 300 }} aria-label="What Greenroom found">
          <h3>Found in your script</h3>
          {!ready ? (
            <Empty title="No lines yet">Type anything. Plain words become one narrator&apos;s lines.</Empty>
          ) : (
            <>
              <p className="num">
                {project.scenes.length} scene{project.scenes.length === 1 ? "" : "s"}, {project.lines.length} line{project.lines.length === 1 ? "" : "s"}
              </p>
              {onlyNarrator && <p className="muted small">No speaker names found, so this is read by one narrator. Start lines with a name and a colon to add characters.</p>}
              {cast.map((c) => (
                <label key={c.id} className="field">
                  <span className="row between">
                    <span className="row">
                      <Avatar seed={(library.find((v) => v.id === c.voiceId)?.id ?? c.id) + (library.find((v) => v.id === c.voiceId)?.name ?? c.name)} gender={library.find((v) => v.id === c.voiceId)?.gender} size={34} />
                      <span className="speaker">{c.name}</span>
                    </span>
                    <span className="muted small">{counts.get(c.id)} line{counts.get(c.id) === 1 ? "" : "s"}</span>
                  </span>
                  <select value={library.some((v) => v.id === c.voiceId) ? c.voiceId : ""} onChange={(e) => patch(c.id, e.target.value)} aria-label={`Voice for ${c.name}`}>
                    <option value="">{library.length ? "Choose a voice…" : "No voices yet"}</option>
                    {library.map((v) => (
                      <option key={v.provider + v.id} value={v.id}>
                        {v.name} {voiceLine(v) ? `(${voiceLine(v)})` : ""} · {ENGINES[v.provider].label}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
              {library.length === 0 && (
                <button onClick={() => go("voices")}>Find a voice first</button>
              )}
            </>
          )}
        </aside>
      </div>
    </section>
  );
}
