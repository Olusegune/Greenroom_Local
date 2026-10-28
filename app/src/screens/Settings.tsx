import { useState } from "react";
import { api, type KeyName } from "../api";
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
      <KeyCard mark="E" tone="e1" title="ElevenLabs" hint="From elevenlabs.io, Developers, API keys. Used for speech, sound effects, voice design and cloning." fields={[["elevenlabs", "API key"]]} has={keys.elevenlabs} changed={refreshKeys} />
      <KeyCard mark="V" tone="e2" title="VoiceKiller" hint="From voicekiller.com, API page. It needs both the API key and your user id." fields={[["voicekiller", "API key"], ["voicekiller-userid", "User id"]]} has={keys.voicekiller} changed={refreshKeys} />
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

function HuggingFaceConnection({ saved }: { saved: boolean }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const check = async () => { setBusy(true); setMessage(""); try { setMessage(`Connected as ${await api.huggingfaceCheck()}.`); } catch (e) { setMessage((e as Error).message); } finally { setBusy(false); } };
  return <div className="card stack"><div className="row wrap"><button disabled={!saved || busy} onClick={() => void check()}>{busy ? "Checking…" : "Check connection"}</button><button onClick={() => { void import("@tauri-apps/plugin-opener").then(({ openUrl }) => openUrl("https://huggingface.co/settings/tokens")); }}>Create a Hugging Face token</button></div><p className="muted small">The connection check sends only your token to Hugging Face. Saving or checking a token does not download a model. Advanced-model downloads and inference are still being integrated.</p>{message && <p role="status">{message}</p>}</div>;
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
