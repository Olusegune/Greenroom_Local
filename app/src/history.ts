import type { Project } from "./types";

/** Changes of the same kind this close together (typing, a slider being dragged) count as one step. */
export const MERGE_MS = 900;
const LIMIT = 100;

/**
 * Undo and redo for anything that can be held as a value. A step is the state just before a change.
 * `key` says what kind of change it was: a quick run with the same key merges into one step; the key "" never merges.
 */
export class History<T> {
  private past: T[] = [];
  private future: T[] = [];
  private lastKey = "";
  private lastAt = 0;

  record(before: T, key: string, now: number): void {
    const merge = key !== "" && key === this.lastKey && now - this.lastAt < MERGE_MS && this.past.length > 0;
    this.lastKey = key;
    this.lastAt = now;
    if (merge) return;
    if (this.past.length > 0 && this.past[this.past.length - 1] === before) return;
    this.past.push(before);
    if (this.past.length > LIMIT) this.past.shift();
    this.future = [];
  }

  canUndo(): boolean {
    return this.past.length > 0;
  }
  canRedo(): boolean {
    return this.future.length > 0;
  }
  /** The state to go back to, given the one showing now; null when there is nothing to undo. */
  undo(current: T): T | null {
    const prev = this.past.pop();
    if (prev === undefined) return null;
    this.future.push(current);
    this.lastKey = "";
    return prev;
  }
  redo(current: T): T | null {
    const next = this.future.pop();
    if (next === undefined) return null;
    this.past.push(current);
    this.lastKey = "";
    return next;
  }
  clear(): void {
    this.past = [];
    this.future = [];
    this.lastKey = "";
  }
}

/**
 * Going back to an earlier state of a project must never throw away paid work or the record of spending, so this
 * keeps every take (they are files that cannot be remade for free) and the ledger from the current state.
 */
export function keepWork(current: Project, snap: Project): Project {
  const lines = snap.lines.map((l) => {
    const c = current.lines.find((x) => x.id === l.id);
    if (!c) return l;
    const have = new Set(l.takes.map((t) => t.id));
    const takes = [...l.takes, ...c.takes.filter((t) => !have.has(t.id))];
    const chosen = l.chosen && takes.some((t) => t.id === l.chosen) ? l.chosen : c.chosen && takes.some((t) => t.id === c.chosen) ? c.chosen : l.chosen;
    return { ...l, takes, chosen };
  });
  return { ...snap, lines, ledger: current.ledger };
}
