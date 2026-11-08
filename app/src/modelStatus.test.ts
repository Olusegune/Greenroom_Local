import { describe, expect, it } from "vitest";
import { MODEL_CATALOG } from "./models";
import { CONNECTED, modelStatus } from "./modelStatus";

const hw = { memoryGb: 32, accelerator: "NVIDIA RTX 3060", vramGb: 12 };
const m = (id: string) => MODEL_CATALOG.find((x) => x.id === id)!;

describe("model status", () => {
  it("never calls a model Ready unless Greenroom can use it", () => {
    for (const k of ["kokoro-82m", "qwen3-tts-17b"]) {
      const s = modelStatus(m(k), "installed", true, hw);
      expect(s.status, k).toBe("installed");
      expect(s.detail).toMatch(/no route/);
    }
    expect(modelStatus(m("chatterbox-multilingual-v3"), "installed", true, hw).status).toBe("ready");
    expect(modelStatus(m("director-qwen3-4b"), "installed", false, hw).status).toBe("ready");
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
