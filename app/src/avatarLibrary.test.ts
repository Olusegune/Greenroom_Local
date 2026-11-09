import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { addCustom, assignAvatar, emptyStore, expressionFor, faceFor, facets, filterAvatars, migrateStore, progress, RECENT_MAX, removeCustom, suggestAvatars, toggleFavorite, touchRecent, validateManifest, type CustomAvatar } from "./avatarLibrary";

const PUB = join(__dirname, "..", "public", "avatars");
const MASTERS = join(__dirname, "..", "..", "avatars", "masters");
const raw = JSON.parse(readFileSync(join(PUB, "manifest.json"), "utf-8"));
const exists = (p: string) => existsSync(p.startsWith("masters/") ? join(MASTERS, p.slice(8)) : join(PUB, p));
const check = validateManifest(raw, exists);
const list = check.manifest!.avatars;

/** Width and height of a WebP file, read from its header. */
function webpSize(file: string): [number, number] {
  const b = readFileSync(file);
  if (b.toString("ascii", 0, 4) !== "RIFF" || b.toString("ascii", 8, 12) !== "WEBP") throw new Error("not a WebP: " + file);
  const kind = b.toString("ascii", 12, 16);
  if (kind === "VP8 ") return [b.readUInt16LE(26) & 0x3fff, b.readUInt16LE(28) & 0x3fff];
  if (kind === "VP8L") {
    const v = b.readUInt32LE(21);
    return [(v & 0x3fff) + 1, ((v >> 14) & 0x3fff) + 1];
  }
  return [b.readUIntLE(24, 3) + 1, b.readUIntLE(27, 3) + 1];
}

const masters = list.filter((a) => a.tier === "master");
const previews = list.filter((a) => a.tier === "preview");

