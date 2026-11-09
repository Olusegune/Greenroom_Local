import { describe, expect, it } from "vitest";
import { ageBandOf, isLocalVoice, pickStandIn } from "./localStandIn";
import type { VoiceEntry } from "./types";

const v = (o: Partial<VoiceEntry> & { id: string; provider: VoiceEntry["provider"] }): VoiceEntry => ({ name: o.id, source: "library", language: "English", accent: "", gender: "Not stated", notes: "", createdAt: "2026-01-01", ...o });

describe("pickStandIn", () => {
  const lib = [
    v({ id: "eleven-1", provider: "elevenlabs", gender: "female" }),
    v({ id: "alan", provider: "piper", gender: "male", age: "mid" }),
    v({ id: "amy", provider: "piper", gender: "female", age: "young" }),
    v({ id: "ana", provider: "piper", language: "Spanish", gender: "female" }),
  ];
  it("never picks a cloud voice", () => { expect(pickStandIn({ gender: "female" }, [lib[0]!])).toBeNull(); });
  it("matches gender and age", () => {
    expect(pickStandIn({ gender: "male", language: "English" }, lib)?.id).toBe("alan");
    expect(pickStandIn({ gender: "female", language: "English", age: "young" }, lib)?.id).toBe("amy");
  });
  it("does not cross languages", () => {
    expect(pickStandIn({ gender: "female", language: "Spanish" }, lib)?.id).toBe("ana");
    expect(pickStandIn({ language: "Yoruba" }, lib)).toBeNull();
  });
  it("returns null for an empty library", () => { expect(pickStandIn({}, [])).toBeNull(); });
  it("maps ages and knows local engines", () => {
    expect(ageBandOf(["elderly"])).toBe("old");
    expect(ageBandOf(["ageless"])).toBeUndefined();
    expect(isLocalVoice({ provider: "piper" })).toBe(true);
    expect(isLocalVoice({ provider: "elevenlabs" })).toBe(false);
  });
});
