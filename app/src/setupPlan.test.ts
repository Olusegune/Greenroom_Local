import { describe, expect, it } from "vitest";
import { KOKORO_VOICES, PIPER_ENGINE_MB, planKokoro, planSetup, runSetup, STARTER_VOICES, summarize, type SetupInput, type SetupStep } from "./setupPlan";

const base: SetupInput = { hardware: { tier: "standard", memoryGb: 16 }, piperInstalled: false, piperVoices: [], libraryVoices: [], chatterboxRuntime: false, chatterboxModel: "available", withChatterbox: false };

describe("planSetup", () => {
  it("a clean PC gets Piper and two voices, in order, with the voices waiting on Piper", () => {
    const p = planSetup(base);
    expect(p.steps.map((s) => s.id)).toEqual(["piper", ...STARTER_VOICES.map((v) => "voice:" + v.key)]);
    expect(p.steps[1]!.needs).toBe("piper");
    expect(p.knownMb).toBe(PIPER_ENGINE_MB + STARTER_VOICES.reduce((n, v) => n + v.sizeMb, 0));
    expect(p.sizeUnknown).toBe(false);
  });
  it("skips what is done, so running twice does nothing", () => {
    const all = { ...base, piperInstalled: true, piperVoices: STARTER_VOICES.map((v) => v.key), libraryVoices: STARTER_VOICES.map((v) => v.key) };
    const p = planSetup(all);
    expect(p.steps).toEqual([]);
    expect(p.alreadyDone.length).toBe(3);
    expect(summarize([])).toBe("Everything was already set up.");
  });
  it("a voice on disk but missing from the library is added without a download", () => {
    const p = planSetup({ ...base, piperInstalled: true, piperVoices: [STARTER_VOICES[0]!.key], libraryVoices: [] });
    const s = p.steps.find((x) => x.key === STARTER_VOICES[0]!.key)!;
    expect(s.sizeMb).toBe(0);
    expect(s.needs).toBeUndefined();
  });
  it("Chatterbox is added only when chosen, and its runtime size is reported as unknown", () => {
    expect(planSetup(base).steps.some((s) => s.kind.startsWith("chatterbox"))).toBe(false);
    const p = planSetup({ ...base, withChatterbox: true });
    expect(p.steps.map((s) => s.kind)).toContain("chatterbox-runtime");
    expect(p.steps.map((s) => s.kind)).toContain("chatterbox-model");
    expect(p.sizeUnknown).toBe(true);
    expect(planSetup({ ...base, withChatterbox: true, chatterboxRuntime: true, chatterboxModel: "installed" }).steps.some((s) => s.kind.startsWith("chatterbox"))).toBe(false);
  });
  it("advises against Chatterbox on a small PC and says why", () => {
    const small = planSetup({ ...base, hardware: { tier: "compact", memoryGb: 4 } });
    expect(small.chatterboxAdvisable).toBe(false);
    expect(small.chatterboxNote).toContain("4 GB");
    expect(planSetup(base).chatterboxAdvisable).toBe(true);
  });
});

describe("Kokoro steps", () => {
  it("are absent unless chosen", () => { expect(planSetup(base).steps.some((s) => s.kind.startsWith("kokoro"))).toBe(false); });
  it("run runtime, then model, then voices, each waiting on the one before", () => {
    const p = planKokoro({ kokoroRuntime: false, kokoroModel: false, libraryKokoro: [] });
    expect(p.steps.map((s) => s.kind)).toEqual(["kokoro-runtime", "kokoro-model", "kokoro-voices"]);
    expect(p.steps[1]!.needs).toBe("kokoro-runtime");
    expect(p.steps[2]!.needs).toBe("kokoro-model");
    expect(p.steps.every((s) => !s.kind.startsWith("chatterbox") && s.kind !== "piper" && s.kind !== "voice")).toBe(true);
  });
  it("skip what is done and add only the missing voices", () => {
    const some = KOKORO_VOICES.slice(0, 2).map((v) => v.id);
    const p = planKokoro({ kokoroRuntime: true, kokoroModel: true, libraryKokoro: some });
    expect(p.steps.map((s) => s.kind)).toEqual(["kokoro-voices"]);
    expect(p.steps[0]!.needs).toBeUndefined();
    expect(p.steps[0]!.label).toContain(String(KOKORO_VOICES.length - 2));
    expect(planKokoro({ kokoroRuntime: true, kokoroModel: true, libraryKokoro: KOKORO_VOICES.map((v) => v.id) }).steps).toEqual([]);
  });
  it("only ever lists voice names Kokoro accepts", () => { for (const v of KOKORO_VOICES) expect(v.id).toMatch(/^[ab][fm]_[a-z]+$/); });
});

describe("runSetup", () => {
  const steps: SetupStep[] = [
    { id: "piper", kind: "piper", label: "Piper", why: "" },
    { id: "voice:a", kind: "voice", label: "A", why: "", needs: "piper" },
    { id: "voice:b", kind: "voice", label: "B", why: "", needs: "piper" },
  ];
  it("runs in order and reports done", async () => {
    const order: string[] = [];
    const r = await runSetup(steps, async (s) => { order.push(s.id); }, () => undefined);
    expect(order).toEqual(["piper", "voice:a", "voice:b"]);
    expect(r.every((x) => x.status === "done")).toBe(true);
    expect(summarize(r)).toBe("All 3 steps finished.");
  });
  it("skips steps whose prerequisite failed and keeps the error", async () => {
    const r = await runSetup(steps, async (s) => { if (s.id === "piper") throw new Error("no network"); }, () => undefined);
    expect(r[0]).toMatchObject({ status: "failed", error: "no network" });
    expect(r[1]!.status).toBe("skipped");
    expect(r[1]!.error).toContain("Piper");
    expect(summarize(r)).toContain("1 failed, 2 skipped");
  });
  it("a failed voice does not stop the other voice", async () => {
    const r = await runSetup(steps, async (s) => { if (s.id === "voice:a") throw new Error("x"); }, () => undefined);
    expect(r.map((x) => x.status)).toEqual(["done", "failed", "done"]);
  });
  it("stop takes effect between steps and never starts the rest", async () => {
    let n = 0;
    const r = await runSetup(steps, async () => { n++; }, () => undefined, () => n >= 1);
    expect(n).toBe(1);
    expect(r.map((x) => x.status)).toEqual(["done", "skipped", "skipped"]);
  });
  it("reports progress after every change", async () => {
    const seen: string[] = [];
    await runSetup(steps.slice(0, 1), async () => undefined, (r) => seen.push(r[0]!.status));
    expect(seen).toEqual(["waiting", "running", "done"]);
  });
});
