// Plans and runs the agent's production for the open project. The Agent Studio screen and the MCP bridge (an outside AI agent asking
// Greenroom to produce a script) both go through these two functions, so they follow exactly the same rules: the same gates, the same
// spending limit, the same cost sheet. Nothing here approves a voice, spends past the limit or delivers; those stay with the person.

import type { MutableRefObject } from "react";
import { applyCharacterSheet, readCharacterSheet } from "../casting/sheet";
import { agentEnv } from "../screens/agentEnv";
import type { useApp } from "../ctx";
import { DEFAULT_PRICES, soundEngineOf } from "../engines";
import { estimateCost } from "../trust";
import type { Project } from "../types";
import { estimateRemaining, merge, resume, step, type AgentRun, type Mode } from "./graph";
import { migrateRun } from "./persist";
import { planProduction } from "./plan";
import { executors } from "./services";

export interface Runner {
  app: ReturnType<typeof useApp>;
  live: MutableRefObject<Project | null>;
}

const now = () => new Date().toISOString();

/** Writes the run into the project (one Undo step) and into the live copy the steps read. */
export function saveRun(rc: Runner, r: AgentRun): void {
  rc.live.current = { ...rc.live.current!, agent: r };
  rc.app.edit((p) => ({ ...p, agent: r }), "agent-run");
}

export interface PlanOptions {
  brief: string;
  mode: Mode;
  localOnly: boolean;
  cloudLimit: number;
  /** The owner allows draft voices for characters that have none (never approved). */
  draftCasting?: boolean;
}

/** Plans the production from a brief and saves the plan. An existing run keeps its finished steps whose inputs did not change. */
export function planFor(rc: Runner, o: PlanOptions): AgentRun {
  const { app, live } = rc;
  const prices = app.engines.prices ?? DEFAULT_PRICES;
  const price = (engine: unknown, chars: number) => estimateCost(prices, [{ kind: "speech", engine: engine as never, chars }]).cost;
  // character descriptions written in the brief ("VENOMSPUR" then a paragraph) are read like those in a script; nothing the owner set is changed
  const sheet = readCharacterSheet(o.brief, (live.current?.characters ?? []).map((c) => c.name));
  if (Object.keys(sheet).length) {
    const updated = applyCharacterSheet(live.current!.characters, sheet);
    rc.live.current = { ...live.current!, characters: updated };
    app.edit((p) => ({ ...p, characters: applyCharacterSheet(p.characters, sheet) }), "agent-sheet");
  }
  const existing = migrateRun(live.current?.agent);
  const cloudLimit = o.localOnly ? 0 : Math.max(0, o.cloudLimit || 0);
  const fresh = planProduction(live.current!, app.library, {
    id: existing?.id ?? "run-" + Date.now().toString(36),
    brief: o.brief,
    mode: o.mode,
    localOnly: o.localOnly,
    cloudLimit,
    draftCasting: o.draftCasting === true,
    now: now(),
    price: price as never,
    sound: { cloud: !soundEngineOf(app.engines).free, price: (n) => estimateCost(prices, [{ kind: "sound", count: n }]).cost },
  });
  const next = existing ? { ...merge(existing, fresh, now()), mode: o.mode, localOnly: o.localOnly, cloudLimit, brief: o.brief, ...(o.draftCasting ? { draftCasting: true } : { draftCasting: undefined }) } : fresh;
  saveRun(rc, next);
  return next;
}

export interface RunResult {
  run: AgentRun | null;
  /** Why nothing ran (manual mode, no plan, or the person declined the cost sheet). */
  reason?: string;
}

/**
 * Runs the plan until a step needs the person or everything is done. In Autonomous mode with cloud work planned, the person is shown the
 * app's cost sheet first and the run waits for their answer; a "no" runs nothing. Local-only runs spend nothing and ask nothing.
 */
export async function runFor(rc: Runner, o: { from?: AgentRun; signal?: AbortSignal } = {}): Promise<RunResult> {
  const { app, live } = rc;
  const run = o.from ?? migrateRun(live.current?.agent);
  if (!run) return { run: null, reason: "There is no plan yet. Plan the production first." };
  if (run.mode === "manual") return { run, reason: "Manual Studio: the agent does not run steps. Switch to Guided Agent to let it work." };
  const currency = app.engines.prices?.currency ?? "USD";
  const need = estimateRemaining(run);
  if (run.mode === "autonomous" && need > 0 && !run.localOnly) {
    const ok = await app.confirmSpend({
      title: "Let the agent spend up to your limit?",
      lines: [`Estimated cloud work: ${need.toFixed(2)} ${currency}`, `Hard limit: ${run.cloudLimit.toFixed(2)} ${currency}. The agent stops before passing it and never retries a paid step by itself.`, "Voice rights and final delivery still wait for you."],
    });
    if (!ok) return { run, reason: "The person declined the cost sheet, so nothing was run." };
  }
  let r = resume(run, now());
  const ex = executors(agentEnv({ app, live }));
  const ac = o.signal ? { signal: o.signal } : { signal: new AbortController().signal };
  for (let i = 0; i < 400; i++) {
    const s = await step(r, ex, now, ac.signal);
    r = s.run;
    saveRun(rc, r);
    if (s.event === "idle" || s.event === "cancelled") break;
  }
  return { run: r };
}
