import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { autoAvatar, LOOKS, pipergender, readVoice, validateManifest, withoutAudience, type AvatarManifest } from "./avatarLibrary";
import { assignedFace, syncPortraits, validPortrait, voiceHint } from "./portrait";

const raw = JSON.parse(readFileSync(join(__dirname, "..", "public", "avatars", "manifest.json"), "utf8"));
const manifest = validateManifest(raw).manifest as AvatarManifest;
const time = <T,>(f: () => T): [T, number] => {
  const t = performance.now();
  const r = f();
  return [r, performance.now() - t];
};

describe("hostile text cannot hang or crash the face picker (ReDoS and oversize input)", () => {
  const nasty = [
    "a".repeat(200_000),
    "for ".repeat(50_000),
    "children's ".repeat(30_000),
    " ".repeat(200_000) + "x",
    "20s ".repeat(40_000),
    "\u2019s ".repeat(40_000),
    "(".repeat(50_000),
    ("middle-" + "aged ").repeat(20_000),
    "young ".repeat(60_000) + "adult fiction",
  ];
  for (const [i, s] of nasty.entries()) {
    it(`case ${i} is read in well under a second`, () => {
      const [, ms] = time(() => {
        readVoice("Female", s);
        withoutAudience(s);
        voiceHint({ id: "x", name: s, gender: "", accent: s, language: s, notes: s });
        autoAvatar(manifest, "seed", "", s);
      });
      expect(ms).toBeLessThan(1000);
    });
  }
  it("the text read for a voice is capped", () => {
    expect(voiceHint({ id: "x", name: "a - " + "b".repeat(100_000), notes: "c".repeat(100_000) }).length).toBeLessThanOrEqual(2000);
  });
});

describe("hostile library data does not throw or pollute", () => {
  it("prototype keys find nothing", () => {
    for (const k of ["__proto__", "constructor", "toString", "hasOwnProperty", "prototype"]) {
      expect(LOOKS[k], k).toBeUndefined();
      expect(pipergender(k)).toBeUndefined();
      expect(pipergender(`en-${k}-low`)).toBeUndefined();
    }
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });
  it("odd types and values in a stored voice are tolerated", () => {
    const odd = [
      { id: "1", name: 12 as never, gender: 5 as never, accent: {} as never, language: [] as never, notes: null as never },
      { id: "2", name: "x", gender: "Female", age: "hacked" as never, heritage: "<script>" as never },
      { id: "3", name: "<img src=x onerror=alert(1)>", gender: "'; DROP TABLE voices;--", notes: "\u0000\u202e".repeat(100) },
      { id: "", name: "", gender: "", notes: "" },
      { id: "__proto__", name: "__proto__", gender: "male", notes: "constructor" },
    ];
    expect(() => syncPortraits(odd as never)).not.toThrow();
    for (const v of odd) {
      expect(() => assignedFace(manifest, String(v.id) + String(v.name))).not.toThrow();
      expect(() => autoAvatar(manifest, String(v.id) + String(v.name), v.gender as never, voiceHint(v as never), { age: (v as { age?: never }).age, heritage: (v as { heritage?: never }).heritage })).not.toThrow();
    }
  });
  it("an unknown stored age or heritage is ignored, not used", () => {
    const a = autoAvatar(manifest, "s", "Female", "", { age: "hacked" as never, heritage: "<script>" as never });
    expect(a).not.toBeNull();
    expect(LOOKS[a!.id]!.g).toBe("f");
  });
  it("a voice's own picture must be a small image data address, never script or a link", () => {
    for (const bad of ["data:image/svg+xml;base64,PHN2Zz48c2NyaXB0Pg==", "javascript:alert(1)", "http://evil.example/a.png", "data:text/html;base64,AAAA", "data:image/png;base64,AAAA<script>", "data:image/jpeg;base64," + "A".repeat(500_000)]) expect(validPortrait(bad), bad.slice(0, 30)).toBe(false);
    expect(validPortrait("data:image/jpeg;base64,/9j/4AAQSkZJRg==")).toBe(true);
  });
});

