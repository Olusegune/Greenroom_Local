import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ACCENT_ROLES, ALL_PIPER_ROLES, WAZOBIA_ROLES, documentedGender } from "../castcall";
import { profileOf, speakerOf } from "./voiceProfile";
import type { VoiceEntry } from "../types";

const model = JSON.parse(readFileSync(join(__dirname, "..", "fixtures", "l2arctic.speakers.json"), "utf8")) as { speakers: Record<string, string> };
const entry = (key: string, over: Partial<VoiceEntry> = {}): VoiceEntry => ({ id: key, name: key, provider: "piper", source: "library", language: "English", accent: "", gender: "", notes: "", createdAt: "", ...over });

describe("the L2-ARCTIC speaker table matches the model's own speaker map", () => {
  it("every speaker number in Greenroom points at the speaker named for it, and each is used once", () => {
    expect(Object.keys(model.speakers)).toHaveLength(24);
    const seen = new Set<string>();
    for (const r of ACCENT_ROLES) {
      const n = r.key.split("@")[1]!;
      expect(r.name.toUpperCase(), `${r.key}`).toBe(model.speakers[n]);
      seen.add(n);
    }
    expect(seen.size).toBe(24);
  });
  it("sends the speaker number to the engine as part of the voice id and reads it back as the speaker", () => {
    for (const r of ACCENT_ROLES) expect(speakerOf(entry(r.key))).toBe(r.key.split("@")[1]);
  });
});

describe("no voice in the catalogue gets a gender, age or accent from its name", () => {
  it("only the L2-ARCTIC speakers have a documented gender, and it stays unverified until someone listens", () => {
    for (const r of ALL_PIPER_ROLES) {
      const g = documentedGender(r.key);
      const isL2 = r.key.includes("l2arctic");
      expect(g !== "", r.key).toBe(isL2);
      const p = profileOf(entry(r.key, { accent: r.accent, language: r.language, gender: g }));
      expect(p.gender.status === "verified", r.key).toBe(false);
      if (!isL2) expect(p.gender.value, r.key).toBeNull();
      expect(p.age.value, r.key).toBeNull();
    }
  });
  it("L2-ARCTIC voices are marked non-commercial", () => {
    for (const r of ACCENT_ROLES) expect(profileOf(entry(r.key)).commercial.status).toBe("forbidden");
  });
  it("WazobiaVoice speakers have no invented age or gender, and are non-commercial", () => {
    expect(WAZOBIA_ROLES.length).toBe(13 * 4);
    for (const r of WAZOBIA_ROLES) {
      const p = profileOf(entry(`${r.voice}@${r.lang}`, { provider: "wazobia", name: r.name, language: r.lang, accent: r.accent }));
      expect(p.gender.value).toBeNull();
      expect(p.age.value).toBeNull();
      expect(p.commercial.status).toBe("forbidden");
      expect(p.speakerId).toBe(r.lang);
    }
  });
});
