import { useEffect, useState } from "react";
import { api, type PiperStatus } from "../api";
import { useApp } from "../ctx";
import { ENGINES, QUALITIES, SOUND_ENGINES, soundEngineOf, type ElevenModel, type ElevenSfxModel, type Quality, type SoundEngine } from "../engines";
import { Note, useBusy } from "../ui";
import { BASIS_LABEL } from "../trust";
import type { ConsentBasis } from "../types";

/** One engine: a folded card with its mark, name and status always visible, and its settings inside. */
function EngineCard({ mark, tone, title, status, ok, blurb, children, open }: { mark: string; tone: string; title: string; status: string; ok?: boolean; blurb: string; children?: React.ReactNode; open?: boolean }) {
  return (
    <details className="card eng fold" open={open}>
      <summary>
        <span className={`eng-mark ${tone}`} aria-hidden="true">
          {mark}
        </span>
        <span className="eng-id">
          <strong>{title}</strong>
          <span className="muted small">{blurb}</span>
        </span>
        <span className={ok ? "badge ok" : "badge"}>{status}</span>
      </summary>
      <div className="stack eng-body">{children}</div>
    </details>
  );
}

export default function Engines() {
  const { keys, engines, saveEngines, go } = useApp();
  return (
    <section>
      <div>
        <h1>Engines</h1>
        <p className="lede">An engine is where a voice comes from. Each voice belongs to one engine, so choosing a voice in Cast chooses the engine. Set up the ones you want here.</p>
      </div>
      <div className="engine-quick card">
        <div><strong>Quick setup</strong><p className="muted small">Piper is the offline starting point. Cloud engines stay optional and use your own accounts.</p></div>
        <div className="row wrap"><button className="primary" onClick={() => go("voices")}>Find local voices</button><button onClick={() => go("settings")}>Manage connections</button><button className="sm" onClick={() => go("lab")}>Test voices</button></div>
      </div>

      <EngineCard mark="E" tone="e1" title={ENGINES.elevenlabs.label} status={keys.elevenlabs ? "Key saved" : "Needs a key"} ok={keys.elevenlabs} blurb="Speech, sound effects, voice design and cloning">
        <p className="muted small">{ENGINES.elevenlabs.blurb}</p>
        <div className="row wrap">
          <label className="field" style={{ maxWidth: 320, flex: 1 }}>
            Speech model
            <select value={engines.elevenModel} onChange={(e) => saveEngines({ ...engines, elevenModel: e.target.value as ElevenModel })}>
              <option value="eleven_v4">Eleven v4 (newest, best)</option>
              <option value="eleven_v3">Eleven v3</option>
            </select>
          </label>
          <label className="field" style={{ maxWidth: 420, flex: 1 }}>
            Audio quality
            <select value={engines.quality ?? "standard"} onChange={(e) => saveEngines({ ...engines, quality: e.target.value as Quality })}>
              {QUALITIES.map((q) => (
                <option key={q.id} value={q.id}>
                  {q.label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="muted small">{QUALITIES.find((q) => q.id === (engines.quality ?? "standard"))?.note} Lossless sources keep a 24-bit export clean; an MP3 source cannot gain detail it does not have.</p>
        {!keys.elevenlabs && (
          <div>
            <button onClick={() => go("settings")}>Add the key in Settings</button>
          </div>
        )}
      </EngineCard>

      <Simple mark="V" tone="e2" title={ENGINES.voicekiller.label} ready={keys.voicekiller} short="About two thousand voices; no inline sound tags" blurb={ENGINES.voicekiller.blurb} extra={<VkClone />} />
      <Simple mark="K" tone="e3" title={ENGINES.kie.label} ready={keys.kie} short="Preset voices, sound effects, the AI Director and Suno music" blurb={ENGINES.kie.blurb} />
      <EngineCard mark="S" tone="e4" title="Sound clips and atmosphere" status={soundEngineOf(engines).label.split(" ")[0] ?? ""} ok={!!keys[soundEngineOf(engines).key]} blurb="Which engine makes sneezes, doors and the background">
        <p className="muted small">Which engine makes sneezes, doors, footsteps and the background atmosphere. This is separate from the voices, so a project can speak with one engine and make its sounds with another.</p>
        <label className="field" style={{ maxWidth: 360 }}>
          Sound engine
          <select value={soundEngineOf(engines).id} onChange={(e) => saveEngines({ ...engines, soundEngine: e.target.value as SoundEngine })}>
            {SOUND_ENGINES.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
                {keys[s.key] ? "" : " (needs a key)"}
              </option>
            ))}
          </select>
        </label>
        {soundEngineOf(engines).id === "elevenlabs" && (
          <label className="field" style={{ maxWidth: 360 }}>
            ElevenLabs sound model
            <select value={engines.elevenSfxModel ?? "eleven_text_to_sound_v3"} onChange={(e) => saveEngines({ ...engines, elevenSfxModel: e.target.value as ElevenSfxModel })}>
              <option value="eleven_text_to_sound_v3">Sound Effects v3 — recommended</option>
              <option value="eleven_text_to_sound_v2">Sound Effects v2 — fallback</option>
            </select>
          </label>
        )}
        <div className="row wrap">
          <button className="primary" onClick={() => go("sfx")}>Open SFX Studio</button>
          <span className="muted small">Create, audition and place an effect directly on a script line.</span>
        </div>
        {!keys[soundEngineOf(engines).key] && (
          <div>
            <button onClick={() => go("settings")}>Add the key in Settings</button>
          </div>
        )}
        <p className="muted small">Music is added from files on the Timeline. Making music with an engine such as Suno is not built yet.</p>
      </EngineCard>

      <Piper />
      <LocalServer />
    </section>
  );
}

function Simple({ title, ready, blurb, short, extra, mark, tone }: { title: string; ready: boolean; blurb: string; short: string; extra?: React.ReactNode; mark: string; tone: string }) {
  const { go } = useApp();
  return (
    <EngineCard mark={mark} tone={tone} title={title} status={ready ? "Key saved" : "Needs a key"} ok={ready} blurb={short}>
      <p className="muted small">{blurb}</p>
      {!ready && (
        <div>
          <button onClick={() => go("settings")}>Add the key in Settings</button>
        </div>
      )}
      {ready && extra}
    </EngineCard>
  );
}

function VkClone() {
  const { library, saveLibrary, toast } = useApp();
  const [name, setName] = useState("");
  const [who, setWho] = useState("");
  const [basis, setBasis] = useState<ConsentBasis | "">("");
  const register = () => {
    const n = name.trim();
    if (!n || !who.trim() || !basis) return;
    if (library.some((v) => v.id === n && v.provider === "voicekiller")) return toast(`${n} is already in your library.`);
    saveLibrary((l) => [...l, { id: n, name: n, provider: "voicekiller", vkClone: true, source: "cloned", language: "", accent: "", gender: "", notes: "Cloned on voicekiller.com", createdAt: new Date().toISOString(), consent: { speaker: who.trim(), basis, reference: "", date: new Date().toISOString().slice(0, 10) } }]);
    toast(`${n} registered.`);
    setName("");
    setWho("");
    setBasis("");
  };
  return (
    <div className="stack">
      <h3>A voice you cloned on voicekiller.com</h3>
      <p className="muted small">Clones cannot be created through their API, so register one here by the exact name you gave it on their website.</p>
      <div className="row">
        <input type="text" aria-label="Clone name on VoiceKiller" placeholder="Exact name of the clone" value={name} onChange={(e) => setName(e.target.value)} style={{ flex: 1 }} />
        <button disabled={!name.trim() || !who.trim() || !basis} onClick={register}>
          Register clone
        </button>
      </div>
      <div className="row wrap">
        <input type="text" aria-label="Whose voice is the clone" placeholder="Whose voice it is" value={who} onChange={(e) => setWho(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
        <select aria-label="Basis for using the clone" value={basis} onChange={(e) => setBasis(e.target.value as ConsentBasis)}>
          <option value="">Basis for using it…</option>
          {(["self", "permission", "licence", "other"] as ConsentBasis[]).map((b) => (
            <option key={b} value={b}>
              {BASIS_LABEL[b]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function Piper() {
  const { go, confirmSpend, toast } = useApp();
  const { busy, run } = useBusy();
  const [st, setSt] = useState<PiperStatus | null>(null);
  const refresh = () => void api.piperStatus().then(setSt).catch(() => setSt({ installed: false, voices: [] }));
  useEffect(refresh, []);

  const install = async () => {
    const ok = await confirmSpend({ title: "Install Piper?", lines: ["Downloads the Piper program (22 MB) from its official GitHub release", "Greenroom checks it matches the version it was tested with before using it", "Nothing is sent from your projects"], download: true });
    if (!ok) return;
    await run(async () => {
      try {
        await api.piperInstall();
        toast("Piper installed.");
        refresh();
      } catch (e) {
        toast((e as Error).message, true);
      }
    });
  };
  const remove = async (k: string) => {
    try {
      await api.piperRemoveVoice(k);
      refresh();
    } catch (e) {
      toast((e as Error).message, true);
    }
  };

  return (
    <EngineCard mark="P" tone="e5" title={ENGINES.piper.label} status={st?.installed ? "Installed" : "Not installed"} ok={!!st?.installed} blurb="Free, runs on this computer, no internet needed">
      <p className="muted small">{ENGINES.piper.blurb} Each voice has its own licence, shown in its model card on the Piper voices page.</p>
      <div className="row wrap">
        {!st?.installed && (
          <button className="primary" disabled={busy} onClick={() => void install()}>
            {busy ? "Installing…" : "Install Piper (22 MB)"}
          </button>
        )}
        <button onClick={() => go("voices")}>Find Piper voices</button>
      </div>
      {st && st.voices.length > 0 && (
        <div className="stack">
          <h3>Downloaded voices</h3>
          {st.voices.map((k) => (
            <div key={k} className="row between">
              <code>{k}</code>
              <button className="sm ghost danger" onClick={() => void remove(k)}>
                Delete files
              </button>
            </div>
          ))}
        </div>
      )}
    </EngineCard>
  );
}

function LocalServer() {
  const { engines, saveEngines, library, saveLibrary, toast } = useApp();
  const { busy, run } = useBusy();
  const [cfg, setCfg] = useState(engines.localServer);
  const [voices, setVoices] = useState<string[] | null>(null);
  const [typed, setTyped] = useState("");
  useEffect(() => setCfg(engines.localServer), [engines.localServer]);

  const add = (name: string) => {
    const n = name.trim();
    if (!n) return;
    if (library.some((v) => v.id === n && v.provider === "local")) return toast(`${n} is already in your library.`);
    saveLibrary((l) => [...l, { id: n, name: n, provider: "local", source: "library", language: "", accent: "", gender: "", notes: "From my local server", createdAt: new Date().toISOString() }]);
    toast(`${n} added.`);
  };
  const test = () =>
    run(async () => {
      saveEngines({ ...engines, localServer: cfg });
      try {
        setVoices(await api.localVoices());
      } catch (e) {
        setVoices(null);
        toast((e as Error).message, true);
      }
    });

  return (
    <EngineCard mark="L" tone="e6" title={ENGINES.local.label} status="Optional" blurb="Your own speech server on this computer">
      <p className="muted small">{ENGINES.local.blurb} It must speak the OpenAI-style speech API (<code>/v1/audio/speech</code>) and run on this computer. For privacy, only 127.0.0.1 and localhost addresses are accepted.</p>
      <div className="row wrap">
        <label className="field" style={{ flex: 2, minWidth: "min(220px, 100%)" }}>
          Address
          <input type="text" value={cfg.url} onChange={(e) => setCfg({ ...cfg, url: e.target.value })} placeholder="http://127.0.0.1:8880" />
        </label>
        <label className="field" style={{ flex: 1, minWidth: "min(140px, 100%)" }}>
          Model name
          <input type="text" value={cfg.model} onChange={(e) => setCfg({ ...cfg, model: e.target.value })} placeholder="kokoro" />
        </label>
        <div style={{ alignSelf: "end" }}>
          <button onClick={() => void test()} disabled={busy}>
            {busy ? "Checking…" : "Save and check"}
          </button>
        </div>
      </div>
      {voices && (
        <div className="stack">
          <Note kind="ok">The server answered with {voices.length} voice{voices.length === 1 ? "" : "s"}.</Note>
          <div className="chips">
            {voices.slice(0, 60).map((v) => (
              <button key={v} className="chip" aria-pressed="false" onClick={() => add(v)}>
                + {v}
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="row">
        <input type="text" aria-label="Add a voice by name" placeholder="Or type a voice name to add" value={typed} onChange={(e) => setTyped(e.target.value)} style={{ flex: 1 }} />
        <button
          disabled={!typed.trim()}
          onClick={() => {
            add(typed);
            setTyped("");
          }}
        >
          Add voice
        </button>
      </div>
    </EngineCard>
  );
}
