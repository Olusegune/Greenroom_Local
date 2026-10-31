import { describe, expect, it } from "vitest";
import { MODEL_CATALOG, recommendedModels, totalDownload } from "./models";

describe("model catalogue", () => {
  it("keeps studio models off compact machines", () => {
    expect(recommendedModels({ platform: "windows", memoryGb: 8, accelerator: "CPU", vramGb: 0, tier: "compact" })).toEqual(["greenroom-runtime", "kokoro-82m"]);
  });
  it("calculates a setup download", () => {
    expect(totalDownload(["greenroom-runtime", "whisper-large-v3-turbo"], MODEL_CATALOG)).toBeCloseTo(2.9);
  });
});
