import { useState } from "react";
import { ACCENTS, applyPalette, readPalette, savePalette } from "../palette";
import { api, type KeyName } from "../api";
import { inworldCache } from "../finder";
import { useApp } from "../ctx";
import { checkForUpdates, installUpdate, useUpdates } from "../updates";
import { APP_VERSION } from "../version";

export default function Settings() {
  const { keys, refreshKeys, engines, saveEngines, saving } = useApp();
  const u = useUpdates();
  return (
    <section>
      <div>
        <h1>Settings</h1>
        <p className="lede">Your keys are saved in the Windows Credential Manager. Greenroom can use them but never shows them again, and never writes them to a file.</p>
      </div>
      <AppearanceSettings />
      <ColourSettings />
      <KeyCard mark="E" tone="e1" title="ElevenLabs" hint="From elevenlabs.io, Developers, API keys. Used for speech, sound effects, voice design and cloning." fields={[["elevenlabs", "API key"]]} has={keys.elevenlabs} changed={refreshKeys} />
      <KeyCard mark="V" tone="e2" title="VoiceKiller" hint="From voicekiller.com, API page. It needs both the API key and your user id." fields={[["voicekiller", "API key"], ["voicekiller-userid", "User id"]]} has={keys.voicekiller} changed={refreshKeys} />
      <KeyCard mark="I" tone="e4" title="Inworld" hint="From the Inworld Portal, Settings, API keys: copy the Base64 credential and paste it here as it is. Used for Inworld voices, speech and cloning." fields={[["inworld", "Base64 credential"]]} has={keys.inworld} changed={refreshKeys} />
      <InworldConnection saved={keys.inworld} />
      <KeyCard mark="O" tone="e5" title="OpenAI" hint="From platform.openai.com, API keys. Used only for the AI Director and for reading a script (never for voices). Each request is billed by OpenAI to your account." fields={[["openai", "API key"]]} has={keys.openai} changed={refreshKeys} />
      <KeyCard mark="G" tone="e2" title="Google Gemini" hint="From Google AI Studio (aistudio.google.com), Get API key. Used only for the AI Director and for reading a script. Each request is billed to your Google account (some models have a free tier)." fields={[["gemini", "API key"]]} has={keys.gemini} changed={refreshKeys} />
      <KeyCard mark="K" tone="e3" title="Kie" hint="From kie.ai, API Key page. Used for Kie voices, sound effects, the AI Director and Suno music." fields={[["kie", "API key"]]} has={keys.kie} changed={refreshKeys} />
      <h2>Model repository connections</h2>
      <KeyCard mark="H" tone="e5" title="Hugging Face" hint="Create a read-only access token in Hugging Face settings. For gated models, first obtain access on the model page. Your token is stored in your system credential store." fields={[["huggingface", "read token"]]} has={keys.huggingface} changed={refreshKeys} />
      <HuggingFaceConnection saved={keys.huggingface} />
      <div className="card stack" id="updates">
        <div className="row between wrap">
          <span className="eng-id">
            <strong>Updates</strong>
            <span className="muted small">
              You have Greenroom {APP_VERSION}.{" "}
              {u.phase === "none" ? "This is the newest version." : u.phase === "available" && u.info ? `Version ${u.info.version} is available.` : u.phase === "checking" ? "Looking…" : ""}
            </span>
          </span>
          {u.phase !== "available" && u.phase !== "installing" && (
            <button onClick={() => void checkForUpdates()} disabled={u.phase === "checking"}>
              {u.phase === "checking" ? "Looking…" : "Check for updates"}
            </button>
          )}
        </div>
        {u.phase === "error" && (
          <p className="err-text small" role="alert">
            {u.error}
          </p>
        )}
        {(u.phase === "available" || u.phase === "installing") && u.info && (
          <div className="update-box">
            <strong>Greenroom {u.info.version}</strong>
            {u.info.notes && <p className="muted small" style={{ whiteSpace: "pre-wrap", margin: "4px 0 0" }}>{u.info.notes}</p>}
            {u.phase === "installing" ? (
              <div style={{ marginTop: 10 }}>
                <div className="progress" aria-hidden="true">
                  <i style={{ width: u.progress < 0 ? "40%" : `${Math.round(u.progress * 100)}%` }} />
                </div>
                <p className="muted small" role="status">
                  {u.progress >= 1 ? "Installing and restarting…" : u.progress < 0 ? "Downloading…" : `Downloading… ${Math.round(u.progress * 100)}%`}
                </p>
              </div>
            ) : (
              <div className="row wrap" style={{ marginTop: 10 }}>
                <button className="primary" onClick={() => void installUpdate()} disabled={saving === "saving"}>
                  Download, install and restart
                </button>
                <span className="muted small">Greenroom closes and opens again. Your projects are saved automatically first. The download is checked against Greenroom's signature and is refused if it does not match.</span>
              </div>
            )}
          </div>
        )}
        <label className="row small">
          <input type="checkbox" checked={engines.updateCheck !== false} onChange={(e) => saveEngines({ ...engines, updateCheck: e.target.checked })} /> Look for a new version when Greenroom starts
        </label>
        <p className="muted small">Looking sends only an ordinary web request to GitHub (which can see your internet address). Nothing about you or your projects is sent, and nothing is ever installed unless you press the button.</p>
      </div>

      <div className="card stack">
        <h2>About</h2>
        <p className="muted small">
          Greenroom {APP_VERSION}. Everything you make (projects, takes, voices, backups and exports) is kept on this computer in Documents\Greenroom. Only the text of a line, a description or a style is sent to a provider, and only when you confirm.
        </p>
      </div>
    </section>
  );
}

