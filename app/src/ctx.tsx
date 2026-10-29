import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { api, type KeyStatus } from "./api";
import { History, keepWork } from "./history";
import { newProject, type Project, type VoiceEntry } from "./types";
import { uid } from "./script";
import { DEFAULT_ENGINES_CFG, DEFAULT_PRICES, type EnginesCfg } from "./engines";
import { estimateCost, spendLines, type SpendItem } from "./trust";

export type Tab = "home" | "write" | "cast" | "perform" | "timeline" | "picture" | "export" | "studio" | "history" | "voices" | "models" | "engines" | "sfx" | "lab" | "settings" | "help";

export interface SpendAsk {
  title: string;
  lines: string[];
  /** When set, the sheet offers "do not ask again this session" for this kind of single action. */
  skipKey?: string;
  /** Shown in red when the work would pass the project budget. The owner can still go ahead. */
  warn?: string;
  /** A file download rather than a paid call: different words, no credits mentioned. */
  download?: boolean;
}

interface Ctx {
  tab: Tab;
  go: (t: Tab) => void;
  keys: KeyStatus;
  refreshKeys: () => void;
  engines: EnginesCfg;
  saveEngines: (c: EnginesCfg) => void;
  library: VoiceEntry[];
  saveLibrary: (next: VoiceEntry[] | ((current: VoiceEntry[]) => VoiceEntry[])) => void;
  project: Project | null;
  saving: "idle" | "saving" | "saved" | "error";
  openProject: (id: string) => Promise<void>;
  createProject: (name: string) => Promise<void>;
  closeProject: () => void;
  /** Change the open project. `key` names the kind of change: a quick run with the same key is one undo step; "" never merges. */
  edit: (fn: (p: Project) => Project, key?: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  /** Put a whole earlier state of the project in place (for example a version). It can be undone. */
  replaceProject: (p: Project) => void;
  toast: (text: string, bad?: boolean) => void;
  confirmSpend: (a: SpendAsk) => Promise<boolean>;
  /** Cost lines and any over-budget warning for work about to be paid for, to add to a confirmation sheet. */
  priceLines: (items: SpendItem[]) => { lines: string[]; warn?: string };
  /** Record paid work in the project ledger, with an estimated cost from the owner's prices. */
  addLedger: (e: { kind: "speech" | "sound" | "director" | "design" | "sample" | "music"; engine: string; chars: number; items: SpendItem[]; note?: string }) => void;
}

const C = createContext<Ctx | null>(null);
export const useApp = () => {
  const c = useContext(C);
  if (!c) throw new Error("outside provider");
  return c;
};

export function Provider({ children }: { children: ReactNode }) {
  const [tab, setTab] = useState<Tab>("home");
  const [keys, setKeys] = useState<KeyStatus>({ elevenlabs: false, kie: false, voicekiller: false, huggingface: false });
  const [library, setLibrary] = useState<VoiceEntry[]>([]);
  const [engines, setEngines] = useState<EnginesCfg>(DEFAULT_ENGINES_CFG);
  const [project, setProject] = useState<Project | null>(null);
  const [saving, setSaving] = useState<Ctx["saving"]>("idle");
  const [note, setNote] = useState<{ text: string; bad: boolean } | null>(null);
  const [ask, setAsk] = useState<{ a: SpendAsk; done: (ok: boolean) => void } | null>(null);
  const libRef = useRef<VoiceEntry[]>([]);
  const skipped = useRef(new Set<string>());
  const dirty = useRef(false);
  const projectRef = useRef<Project | null>(null);
  const hist = useRef(new History<Project>());
  const [, bump] = useState(0);
  const setP = useCallback((p: Project | null) => {
    projectRef.current = p;
    setProject(p);
  }, []);

  // Every main destination is its own workspace. Keeping an old scroll position
  // made destination headings appear missing after moving between long screens.
  useEffect(() => {
    const stage = document.querySelector<HTMLElement>(".stage");
    stage?.scrollTo({ top: 0, left: 0 });
  }, [tab]);

  const refreshKeys = useCallback(() => void api.keyStatus().then(setKeys).catch(() => undefined), []);
  useEffect(refreshKeys, [refreshKeys]);
  useEffect(() => void api.libraryLoad().then((l) => ((libRef.current = l), setLibrary(l))).catch(() => undefined), []);

  useEffect(() => void api.enginesLoad().then((c) => setEngines({ ...DEFAULT_ENGINES_CFG, ...c, localServer: { ...DEFAULT_ENGINES_CFG.localServer, ...(c.localServer ?? {}) } })).catch(() => undefined), []);

  const toast = useCallback((text: string, bad = false) => {
    setNote({ text, bad });
    setTimeout(() => setNote((n) => (n?.text === text ? null : n)), bad ? 8000 : 3500);
  }, []);

  const saveEngines = useCallback(
    (c: EnginesCfg) => {
      setEngines(c);
      api.enginesSave(c).catch((e: Error) => toast(e.message, true));
    },
    [toast],
  );

  const saveLibrary = useCallback(
    (next: VoiceEntry[] | ((current: VoiceEntry[]) => VoiceEntry[])) => {
      // Always work from the latest list, so two quick changes cannot overwrite each other.
      const v = typeof next === "function" ? next(libRef.current) : next;
      libRef.current = v;
      setLibrary(v);
      api.librarySave(v).catch((e: Error) => toast(e.message, true));
    },
    [toast],
  );

  const edit = useCallback(
    (fn: (p: Project) => Project, key = "auto") => {
      const cur = projectRef.current;
      if (!cur) return;
      // A key starting with ~ is work that was paid for (a take, a ledger line): it is saved but is not an undo step.
      // A new take also ends the undo history, so no undo can ever leave a take without the line it belongs to. Versions
      // (History screen) still go further back.
      if (key === "~take") hist.current.clear();
      else if (!key.startsWith("~")) hist.current.record(cur, key, Date.now());
      dirty.current = true;
      setP({ ...fn(cur), updatedAt: new Date().toISOString() });
      bump((n) => n + 1);
    },
    [setP],
  );

  const travel = useCallback(
    (to: (cur: Project) => Project | null) => {
      const cur = projectRef.current;
      if (!cur) return;
      const next = to(cur);
      if (!next) return;
      dirty.current = true;
      setP({ ...keepWork(cur, next), updatedAt: new Date().toISOString() });
      bump((n) => n + 1);
    },
    [setP],
  );
  const undo = useCallback(() => travel((cur) => hist.current.undo(cur)), [travel]);
  const redo = useCallback(() => travel((cur) => hist.current.redo(cur)), [travel]);
  const replaceProject = useCallback(
    (p: Project) => {
      const cur = projectRef.current;
      if (!cur) return;
      hist.current.record(cur, "", Date.now());
      dirty.current = true;
      setP({ ...keepWork(cur, { ...p, id: cur.id }), updatedAt: new Date().toISOString() });
      bump((n) => n + 1);
    },
    [setP],
  );

  // Ctrl+Z, Ctrl+Shift+Z and Ctrl+Y work anywhere except inside a text box, which has its own undo.
  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      const key = e.key.toLowerCase();
      if (key === "z" && !e.shiftKey) (e.preventDefault(), undo());
      else if ((key === "z" && e.shiftKey) || key === "y") (e.preventDefault(), redo());
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [undo, redo]);

