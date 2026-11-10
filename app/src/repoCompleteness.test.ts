import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Files compiled into the app with include_str! / include_bytes! must exist, must not be hidden by .gitignore, and must be committed.
// This is what went wrong with runtime/kokoro_once.py and runtime/qwen_once.py: a .gitignore rule hid them, the app built on the one PC
// that had them, and nobody else could build it from GitHub.

const RUST = join(__dirname, "..", "src-tauri", "src");
const REPO = resolve(__dirname, "..", "..");
const PLACEHOLDER = "LOCAL PLACEHOLDER (not committed)";

const embedded: { file: string; target: string }[] = [];
const walk = (d: string) => {
  for (const n of readdirSync(d)) {
    const p = join(d, n);
    if (statSync(p).isDirectory()) walk(p);
    else if (n.endsWith(".rs")) {
      const text = readFileSync(p, "utf8");
      for (const m of text.matchAll(/include_(?:str|bytes)!\(\s*"([^"]+)"\s*\)/g)) embedded.push({ file: p, target: resolve(dirname(p), m[1]!) });
    }
  }
};
walk(RUST);

const git = (...args: string[]): { ok: boolean; out: string } => {
  try {
    return { ok: true, out: execFileSync("git", args, { cwd: REPO, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }) };
  } catch {
    return { ok: false, out: "" };
  }
};
const haveGit = git("rev-parse", "--is-inside-work-tree").out.trim() === "true";

describe("everything compiled into the app is in the repository", () => {
  it("finds the embedded files", () => {
    expect(embedded.length).toBeGreaterThan(3);
  });
  for (const { file, target } of embedded) {
    const rel = target.slice(REPO.length + 1).replace(/\\/g, "/");
    it(`${rel} exists`, () => {
      expect(existsSync(target), `${rel} is compiled into the app by ${file.slice(REPO.length + 1)} but is missing`).toBe(true);
    });
    it.skipIf(!haveGit)(`${rel} is not hidden by .gitignore`, () => {
      const r = git("check-ignore", "-q", rel);
      // check-ignore exits 0 when the path IS ignored (execFileSync throws), and 1 when it is not
      expect(r.ok, `${rel} is ignored by .gitignore, so it never reaches GitHub`).toBe(false);
    });
    it.skipIf(!haveGit)(`${rel} is committed`, () => {
      if (existsSync(target) && readFileSync(target, "utf8").includes(PLACEHOLDER)) {
        console.warn(`WARNING: ${rel} is a local placeholder. Copy the real file from the PC that built the app and commit it.`);
        return;
      }
      const r = git("ls-files", "--error-unmatch", rel);
      expect(r.ok, `${rel} is compiled into the app but is not committed to git`).toBe(true);
    });
  }
});
