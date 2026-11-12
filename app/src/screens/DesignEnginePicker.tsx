import { useEffect, useState } from "react";
import { api } from "../api";
import { useApp } from "../ctx";
import type { DesignEngine } from "../voiceDesigner";

/** Whether Qwen3-TTS is set up on this PC (so voices can be designed for free). */
export function useQwenReady(): boolean | null {
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => { let live = true; void api.qwenDesignReady().then((ok) => live && setReady(ok)).catch(() => live && setReady(false)); return () => { live = false; }; }, []);
  return ready;
}

/** Choose who designs the voice. Each option says what it costs and what it needs, and says so when it is not available yet. */
export default function DesignEnginePicker({ engine, onChange, qwenReady, onClose }: { engine: DesignEngine; onChange: (e: DesignEngine) => void; qwenReady: boolean | null; onClose?: () => void }) {
  const { keys, go } = useApp();
  const opt = (id: DesignEngine, title: string, cost: string, ok: boolean | null) => (
    <label className={`design-engine${engine === id ? " on" : ""}`}>
      <input type="radio" name="design-engine" checked={engine === id} onChange={() => onChange(id)} />
      <span><strong>{title}</strong><br /><span className="small muted">{cost}{ok === null ? " Checking…" : ok ? "" : " Not set up yet."}</span></span>
    </label>
  );
  const leave = (tab: "settings" | "models") => () => { onClose?.(); go(tab); };
  return (
    <fieldset className="stack design-engines">
      <legend className="small">Design this voice with</legend>
      <div className="row wrap">
        {opt("qwen", "Qwen3-TTS on this PC", "Free. Nothing is sent anywhere. A few minutes for three previews on a processor, much faster on a graphics card.", qwenReady)}
        {opt("elevenlabs", "ElevenLabs", "Uses credits, and keeping the voice needs a free voice slot on your account.", keys.elevenlabs)}
      </div>
      {engine === "qwen" && qwenReady === false && <p className="small">Qwen3-TTS is not set up on this PC. <button className="sm" onClick={leave("models")}>Set it up in Model Center</button> It is free; the download is several GB.</p>}
      {engine === "elevenlabs" && !keys.elevenlabs && <p className="small">Voice design with ElevenLabs needs your key. <button className="sm" onClick={leave("settings")}>Open Settings</button> Or choose Qwen3-TTS above.</p>}
    </fieldset>
  );
}
