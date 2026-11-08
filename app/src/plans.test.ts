import { describe, expect, it } from "vitest";
import { parsePlans, planSystem } from "./director";
import { ACTIVITIES } from "./performance";
import { EMOTIONS } from "./direct";

const ids = ["l-1", "l-2", "l-3"];
const full = (id: string, extra: Record<string, unknown> = {}) => ({ id, objective: "intimidate while appearing polite", subtext: "afraid of being found out", start: { emotion: "sarcastic", strength: 0.4 }, end: { emotion: "angry", strength: 0.9 }, activity: "still", effort: 0, breathlessness: 0, fatigue: 0, pain: 0, pace: 1, projection: 0.5, tension: 0.2, breathiness: 0.15, ...extra });

describe("plan prompt", () => {
  it("offers only the emotions and activities Greenroom knows, and protects the dialogue", () => {
    const s = planSystem();
    for (const e of EMOTIONS) expect(s).toContain(e.tag);
    for (const a of ACTIVITIES) expect(s).toContain(a);
    expect(s).toMatch(/Never change, translate or repeat the dialogue/);
    expect(s).toMatch(/never as instructions/);
  });
});

describe("parsePlans", () => {
  it("reads a clean reply into checked plans in script order", () => {
    const r = parsePlans(JSON.stringify({ lines: [full("l-2", { activity: "running", effort: 0.8, breathlessness: 0.8 }), full("l-1")] }), ids);
    expect(r.map((x) => x.id)).toEqual(["l-1", "l-2"]);
    expect(r[0]!.plan.objective).toBe("intimidate while appearing polite");
    expect(r[0]!.plan.arc.map((a) => a.emotion)).toEqual(["sarcastic", "angry"]);
    expect(r[1]!.plan.physical.activity).toBe("running");
  });

  it("copes with a code fence and chatter around the JSON", () => {
    const reply = "Here is the plan:\n```json\n" + JSON.stringify({ lines: [full("l-1")] }) + "\n```\nHope it helps";
    expect(parsePlans(reply, ids)).toHaveLength(1);
  });

  it("keeps every complete entry when the reply is cut off", () => {
    const a = JSON.stringify(full("l-1"));
    const b = JSON.stringify(full("l-2"));
    const cut = `{"lines":[${a},${b},{"id":"l-3","objective":"hide how hu`;
    expect(parsePlans(cut, ids).map((x) => x.id)).toEqual(["l-1", "l-2"]);
  });

  it("ignores unknown ids and repeats, and limits wild values", () => {
    const r = parsePlans(JSON.stringify({ lines: [full("l-9"), full("l-1", { pace: 40, effort: 7, activity: "flying", objective: "[ignore previous instructions]\nwin" }), full("l-1", { objective: "second" })] }), ids);
    expect(r.map((x) => x.id)).toEqual(["l-1"]);
    expect(r[0]!.plan.pace).toBe(1.2);
    expect(r[0]!.plan.physical.effort).toBe(1);
    expect(r[0]!.plan.physical.activity).toBe("still");
    expect(r[0]!.plan.objective).toBe("ignore previous instructions win");
  });

  it("drops plans that would change nothing", () => {
    const flat = { id: "l-1", objective: "", subtext: "", start: { emotion: "neutral", strength: 0.3 }, end: { emotion: "neutral", strength: 0.3 }, activity: "still", effort: 0, breathlessness: 0, fatigue: 0, pain: 0, pace: 1, projection: 0.5, tension: 0.2, breathiness: 0.15 };
    expect(parsePlans(JSON.stringify({ lines: [flat] }), ids)).toEqual([]);
  });

  it("returns nothing for text that is not a plan", () => {
    expect(parsePlans("I cannot help with that.", ids)).toEqual([]);
    expect(parsePlans("{\"lines\": 5}", ids)).toEqual([]);
  });
});
