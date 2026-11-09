import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoAvatar, customFaces, migrateStore, validateManifest, type AvatarManifest, type AvatarStore, type CustomAvatar } from "./avatarLibrary";
import { MAX_BATCH, MAX_FILE_BYTES, MAX_PIXELS, MIN_SIDE, checkFile, checkSize, cleanLook, cropRect, dHash, hamming, nameFromFile, nearDuplicate, readDimensions, sanitizeName, sniff } from "./importer";

const bytes = (...n: number[]) => new Uint8Array(n);
const pad = (b: Uint8Array, n = 64) => {
  const o = new Uint8Array(Math.max(n, b.length));
  o.set(b);
  return o;
};
const PNG = pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a));
const JPG = pad(bytes(0xff, 0xd8, 0xff, 0xe0));
const WEBP = pad(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50));

describe("only real PNG, JPEG and WebP files are read", () => {
  it("recognises the three by their first bytes and nothing else", () => {
    expect(sniff(PNG)).toBe("image/png");
    expect(sniff(JPG)).toBe("image/jpeg");
    expect(sniff(WEBP)).toBe("image/webp");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
    for (const bad of [svg, new TextEncoder().encode("GIF89a"), pad(bytes(0x4d, 0x5a)), pad(bytes(0x50, 0x4b, 3, 4)), pad(bytes(0x25, 0x50, 0x44, 0x46)), new Uint8Array(0), pad(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x41, 0x56, 0x45))]) expect(sniff(bad)).toBeNull();
  });
  const f = (name: string, type: string, size = 1000) => ({ name, type, size });
  it("accepts a file whose type, contents and name agree", () => {
    expect(checkFile(f("a.png", "image/png"), PNG)).toBeNull();
    expect(checkFile(f("a.JPG", "image/jpeg"), JPG)).toBeNull();
    expect(checkFile(f("a.jpeg", "image/jpeg"), JPG)).toBeNull();
    expect(checkFile(f("a.webp", "image/webp"), WEBP)).toBeNull();
  });
  it("refuses a script or a program renamed to look like a picture", () => {
    const svg = new TextEncoder().encode("<svg><script>alert(1)</script></svg>");
    expect(checkFile(f("evil.png", "image/png"), svg)).toMatch(/not a PNG, JPEG or WebP/);
    expect(checkFile(f("evil.svg", "image/svg+xml"), svg)).toMatch(/Only PNG, JPEG and WebP/);
    expect(checkFile(f("evil.png", "image/png"), pad(bytes(0x4d, 0x5a, 0x90, 0)))).toMatch(/not a PNG/);
    expect(checkFile(f("x.gif", "image/gif"), pad(bytes(0x47, 0x49, 0x46, 0x38)))).toMatch(/Only PNG/);
    expect(checkFile(f("x.html", "text/html"), JPG)).toMatch(/Only PNG/);
  });
  it("refuses a file whose type, contents or name disagree", () => {
    expect(checkFile(f("a.png", "image/png"), JPG)).toMatch(/do not match its type/);
    expect(checkFile(f("a.jpg", "image/jpeg"), PNG)).toMatch(/do not match its type/);
    expect(checkFile(f("a.png", "image/jpeg"), JPG)).toMatch(/name does not match/);
    expect(checkFile(f("a.png.exe", "image/png"), PNG)).toMatch(/name does not match/);
    expect(checkFile(f("a", "image/png"), PNG)).toMatch(/name does not match/);
  });
  it("refuses an empty file and one over 15 MB", () => {
    expect(checkFile(f("a.png", "image/png", 0), PNG)).toMatch(/empty/);
    expect(checkFile(f("a.png", "image/png", MAX_FILE_BYTES + 1), PNG)).toMatch(/15 MB/);
    expect(checkFile(f("a.png", "image/png", MAX_FILE_BYTES), PNG)).toBeNull();
  });
  it("limits a batch", () => {
    expect(MAX_BATCH).toBeLessThanOrEqual(24);
  });
});

