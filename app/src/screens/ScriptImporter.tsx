import { useState } from "react";
import { api, type ScriptFile } from "../api";
import { useApp } from "../ctx";
import { askCloud } from "../directorCall";
import { directorLabel, directorReady } from "../engines";
import { parseScript } from "../script";
import { convertScript, mergeScript, type Converted } from "../scriptImport";
import { castingSystem, castingUser, parseCasting } from "../scriptAi";
import type { Character } from "../types";
import { CharacterLooks } from "./CharacterLooks";

type Row = { name: string; lines: number; about?: string; look?: Character["look"] };

const FORMAT: Record<ScriptFile["format"], string> = { text: "plain text", fountain: "Fountain screenplay", word: "Word document", pdf: "PDF" };
const KIND: Record<Converted["kind"], string> = { app: "already written as NAME: line", screenplay: "a screenplay", plain: "prose" };

/** Import a script from a file (text, Fountain, Word or PDF): read it, show who is in it, and add it to the project. */
export function ScriptImporter({ onClose }: { onClose: () => void }) {
  const { project, edit, engines, keys, confirmSpend, addLedger, toast } = useApp();
  const [file, setFile] = useState<ScriptFile | null>(null);
  const [conv, setConv] = useState<Converted | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [mode, setMode] = useState<"replace" | "append">(project?.script.trim() ? "append" : "replace");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  if (!project) return null;

  const cloudReady = engines.directorEngine !== "local" && directorReady(engines, keys, false);

  const choose = async () => {
    setBusy(true);
    try {
      const path = await api.pickScript();
      if (!path) return;
      const f = await api.scriptOpen(path);
      const c = convertScript(f.text);
      setFile(f);
      setConv(c);
      setRows(c.characters.map((x) => ({ name: x.name, lines: x.lines, about: x.about || undefined, look: x.gender || x.age || x.heritage ? { gender: x.gender, age: x.age, heritage: x.heritage } : undefined })));
    } catch (e) {
      toast((e as Error).message || "Greenroom could not read that file.", true);
    } finally {
      setBusy(false);
    }
  };

  const readWithAi = async () => {
    if (!conv) return;
    const user = castingUser(conv.text, rows.map((r) => r.name));
    const sys = castingSystem();
    const ok = await confirmSpend({
      title: "Read the characters with AI?",
      lines: [`Sends the script text (${Math.min(conv.text.length, 60_000).toLocaleString()} characters) and the character names to ${directorLabel(engines)}`, "It suggests who each character is. You review and edit every suggestion before anything is used.", "Billed by your provider to your own account; Greenroom cannot see the price."],
    });
    if (!ok) return;
    setThinking(true);
    try {
      const reply = await askCloud(engines, sys, user);
      addLedger({ kind: "director", engine: directorLabel(engines), chars: sys.length + user.length, items: [{ kind: "director" }] });
      const found = parseCasting(reply, rows.map((r) => r.name));
      if (!found.length) {
        toast("The AI did not send anything usable. Your own edits are untouched.", true);
        return;
      }
      setRows((cur) =>
        cur.map((r) => {
          const f = found.find((x) => x.name === r.name);
          if (!f) return r;
          const look = { gender: r.look?.gender ?? f.gender, age: r.look?.age ?? f.age, heritage: r.look?.heritage ?? f.heritage };
          return { ...r, about: r.about || f.about, look: look.gender || look.age || look.heritage ? look : undefined };
        }),
      );
      toast(`The AI described ${found.length} character${found.length === 1 ? "" : "s"}. Check them below.`);
    } catch (e) {
      toast((e as Error).message, true);
    } finally {
      setThinking(false);
    }
  };

  const add = () => {
    if (!conv) return;
    edit((p) => {
      const script = mergeScript(p.script, conv.text, mode);
      const parsed = parseScript(script, p.characters, p.lines);
      const characters = parsed.characters.map((c) => {
        const r = rows.find((x) => x.name.toLowerCase() === c.name.toLowerCase());
        // what the owner already said about a character is never overwritten
        return r && !c.about && !c.look ? { ...c, about: r.about, look: r.look } : c;
      });
      return { ...p, script, scenes: parsed.scenes, lines: parsed.lines, characters };
    });
    toast(`Imported ${conv.lines} line${conv.lines === 1 ? "" : "s"} and ${rows.length} character${rows.length === 1 ? "" : "s"}.`);
    onClose();
  };

  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="si-t" style={{ width: "min(860px, 96vw)", maxHeight: "92vh", overflow: "auto" }}>
        <h2 id="si-t">Import a script</h2>
        <p className="muted small">Choose a plain text, Markdown, Fountain, Word (.docx) or PDF file. Greenroom reads it on this computer, works out who is speaking, and shows you the result before anything is added. Nothing is sent anywhere unless you press "Read the characters with AI".</p>
        <div className="row wrap" style={{ marginBottom: 12 }}>
          <button className="primary" disabled={busy} onClick={() => void choose()}>
            {file ? "Choose a different file…" : "Choose a script…"}
          </button>
          {busy && <span className="muted small">Reading…</span>}
        </div>
        {file && conv && (
          <div className="stack" style={{ gap: 12 }}>
            <p className="small" style={{ margin: 0 }}>
              <strong>{file.name}</strong> · {FORMAT[file.format]}, read as {KIND[conv.kind]} · {conv.scenes} scene{conv.scenes === 1 ? "" : "s"}, {conv.lines} line{conv.lines === 1 ? "" : "s"}, {rows.length} character{rows.length === 1 ? "" : "s"}
            </p>
            {file.truncated && <p className="small" role="alert" style={{ margin: 0, color: "var(--warn, #ffd28a)" }}>The file was very long, so only the first part was read.</p>}
            {conv.warnings.length > 0 && (
              <ul className="small" role="alert" style={{ margin: "0 0 0 18px", color: "var(--warn, #ffd28a)" }}>
                {conv.warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            )}
            <details>
              <summary className="small">What will be added (the first part)</summary>
              <textarea readOnly rows={8} aria-label="Converted script" value={conv.text.slice(0, 3000)} style={{ width: "100%" }} />
            </details>
            {rows.length > 0 && (
              <>
                <div className="row wrap" style={{ gap: 8 }}>
                  <h3 style={{ margin: 0 }}>Characters</h3>
                  <span className="spacer" />
                  <button className="sm" disabled={thinking || !cloudReady} onClick={() => void readWithAi()} title={cloudReady ? "Ask your chosen AI provider to describe each character" : "Choose OpenAI, Gemini or Kie in Engines and add its key in Settings"}>
                    {thinking ? "Reading…" : "Read the characters with AI"}
                  </button>
                </div>
                {rows.map((r) => (
                  <div key={r.name} style={{ padding: 10, border: "1px solid var(--line)", borderRadius: 10 }}>
                    <p className="small" style={{ margin: "0 0 6px" }}>
                      <strong>{r.name}</strong> · {r.lines} line{r.lines === 1 ? "" : "s"}
                    </p>
                    <CharacterLooks name={r.name} about={r.about} look={r.look} onChange={(p) => setRows((cur) => cur.map((x) => (x.name === r.name ? { ...x, ...("about" in p ? { about: p.about } : {}), ...("look" in p ? { look: p.look } : {}) } : x)))} />
                  </div>
                ))}
              </>
            )}
            <fieldset className="row wrap" style={{ border: 0, padding: 0, gap: 16 }}>
              <label className="row" style={{ gap: 6 }}>
                <input type="radio" name="si-mode" checked={mode === "replace"} onChange={() => setMode("replace")} /> Replace the current script
              </label>
              <label className="row" style={{ gap: 6 }}>
                <input type="radio" name="si-mode" checked={mode === "append"} onChange={() => setMode("append")} /> Add to the end of it
              </label>
            </fieldset>
          </div>
        )}
        <div className="row end" style={{ marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!conv || conv.lines === 0} onClick={add}>
            Add to the project
          </button>
        </div>
      </div>
    </div>
  );
}
