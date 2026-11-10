// Drives the REAL built app (Tauri exe, real Rust backend, the owner's real data) through every screen WITHOUT changing anything:
// it only navigates, reads and takes screenshots. It never presses a button that saves, installs, generates or deletes, and it never
// opens a project (opening makes a backup copy).
//
// How: start the exe with WebView2 remote debugging on, then run this script.
//   PowerShell:  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS="--remote-debugging-port=9333"; Start-Process "<path to Greenroom Local.exe>"
//   then:        node scripts/qa/real_app_readonly.mjs <outdir> 9333
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
const port = Number(process.argv[3] ?? 9333);
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 60; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.some((t) => t.type === "page")) break; } catch {} await sleep(500); }
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === "Runtime.exceptionThrown") errors.push("EXCEPTION " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 300));
  else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => (await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true })).result?.result?.value;
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "png" }); writeFileSync(`${out}/${name}.png`, Buffer.from(r.result.data, "base64")); };
const nav = (t) => ev(`(()=>{const b=[...document.querySelectorAll('.rail button.nav')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)}));if(b){b.click();return true}return false})()`);
const flat = (t) => (t ?? "").split(String.fromCharCode(10)).join(" ");
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);

await send("Page.enable"); await send("Runtime.enable");
await sleep(2500);
check("running inside the real app (Tauri backend present)", (await ev(`!!(window.__TAURI_INTERNALS__ || window.__TAURI__)`)) === true);
check("the Projects screen is showing, with the sidebar", (await ev(`!!document.querySelector('.rail')`)) === true && flat(await ev(`document.body.innerText`)).includes("Projects"));
await shot("0-start");
await nav("Settings"); await sleep(1200);
check("the version shown in Settings matches the build", flat(await ev(`document.querySelector('main.stage')?.innerText ?? ''`)).includes(process.argv[4] ?? JSON.parse(readFileSync(new URL("../../app/package.json", import.meta.url), "utf8")).version));

const SCREENS = ["Voices", "Voice metadata", "Presets", "Model Center", "Engines", "SFX Studio", "Voice lab", "Settings", "Help & guide"];
for (const s of SCREENS) {
  const ok = await nav(s); await sleep(1500);
  const text = flat(await ev(`document.querySelector('main.stage')?.innerText ?? ''`));
  const bad = /undefined|NaN|\[object/.test(text);
  check(`${s} opens and shows no broken text`, ok && text.length > 40 && !bad, bad ? text.match(/.{20}(undefined|NaN|\[object).{20}/)?.[0] : `${text.length} chars`);
  await shot("s-" + s.replace(/[^A-Za-z]+/g, "-"));
}

// Read-only checks on real data
await nav("Voice metadata"); await sleep(1200);
const rows = await ev(`document.querySelectorAll('.review-item').length`);
check("Voice metadata lists the real voice library", rows > 0, `${rows} voices`);
await ev(`document.querySelector('.review-item')?.click()`); await sleep(400);
const detail = flat(await ev(`document.querySelector('.review-detail')?.innerText ?? ''`));
check("a real voice shows every fact with a status and a source", /Vocal presentation/.test(detail) && /Languages spoken/.test(detail) && /(Unknown|Unverified|Verified)/.test(detail), detail.slice(0, 140));
check("a real Piper voice shows its gender as Unknown or as claimed, never as confirmed from its name", !/Alan[^]{0,80}Verified[^]{0,40}Vocal presentation/.test(detail));
await shot("r-voice-metadata");
await nav("Presets"); await sleep(1200);
check("Presets shows twelve genre tiles with icons", (await ev(`document.querySelectorAll('.genre-tile .genre-svg').length`)) === 12);
await shot("r-presets");
await nav("Model Center"); await sleep(1500);
const mc = flat(await ev(`document.querySelector('main.stage')?.innerText ?? ''`));
check("Model Center reports real status for local engines", /Piper|Chatterbox|Kokoro/.test(mc));

console.log(checks.join(String.fromCharCode(10)));
console.log("console errors / exceptions:", errors.length);
errors.slice(0, 8).forEach((e) => console.log("  ", e));
ws.close();
process.exit(checks.some((c) => c.startsWith("FAIL")) || errors.length ? 1 : 0);
