import { useCallback, useEffect, useState } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { api, inApp, type BackupInfo, type VersionInfo } from "../api";
import { useApp } from "../ctx";
import { Note, useBusy } from "../ui";

const when = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
};
const size = (b: number) => (b > 1 << 20 ? `${(b / (1 << 20)).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
const labelOf = (l: string) => (l === "auto" ? "Saved automatically" : l === "opened" ? "When you opened it" : l === "closed" ? "When you closed it" : l.startsWith("before-restore") ? "Before a restore" : l ? l.replace(/-/g, " ") : "Saved");

/** Earlier versions of the project, and whole-project backups. Nothing here deletes a take. */
export default function History() {
  const { project, replaceProject, openProject, toast } = useApp();
  const { busy, run } = useBusy();
  const [versions, setVersions] = useState<VersionInfo[] | null>(null);
  const [backups, setBackups] = useState<BackupInfo[] | null>(null);
  const [last, setLast] = useState("");
  const id = project?.id;

  const refresh = useCallback(() => {
    if (id) void api.versionList(id).then(setVersions).catch(() => setVersions([]));
    void api.backupList().then(setBackups).catch(() => setBackups([]));
  }, [id]);
  useEffect(refresh, [refresh]);

  if (!project || !id) return null;

  const saveNow = () =>
    run(async () => {
      try {
        const v = await api.versionSave(id, "saved by you");
        toast(v ? "Kept this version." : "Nothing has changed since the last version.");
        refresh();
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  const restore = (v: VersionInfo) =>
    run(async () => {
      try {
        const old = await api.versionLoad(id, v.id);
        // Keep today's state first, so a restore can always be reversed from this list or with Undo.
        await api.versionSave(id, "before restore");
        replaceProject(old);
        toast(`Went back to ${when(v.at)}. Undo brings today's state back.`);
        refresh();
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  const backupNow = () =>
    run(async () => {
      try {
        const p = await api.backupNow(id);
        setLast(p);
        toast("Backup saved.");
        refresh();
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  const reveal = async (p: string) => {
    if (!inApp()) return;
    try {
      await revealItemInDir(p);
    } catch {
      toast("Could not open the folder.", true);
    }
  };

  const openBackup = (b: BackupInfo) =>
    run(async () => {
      try {
        const nid = await api.backupRestore(b.file);
        toast("Opened the backup as a new project. Your other projects were not touched.");
        await openProject(nid);
      } catch (e) {
        toast((e as Error).message, true);
      }
    });

  return (
    <section>
      <div>
        <h1>History</h1>
        <p className="lede">Greenroom keeps earlier versions of this project and makes a backup of everything once a day. Going back never deletes a take you made.</p>
      </div>

      <div className="card stack">
        <div className="row between wrap">
          <h2>Versions</h2>
          <button onClick={() => void saveNow()} disabled={busy}>
            Keep this version now
          </button>
        </div>
        <p className="muted small">A version is saved when you open or close the project and about every ten minutes while you work, keeping the newest 60. Restoring one puts the script, directions, timeline and notes back as they were; takes you made since are kept.</p>
        {versions === null ? (
          <p className="muted">Loading…</p>
        ) : versions.length === 0 ? (
          <p className="muted">No versions yet. They appear as you work.</p>
        ) : (
          versions.map((v, i) => (
            <div key={v.id} className="row between wrap hist-row">
              <span>
                <strong>{when(v.at)}</strong>
                <span className="muted small"> · {labelOf(v.label)} · {size(v.bytes)}</span>
              </span>
              <button className="sm" onClick={() => void restore(v)} disabled={busy} aria-label={`Go back to ${when(v.at)}`}>
                {i === 0 ? "Go back to this" : "Restore"}
              </button>
            </div>
          ))
        )}
      </div>

      <div className="card stack">
        <div className="row between wrap">
          <h2>Backups</h2>
          <button className="primary" onClick={() => void backupNow()} disabled={busy}>
            Back up now
          </button>
        </div>
        <p className="muted small">A backup is one file holding the whole project and all its takes, checked with fingerprints when it is opened. One is made automatically each day you open a project, and the newest five of each project are kept. They are saved in Documents\Greenroom\backups, so you can copy them to a drive or cloud folder.</p>
        {last && (
          <p className="small" aria-live="polite">
            Saved <code>{last.split(/[\\/]/).pop()}</code>{" "}
            <button className="sm" onClick={() => void reveal(last)}>
              Show in folder
            </button>
          </p>
        )}
        {backups === null ? (
          <p className="muted">Loading…</p>
        ) : backups.length === 0 ? (
          <Note>No backups yet.</Note>
        ) : (
          backups.map((b) => (
            <div key={b.file} className="row between wrap hist-row">
              <span>
                <strong>{b.name}</strong>
                <span className="muted small">
                  {" "}
                  · {when(b.at)} · {b.takes} take{b.takes === 1 ? "" : "s"} · {size(b.bytes)}
                  {b.projectId === id ? " · this project" : ""}
                </span>
              </span>
              <button className="sm" onClick={() => void openBackup(b)} disabled={busy}>
                Open as a new project
              </button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