describe("the built-in library on disk", () => {
  it("has a valid manifest whose every listed file exists", () => {
    expect(check.problems).toEqual([]);
    expect(check.ok).toBe(true);
    expect(list.length).toBeGreaterThan(0);
  });

  it("has unique ids and unique asset files", () => {
    expect(new Set(list.map((a) => a.id)).size).toBe(list.length);
    const files = list.flatMap((a) => Object.values(a.assets));
    expect(new Set(files).size).toBe(files.length);
  });

  it("has distinct portraits: no two picture files are the same", () => {
    const sums = masters.map((a) => createHash("sha256").update(readFileSync(join(MASTERS, a.assets.master!.slice(8)))).digest("hex"));
    const small = previews.map((a) => createHash("sha256").update(readFileSync(join(PUB, a.assets.card_small))).digest("hex"));
    expect(new Set([...sums, ...small]).size).toBe(list.length);
  });

  it("has every master at 1024 x 1024 PNG and every derivative at its exact size", () => {
    for (const a of masters) {
      expect(webpSize(join(PUB, a.assets.card!)), a.id).toEqual([512, 512]);
      const m = readFileSync(join(MASTERS, a.assets.master!.slice(8)));
      expect(m.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
      expect([m.readUInt32BE(16), m.readUInt32BE(20)]).toEqual([1024, 1024]);
    }
    for (const a of list) {
      expect(webpSize(join(PUB, a.assets.card_small)), a.id).toEqual([256, 256]);
      expect(webpSize(join(PUB, a.assets.thumbnail)), a.id).toEqual([128, 128]);
    }
  });

  it("never gives a preview portrait a master or a 512 card, and never counts it toward the 100", () => {
    expect(previews.length).toBeGreaterThan(0);
    for (const a of previews) {
      expect(a.assets.master, a.id).toBeUndefined();
      expect(a.assets.card, a.id).toBeUndefined();
      expect(existsSync(join(MASTERS, `${a.id}.png`)), a.id).toBe(false);
    }
    const p = progress(check.manifest);
    expect(p.have).toBe(masters.length);
    expect(p.previews).toBe(previews.length);
  });

  it("keeps the bundled pictures small: thumbnails under 15 KB, cards under 120 KB", () => {
    for (const a of list) {
      expect(statSync(join(PUB, a.assets.thumbnail)).size, a.id).toBeLessThan(15_000);
      expect(statSync(join(PUB, a.assets.card ?? a.assets.card_small)).size, a.id).toBeLessThan(120_000);
    }
  });

  it("records rights for every portrait, with a source and a stated commercial status", () => {
    for (const a of list) {
      expect(a.license.source.length, a.id).toBeGreaterThan(5);
      expect(["confirmed", "unconfirmed", "not_allowed"]).toContain(a.license.commercial_use);
    }
  });

  it("does not claim the 100-portrait target before 100 full-resolution portraits exist", () => {
    const p = progress(check.manifest);
    expect(p.have + p.missing).toBe(p.target);
    expect(p.target).toBe(100);
    if (p.have < 100) expect(p.missing).toBeGreaterThan(0);
  });

  it("gives no portrait a voice, accent or personality, and no recognisable franchise or celebrity names", () => {
    for (const a of list) {
      expect(Object.keys(a).some((k) => /voice|accent|personality/i.test(k)), a.id).toBe(false);
      expect(/joker|einstein|wednesday|gandalf|kung fu|queen elizabeth/i.test(`${a.name} ${a.tags.join(" ")}`), a.id).toBe(false);
    }
  });
});

describe("validateManifest", () => {
  const good = (over: Record<string, unknown> = {}) => ({ id: "x_one_001", name: "X", collection: "contemporary_everyday", period: "contemporary", genre: ["drama"], style: "cinematic_realism", age_category: "adult", archetype: "a", clothing: "c", tags: ["t"], assets: { master: "masters/x.png", card: "cards/x.webp", card_small: "cards256/x.webp", thumbnail: "thumbs/x.webp" }, license: { type: "t", source: "s", commercial_use: "unconfirmed" }, ...over });
  const m = (...a: unknown[]) => ({ version: 1, avatars: a });

  it("accepts a sound entry and rejects duplicates, unsafe paths and unknown values", () => {
    expect(validateManifest(m(good())).ok).toBe(true);
    expect(validateManifest(m(good(), good())).problems.join()).toMatch(/duplicate id/);
    expect(validateManifest(m(good({ assets: { master: "../../etc/passwd", card: "cards/x.webp", card_small: "cards256/x.webp", thumbnail: "thumbs/x.webp" } }))).problems.join()).toMatch(/unsafe/);
    expect(validateManifest(m(good({ assets: { master: "https://evil.example/a.png", card: "cards/x.webp", card_small: "cards256/x.webp", thumbnail: "thumbs/x.webp" } }))).ok).toBe(false);
    expect(validateManifest(m(good({ collection: "nope" }))).ok).toBe(false);
    expect(validateManifest(m(good({ age_category: "ancient" }))).ok).toBe(false);
    expect(validateManifest(m(good({ license: undefined }))).problems.join()).toMatch(/rights/);
    expect(validateManifest(m(good({ id: "Bad Id" }))).ok).toBe(false);
  });

  it("reports a listed file that does not exist and keeps only sound entries", () => {
    const r = validateManifest(m(good(), good({ id: "y_two_001", assets: { master: "masters/y.png", card: "cards/y.webp", card_small: "cards256/y.webp", thumbnail: "thumbs/y.webp" } })), (p) => p.includes("x."));
    expect(r.manifest!.avatars.map((a) => a.id)).toEqual(["x_one_001"]);
    expect(r.problems.join()).toMatch(/does not exist/);
  });

  it("accepts a preview with only a 256 card and a thumbnail, and rejects one that claims a master", () => {
    const pre = (assets: Record<string, string>) => good({ tier: "preview", assets });
    expect(validateManifest(m(pre({ card_small: "cards256/x.webp", thumbnail: "thumbs/x.webp" }))).ok).toBe(true);
    expect(validateManifest(m(pre({ master: "masters/x.png", card_small: "cards256/x.webp", thumbnail: "thumbs/x.webp" }))).problems.join()).toMatch(/must not claim a master/);
    expect(validateManifest(m(good({ assets: { card_small: "cards256/x.webp", thumbnail: "thumbs/x.webp" } }))).ok).toBe(false);
  });

  it("rejects junk", () => {
    expect(validateManifest(null).ok).toBe(false);
    expect(validateManifest({ version: 2, avatars: [] }).ok).toBe(false);
  });
});

describe("searching and filtering", () => {
  it("finds by words across name, tags, clothing, period and archetype", () => {
    expect(filterAvatars(list, { text: "teal blazer" }).map((a) => a.id)).toContain("contemporary_editor_001");
    expect(filterAvatars(list, { text: "grey beard" }).length).toBeGreaterThan(0);
    expect(filterAvatars(list, { text: "zzzz nothing" })).toEqual([]);
    expect(filterAvatars(list, {})).toHaveLength(list.length);
  });

  it("filters by collection, age, genre and style, together", () => {
    expect(filterAvatars(list, { collection: "science_fiction_cyberpunk" }).every((a) => a.collection === "science_fiction_cyberpunk")).toBe(true);
    expect(filterAvatars(list, { age: "elderly" }).every((a) => a.age_category === "elderly")).toBe(true);
    expect(filterAvatars(list, { genre: "cyberpunk", age: "young_adult" }).map((a) => a.id)).toContain("scifi_runner_001");
    const flat = filterAvatars(list, { style: "stylized_3d" });
    expect(flat.length).toBeGreaterThan(0);
    expect(flat.every((a) => a.style === "stylized_3d")).toBe(true);
    expect(filterAvatars(list, { only: new Set(["contemporary_elder_001"]) })).toHaveLength(1);
  });

  it("lists only the choices that exist", () => {
    const f = facets(list);
    expect(f.collections).toContain("contemporary_everyday");
    expect(f.collections).toContain("ancient_civilizations");
    expect(facets([list[0]!]).collections).toEqual([list[0]!.collection]);
    expect(f.ages.length).toBeGreaterThan(2);
  });
});

describe("suggestions", () => {
  it("suits the description and never reads an accent as an appearance", () => {
    const s = suggestAvatars("An elderly British bureaucrat, impeccably dressed, stern, quietly sinister.", list);
    expect(s.length).toBeGreaterThan(0);
    expect(s.length).toBeLessThanOrEqual(6);
    expect(s[0]!.entry.age_category).toMatch(/elderly|older_adult|middle_aged/);
    expect(s.every((x) => x.score > 0 && x.why.length > 0)).toBe(true);
    expect(s.flatMap((x) => x.why)).not.toContain("british");
    const same = suggestAvatars("An elderly bureaucrat, impeccably dressed, stern, quietly sinister.", list);
    expect(s.map((x) => x.entry.id)).toEqual(same.map((x) => x.entry.id));
  });

  it("offers fewer rather than unrelated faces, and nothing for an empty description", () => {
    expect(suggestAvatars("submarine zeppelin", list)).toEqual([]);
    expect(suggestAvatars("", list)).toEqual([]);
    expect(suggestAvatars("a young cyberpunk hacker", list)[0]!.entry.id).toBe("scifi_runner_001");
  });
});

describe("favourites, recent and custom avatars", () => {
  const custom = (id: string): CustomAvatar => ({ id, name: id, createdAt: "", image: "data:image/jpeg;base64,AAAA", thumb: "data:image/jpeg;base64,AAAA", source: "imported", tags: [] });

  it("toggles favourites and keeps recent in order, once each, capped", () => {
    let s = toggleFavorite(emptyStore(), "a");
    expect(s.favorites).toEqual(["a"]);
    expect(toggleFavorite(s, "a").favorites).toEqual([]);
    for (let i = 0; i < RECENT_MAX + 5; i++) s = touchRecent(s, `id${i}`);
    s = touchRecent(s, "id10");
    expect(s.recent).toHaveLength(RECENT_MAX);
    expect(s.recent[0]).toBe("id10");
    expect(new Set(s.recent).size).toBe(RECENT_MAX);
  });

  it("removing a custom avatar removes it from favourites and recent too", () => {
    let s = addCustom(emptyStore(), custom("custom:1"));
    s = touchRecent(toggleFavorite(s, "custom:1"), "custom:1");
    s = removeCustom(s, "custom:1");
    expect(s).toEqual(emptyStore());
  });

  it("reads a damaged saved library safely", () => {
    expect(migrateStore(undefined)).toEqual(emptyStore());
    const s = migrateStore({ custom: [custom("custom:ok"), { id: "custom:bad", image: "javascript:alert(1)", thumb: "x" }, { id: "nocustom", image: "data:image/jpeg;base64,AAAA", thumb: "data:image/jpeg;base64,AAAA" }, null], favorites: ["a", "a", 5], recent: ["r"] });
    expect(s.custom.map((c) => c.id)).toEqual(["custom:ok"]);
    expect(s.favorites).toEqual(["a"]);
  });

  it("uses an expression variant when there is one and the main picture when there is not", () => {
    const a = { ...custom("custom:v"), variants: { angry: "data:image/png;base64,BBBB" } as CustomAvatar["variants"] };
    const s = addCustom(emptyStore(), a);
    expect(faceFor("custom:v", null, s, "angry")!.card).toBe("data:image/png;base64,BBBB");
    expect(faceFor("custom:v", null, s, "sad")!.card).toBe(a.image);
    expect(faceFor("custom:gone", null, s)).toBeNull();
    expect(faceFor(undefined, null, s)).toBeNull();
    expect(expressionFor("angry")).toBe("angry");
    expect(expressionFor("tired")).toBe("sad");
    expect(expressionFor("whispers", true)).toBe("speaking");
    expect(expressionFor("")).toBe("neutral");
  });

  it("shows a preview at its own 256 size, never a larger one", () => {
    const pv = previews[0]!;
    const f = faceFor(pv.id, check.manifest, emptyStore())!;
    expect(f.card).toBe(f.small);
    expect(f.card.startsWith("./avatars/cards256/")).toBe(true);
  });

  it("finds a built-in face by id, with relative paths", () => {
    const f = faceFor(masters[0]!.id, check.manifest, emptyStore())!;
    expect(f.card.startsWith("./avatars/cards/")).toBe(true);
    expect(f.thumb.startsWith("./avatars/thumbs/")).toBe(true);
  });
});

describe("avatar and voice are independent", () => {
  const cast = [{ id: "c1", name: "A", voiceId: "v1", language: "en", avatarId: "x" }, { id: "c2", name: "B", voiceId: "v2", language: "en" }];
  it("changing the avatar leaves the voice, and everyone else, alone", () => {
    const next = assignAvatar(cast, "c1", "contemporary_elder_001");
    expect(next[0]).toEqual({ ...cast[0], avatarId: "contemporary_elder_001" });
    expect(next[0]!.voiceId).toBe("v1");
    expect(next[1]).toBe(cast[1]);
    expect(cast[0]!.avatarId).toBe("x");
  });
  it("the same avatar can serve several characters, and removing it clears only the picture", () => {
    const both = assignAvatar(assignAvatar(cast, "c1", "same"), "c2", "same");
    expect(both.map((c) => c.avatarId)).toEqual(["same", "same"]);
    const cleared = assignAvatar(both, "c1", undefined);
    expect(cleared[0]!.avatarId).toBeUndefined();
    expect(cleared[0]!.voiceId).toBe("v1");
  });
  it("an old character with no avatar still works", () => {
    expect(assignAvatar([{ id: "o", name: "Old", voiceId: "v" }], "zzz", "a")).toEqual([{ id: "o", name: "Old", voiceId: "v" }]);
  });
});
