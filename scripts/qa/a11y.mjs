// Automated accessibility audit (axe-core, WCAG 2.1 A and AA) of the screens in the demo build, in the dark and light themes.
// It finds what a machine can find: contrast, names for controls, labels, landmarks, ARIA mistakes. It cannot replace a person
// using a screen reader or only a keyboard. Usage: node scripts/qa/a11y.mjs <outdir>   (needs `npx vite --port 5173`)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const AXE = readFileSync(new URL("../../app/node_modules/axe-core/axe.min.js", import.meta.url), "utf8");
const port = 9448;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1000", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-a11y-profile", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => (await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = (t, sel = "button,a,[role=tab]") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)})&&!x.disabled);if(b){b.click();return true}return false})()`);
await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);
await ev("localStorage.clear()"); await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);
await click("Animation story"); await sleep(1500);

// Use the app's own Light / Dark button, so every attribute and variable it sets is in place, as a real user would see them.
const setTheme = async (t) => { await click(t === 'light' ? 'Light' : 'Dark', '.app-menu button'); await sleep(400); };
const audit = async () => ev(`(async()=>{ if(!window.axe){ (0,eval)(${JSON.stringify(AXE)}); } const r = await axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a','wcag2aa','wcag21a','wcag21aa'] } }); return r.violations.map(v=>({id:v.id, impact:v.impact, help:v.help, count:v.nodes.length, sample:v.nodes.slice(0,3).map(n=>({target:n.target.join(' '), summary:(n.failureSummary||'').split('\\n').slice(1,3).join(' ').slice(0,200)}))})); })()`);

const screens = [
  ["Presets: genres", async () => { await click("Presets", ".rail button.nav"); await sleep(600); }],
  ["Presets: cards", async () => { await click("Film and television", ".genre-tile"); await sleep(600); }],
  ["Presets: compare and filters", async () => { await click("Advanced filters"); await click("Compare", ".preset-card button"); await sleep(400); }],
  ["Presets: cast panel", async () => { await click("Add to Cast", ".preset-card button"); await sleep(400); }],
  ["Agent Studio", async () => { await click("Agent Studio", ".rail button.nav"); await sleep(600); await click("Plan the production"); await sleep(700); }],
  ["Cast", async () => { await click("Cast", ".rail button.nav"); await sleep(700); await ev(`document.querySelectorAll('details.char-profile').forEach(d=>d.open=true)`); await sleep(300); }],
  ["Perform", async () => { await click("Perform", ".rail button.nav"); await sleep(800); }],
  ["Voices", async () => { await click("Voices", ".rail button.nav"); await sleep(700); }],
  ["Export", async () => { await click("Export", ".rail button.nav"); await sleep(700); }],
  ["Timeline", async () => { await click("Timeline", ".rail button.nav"); await sleep(700); }],
  ["Model Center", async () => { await click("Model Center", ".rail button.nav"); await sleep(700); }],
  ["Voice metadata", async () => { await click("Voice metadata", ".rail button.nav"); await sleep(700); await ev(`document.querySelector('.review-item')?.click()`); await sleep(400); }],
  ["Cast with the casting panel open", async () => { await click("Cast", ".rail button.nav"); await sleep(700); await ev(`[...document.querySelectorAll('.casting-panel button')].find(b=>b.textContent.includes('Choose or check'))?.click()`); await sleep(400); }],
  ["Settings", async () => { await click("Settings", ".rail button.nav"); await sleep(700); }],
];
const report = {};
for (const theme of ["dark", "light"]) {
  await setTheme(theme);
  for (const [name, go] of screens) {
    await go(); await sleep(300);
    report[`${name} (${theme})`] = await audit();
  }
}
writeFileSync(`${out}/a11y.json`, JSON.stringify(report, null, 1));
let total = 0; const byRule = {};
for (const [k, v] of Object.entries(report)) {
  console.log(`${v.length ? "ISSUES" : "clean "} ${k}${v.length ? ": " + v.map((x) => `${x.id}×${x.count}(${x.impact})`).join(", ") : ""}`);
  for (const x of v) { total += x.count; byRule[x.id] = (byRule[x.id] ?? 0) + x.count; }
}
console.log("TOTAL nodes with violations:", total, JSON.stringify(byRule));
ws.close(); chrome.kill(); process.exit(0);