  // Autosave shortly after the last change. Takes are written the moment they are made, so this only holds the plan.
  useEffect(() => {
    if (!project || !dirty.current) return;
    setSaving("saving");
    const t = setTimeout(() => {
      api
        .projectSave(project)
        .then(() => (dirty.current = false, setSaving("saved")))
        .catch((e: Error) => (setSaving("error"), toast("Could not save: " + e.message, true)));
    }, 600);
    return () => clearTimeout(t);
  }, [project, toast]);

  const openProject = useCallback(
    async (id: string) => {
      try {
        const p = await api.projectLoad(id);
        dirty.current = false;
        hist.current.clear();
        setP(p);
        bump((n) => n + 1);
        setSaving("idle");
        setTab("write");
        // Anchor the state as opened, and make the daily backup if it is due. Neither blocks the screen.
        void api.versionSave(id, "opened").catch(() => undefined);
        void api.backupAuto(id).catch(() => undefined);
      } catch (e) {
        toast((e as Error).message, true);
      }
    },
    [toast, setP],
  );

  const createProject = useCallback(
    async (name: string) => {
      const now = new Date().toISOString();
      const p = newProject("p-" + uid(), name.trim() || "Untitled project", now);
      try {
        await api.projectSave(p);
        dirty.current = false;
        hist.current.clear();
        setP(p);
        bump((n) => n + 1);
        setSaving("saved");
        setTab("write");
      } catch (e) {
        toast((e as Error).message, true);
      }
    },
    [toast, setP],
  );

