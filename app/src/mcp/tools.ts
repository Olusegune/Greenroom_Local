// What each MCP tool does inside the app window. The Rust server (mcp.rs) has already checked the caller and the arguments; these run
// with the same code as the screens. There is deliberately no tool that approves a voice, spends past a limit or delivers an export:
// those stay with the person, and paid work shows the app's own cost sheet and waits for their answer.

import { planFor, runFor, type Runner } from "../agent/runner";
import { progress, type AgentRun } from "../agent/graph";
import { migrateRun } from "../agent/persist";
import { api } from "../api";
import { heard, summarise, todoList } from "../listen";
import { parseScript } from "../script";
import type { Project } from "../types";
import { APP_VERSION } from "../version";
import tools from "./tools.json";

export const TOOL_NAMES: string[] = (tools as { name: string }[]).map((t) => t.name);

export interface StepView {
  title: string;
  status: string;
  /** The reason a person must act, for a step that is waiting. */
  waitingFor?: string;
  detail: string;
}

const WHY: Record<string, string> = {
  rights: "approving a voice for a character is a voice-rights decision, made only by the person",
  final: "delivering the final export is the person's decision",
  spend: "paid work needs the person's approval",
  creative: "a creative check for the person",
};

/** A plain summary of the agent's run for an outside agent. Nothing in it is a judgment of how anything sounds. */
export function describeRun(run: AgentRun | null | undefined): unknown {
  if (!run) return { planned: false, note: "No production has been planned. Call plan_production." };
  const p = progress(run);
  const steps: StepView[] = run.nodes
    .filter((n) => n.enabled)
    .map((n) => ({ title: n.title, status: n.status, detail: n.detail.slice(0, 160), ...(n.status === "awaiting_approval" ? { waitingFor: WHY[n.gate] ?? "the person's approval" } : {}), ...(n.error ? { error: n.error.slice(0, 200) } : {}) }));
  return {
    planned: true,
    mode: run.mode,
    localOnly: run.localOnly,
    draftCasting: run.draftCasting === true,
    cloudLimit: run.cloudLimit,
    spent: Number(run.spent.toFixed(4)),
    progress: p,
    finished: p.done === p.total && p.total > 0,
    waitingForThePerson: steps.filter((s) => s.waitingFor).map((s) => ({ step: s.title, because: s.waitingFor })),
    steps,
    note: p.waiting ? "Steps marked waitingFor need the person in the Greenroom window. They cannot be approved from here." : undefined,
  };
}

/** The open project in a few lines: what exists, who is cast, what has takes, and the owner's own verdicts. */
export function describeProject(p: Project | null): unknown {
  if (!p) return { open: false, note: "No project is open. Call create_project or open_project." };
  const sum = summarise(p.lines);
  const used = new Set(p.lines.map((l) => l.characterId));
  return {
    open: true,
    id: p.id,
    name: p.name,
    scenes: p.scenes,
    lines: p.lines.length,
    linesWithTakes: p.lines.filter((l) => l.takes.length > 0).length,
    soundCues: p.lines.reduce((n, l) => n + l.events.length, 0),
    characters: p.characters
      .filter((c) => used.has(c.id))
      .map((c) => ({ name: c.name, lines: p.lines.filter((l) => l.characterId === c.id).length, voiceId: c.voiceId ?? null, voiceApproved: !!c.casting?.approval, voiceIsAgentDraft: !!c.casting?.draft && !c.casting.approval })),
    listening: { heard: sum.heard, good: sum.good, voice: sum.voice, delivery: sum.delivery, glitch: sum.glitch, notHeardYet: sum.unheard },
    production: describeRun(migrateRun(p.agent)),
  };
}

