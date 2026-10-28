import { useEffect, useRef, useState, type ReactNode } from "react";
import { Alert, Check, Info, Play, Stop } from "./icons";
import { playUrl, stopPlayback } from "./media";

export function Note({ kind = "info", children }: { kind?: "info" | "warn" | "err" | "ok"; children: ReactNode }) {
  const Icon = kind === "ok" ? Check : kind === "info" ? Info : Alert;
  return (
    <div className={kind === "info" ? "note" : `note ${kind}`} role={kind === "err" ? "alert" : undefined}>
      <Icon size={18} />
      <div>{children}</div>
    </div>
  );
}

export function Empty({ title, children, action }: { title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      {children && <p className="muted">{children}</p>}
      {action}
    </div>
  );
}

/** A play / stop button for a sound that is fetched only when pressed. */
export function PlayButton({ get, label = "Play", disabled, round }: { get: () => Promise<string>; label?: string; disabled?: boolean; round?: boolean }) {
  const [state, setState] = useState<"idle" | "loading" | "playing">("idle");
  const alive = useRef(true);
  useEffect(() => () => void (alive.current = false), []);
  const click = async () => {
    if (state === "playing") return stopPlayback();
    setState("loading");
    try {
      const url = await get();
      if (!alive.current) return;
      setState("playing");
      await playUrl(url, () => alive.current && setState("idle"));
    } catch {
      if (alive.current) setState("idle");
    }
  };
  if (round)
    return (
      <button className={state === "playing" ? "play-round on" : "play-round"} onClick={click} disabled={disabled || state === "loading"} aria-label={state === "playing" ? `Stop ${label}` : label} title={label}>
        {state === "loading" ? <span aria-hidden="true">…</span> : state === "playing" ? <Stop size={14} /> : <Play size={14} />}
      </button>
    );
  return (
    <button className="sm" onClick={click} disabled={disabled || state === "loading"} aria-label={state === "playing" ? `Stop ${label}` : label}>
      {state === "playing" ? <Stop size={14} /> : <Play size={14} />}
      {state === "loading" ? "…" : state === "playing" ? "Stop" : label}
    </button>
  );
}

export function useBusy() {
  const [busy, setBusy] = useState(false);
  const run = async <T,>(f: () => Promise<T>): Promise<T | undefined> => {
    setBusy(true);
    try {
      return await f();
    } finally {
      setBusy(false);
    }
  };
  return { busy, run };
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: [T, string][] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}>
          {label}
        </button>
      ))}
    </div>
  );
}
