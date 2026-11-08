import { describe, expect, it } from "vitest";
import { portraitFor, portraitPrompt, squareCrop, syncPortraits, validPortrait, voiceSeed } from "./portrait";

const PIC = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQ==";
const v = (over: Partial<{ id: string; name: string; gender: string; notes: string; portrait: string }> = {}) => ({ id: "v1", name: "Alex", gender: "male", notes: "", ...over });

describe("portrait lookup", () => {
  it("finds a voice's picture by the seed every screen uses, and forgets removed ones", () => {
    syncPortraits([{ id: "a", name: "Ann", portrait: PIC }, { id: "b", name: "Bo" }]);
    expect(portraitFor(voiceSeed({ id: "a", name: "Ann" }))).toBe(PIC);
    expect(portraitFor("bBo")).toBeUndefined();
    syncPortraits([{ id: "b", name: "Bo" }]);
    expect(portraitFor("aAnn")).toBeUndefined();
  });
  it("ignores anything that is not a small image address", () => {
    syncPortraits([{ id: "x", name: "X", portrait: "javascript:alert(1)" }, { id: "y", name: "Y", portrait: "data:text/html;base64,PGI+" }]);
    expect(portraitFor("xX")).toBeUndefined();
    expect(portraitFor("yY")).toBeUndefined();
    expect(validPortrait(PIC)).toBe(true);
    expect(validPortrait("https://evil.example/a.png")).toBe(false);
    expect(validPortrait("data:image/svg+xml;base64,PHN2Zz4=")).toBe(false);
    expect(validPortrait("data:image/jpeg;base64," + "A".repeat(400_000))).toBe(false);
    expect(validPortrait(undefined)).toBe(false);
  });
});

describe("squareCrop", () => {
  it("takes the middle square of a wide or tall picture", () => {
    expect(squareCrop(1000, 500)).toEqual({ x: 250, y: 0, size: 500 });
    expect(squareCrop(300, 900)).toEqual({ x: 0, y: 300, size: 300 });
    expect(squareCrop(64, 64)).toEqual({ x: 0, y: 0, size: 64 });
  });
});

describe("portraitPrompt", () => {
  it("asks for a fictional person, uses the gender and the voice's own description, and is stable", () => {
    const a = portraitPrompt(v({ gender: "female", notes: "Warm and wise grandmother" }));
    expect(a).toMatch(/fictional woman/);
    expect(a).toMatch(/seventies/);
    expect(a).toMatch(/warm, kind/);
    expect(a).toMatch(/not a real person and not resembling any celebrity/);
    expect(a).toBe(portraitPrompt(v({ gender: "female", notes: "Warm and wise grandmother" })));
  });
  it("does not guess heritage from the name or accent", () => {
    const p = portraitPrompt(v({ name: "Adaeze Okonkwo", notes: "Nigerian English accent" }));
    expect(p).not.toMatch(/nigerian|african|asian|european|black|white/i);
  });
  it("is long enough for the image request and has no control characters", () => {
    const p = portraitPrompt(v());
    expect(p.length).toBeGreaterThan(8);
    expect(p.length).toBeLessThan(1500);
    expect(/[\u0000-\u001f]/.test(p)).toBe(false);
  });
});
