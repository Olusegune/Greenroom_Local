import { describe, expect, it } from "vitest";
import { actsOnWords, CAPS, suggestEngines } from "./engineCaps";
import { ENGINE_ORDER } from "./engines";

describe("engine capabilities", () => {
  it("covers every engine", () => {
    for (const e of ENGINE_ORDER) expect(CAPS[e]).toBeTruthy();
  });

  it("knows Inworld Flash does not follow written words but TTS 2 does", () => {
    expect(actsOnWords("inworld", "inworld-tts-2")).toBe(true);
    expect(actsOnWords("inworld", "inworld-tts-2-flash")).toBe(false);
    expect(actsOnWords("piper")).toBe(false);
    expect(actsOnWords("voicekiller")).toBe(true);
  });
});

describe("suggestEngines", () => {
  const ready = ["piper", "elevenlabs", "inworld", "voicekiller", "kie"] as const;

  it("lists the engines that can act on direction first and says why the others cannot", () => {
    const r = suggestEngines({ words: true }, [...ready]);
    expect(r.filter((x) => x.ok).map((x) => x.engine).sort()).toEqual(["elevenlabs", "inworld", "voicekiller"]);
    expect(r.find((x) => x.engine === "piper")!.reasons).toContain("cannot act on written direction");
    expect(r.slice(0, 3).every((x) => x.ok)).toBe(true);
  });

  it("puts a capable local engine ahead of a cloud one, but never invents one", () => {
    const r = suggestEngines({ words: false }, [...ready]);
    expect(r[0]!.engine).toBe("piper");
    expect(suggestEngines({ words: true }, ["piper"])[0]!.ok).toBe(false);
  });

  it("rules cloud engines out for private text instead of downgrading to them", () => {
    const r = suggestEngines({ private: true, words: true }, [...ready]);
    expect(r.every((x) => !x.ok)).toBe(true);
    expect(r.find((x) => x.engine === "elevenlabs")!.reasons).toContain("sends text to a company");
  });

  it("checks sounds and cloning, and Inworld only plays its documented sounds", () => {
    expect(suggestEngines({ sounds: ["laughs"] }, [...ready]).filter((x) => x.ok).map((x) => x.engine).sort()).toEqual(["elevenlabs", "inworld"]);
    const g = suggestEngines({ sounds: ["gasps"] }, [...ready]);
    expect(g.find((x) => x.engine === "inworld")!.ok).toBe(false);
    expect(g.find((x) => x.engine === "elevenlabs")!.ok).toBe(true);
    expect(suggestEngines({ cloning: true }, [...ready]).filter((x) => x.ok).map((x) => x.engine).sort()).toEqual(["elevenlabs", "inworld"]);
  });

  it("honours free only", () => {
    expect(suggestEngines({ freeOnly: true }, [...ready]).filter((x) => x.ok).map((x) => x.engine)).toEqual(["piper"]);
  });
});
