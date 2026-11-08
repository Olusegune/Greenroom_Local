import { useState } from "react";
import { useApp } from "../ctx";
import type { PlanSuggestion } from "../director";
import { cleanNote } from "../direct";
import { compilePerformance, migratePerformance, type PerformancePlan } from "../performance";

/** The director's performance plans for the scene. Edit the objective and subtext, tick the lines to use, then apply. Only the line's plan is written. */
export function PlanReview({ items, onClose }: { items: PlanSuggestion[]; onClose: () => void }) {
  const { project, edit, toast } = useApp();
  const lineOf = (id: string) => project!.lines.find((l) => l.id === id)!;
  const has = (id: string) => !!migratePerformance(lineOf(id).performance);
  const [plans, setPlans] = useState<Record<string, PerformancePlan>>(() => Object.fromEntries(items.map((i) => [i.id, i.plan])));
  const [keepMine, setKeepMine] = useState(true);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.filter((i) => !has(i.id)).map((i) => i.id)));
  const setField = (id: string, f: "objective" | "subtext", v: string) => setPlans((p) => ({ ...p, [id]: { ...p[id]!, [f]: cleanNote(v, 160) } }));
  const apply = () => {
    edit((p) => ({ ...p, lines: p.lines.map((l) => (picked.has(l.id) && plans[l.id] ? { ...l, performance: plans[l.id] } : l)) }));
    toast(`Planned the performance for ${picked.size} line${picked.size === 1 ? "" : "s"}. Nothing was generated.`);
    onClose();
  };
  return (
    <div className="scrim" role="presentation">
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="plan-t" style={{ width: "min(860px, 94vw)" }}>
        <h2 id="plan-t">The director&apos;s performance plan</h2>
        <p className="muted small">For each line: what the character wants, what is underneath, how the feeling moves and what the body is doing. Edit the first two, tick the lines you want, then press Apply. Your directions and the script are not changed, and nothing is spoken or paid for until you make a take.</p>
        <label className="row small" style={{ margin: "8px 0" }}>
          <input
            type="checkbox"
            checked={keepMine}
            onChange={(e) => {
              setKeepMine(e.target.checked);
              setPicked(new Set(items.filter((i) => !(e.target.checked && has(i.id))).map((i) => i.id)));
            }}
          />
          Leave lines where I already made a plan alone
        </label>
        <div className="stack" style={{ maxHeight: "52vh", overflow: "auto" }}>
          {items.map((i) => {
            const l = lineOf(i.id);
            const who = project!.characters.find((c) => c.id === l.characterId)?.name ?? "?";
            const plan = plans[i.id]!;
            const c = compilePerformance(plan);
            return (
              <div key={i.id} className="take" style={{ alignItems: "flex-start" }}>
                <input
                  type="checkbox"
                  aria-label={`Use the plan for ${who}: ${l.text.slice(0, 30)}`}
                  checked={picked.has(i.id)}
                  onChange={(e) =>
                    setPicked((set) => {
                      const n = new Set(set);
                      if (e.target.checked) n.add(i.id);
                      else n.delete(i.id);
                      return n;
                    })
                  }
                  style={{ marginTop: 6 }}
                />
                <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 6 }}>
                  <span>
                    <span className="speaker">{who}</span> <span className="muted small">{l.text.slice(0, 90)}</span>
                    {has(i.id) && <span className="badge warn" style={{ marginLeft: 8 }}>already has a plan</span>}
                  </span>
                  <span className="row wrap">
                    <input type="text" aria-label={`Objective for ${who}`} placeholder="Objective" value={plan.objective} maxLength={160} onChange={(e) => setField(i.id, "objective", e.target.value)} style={{ flex: 1, minWidth: 220 }} />
                    <input type="text" aria-label={`Subtext for ${who}`} placeholder="Subtext" value={plan.subtext} maxLength={160} onChange={(e) => setField(i.id, "subtext", e.target.value)} style={{ flex: 1, minWidth: 220 }} />
                  </span>
                  <span className="muted small">{c.sentences.slice(plan.objective || plan.subtext ? 1 : 0).join(" ") || "No arc or body change."}{c.pace !== 1 ? ` Pace ${c.pace.toFixed(2)}×.` : ""}</span>
                </span>
              </div>
            );
          })}
        </div>
        <div className="row end" style={{ marginTop: 16 }}>
          <button onClick={onClose}>Cancel</button>
          <button className="primary" disabled={picked.size === 0} onClick={apply}>
            Apply to {picked.size} line{picked.size === 1 ? "" : "s"}
          </button>
        </div>
      </div>
    </div>
  );
}
