import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CharacterMark, VoiceFace, VoiceMark, barHeights } from "./voiceMark";

describe("the mark and face of a voice in a list", () => {
  it("shows a neutral mark, the same one every time, and a different one for a different voice", () => {
    expect(barHeights("en_GB-alan-medium")).toEqual(barHeights("en_GB-alan-medium"));
    expect(barHeights("en_GB-alan-medium")).not.toEqual(barHeights("en_US-amy-medium"));
    expect(barHeights("x")).toHaveLength(9);
    for (const h of barHeights("anything")) expect(h).toBeGreaterThan(0);
  });
  it("draws no person: the mark has no image, no face and is hidden from screen readers", () => {
    const html = renderToStaticMarkup(<VoiceMark id="v" provider="piper" />);
    expect(html).toContain("voice-mark");
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain("<img");
  });
  it("the owner's own picture is shown, and a value that is not an image is ignored", () => {
    const base = { id: "v", provider: "piper" as const, name: "Alan" };
    expect(renderToStaticMarkup(<VoiceFace voice={{ ...base, portrait: "data:image/jpeg;base64,AAAA" }} />)).toContain("<img");
    // a value that is not an image is ignored, not rendered
    expect(renderToStaticMarkup(<VoiceFace voice={{ ...base, portrait: "javascript:alert(1)" }} />)).not.toContain("<img");
  });
  it("until the portrait library has loaded, a voice shows its mark whatever its record says", () => {
    const a = renderToStaticMarkup(<VoiceFace voice={{ id: "v", provider: "elevenlabs", name: "Abiola (Nigerian, male)", gender: "male" }} />);
    const b = renderToStaticMarkup(<VoiceFace voice={{ id: "v", provider: "elevenlabs", name: "Someone else entirely" }} />);
    expect(a).toBe(b);
  });
  it("a character with nothing stated shows its initials", () => {
    expect(renderToStaticMarkup(<CharacterMark name="Ada Obi" />)).toContain(">AO<");
    expect(renderToStaticMarkup(<CharacterMark name="" />)).toContain(">?<");
  });
});

import { voiceChipsChecked } from "./voiceMeta";
import { listened, voice as fixtureVoice } from "./casting/fixtures";

describe("the voice card chips say what is known", () => {
  it("a stated gender is 'claimed' until someone listens, and a Piper voice's name gives none", () => {
    const claimed = voiceChipsChecked(fixtureVoice("a", { gender: "male", accent: "Nigerian" }));
    expect(claimed.find((c) => c.kind === "gender")!.text).toBe("Masculine (claimed)");
    const heard = voiceChipsChecked(listened(fixtureVoice("b", { gender: "male" }), { gender: "masculine" }));
    expect(heard.find((c) => c.kind === "gender")!.text).toBe("Masculine");
    const piper = voiceChipsChecked(fixtureVoice("en_GB-alan-medium", { provider: "piper", gender: "male", accent: "British" }));
    expect(piper.some((c) => c.kind === "gender")).toBe(false);
    expect(piper.some((c) => c.kind === "accent")).toBe(true);
  });
});
