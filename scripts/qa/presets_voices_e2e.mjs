// Presets with a real-looking voice library: the "Hear with" list must put fitting voices first and say when one does not fit.
// Usage: node scripts/qa/presets_voices_e2e.mjs <outdir>   (needs `npx vite --port 5173` running)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const port = 9446;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1000", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-presetvoices-profile", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
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
const click = (t, sel = "button,a,[role=tab]") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)}));if(b){b.click();return true}return false})()`);
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);

const fixture = JSON.parse(readFileSync(new URL("../../app/src/fixtures/voices.sample.json", import.meta.url)));
const piper = [
  { id: "en_GB-alan-low", name: "Alan (British, male)", provider: "piper", source: "library", language: "English", accent: "British", gender: "male", notes: "", createdAt: "" },
  { id: "en_US-amy-medium", name: "Amy (American, female)", provider: "piper", source: "library", language: "English", accent: "American", gender: "female", notes: "", createdAt: "" },
];
const lib = [...fixture.filter((v) => v.provider === "elevenlabs").map((v) => ({ ...v, source: "account", createdAt: "" })), ...piper];

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(1500);
await ev(`localStorage.clear(); localStorage.setItem('greenroom-demo-library', ${JSON.stringify(JSON.stringify(lib))})`);
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);
await click("Presets", ".rail button.nav"); await sleep(500);
await click("Film and television", ".genre-tile"); await sleep(600);
const cards = await ev(`[...document.querySelectorAll('.preset-card')].map(c=>({name:c.getAttribute('aria-label'), selected:(c.querySelector('select')?.selectedOptions[0]?.textContent)||'', note:(c.querySelector('[role=status]')?.textContent||'').slice(0,140), groups:[...c.querySelectorAll('optgroup')].map(g=>g.label.slice(0,12))}))`);
console.log(JSON.stringify(cards.slice(0, 6), null, 1));
check("cards show a Hear with voice", cards.length > 0 && cards.every((c) => c.selected));
const woman = cards.find((c) => /woman|mother|female/i.test(c.name));
check("a female preset does not default to a male voice", woman && !/Alex Oke|Chris Razor|Brian|Eric|Alan/.test(woman.selected), woman ? `${woman.name} -> ${woman.selected}` : "none");
check("every card says how the chosen voice fits", cards.every((c) => c.note.length > 5));
await shot("presets-fit");
console.log(checks.join("\n"));
console.log("console errors:", errors.length, errors.slice(0, 3));
ws.close(); chrome.kill(); process.exit(0);