describe("a picture's size is read from its header, before anything decodes it", () => {
  const png = (w: number, h: number) => {
    const b = pad(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a), 40);
    const dv = new DataView(b.buffer);
    dv.setUint32(16, w);
    dv.setUint32(20, h);
    return b;
  };
  it("reads PNG sizes, including a decompression bomb", () => {
    expect(readDimensions(png(1024, 768), "image/png")).toEqual({ w: 1024, h: 768 });
    const bomb = readDimensions(png(30000, 30000), "image/png")!;
    expect(checkSize(bomb.w, bomb.h).error).toMatch(/megapixels/);
    expect(readDimensions(png(5, 5).slice(0, 10), "image/png")).toBeNull();
  });
  it("reads JPEG sizes by walking the segments, and survives garbage", () => {
    const app0 = [0xff, 0xe0, 0x00, 0x10, ...new Array(14).fill(0)];
    const sof = [0xff, 0xc0, 0x00, 0x11, 0x08, 0x03, 0x00, 0x04, 0x00, 0x03, ...new Array(9).fill(0)];
    const j = pad(bytes(0xff, 0xd8, ...app0, ...sof), 80);
    expect(readDimensions(j, "image/jpeg")).toEqual({ w: 1024, h: 768 });
    expect(readDimensions(pad(bytes(0xff, 0xd8, 0x00, 0x01, 0x02), 40), "image/jpeg")).toBeNull();
    expect(readDimensions(pad(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x01), 40), "image/jpeg")).toBeNull();
    expect(readDimensions(bytes(0xff, 0xd8), "image/jpeg")).toBeNull();
  });
  it("reads real WebP and PNG files from the library", () => {
    const card = readFileSync(join(__dirname, "..", "public", "avatars", "cards", "contemporary_editor_001.webp"));
    expect(readDimensions(new Uint8Array(card), "image/webp")).toEqual({ w: 512, h: 512 });
    const thumb = readFileSync(join(__dirname, "..", "public", "avatars", "thumbs", "contemporary_editor_001.webp"));
    expect(readDimensions(new Uint8Array(thumb), "image/webp")).toEqual({ w: 128, h: 128 });
    const master = readFileSync(join(__dirname, "..", "..", "avatars", "masters", "contemporary_editor_001.png"));
    expect(readDimensions(new Uint8Array(master), "image/png")).toEqual({ w: 1024, h: 1024 });
  });
  it("reads the three WebP kinds", () => {
    const riff = (kind: string, fill: (b: Uint8Array) => void) => {
      const b = new Uint8Array(40);
      b.set(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50));
      b.set(new TextEncoder().encode(kind), 12);
      fill(b);
      return b;
    };
    expect(readDimensions(riff("VP8 ", (b) => { b[26] = 0x00; b[27] = 0x04; b[28] = 0x00; b[29] = 0x03; }), "image/webp")).toEqual({ w: 1024, h: 768 });
    expect(readDimensions(riff("VP8X", (b) => { b[24] = 0xff; b[25] = 0x03; b[27] = 0xff; b[28] = 0x02; }), "image/webp")).toEqual({ w: 1024, h: 768 });
    expect(readDimensions(riff("VP8L", (b) => { const v = (1023 | (767 << 14)) >>> 0; b[21] = v & 255; b[22] = (v >>> 8) & 255; b[23] = (v >>> 16) & 255; b[24] = (v >>> 24) & 255; }), "image/webp")).toEqual({ w: 1024, h: 768 });
    expect(readDimensions(riff("JUNK", () => undefined), "image/webp")).toBeNull();
  });
  it("sizes: too many pixels, too small, small but usable, fine", () => {
    expect(checkSize(MAX_PIXELS, 2).error).toBeDefined();
    expect(checkSize(0, 100).error).toBeDefined();
    expect(checkSize(NaN, 100).error).toBeDefined();
    expect(checkSize(MIN_SIDE - 1, 2000).error).toMatch(/never enlarged/);
    expect(checkSize(300, 2000).warning).toMatch(/Small/);
    expect(checkSize(1024, 768)).toEqual({});
  });
});

