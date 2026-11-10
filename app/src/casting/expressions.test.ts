import { describe, expect, it } from "vitest";
import { ENGINE_ORDER } from "../engines";
import { plan } from "../generate";
import { CONTROLS, LISTENING_TESTS, controlSupport, expressionReport } from "./expressions";
import { line, voice } from "./fixtures";

describe("the expression capability matrix", () => {
  it("has an answer for every engine and every control", () => {
    for (const e of ENGINE_ORDER) for (const c of CONTROLS) expect(controlSupport(e, c.id).how.length, `${e}/${c.id}`).toBeGreaterThan(10);
  });
  it("marks nothing as verified: nobody has listened", () => {
    for (const e of ENGINE_ORDER) for (const c of CONTROLS) expect(controlSupport(e, c.id).status).not.toBe("native_verified");
  });
  it("a plain-text engine does not claim to act: it is unsupported or needs a separate clip", () => {
    for (const e of ["piper", "kokoro", "chatterbox", "qwen", "wazobia", "kie", "local"] as const) {
      expect(controlSupport(e, "whisper").status).toBe("unsupported");
      expect(controlSupport(e, "laugh").status).toBe("asset");
      expect(controlSupport(e, "transition").status).toBe("unsupported");
    }
  });
  it("tag engines send tags natively, and Inworld approximates what it has no exact tag for", () => {
    expect(controlSupport("elevenlabs", "laugh").status).toBe("native_unverified");
    expect(controlSupport("inworld", "laugh").status).toBe("native_unverified");
    expect(controlSupport("inworld", "breathless").status).toBe("approximated");
    expect(controlSupport("inworld", "whisper").status).toBe("approximated");
  });
  it("warns about what cannot be done and offers engines that can, instead of dropping it silently", () => {
    const r = expressionReport("piper", ["whisper", "shout"]);
    expect(r.unsupported).toEqual(["whisper", "shout"]);
    expect(r.alternatives).toContain("elevenlabs");
    expect(r.alternatives).not.toContain("piper");
    expect(expressionReport("elevenlabs", ["laugh", "cry"]).unsupported).toEqual([]);
    expect(expressionReport("piper", ["laugh"]).assets).toEqual(["laugh"]);
  });
  it("every control has a listening test that says what to hear and what failing sounds like", () => {
    for (const c of CONTROLS) { const t = LISTENING_TESTS[c.id]; expect(t.line && t.listenFor && t.failure).toBeTruthy(); }
  });
});

describe("unsupported tags are not sent blindly", () => {
  const l = line("l", "c", { text: "Ha! [laughs] Oh, that is wonderful. [whispers] Quiet now." });
  it("a plain engine receives the words only: the tags are stripped, not read aloud", () => {
    for (const provider of ["piper", "kokoro", "chatterbox", "qwen", "wazobia"] as const) {
      const p = plan(l, voice("v", { provider }), "eleven_v4" as never);
      expect(p.text, provider).not.toMatch(/\[|laughs|whispers/);
      expect(p.text, provider).toContain("Oh, that is wonderful.");
    }
  });
  it("a tag engine receives the tags", () => {
    expect(plan(l, voice("v", { provider: "elevenlabs" }), "eleven_v4" as never).text).toContain("[laughs]");
  });
});