function AppearanceSettings() {
  const [theme, setTheme] = useState(() => localStorage.getItem("greenroom-appearance") ?? "system");
  const apply = (next: string) => {
    setTheme(next); localStorage.setItem("greenroom-appearance", next);
    document.documentElement.dataset.theme = next === "system" ? (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark") : next;
  };
  return <div className="card appearance-card"><div><h2>Appearance</h2><p className="muted small">Choose a bright studio surface, a dark stage, or follow your computer.</p></div><div className="appearance-options" role="group" aria-label="Appearance"><button className={theme === "light" ? "selected" : ""} onClick={() => apply("light")}>Light</button><button className={theme === "dark" ? "selected" : ""} onClick={() => apply("dark")}>Dark</button><button className={theme === "system" ? "selected" : ""} onClick={() => apply("system")}>System</button></div></div>;
}

function ColourSettings() {
  const [p, setP] = useState(() => readPalette((k) => { try { return localStorage.getItem(k); } catch { return null; } }));
  const set = (next: typeof p) => { setP(next); savePalette(next); applyPalette(document.documentElement, next); };
  return <div className="card stack"><div><h2>Colour</h2><p className="muted small">Pick an accent and a surface. The change is instant and saved on this computer.</p></div>
    <div className="row wrap" role="group" aria-label="Accent colour">{ACCENTS.map((a) => <button key={a.id} className={p.accent === a.id ? "selected" : ""} aria-pressed={p.accent === a.id} title={a.note} onClick={() => set({ ...p, accent: a.id })}><span aria-hidden="true" style={{ display: "inline-block", width: 12, height: 12, borderRadius: "50%", background: a.swatch, marginRight: 8 }} />{a.label}</button>)}</div>
    <div className="row wrap" role="group" aria-label="Surface"><button className={p.surface === "graphite" ? "selected" : ""} aria-pressed={p.surface === "graphite"} onClick={() => set({ ...p, surface: "graphite" })}>Graphite (neutral)</button><button className={p.surface === "tinted" ? "selected" : ""} aria-pressed={p.surface === "tinted"} onClick={() => set({ ...p, surface: "tinted" })}>Green-tinted (original)</button></div></div>;
}

function HuggingFaceConnection({ saved }: { saved: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); setMessage(""); try { setMessage(`Connected as ${await api.huggingfaceCheck()}.`); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } };
  return <div className="card stack"><div className="row wrap"><button disabled={!saved || busy} onClick={() => void check()}>{busy ? "Checking…" : "Check connection"}</button><button onClick={() => { void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl("https://huggingface.co/settings/tokens")); }}>Create a Hugging Face token</button></div><p className="muted small">The connection check sends only your token to Hugging Face. Saving or checking a token does not download a model. Advanced-model downloads and inference are still being integrated.</p>{message && <p role="status">{message}</p>}</div>;
}

