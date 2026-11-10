// Randomised checks of the rules that must hold for EVERY character and voice, not just the examples. A fixed seed makes a failure
// reproducible: the message names the case.

import { describe, expect, it } from "vitest";
import { evaluate } from "./engine";
import { assignVoice, auditCasting, castingGuard, isLocked } from "./lock";
import { readProjectCasting } from "./persist";
import { requirementsOf } from "./requirements";
import { profileOf } from "./voiceProfile";
import type { Fact, VocalAge, VocalGender } from "./types";
import { NOW, char, line, project, take, voice } from "./fixtures";
import type { Character, VoiceEntry } from "../types";

function rng(seed: number) { let s = seed >>> 0; return () => { s = (Math.imul(s, 1664525) + 1013904223) >>> 0; return s / 4294967296; }; }
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]!;
const GENDERS: (VocalGender | null)[] = ["masculine", "feminine", "androgynous", null];
const AGES: (VocalAge | null)[] = ["child", "teen", "young", "mid", "old", null];
const LANGS = ["english", "yoruba", "french", null] as const;
const ACCENTS = ["British", "American", "Nigerian", "Scottish", "", null] as const;
const STATUS = ["verified", "unverified"] as const;
const PROVIDERS = ["piper", "kokoro", "elevenlabs", "wazobia", "qwen", "chatterbox"] as const;

const fact = <T,>(r: () => number, v: T | null): Fact<T> => (v === null || v === "" ? { value: null, status: "unknown", source: "none", confidence: "none" } : { value: v, status: pick(r, STATUS), source: "owner_listening", confidence: "high" });

function randomVoice(r: () => number, i: number): VoiceEntry {
  const provider = pick(r, PROVIDERS);
  const lang = pick(r, LANGS);
  const base = voice(`v${i}`, { provider, name: `Voice ${i}`, language: lang ?? "", accent: pick(r, ACCENTS) ?? "", gender: pick(r, ["", "male", "female"]) });
  const meta: NonNullable<VoiceEntry["meta"]> = { version: 1, revisions: [] };
  if (r() < 0.8) meta.gender = fact(r, pick(r, GENDERS));
  if (r() < 0.8) meta.age = fact(r, pick(r, AGES));
  if (r() < 0.8) meta.languages = fact(r, lang ? [lang] : null);
  if (r() < 0.8) meta.accent = fact(r, pick(r, ACCENTS));
  return { ...base, meta };
}

function randomCharacter(r: () => number, i: number): Character {
  const g = pick(r, ["masculine", "feminine", "any", undefined] as const);
  const spec = { version: 1 as const, ...(g ? { vocalGender: g } : {}), ...(r() < 0.5 ? { vocalAge: [pick(r, ["child", "teen", "young", "mid", "old"] as const)] } : {}), ...(r() < 0.4 ? { language: pick(r, ["Yoruba", "French", "English"]), languageStrictness: pick(r, ["required", "preferred"] as const) } : {}), ...(r() < 0.4 ? { accent: pick(r, ["British", "American", "Nigerian English"]), accentStrictness: pick(r, ["required", "preferred"] as const) } : {}), ...(r() < 0.3 ? { nationality: "Nigerian", culturalBackground: "Yoruba" } : {}) };
  return char(`c${i}`, `Char ${i}`, { cast: spec, ...(r() < 0.3 ? { look: { gender: pick(r, ["m", "f"] as const), heritage: pick(r, ["black", "white", "east_asian"] as const) } } : {}) });
}

describe("casting invariants over 3000 random character and voice pairs", () => {
  const r = rng(20261110);
  const cases = Array.from({ length: 3000 }, (_, i) => ({ c: randomCharacter(r, i), v: randomVoice(r, i) }));

  it("a verdict is never VERIFIED_MATCH unless something was required and every required fact is verified and agrees", () => {
    for (const { c, v } of cases) {
      const req = requirementsOf(c);
      const m = evaluate(req, profileOf(v));
      if (m.status !== "VERIFIED_MATCH") continue;
      expect(req.empty, `${c.id}/${v.id}`).toBe(false);
      for (const reason of m.reasons.filter((x) => x.level === "hard")) expect(reason.outcome, `${c.id}/${v.id}: ${reason.text}`).toBe("match");
    }
  });
  it("a hard mismatch is always INCOMPATIBLE, and an unknown required fact is never a match", () => {
    for (const { c, v } of cases) {
      const m = evaluate(requirementsOf(c), profileOf(v));
      const hard = m.reasons.filter((x) => x.level === "hard");
      if (hard.some((x) => x.outcome === "mismatch")) expect(m.status, `${c.id}/${v.id}`).toBe("INCOMPATIBLE");
      if (m.status !== "INCOMPATIBLE" && hard.some((x) => x.outcome === "unknown" && x.attribute !== "availability")) expect(["UNKNOWN_METADATA", "UNAVAILABLE"], `${c.id}/${v.id}`).toContain(m.status);
    }
  });
  it("heritage, nationality and cultural background never change a verdict", () => {
    for (const { c, v } of cases.slice(0, 600)) {
      const plain = { ...c, look: c.look ? { ...c.look, heritage: undefined } : undefined, cast: { ...c.cast!, nationality: undefined, culturalBackground: undefined } } as Character;
      expect(evaluate(requirementsOf(c), profileOf(v)).status, `${c.id}/${v.id}`).toBe(evaluate(requirementsOf(plain), profileOf(v)).status);
    }
  });
  it("a verdict is deterministic", () => {
    for (const { c, v } of cases.slice(0, 300)) expect(evaluate(requirementsOf(c), profileOf(v))).toEqual(evaluate(requirementsOf(c), profileOf(v)));
  });
});