describe("the manifest cannot point outside the app's own pictures", () => {
  const base = raw.avatars.find((a: { tier: string }) => a.tier === "master");
  const withAsset = (patch: Record<string, string>) => validateManifest({ ...raw, avatars: [{ ...base, assets: { ...base.assets, ...patch } }] });
  for (const bad of ["../../secrets.png", "/etc/passwd", "C:\\Windows\\win.ini", "http://evil.example/a.webp", "https://evil.example/a.webp", "//evil.example/a.webp", "file:///C:/x.webp", "cards/../../x.webp", "data:image/png;base64,AAAA", "javascript:alert(1)"]) {
    it(`refuses an asset path of ${bad}`, () => {
      const r = withAsset({ card: bad });
      expect(r.ok, bad).toBe(false);
      expect(r.manifest?.avatars.length ?? 0).toBe(0);
    });
  }
  it("the shipped manifest only refers to relative paths inside the avatar folders", () => {
    for (const a of manifest.avatars) for (const p of Object.values(a.assets)) expect(p, a.id).toMatch(/^(masters|cards|cards256|thumbs)\/[A-Za-z0-9_.-]+\.(png|webp)$/);
  });
});

describe("source hygiene", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(n) && !/\.test\./.test(n)) files.push(p);
    }
  };
  walk(__dirname);
  const src = files.map((f) => [f, readFileSync(f, "utf8")] as const);
  it("no raw HTML sinks, eval or dynamic code", () => {
    for (const [f, s] of src) expect(s, f).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML\s*=|\beval\(|new Function\(|document\.write\(/);
  });
  it("the avatar and voice-face code makes no network request of its own", () => {
    for (const f of ["avatar.tsx", "avatarLibrary.ts", "portrait.ts", "importer.ts", "scriptImport.ts", "scriptAi.ts", "screens/AvatarButton.tsx", "screens/PortraitImporter.tsx", "screens/CharacterLooks.tsx"]) {
      const s = readFileSync(join(__dirname, f), "utf8");
      expect(s.replace(/fetch\(`data:/g, ""), f).not.toMatch(/\bfetch\(|XMLHttpRequest|WebSocket|navigator\.sendBeacon|https?:\/\//);
    }
  });
  it("no key, token or secret is written into the source", () => {
    for (const [f, s] of src) expect(s, f).not.toMatch(/(sk-[A-Za-z0-9]{20,}|xi-api-key:\s*["'][A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16}|-----BEGIN [A-Z ]*PRIVATE KEY)/);
  });
});

describe("the script importer and the cloud text providers", () => {
  const rust = (f: string) => readFileSync(join(__dirname, "..", "src-tauri", "src", f), "utf8");
  it("reading a script file uses no network and runs no program", () => {
    const s = rust("script_import.rs").split("#[cfg(test)]")[0]!;
    expect(s).not.toMatch(/ureq|reqwest|TcpStream|std::process|Command::new|net::/);
    expect(s).not.toMatch(/File::create|fs::write|create_dir|extract\(|unpack/);
  });
  it("the providers are fixed addresses, the key travels in a header and never in an address or a log", () => {
    const s = rust("llm.rs").split("#[cfg(test)]")[0]!;
    const urls = s.match(/https?:\/\/[a-z0-9.-]+/gi)?.filter((u) => !/developers\.openai|aistudio\.google/.test(u)) ?? [];
    expect([...new Set(urls)].sort()).toEqual(["https://api.openai.com", "https://generativelanguage.googleapis.com"]);
    expect(s).not.toMatch(/key=|\?key|println!|eprintln!|dbg!|log::/);
    expect(s).toMatch(/Authorization/);
    expect(s).toMatch(/x-goog-api-key/);
  });
  it("the keys are stored only in the system credential store, under names the Rust side allows", () => {
    const lib = rust("lib.rs");
    expect(lib).toMatch(/"inworld" \| "huggingface" \| "openai" \| "gemini"/);
    expect(lib).not.toMatch(/^.*get_key\("(?:openai|gemini)"\).*(?:fs::write|atomic_write|File::create).*$/m);
    expect(lib).toMatch(/keyring::Entry::new\(SERVICE, name\)/);
  });
  it("a character's description is shown as text only", () => {
    for (const f of ["screens/CharacterLooks.tsx", "screens/ScriptImporter.tsx", "screens/Write.tsx"]) expect(readFileSync(join(__dirname, f), "utf8"), f).not.toMatch(/dangerouslySetInnerHTML|innerHTML/);
  });
});