  const closeProject = useCallback(() => {
    if (projectRef.current) void api.versionSave(projectRef.current.id, "closed").catch(() => undefined);
    hist.current.clear();
    setP(null);
    bump((n) => n + 1);
    setTab("home");
  }, [setP]);

  const confirmSpend = useCallback((a: SpendAsk) => {
    // A budget warning is never skipped, even if the owner chose not to be asked again for single items.
    if (a.skipKey && !a.warn && skipped.current.has(a.skipKey)) return Promise.resolve(true);
    return new Promise<boolean>((resolve) => setAsk({ a, done: resolve }));
  }, []);

  const priceLines = useCallback((items: SpendItem[]) => spendLines(engines.prices ?? DEFAULT_PRICES, items, project?.budget, project?.ledger), [engines.prices, project?.budget, project?.ledger]);

  const addLedger = useCallback(
    (e: { kind: "speech" | "sound" | "director" | "design" | "sample" | "music"; engine: string; chars: number; items: SpendItem[]; note?: string }) => {
      const cost = estimateCost(engines.prices ?? DEFAULT_PRICES, e.items).cost;
      edit((p) => ({ ...p, ledger: [...(p.ledger ?? []), { at: new Date().toISOString(), kind: e.kind, engine: e.engine, chars: e.chars, cost, note: e.note }] }), "~ledger");
    },
    [engines.prices, edit],
  );

  const value = useMemo<Ctx>(
    () => ({ tab, go: setTab, keys, refreshKeys, engines, saveEngines, library, saveLibrary, project, saving, openProject, createProject, closeProject, edit, undo, redo, canUndo: hist.current.canUndo(), canRedo: hist.current.canRedo(), replaceProject, toast, confirmSpend, priceLines, addLedger }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [tab, keys, refreshKeys, engines, saveEngines, library, saveLibrary, project, saving, openProject, createProject, closeProject, edit, undo, redo, replaceProject, toast, confirmSpend, priceLines, addLedger],
  );

  return (
    <C.Provider value={value}>
      {children}
      {note && (
        <div className={note.bad ? "toast err" : "toast"} role={note.bad ? "alert" : "status"}>
          {note.text}
        </div>
      )}
      {ask && <SpendSheet ask={ask.a} onDone={(ok, skip) => (skip && ask.a.skipKey && skipped.current.add(ask.a.skipKey), ask.done(ok), setAsk(null))} />}
    </C.Provider>
  );
}

function SpendSheet({ ask, onDone }: { ask: SpendAsk; onDone: (ok: boolean, skip: boolean) => void }) {
  const [skip, setSkip] = useState(false);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onDone(false, false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onDone]);
  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="spend-t">
        <h2 id="spend-t">{ask.title}</h2>
        {ask.warn && <p className="note err" role="alert">{ask.warn}</p>}
        <p className="muted">{ask.download ? "This downloads files to this computer. Nothing is sent from your project." : "This sends text to the provider and uses credits on your own account. Greenroom cannot see your price, so check your plan if unsure."}</p>
        <ul>
          {ask.lines.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
        {ask.skipKey && (
          <label className="row small muted">
            <input type="checkbox" checked={skip} onChange={(e) => setSkip(e.target.checked)} /> Do not ask again for single items this session
          </label>
        )}
        <div className="row end" style={{ marginTop: 16 }}>
          <button onClick={() => onDone(false, false)}>Cancel</button>
          <button className="primary" autoFocus onClick={() => onDone(true, skip)}>
            {ask.download ? "Download" : ask.warn ? "Go over budget and continue" : "Go ahead and use credits"}
          </button>
        </div>
      </div>
    </div>
  );
}
