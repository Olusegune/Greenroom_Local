// The menus of the application menu bar: File, Edit, View and Help, in the order and wording Windows people expect.
// Kept apart from drawing so what each menu offers (and when it is greyed out) can be tested.

import type { MenuDef } from "./MenuBar";
import type { Tab } from "./ctx";

export interface MenuActions {
  hasProject: boolean;
  canUndo: boolean;
  canRedo: boolean;
  version: string;
  go: (t: Tab) => void;
  save: () => void;
  backup: () => void;
  close: () => void;
  exit: () => void;
  undo: () => void;
  redo: () => void;
  edit: (what: "cut" | "copy" | "paste" | "selectAll") => void;
  checkUpdates: () => void;
  about: () => void;
}

export function buildMenus(a: MenuActions): MenuDef[] {
  const p = !a.hasProject;
  return [
    {
      id: "file",
      label: "File",
      items: [
        { label: "New project…", hint: "Ctrl+N", run: () => a.go("home") },
        { label: "Open project…", hint: "Ctrl+O", run: () => a.go("home") },
        { label: "Open a backup…", disabled: p, run: () => a.go("history") },
        { sep: true },
        { label: "Save", hint: "Ctrl+S", disabled: p, run: a.save },
        { label: "Save a backup copy", hint: "Ctrl+Shift+S", disabled: p, run: a.backup },
        { label: "Export audio…", disabled: p, run: () => a.go("export") },
        { sep: true },
        { label: "Close project", hint: "Ctrl+W", disabled: p, run: a.close },
        { label: "Exit", hint: "Ctrl+Q", run: a.exit },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { label: "Undo", hint: "Ctrl+Z", disabled: !a.canUndo, run: a.undo },
        { label: "Redo", hint: "Ctrl+Shift+Z", disabled: !a.canRedo, run: a.redo },
        { sep: true },
        { label: "Cut", hint: "Ctrl+X", run: () => a.edit("cut") },
        { label: "Copy", hint: "Ctrl+C", run: () => a.edit("copy") },
        { label: "Paste", hint: "Ctrl+V", run: () => a.edit("paste") },
        { label: "Select all", hint: "Ctrl+A", run: () => a.edit("selectAll") },
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { label: "Script", disabled: p, run: () => a.go("write") },
        { label: "Cast", disabled: p, run: () => a.go("cast") },
        { label: "Perform", disabled: p, run: () => a.go("perform") },
        { label: "Timeline", disabled: p, run: () => a.go("timeline") },
        { sep: true },
        { label: "Voice library", run: () => a.go("voices") },
        { label: "Voice metadata", run: () => a.go("review") },
        { label: "Voice presets", run: () => a.go("presets") },
        { label: "Agent Studio", run: () => a.go("agent") },
        { label: "Model Center", run: () => a.go("models") },
        { label: "Voice lab", run: () => a.go("lab") },
        { label: "Settings", run: () => a.go("settings") },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [
        { label: "Help and guide", run: () => a.go("help") },
        { label: "Check for updates…", run: a.checkUpdates },
        { sep: true },
        { label: `About Greenroom Local ${a.version}`, run: a.about },
      ],
    },
  ];
}

/** Which menu action a key press means, or null. Ctrl or Cmd is required, so ordinary typing is never caught. */
export function shortcutFor(e: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }): "new" | "open" | "save" | "backup" | "close" | "exit" | null {
  if (!(e.ctrlKey || e.metaKey) || e.altKey) return null;
  const k = e.key.toLowerCase();
  if (k === "n" && !e.shiftKey) return "new";
  if (k === "o" && !e.shiftKey) return "open";
  if (k === "s") return e.shiftKey ? "backup" : "save";
  if (k === "w" && !e.shiftKey) return "close";
  if (k === "q" && !e.shiftKey) return "exit";
  return null;
}
