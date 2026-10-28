import { describe, expect, it } from "vitest";
import { FPS_PRESETS, fpsLabel, fpsValue, frameToSec, frameToTc, nominal, secAtTc, secToFrame, snapToFrame, tcAt, tcToFrame } from "./picture";

const f24 = { num: 24, den: 1 };
const f2398 = { num: 24000, den: 1001 };
const f2997 = { num: 30000, den: 1001 };

describe("frame rates", () => {
  it("know their real and nominal rates and name themselves", () => {
    expect(fpsValue(f2398)).toBeCloseTo(23.976023976, 8);
    expect(nominal(f2398)).toBe(24);
    expect(nominal(f2997)).toBe(30);
    expect(fpsLabel(f2398)).toBe("23.976 fps");
    expect(fpsLabel({ num: 48, den: 1 })).toBe("48.000 fps");
    expect(FPS_PRESETS).toHaveLength(8);
  });
  it("snap a time to the nearest frame", () => {
    expect(snapToFrame(1.01, f24)).toBeCloseTo(1 + 0 / 24, 9);
    expect(snapToFrame(1.03, f24)).toBeCloseTo(25 / 24, 9);
    expect(secToFrame(10, f2398)).toBe(240);
    expect(frameToSec(240, f2398)).toBeCloseTo(10.01, 9);
  });
});

describe("timecode", () => {
  it("counts frames at the nominal rate, so 23.976 timecode runs a little behind the clock", () => {
    expect(frameToTc(0, f24)).toBe("00:00:00:00");
    expect(frameToTc(86400, f24)).toBe("01:00:00:00");
    expect(frameToTc(25, f24)).toBe("00:00:01:01");
    // One real hour of 23.976 video has 86,314 frames.
    expect(frameToTc(Math.round(3600 * fpsValue(f2398)), f2398)).toBe("00:59:56:10");
  });
  it("reads timecode text in several shapes and refuses nonsense", () => {
    expect(tcToFrame("01:00:00:00", f24)).toBe(86400);
    expect(tcToFrame("00:00:02;12", f24)).toBe(60);
    expect(tcToFrame("1:05:03", f24)).toBe((1 * 60 + 5) * 24 + 3);
    expect(tcToFrame("5:03", f24)).toBe(5 * 24 + 3);
    expect(tcToFrame("00:00:00:24", f24)).toBeNull();
    expect(tcToFrame("00:60:00:00", f24)).toBeNull();
    expect(tcToFrame("abc", f24)).toBeNull();
    expect(tcToFrame("1", f24)).toBeNull();
    expect(tcToFrame("1:2:3:4:5", f24)).toBeNull();
  });
  it("round-trips through a picture that starts at 01:00:00:00", () => {
    const pic = { fpsNum: 24, fpsDen: 1, startFrame: 86400 };
    expect(tcAt(0, pic)).toBe("01:00:00:00");
    expect(tcAt(2.5, pic)).toBe("01:00:02:12");
    expect(secAtTc("01:00:02:12", pic)).toBeCloseTo(2.5, 9);
    expect(secAtTc("00:59:59:23", pic)).toBeNull();
    const p2 = { fpsNum: 24000, fpsDen: 1001, startFrame: 0 };
    for (const t of [0, 1.001, 12.5, 100.1]) {
      const s = snapToFrame(t, f2398);
      expect(secAtTc(tcAt(s, p2), p2)).toBeCloseTo(s, 6);
    }
  });
});
