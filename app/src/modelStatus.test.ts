import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "./models";
import { CONNECTED, modelStatus } from "./modelStatus";

const hw = { memoryGb: 32, accelerator: "NVIDIA RTX 3060", vramGb: 12 };
const m = (id: string) => MODEL_CATALOG.find((x) => x.id === id)!;

describe("model status", () => {
  it("never calls a model Ready unless Greenroom can use it", () => {
    // Qwen3-TTS is Ready: its worker made valid audio on a real PC (2026-11-09, also with no internet), and the in-app setup
    // test line passed on the owner's PC. Whether it SOUNDS good is the owner's call and is not claimed here.
    const q = modelStatus(m("qwen3-tts-17b"), "installed", true, hw);
    expect(q.status).toBe("ready");
    expect(modelStatus(m("qwen3-tts-17b"), "available", true, hw).status).toBe("download-required");
    // Kokoro is Ready: two real lines (American and British) made valid audio on a real install (2026-11-09).
    const k = modelStatus(m("kokoro-82m"), "installed", true, hw);
    expect(k.status).toBe("ready");
    expect(modelStatus(m("kokoro-82m"), "available", true, hw).status).toBe("download-required");
    expect(modelStatus(m("chatterbox-multilingual-v3"), "installed", true, hw).status).toBe("ready");
    expect(modelStatus(m("director-qwen3-4b"), "installed", false, hw).status).toBe("ready");
    for (const k of ["stable-audio-open-small", "ace-step-v1"]) {
      const s = modelStatus(m(k), "installed", false, hw);
      expect(s.status, k).toBe("installed");
      expect(s.detail).toMatch(/not marked Ready/);
    }
    expect(Object.keys(CONNECTED).every((id) => MODEL_CATALOG.some((x) => x.id === id))).toBe(true);
  });

  it("asks for a download, then for setup when the runtime is missing", () => {
    expect(modelStatus(m("chatterbox-multilingual-v3"), "available", false, hw).status).toBe("download-required");
    expect(modelStatus(m("chatterbox-multilingual-v3"), "installed", false, hw).status).toBe("requires-setup");
    expect(modelStatus(m("wazobia-voice"), "installed", false, hw).status).toBe("requires-setup");
  });

  it("says unsupported for the wrong hardware, and keeps the experimental flag", () => {
    expect(modelStatus(m("ace-step-v1"), "available", false, { ...hw, accelerator: "Apple Metal" }).status).toBe("unsupported");
    expect(modelStatus(m("ace-step-v1"), "installed", false, hw).experimental).toBe(true);
    const huge = { ...m("chatterbox-multilingual-v3"), memoryGb: 64 };
    expect(modelStatus(huge, "available", false, { ...hw, memoryGb: 16 }).status).toBe("unsupported");
  });
});