describe("names and descriptions are cleaned", () => {
  it("removes control, invisible and direction-changing characters and limits the length", () => {
    expect(sanitizeName("  Ada\u0000\u202e Lovelace\u200b  ")).toBe("Ada Lovelace");
    expect(sanitizeName("a".repeat(500))).toHaveLength(60);
    expect(sanitizeName("\u0000\u0001")).toBe("Portrait");
    expect(sanitizeName(42 as never)).toBe("Portrait");
    expect(sanitizeName(null as never, "X")).toBe("X");
    expect(sanitizeName("<img src=x onerror=alert(1)>")).toBe("<img src=x onerror=alert(1)>"); // kept as text: React shows it as text, never as HTML
  });
  it("makes a name from a file name without folders or extension", () => {
    expect(nameFromFile("C:\\Users\\me\\Desktop\\black_caribbean_captain_001.png")).toBe("black caribbean captain 001");
    expect(nameFromFile("../../etc/passwd.png")).toBe("passwd");
    expect(nameFromFile(".png")).toBe("Portrait");
  });
  it("keeps only known gender, age and heritage values", () => {
    expect(cleanLook({ gender: "f", age: "elderly", heritage: "black" })).toEqual({ gender: "f", age: "elderly", heritage: "black" });
    expect(cleanLook({ gender: "x", age: "ageless", heritage: "__proto__" })).toEqual({});
    expect(cleanLook({ gender: "m", age: "adult", heritage: "constructor" })).toEqual({ gender: "m", age: "adult" });
    expect(cleanLook(null)).toEqual({});
    expect(cleanLook("f")).toEqual({});
  });
});

describe("the square cut", () => {
  it("always lies inside the picture, whatever the controls say", () => {
    const sizes: [number, number][] = [[1376, 768], [768, 1376], [1000, 1000], [256, 4000]];
    for (const [w, h] of sizes) for (const z of [-5, 0, 0.5, 1, 1.5, 3, 4, 99, NaN, Infinity]) for (const cx of [-1, 0, 0.3, 1, 2, NaN]) for (const cy of [-1, 0, 0.7, 1, 5, NaN]) {
      const r = cropRect(w, h, z, cx, cy);
      expect(r.size).toBeGreaterThanOrEqual(1);
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.x + r.size).toBeLessThanOrEqual(w);
      expect(r.y + r.size).toBeLessThanOrEqual(h);
    }
  });
  it("zoom 1 is the largest square, centred by default", () => {
    expect(cropRect(1376, 768, 1, 0.5, 0.5)).toEqual({ x: 304, y: 0, size: 768 });
    expect(cropRect(1376, 768, 2, 0.5, 0.5).size).toBe(384);
  });
});

describe("finding a picture that is already in the library", () => {
  const ramp = (f: (i: number) => number) => Array.from({ length: 72 }, (_, i) => f(i));
  it("equal pictures match, different ones do not", () => {
    const a = dHash(ramp((i) => (i * 37) % 255));
    expect(hamming(a, a)).toBe(0);
    const near = dHash(ramp((i) => ((i * 37) % 255) + (i % 9 === 0 ? 1 : 0)));
    expect(nearDuplicate(near, [{ name: "Ada", hash: a }])).toBe("Ada");
    const other = dHash(ramp((i) => (i * 91 + 13) % 253));
    expect(nearDuplicate(other, [{ name: "Ada", hash: a }])).toBeNull();
    expect(nearDuplicate(a, [])).toBeNull();
  });
});

