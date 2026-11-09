import { useState } from "react";
import { api, type SetupCheckItem } from "../api";
import { useApp } from "../ctx";

/**
 * "Check my setup": looks for the usual reasons an engine does not install (disk space, the internet addresses the installers
 * need, the Hugging Face account) and says what to do about each. "Copy a report" puts the checks and the end of the setup
 * log on the clipboard to send to whoever is helping. Nothing is installed or changed, and no key is included.
 */
export default function SetupCheck({ engine = "all", label = "Check my setup" }: { engine?: string; label?: string }) {
  const { toast } = useApp();
  const [items, setItems] = useState<SetupCheckItem[] | null>(null);
  const [busy, setBusy] = useState(false);

  const run = async () => {
    setBusy(true);
    try {
      setItems(await api.setupCheck(engine));
    } catch (e) {
      toast((e as Error).message || "Could not run the checks.", true);
    } finally {
      setBusy(false);
    }
  };
  const copy = async () => {
    try {
      const text = await api.setupReport();
      await navigator.clipboard.writeText(text);
      toast("Report copied. Paste it into a message.");
    } catch {
      toast("Could not copy the report.", true);
    }
  };
  const bad = items?.filter((i) => !i.ok) ?? [];
  return (
    <div className="stack setup-check" style={{ gap: 8 }}>
      <div className="row wrap" style={{ gap: 8 }}>
        <button className="sm" disabled={busy} onClick={() => void run()}>
          {busy ? "Checking…" : label}
        </button>
        <button className="sm ghost" onClick={() => void copy()} title="Copies the checks and the end of the setup log. It never contains a key.">
          Copy a report
        </button>
      </div>
      {items && (
        <div role="status" aria-live="polite">
          <p className={bad.length ? "small warn-text" : "small muted"} style={{ margin: "0 0 4px" }}>
            {bad.length ? `${bad.length} thing${bad.length === 1 ? "" : "s"} could stop an install:` : "Everything the installers need looks fine."}
          </p>
          <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
            {items.map((i) => (
              <li key={i.name} style={{ color: i.ok ? undefined : "var(--warn, #ffd28a)" }}>
                <strong>{i.ok ? "✓" : "✗"} {i.name}</strong>: {i.detail}
                {i.fix ? <> <span className="muted">{i.fix}</span></> : null}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
