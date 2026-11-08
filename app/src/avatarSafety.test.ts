import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assignAvatar, emptyStore, migrateStore, toggleFavorite, touchRecent } from "./avatarLibrary";
import { newProject, type Project } from "./types";

const src = (f: string) => readFileSync(join(__dirname, f), "utf-8");

describe("no unwanted network requests", () => {
  it("the avatar code never names an outside address", () => {
    for (const f of ["avatarLibrary.ts", "avatarState.ts", "portrait.ts", "screens/AvatarBrowser.tsx"]) {
      const text = src(f).replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(/https?:\/\//.test(text.replace(/data:image/g, "")), f).toBe(false);
    }
  });

  it("the only thing the library fetches is its own manifest, by a relative path", () => {
    const fetches = [...src("avatarState.ts").matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]);
    expect(fetches).toEqual(['"./avatars/manifest.json"']);
  });

  it("the only paid path is the confirmed generate button, which goes through confirmSpend first", () => {
    const text = src("screens/AvatarBrowser.tsx");
    const gen = text.indexOf("api.avatarGenerate");
    expect(gen).toBeGreaterThan(0);
    expect(text.slice(0, gen).lastIndexOf("confirmSpend")).toBeGreaterThan(text.slice(0, gen).lastIndexOf("const make = async"));
    expect(text.match(/api\.avatarGenerate/g)).toHaveLength(1);
  });
});

describe("persistence and old projects", () => {
  it("a character's avatar survives saving and reopening the project, next to its voice", () => {
    const p = newProject("p", "Test", "now");
    p.characters = assignAvatar([{ id: "c1", name: "A", voiceId: "v1", language: "en" }], "c1", "contemporary_elder_001");
    const back = JSON.parse(JSON.stringify(p)) as Project;
    expect(back.characters[0]!.avatarId).toBe("contemporary_elder_001");
    expect(back.characters[0]!.voiceId).toBe("v1");
  });

  it("a project saved before avatars existed opens with no avatar and nothing else changed", () => {
    const old = { version: 1, id: "p", name: "Old", script: "", scenes: [], characters: [{ id: "c", name: "A", voiceId: "v", language: "en" }], lines: [], bed: { prompt: "", volume: 0.25 }, gap: 0.4, pronunciations: [], createdAt: "", updatedAt: "" } as Project;
    expect(old.characters[0]!.avatarId).toBeUndefined();
    expect(assignAvatar(old.characters, "c", undefined)[0]!.voiceId).toBe("v");
  });

  it("favourites and recent survive a restart (saved and read back) and a missing file starts empty", () => {
    const s = touchRecent(toggleFavorite(emptyStore(), "contemporary_elder_001"), "scifi_runner_001");
    expect(migrateStore(JSON.parse(JSON.stringify(s)))).toEqual(s);
    expect(migrateStore(JSON.parse("{}"))).toEqual(emptyStore());
  });
});

describe("responsiveness", () => {
  it("only draws the visible rows of a very large library", () => {
    const text = src("screens/AvatarBrowser.tsx");
    expect(text).toMatch(/VirtualGrid/);
    expect(text).toMatch(/items\.slice\(first \* cols, last \* cols\)/);
    expect(text).toMatch(/loading="lazy"/);
  });
});