function InworldConnection({ saved }: { saved: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => {
    setBusy(true);
    setMessage("");
    try {
      const n = await api.inworldCheck();
      setMessage(`Connected. ${n} voice${n === 1 ? "" : "s"} available to this key. Open Voices to browse them.`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const refresh = async () => {
    setBusy(true);
    setMessage("");
    try {
      const page = await api.voicesInworld();
      inworldCache.list = page.voices;
      setMessage(`Loaded ${page.voices.length} voice${page.voices.length === 1 ? "" : "s"}${page.truncated ? " (the list was cut at a safe limit; narrow it in Voices)" : ""}.`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="card stack">
      <div className="row wrap">
        <button disabled={!saved || busy} onClick={() => void check()}>{busy ? "Checking…" : "Test Inworld connection"}</button>
        <button disabled={!saved || busy} onClick={() => void refresh()}>Refresh voices</button>
        <button onClick={() => { void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl("https://platform.inworld.ai/")); }}>Open the Inworld Portal</button>
      </div>
      <p className="muted small">The test only lists your voices, so it costs nothing. The key belongs to one Inworld workspace; a workspace address alone cannot sign in. Use Remove above to disconnect.</p>
      {message && <p role="status">{message}</p>}
    </div>
  );
}

function KeyCard({ mark, tone, title, hint, fields, has, changed }: { mark: string; tone: string; title: string; hint: string; fields: [KeyName, string][]; has: boolean; changed: () => void }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const filled = fields.every(([n]) => (values[n] ?? "").trim());
  const save = async () => {
    try {
      for (const [n] of fields) await api.setKey(n, values[n] ?? "");
      setValues({});
      setMsg({ ok: true, text: "Saved." });
      changed();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  const remove = async () => {
    try {
      for (const [n] of fields) await api.clearKey(n);
      setMsg({ ok: true, text: "Removed." });
      changed();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <div className="card stack">
      <div className="row between">
        <span className="row" style={{ gap: 14 }}>
          <span className={`eng-mark ${tone}`} aria-hidden="true">
            {mark}
          </span>
          <span className="eng-id">
            <strong>{title}</strong>
            <span className="muted small">{hint}</span>
          </span>
        </span>
        <span className={has ? "badge ok" : "badge"}>{has ? "Saved" : "Not added"}</span>
      </div>
      <div className="row wrap">
        {fields.map(([n, label]) => (
          <input key={n} type="password" autoComplete="off" spellCheck={false} aria-label={`${title} ${label}`} placeholder={has ? `New ${label === "API key" ? label : label.toLowerCase()} to replace` : `Paste ${label === "API key" ? label : label.toLowerCase()}`} value={values[n] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [n]: e.target.value }))} style={{ flex: 1, minWidth: 200 }} />
        ))}
        <button className="primary" disabled={!filled} onClick={save}>
          Save
        </button>
        {has && (
          <button onClick={remove} className="danger">
            Remove
          </button>
        )}
      </div>
      {msg && (
        <p role="status" className={msg.ok ? "ok-text small" : "err-text small"} style={{ marginTop: 8 }}>
          {msg.text}
        </p>
      )}
    </div>
  );
}
