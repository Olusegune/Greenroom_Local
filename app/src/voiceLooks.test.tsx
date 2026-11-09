import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VoiceLooks } from "./screens/AvatarButton";
import type { VoiceEntry } from "./types";

const voice = (over: Partial<VoiceEntry>): VoiceEntry => ({ id: "v1", name: "Chloe", provider: "elevenlabs", source: "account", language: "en", accent: "american", gender: "Female", notes: "", createdAt: "", ...over });

describe("the voice looks editor", () => {
  it("shows the stored gender, age and heritage as selected", () => {
    const html = renderToStaticMarkup(<VoiceLooks v={voice({ age: "child", heritage: "black" })} onChange={() => undefined} />);
    expect(html).toContain("Who is this voice?");
    expect(html).toMatch(/<option value="child" selected/);
    expect(html).toMatch(/<option value="black" selected/);
    expect(html).toMatch(/<option selected[^>]*>Female/);
  });
  it("offers Not stated when nothing is known", () => {
    const html = renderToStaticMarkup(<VoiceLooks v={voice({ gender: "" })} onChange={() => undefined} />);
    expect(html.match(/selected/g)?.length).toBe(3);
    expect(html).toContain("Middle Eastern / North African");
    expect(html).toContain("East or Southeast Asian");
  });
});
