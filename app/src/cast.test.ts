import { describe, expect, it } from "vitest";
import { appliedSummary, applyCast, castFrom } from "./cast";
import { DEFAULT_DIRECTION, type Project, type VoiceEntry } from "./types";

const voice = (id: string, name: string, provider: VoiceEntry["provider"] = "elevenlabs"): VoiceEntry => ({ id, name, provider, source: "library", language: "en", accent: "", gender: "", notes: "", createdAt: "" });
const line = (id: string, characterId: string) => ({ id, characterId, scene: 0, text: "x", direction: { ...DEFAULT_DIRECTION }, takes: [], events: [] });
const project = (): Pick<Project, "characters" | "lines"> => ({
  characters: [
    { id: "c1", name: "ADA", language: "English", voiceId: "v1" },
    { id: "c2", name: "Tunde", language: "Yoruba", voiceId: "gone" },
    { id: "c3", name: "MAMA", language: "English" },
    { id: "c4", name: "ghost", language: "English", voiceId: "v1" },
  ],
  lines: [line("l1", "c1"), line("l2", "c2"), line("l3", "c3")],
});
const lib = [voice("v1", "Ada voice"), voice("v2", "Deep Tunde", "kie")];

describe("saved casts", () => {
  it("keep only speaking characters whose voice is in the library", () => {
    const c = castFrom(project(), lib, "  Late Delivery ", "k1", "now");
    expect(c.name).toBe("Late Delivery");
    expect(c.members).toEqual([{ name: "ADA", voiceId: "v1", voiceName: "Ada voice", provider: "elevenlabs", language: "English" }]);
    expect(castFrom(project(), lib, " ", "k2", "now").name).toBe("Cast");
  });

  it("give voices by name, ignoring case, and leave everyone else alone", () => {
    const cast = { id: "k", name: "K", createdAt: "", members: [{ name: "ada", voiceId: "v1", voiceName: "Ada voice", provider: "elevenlabs" as const, language: "English (British)" }, { name: "TUNDE", voiceId: "v2", voiceName: "Deep Tunde", provider: "kie" as const, language: "English" }, { name: "BO", voiceId: "v1", voiceName: "x", provider: "elevenlabs" as const, language: "" }] };
    const r = applyCast(project(), cast, lib);
    expect(r.characters.find((c) => c.id === "c1")).toMatchObject({ voiceId: "v1", language: "English (British)" });
    expect(r.characters.find((c) => c.id === "c2")).toMatchObject({ voiceId: "v2", language: "English" });
    expect(r.characters.find((c) => c.id === "c3")?.voiceId).toBeUndefined();
    expect(r.characters.find((c) => c.id === "c4")?.voiceId).toBe("v1");
    expect(r.applied).toEqual(["ADA", "Tunde"]);
    expect(r.unmatched).toEqual(["BO"]);
    expect(r.uncast).toEqual(["MAMA"]);
  });

  it("find a voice again by engine and name when its id has changed, and say when it is gone", () => {
    const cast = { id: "k", name: "K", createdAt: "", members: [{ name: "ADA", voiceId: "old-id", voiceName: "ADA VOICE", provider: "elevenlabs" as const, language: "" }, { name: "Tunde", voiceId: "zz", voiceName: "Missing", provider: "kie" as const, language: "" }] };
    const r = applyCast(project(), cast, lib);
    expect(r.characters[0]).toMatchObject({ voiceId: "v1", language: "English" });
    expect(r.characters[1]!.voiceId).toBe("gone");
    expect(r.lostVoices).toEqual(["Tunde"]);
    expect(appliedSummary(r)).toContain("Gave voices to ADA.");
    expect(appliedSummary(r)).toContain("Tunde: the voice is no longer in your library.");
    expect(appliedSummary(applyCast(project(), { ...cast, members: [] }, lib))).toContain("No character matched");
  });

  it("never changes the project it is given", () => {
    const p = project();
    applyCast(p, { id: "k", name: "K", createdAt: "", members: [{ name: "MAMA", voiceId: "v1", voiceName: "", provider: "elevenlabs", language: "" }] }, lib);
    expect(p.characters[2]!.voiceId).toBeUndefined();
  });
});
