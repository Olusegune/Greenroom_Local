import { describe, expect, it } from "vitest";
import type { PiperVoice } from "./api";
import { ENGINES, KIE_VOICES, providerFor } from "./engines";
import { kieFor, piperFor, voicekillerFor } from "./finder";
import { languageName, localeMatches, tileById, TILES, tileByName } from "./languages";

const t = (id: string) => tileById(id)!;
const piper = (key: string, code: string): PiperVoice => ({ key, name: key, code, family: code.split("_")[0]!, language: "", country: "", quality: "medium", speakers: 1, sizeMb: 60 });

describe("tiles", () => {
  it("have unique ids, a flag and a language each", () => {
    expect(new Set(TILES.map((x) => x.id)).size).toBe(TILES.length);
    expect(TILES.length).toBeGreaterThan(60);
    for (const x of TILES) expect(x.cc && x.lang).toBeTruthy();
  });
  it("cover the languages that matter to the owner", () => {
    for (const id of ["en-ng", "pcm", "yo", "ig", "ha", "ko", "ja", "fil", "taglish", "en-gh", "en-za", "en-in", "en-gb", "en-us"]) expect(tileById(id), id).toBeTruthy();
  });
  it("find a tile from a character's language label", () => {
    expect(tileByName("Yoruba")?.id).toBe("yo");
    expect(tileByName("English (Nigerian)")?.id).toBe("en-ng");
    expect(tileByName("Nope")).toBeUndefined();
    expect(languageName("ko")).toBe("Korean");
  });
});

describe("matching a language to an engine's locales", () => {
  it("needs the region when the tile names one", () => {
    expect(localeMatches(t("en-gb"), "en-GB")).toBe(true);
    expect(localeMatches(t("en-gb"), "en_GB")).toBe(true);
    expect(localeMatches(t("en-gb"), "en-US")).toBe(false);
    expect(localeMatches(t("yo"), "yo")).toBe(true);
    expect(localeMatches(t("de"), "de-AT")).toBe(true);
  });
  it("never offers a mixed language such as Pidgin or Taglish from locale lists", () => {
    expect(localeMatches(t("pcm"), "en-NG")).toBe(false);
    expect(piperFor(t("taglish"), [piper("fil", "fil_PH")])).toEqual([]);
    expect(kieFor(t("pcm"))).toEqual([]);
  });
});

describe("finding voices", () => {
  it("VoiceKiller: keeps only voices for the chosen language and region", () => {
    const all = [{ name: "Bella", language: "en" }, { name: "Adv (en-GB)", language: "en-GB" }, { name: "Lucia (es-MX)", language: "es-MX" }];
    expect(voicekillerFor(t("en-gb"), all).map((v) => v.name)).toEqual(["Adv (en-GB)"]);
    expect(voicekillerFor(t("es-mx"), all).map((v) => v.name)).toEqual(["Lucia (es-MX)"]);
    expect(voicekillerFor(t("en-us"), all)).toEqual([]);
  });
  it("Piper: matches by locale and carries the download size", () => {
    const all = [piper("en_GB-alba-medium", "en_GB"), piper("en_US-lessac-medium", "en_US"), piper("sw_CD-x-medium", "sw_CD")];
    expect(piperFor(t("en-gb"), all).map((v) => v.id)).toEqual(["en_GB-alba-medium"]);
    expect(piperFor(t("sw"), all)[0]).toMatchObject({ engine: "piper", sizeMb: 60 });
  });
  it("Kie: offers its preset voices only for languages Turbo 2.5 speaks", () => {
    expect(kieFor(t("fr"))).toHaveLength(KIE_VOICES.length);
    expect(kieFor(t("yo"))).toEqual([]);
    expect(kieFor(t("fr"))[0]!.previewUrl).toMatch(/^https:\/\/static\.aiquickdraw\.com\/elevenlabs\/voice\//);
  });
});

describe("engines", () => {
  it("give every engine a provider and say who understands tags", () => {
    expect(providerFor("elevenlabs", "eleven_v4")).toBe("eleven-v4");
    expect(providerFor("elevenlabs", "eleven_v3")).toBe("eleven-tts");
    expect(providerFor("voicekiller", "eleven_v4", true)).toBe("voicekiller-clone");
    expect(providerFor("piper", "eleven_v4")).toBe("piper");
    expect(ENGINES.elevenlabs.tags).toBe(true);
    expect(ENGINES.piper.tags || ENGINES.local.tags || ENGINES.kie.tags).toBe(false);
    expect(ENGINES.piper.local && ENGINES.local.local).toBe(true);
  });
  it("lists 67 distinct Kie voice ids", () => {
    expect(KIE_VOICES).toHaveLength(67);
    expect(new Set(KIE_VOICES.map((v) => v.id)).size).toBe(67);
  });
});
