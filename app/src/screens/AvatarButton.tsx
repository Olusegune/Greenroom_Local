import { useRef, useState } from "react";
import { api } from "../api";
import { Avatar } from "../avatar";
import { useApp } from "../ctx";
import { portraitPrompt, toPortrait, validPortrait } from "../portrait";
import type { VoiceEntry } from "../types";

/** A voice's face. Press it to give the voice a real picture: choose a file, or describe one and have an image model make it. */
export function AvatarButton({ voice, seed, gender, size = 44, role = "" }: { voice?: VoiceEntry; seed: string; gender?: string; size?: number; role?: string }) {
  const [open, setOpen] = useState(false);
  if (!voice) return <Avatar seed={seed} gender={gender} size={size} />;
  return (
    <>
      <button className="avatar-btn" aria-label={`Change the picture for ${voice.name}`} title="Change the picture" onClick={() => setOpen(true)} style={{ background: "none", border: 0, padding: 0, cursor: "pointer", borderRadius: "50%", lineHeight: 0 }}>
        <Avatar seed={seed} gender={gender} size={size} />
      </button>
      {open && <PortraitDialog voice={voice} seed={seed} gender={gender} role={role} onClose={() => setOpen(false)} />}
    </>
  );
}

function PortraitDialog({ voice, seed, gender, role, onClose }: { voice: VoiceEntry; seed: string; gender?: string; role: string; onClose: () => void }) {
  const { keys, saveLibrary, confirmSpend, toast, go } = useApp();
  const [prompt, setPrompt] = useState(() => portraitPrompt(voice, role));
  const [busy, setBusy] = useState(false);
  const [made, setMade] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const keep = (portrait: string | undefined) => {
    saveLibrary((l) => l.map((v) => (v.id === voice.id && v.provider === voice.provider ? { ...v, portrait } : v)));
    toast(portrait ? `${voice.name} has a new picture.` : `${voice.name} is back to the automatic picture.`);
  };
  const choose = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/") || f.size > 15_000_000) return toast("Choose a picture file up to 15 MB.", true);
    try {
      keep(await toPortrait(f));
      onClose();
    } catch {
      toast("Greenroom could not read that picture.", true);
    }
  };
  const generate = async () => {
    const ok = await confirmSpend({ title: "Make a portrait with AI?", lines: [`Sends this description to Kie's image model (about 8 Kie credits, about USD 0.04, per the model page; Greenroom cannot see your price)`, `For: ${voice.name}`, "You choose whether to keep the picture. A fictional person is asked for; check the result before using it."] });
    if (!ok) return;
    setBusy(true);
    try {
      const out = await api.avatarGenerate(prompt);
      const blob = await (await fetch(`data:${out.mime};base64,${out.imageB64}`)).blob();
      setMade(await toPortrait(blob));
    } catch (e) {
      toast((e as Error).message, true);
    }
    setBusy(false);
  };

  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="pt-t" style={{ width: "min(640px, 94vw)" }}>
        <h2 id="pt-t">Picture for {voice.name}</h2>
        <div className="row wrap" style={{ alignItems: "flex-start" }}>
          <div className="stack" style={{ alignItems: "center" }}>
            {made && validPortrait(made) ? <img src={made} alt="The new picture" width={128} height={128} style={{ borderRadius: "50%", objectFit: "cover" }} /> : <Avatar seed={seed} gender={gender} size={128} />}
            <span className="muted small">{made ? "New" : "Now"}</span>
          </div>
          <div className="stack" style={{ flex: 1, minWidth: 260 }}>
            <button onClick={() => file.current?.click()}>Choose a picture from this computer…</button>
            <input ref={file} type="file" accept="image/*" aria-label="Choose a picture" style={{ display: "none" }} onChange={(e) => void choose(e)} />
            <label className="field">
              Or describe one and have it made
              <textarea rows={5} value={prompt} maxLength={1500} onChange={(e) => setPrompt(e.target.value)} />
            </label>
            <div className="row wrap">
              <button className="primary" disabled={busy || !keys.kie || prompt.trim().length < 8} onClick={() => void generate()}>
                {busy ? "Making the picture…" : "Make a picture (Kie)"}
              </button>
              {!keys.kie && (
                <button className="sm" onClick={() => { onClose(); go("settings"); }}>
                  Add your Kie key
                </button>
              )}
            </div>
            <p className="muted small">The picture is cut to a square and kept small with the voice. A fictional person is asked for, not a likeness of anyone real. Use only pictures you have the right to use.</p>
          </div>
        </div>
        <div className="row end" style={{ marginTop: 16 }}>
          {voice.portrait && (
            <button className="danger" onClick={() => { keep(undefined); onClose(); }}>
              Go back to the automatic picture
            </button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={!made} onClick={() => { keep(made ?? undefined); onClose(); }}>
            Use this picture
          </button>
        </div>
      </div>
    </div>
  );
}