export interface BridgeApp extends Runner {
  /** The project open in the window right now (read after waiting for the window to catch up). */
  current: () => Project | null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The window updates after a create or open; wait until the new project is the one the tools will read. */
async function untilOpen(b: BridgeApp, match: (p: Project) => boolean): Promise<Project> {
  for (let i = 0; i < 60; i++) {
    const p = b.current();
    if (p && match(p)) return p;
    await sleep(50);
  }
  throw new Error("The project did not open in time.");
}

export async function handleTool(name: string, args: Record<string, unknown>, b: BridgeApp): Promise<unknown> {
  const { app } = b;
  switch (name) {
    case "greenroom_status": {
      const [sfx, music, qwen] = await Promise.all([api.sfxReady().catch(() => false), api.acestepReady().catch(() => false), api.qwenDesignReady().catch(() => false)]);
      const byEngine: Record<string, number> = {};
      for (const v of app.library) byEngine[v.provider] = (byEngine[v.provider] ?? 0) + 1;
      return {
        app: "Greenroom Local",
        version: APP_VERSION,
        projectOpen: !!b.current(),
        cloudKeysSaved: Object.entries(app.keys).filter(([, has]) => has).map(([k]) => k),
        localEnginesReady: { soundEffects: sfx, music, qwen3tts: qwen },
        voicesInLibrary: app.library.length,
        voicesByEngine: byEngine,
        note: "Voice approval, spending and the final delivery are decided by the person in the Greenroom window.",
      };
    }
    case "list_projects":
      return { projects: await api.projectList() };
    case "create_project": {
      const nameArg = String(args.name ?? "").trim() || "Untitled project";
      const before = b.current()?.id;
      const full = [args.script, args.characters].filter((x): x is string => typeof x === "string" && !!x.trim()).join(String.fromCharCode(10, 10));
      await app.createProject(nameArg, full || undefined);
      const p = await untilOpen(b, (x) => x.id !== before && x.name === nameArg);
      return { created: true, project: describeProject(p) };
    }
    case "open_project": {
      const id = String(args.id);
      await app.openProject(id);
      const p = await untilOpen(b, (x) => x.id === id);
      return { opened: true, project: describeProject(p) };
    }
    case "set_script": {
      const p0 = b.current();
      if (!p0) throw new Error("No project is open. Call create_project or open_project first.");
      const script = [String(args.script ?? ""), typeof args.characters === "string" ? args.characters : ""].filter((x) => x.trim()).join(String.fromCharCode(10, 10));
      app.edit((p) => ({ ...p, script, ...parseScript(script, p.characters, p.lines) }));
      await sleep(80);
      return { updated: true, project: describeProject(b.current()) };
    }
    case "get_project":
      return describeProject(b.current());
    case "plan_production": {
      if (!b.current()) throw new Error("No project is open. Call create_project or open_project first.");
      if (!b.current()!.lines.length) throw new Error("The project has no script yet. Call set_script first.");
      const localOnly = args.local_only === undefined ? true : !!args.local_only;
      const mode = args.mode === "autonomous" ? "autonomous" : "guided";
      const run = planFor(b, { brief: String(args.brief ?? ""), mode, localOnly, cloudLimit: Number(args.cloud_limit ?? 0), draftCasting: args.draft_casting === true });
      await sleep(80);
      return { planned: true, ...(describeRun(run) as object) };
    }
    case "run_production": {
      if (!b.current()) throw new Error("No project is open. Call create_project or open_project first.");
      const res = await runFor(b);
      await sleep(120);
      return { ran: !res.reason, ...(res.reason ? { reason: res.reason } : {}), ...(describeRun(migrateRun(b.current()?.agent)) as object) };
    }
    case "get_production_status":
      return describeRun(migrateRun(b.current()?.agent));
    case "get_listening_todo": {
      const p = b.current();
      if (!p) throw new Error("No project is open.");
      const items = todoList(p.lines, p.characters);
      return {
        summary: summarise(p.lines),
        heardAnyTake: p.lines.some((l) => heard(l)),
        todo: items.map((t) => ({ line: t.lineNumber, character: t.character, verdict: t.verdict, note: t.note ?? null, whatToDo: t.todo })),
        note: "These are the owner's own listening verdicts. Greenroom adds none of its own.",
      };
    }
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