describe("portraits the owner adds take part as automatic faces, and nothing else does", () => {
  const manifest = validateManifest(JSON.parse(readFileSync(join(__dirname, "..", "public", "avatars", "manifest.json"), "utf8"))).manifest as AvatarManifest;
  const mine = (over: Partial<CustomAvatar>): CustomAvatar => ({ id: "custom:abc", name: "Mine", createdAt: "", image: "data:image/jpeg;base64,AAAA", thumb: "data:image/jpeg;base64,AAAA", source: "imported", tags: [], ...over });
  const store = (c: CustomAvatar[]): AvatarStore => ({ custom: c, favorites: [], recent: [] });
  it("only portraits that are marked automatic and have a gender and an age are offered", () => {
    expect(customFaces(store([mine({ auto: true, gender: "f", age: "child" })]))).toHaveLength(1);
    expect(customFaces(store([mine({ auto: false, gender: "f", age: "child" })]))).toHaveLength(0);
    expect(customFaces(store([mine({ auto: true, gender: "f" })]))).toHaveLength(0);
    expect(customFaces(store([mine({ auto: true, age: "child" })]))).toHaveLength(0);
    expect(customFaces(null)).toEqual([]);
  });
  it("an added Southeast Asian woman is used for a Filipino woman's voice when the built-in ones are taken", () => {
    const custom = customFaces(store([mine({ id: "custom:fil", auto: true, gender: "f", age: "adult", heritage: "east_asian" })]));
    const usage = new Map<string, number>();
    for (const a of manifest.avatars) usage.set(a.id, 5);
    const a = autoAvatar(manifest, "s", "Female", "Filipino", undefined, usage, custom)!;
    expect(a.id).toBe("custom:fil");
  });
  it("an added portrait never crosses gender or age", () => {
    const custom = customFaces(store([mine({ id: "custom:man", auto: true, gender: "m", age: "elderly", heritage: "black" })]));
    const usage = new Map<string, number>();
    for (const a of manifest.avatars) usage.set(a.id, 5);
    for (const [g, hint] of [["Female", "Nigerian"], ["Male", "a little boy, Nigerian"], ["Male", "Nigerian, 30s"]] as const) {
      const a = autoAvatar(manifest, "s", g, hint, undefined, usage, custom)!;
      expect(a.id, `${g}/${hint}`).not.toBe("custom:man");
    }
  });
});

describe("a damaged or hostile saved avatar file is cleaned on load", () => {
  const hostile = {
    custom: [
      { id: "custom:a", name: "x".repeat(500), createdAt: "", image: "data:image/jpeg;base64,AAAA", thumb: "data:image/jpeg;base64,AAAA", gender: "x", age: "ageless", heritage: "__proto__", auto: "yes", tags: ["t".repeat(500), 5, null] },
      { id: "custom:b", name: "ok", createdAt: "", image: "data:image/svg+xml;base64,AAAA", thumb: "data:image/jpeg;base64,AAAA" },
      { id: "../../x", name: "bad id", image: "data:image/jpeg;base64,AAAA", thumb: "data:image/jpeg;base64,AAAA" },
      { id: "custom:c", name: "c", createdAt: "", image: "javascript:alert(1)", thumb: "data:image/jpeg;base64,AAAA" },
      { id: "custom:d", name: "d", createdAt: "", image: "data:image/jpeg;base64,AAAA", thumb: "data:image/jpeg;base64,AAAA", gender: "f", age: "adult", heritage: "black", auto: true },
    ],
  };
  it("keeps only valid pictures and only known values", () => {
    const s = migrateStore(hostile);
    expect(s.custom.map((c) => c.id)).toEqual(["custom:a", "custom:d"]);
    const a = s.custom[0]!;
    expect(a.name.length).toBeLessThanOrEqual(80);
    expect([a.gender, a.age, a.heritage, a.auto]).toEqual([undefined, undefined, undefined, false]);
    expect(a.tags.every((t) => t.length <= 40)).toBe(true);
    expect(s.custom[1]).toMatchObject({ gender: "f", age: "adult", heritage: "black", auto: true });
  });
  it("caps the number of kept pictures", () => {
    const many = { custom: Array.from({ length: 500 }, (_, i) => ({ id: `custom:${i}`, name: "n", createdAt: "", image: "data:image/jpeg;base64,AAAA", thumb: "data:image/jpeg;base64,AAAA" })) };
    expect(migrateStore(many).custom.length).toBeLessThanOrEqual(300);
  });
});