describe("a locked voice survives any sequence of attempts", () => {
  it("1500 random attempts by every actor never change an approved voice unless the owner confirms", () => {
    const r = rng(99);
    const voices = Array.from({ length: 12 }, (_, i) => randomVoice(r, i));
    let chars: Character[] = Array.from({ length: 5 }, (_, i) => char(`c${i}`, `C${i}`));
    // approve a voice for each character
    chars = chars.map((c, i) => assignVoice([c], { characterId: c.id, voice: voices[i]!, by: "owner", approve: true, acknowledge: true, override: true, now: NOW }).characters[0]!);
    const locked = new Map(chars.map((c) => [c.id, c.casting!.approval!.voiceId]));
    const actors = ["agent", "auto", "preset", "cast_import", "script_edit", "model_switch", "owner"] as const;
    for (let n = 0; n < 1500; n++) {
      const c = pick(r, chars);
      const by = pick(r, actors);
      const v = r() < 0.1 ? null : pick(r, voices);
      const res = assignVoice(chars, { characterId: c.id, voice: v, by, approve: r() < 0.3, acknowledge: r() < 0.5, override: r() < 0.3, confirmChange: false, now: NOW });
      chars = res.characters;
      for (const k of chars) { expect(isLocked(k), `${k.id} unlocked by ${by} at ${n}`).toBe(true); expect(k.casting!.approval!.voiceId, `${k.id} changed by ${by} at ${n}`).toBe(locked.get(k.id)); expect(k.voiceId).toBe(locked.get(k.id)); }
    }
  });
  it("the guard refuses every voice except the approved one", () => {
    const r = rng(7);
    const voices = Array.from({ length: 10 }, (_, i) => randomVoice(r, i));
    const c = assignVoice([char("c", "C")], { characterId: "c", voice: voices[0]!, by: "owner", approve: true, acknowledge: true, override: true, now: NOW }).characters[0]!;
    for (const v of voices) expect(castingGuard(c, v, voices).ok, v.id).toBe(v.id === voices[0]!.id);
  });
  it("an audit finds every take made with a voice other than the approved one", () => {
    const r = rng(3);
    const voices = Array.from({ length: 8 }, (_, i) => randomVoice(r, i));
    const c = assignVoice([char("c", "C")], { characterId: "c", voice: voices[0]!, by: "owner", approve: true, acknowledge: true, override: true, now: NOW }).characters[0]!;
    const lines = voices.map((v, i) => line(`l${i}`, "c", { takes: [take(`t${i}`, v.id)], chosen: `t${i}` }));
    const bad = auditCasting([c], lines, voices).filter((x) => x.severity === "problem").map((x) => x.lineId).sort();
    expect(bad).toEqual(lines.filter((_, i) => i !== 0).map((l) => l.id).sort());
  });
});

describe("saved projects survive hostile edits", () => {
  it("random corruption of casting fields never invents an approval or throws", () => {
    const r = rng(41);
    const base = project([assignVoice([char("g", "G")], { characterId: "g", voice: voice("a"), by: "owner", approve: true, acknowledge: true, now: NOW }).characters[0]!]);
    for (let n = 0; n < 500; n++) {
      const p = JSON.parse(JSON.stringify(base));
      const ch = p.characters[0];
      const junk = pick(r, [null, 1, "x", [], {}, { voiceId: 5 }, { voiceId: "", engine: "" }, "<img onerror=x>"] as const);
      const where = pick(r, ["casting", "cast", "casting.approval", "casting.history", "cast.vocalAge", "voiceId"] as const);
      if (where.includes(".")) { const [a, b] = where.split("."); if (ch[a!]) ch[a!][b!] = junk; } else ch[where] = junk;
      const out = readProjectCasting(p);
      const a = out.characters[0]!.casting?.approval;
      if (a) { expect(typeof a.voiceId).toBe("string"); expect(a.voiceId.length).toBeGreaterThan(0); expect(out.characters[0]!.voiceId).toBe(a.voiceId); }
    }
  });
});
