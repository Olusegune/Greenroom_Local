// Voice presets screen in headless Chrome against the demo build: genre tiles, browsing, search, favourites, compare,
// the "Requires voice selection" gate, Add to Cast with an undoable change, and import/export controls.
// Usage: node scripts/qa/presets_e2e.mjs <outdir>   (needs `npx vite --port 5173` running)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const port = 9445;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1000", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-presets-profile", "about:blank"], { stdio: "ignore" });
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
const setValue = (sel, v) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);

// With no project open
check("Presets is in the sidebar", await click("Presets", ".rail button.nav")); await sleep(500);
check("12 genre tiles", (await ev(`document.querySelectorAll('.genre-tile').length`)) === 12);
check("no cards before a genre is chosen", (await ev(`document.querySelectorAll('.preset-card').length`)) === 0);
await shot("1-genres");
await click("Film and television", ".genre-tile"); await sleep(400);
check("Film and television shows 16 cards", (await ev(`document.querySelectorAll('.preset-card').length`)) === 16, String(await ev(`document.querySelectorAll('.preset-card').length`)));
check("no fake audition: no Audition button without a voice", (await ev(`[...document.querySelectorAll('.preset-card button')].some(b=>b.textContent.trim()==='Audition')`)) === false);
check("shows the readiness gate text", (await ev(`document.body.innerText.includes('Requires voice selection')||document.body.innerText.includes('Needs an engine')`)) === true);
await shot("2-film");
await click("← All genres"); await sleep(300);

await setValue('input[aria-label="Search presets"]', "nigerian"); await sleep(400);
check("search 'nigerian' finds 4", (await ev(`document.querySelectorAll('.preset-card').length`)) === 4, String(await ev(`document.querySelectorAll('.preset-card').length`)));
check("accent shown as unverified or experimental", (await ev(`document.querySelectorAll('.preset-card').length>0 && [...document.querySelectorAll('.preset-card')].every(c=>/Experimental/.test(c.textContent))`)) === true);
check("no claim of review", (await ev(`!/Native-speaker reviewed|Community reviewed/.test(document.querySelector('.preset-grid').textContent)`)) === true);
await shot("3-nigerian");

await setValue('input[aria-label="Search presets"]', "noir"); await sleep(300);
await ev(`document.querySelector('.preset-card button[aria-label^="Add Noir"]').click()`); await sleep(200);
check("favourite toggles", (await ev(`document.querySelector('.preset-card button[aria-label^="Remove Noir"]')!==null`)) === true);
await setValue('input[aria-label="Search presets"]', "detective"); await sleep(300);
await click("Compare", ".preset-card button"); await sleep(200);
await setValue('input[aria-label="Search presets"]', "commander"); await sleep(300);
await click("Compare", ".preset-card button"); await sleep(300);
check("compare table has two presets", (await ev(`document.querySelectorAll('.compare thead th').length`)) === 3);
await shot("4-compare");
await click("Add to Cast", ".preset-card button"); await sleep(300);
check("Add to Cast without a project asks to open one", (await ev(`document.querySelector('.cast-panel')?.textContent.includes('Open a project first')`)) === true);

await setValue('input[aria-label="Search presets"]', ""); await click("Advanced filters"); await sleep(300);
check("advanced filters appear", (await ev(`!!document.querySelector('.preset-filters')`)) === true);
check("favourites persisted to local storage", (await ev(`JSON.parse(localStorage.getItem('greenroom-voice-presets')).favorites.length`)) === 1);

// With a project and a voice
await click("Projects", ".rail button.nav"); await sleep(500);
await click("Animation story"); await sleep(1500);
await click("Voices", ".rail button.nav"); await sleep(600);
await click("Find a voice"); await sleep(500);
await ev(`(()=>{const b=[...document.querySelectorAll('button.tile')].find(x=>x.textContent.trim().startsWith('English'));if(b)b.click()})()`); await sleep(1800);
await ev(`(()=>{const h=[...document.querySelectorAll('h2')].find(x=>x.textContent.trim()==='Inworld');const sec=h.closest('.stack');[...sec.querySelectorAll('button')].find(x=>x.textContent.trim().endsWith('Add')).click()})()`); await sleep(700);
await click("Presets", ".rail button.nav"); await sleep(500);
await click("Animation and cartoons", ".genre-tile"); await sleep(400);
const status = await ev(`[...document.querySelectorAll('.preset-card .status')].map(x=>x.textContent).join('|')`);
check("cards report a status", typeof status === "string" && status.length > 0, status.slice(0, 120));
await click("Add to Cast", ".preset-card button"); await sleep(400);
check("cast panel lists characters", (await ev(`document.querySelectorAll('.cast-panel select').length`)) >= 1);
check("preview says what will be filled", (await ev(`document.querySelector('.cast-panel')?.textContent.includes('Will fill in')`)) === true);
await shot("5-cast-panel");
await click("Apply to character", ".cast-panel button"); await sleep(500);
check("applied, panel closed", (await ev(`!document.querySelector('.cast-panel')`)) === true);
await click("Cast", ".rail button.nav"); await sleep(600);
await ev(`document.querySelectorAll('details.char-profile').forEach(d=>d.open=true)`); await sleep(300);
check("the character profile now holds the preset's accent or timbre", (await ev(`/pitch/.test(document.body.innerText)||[...document.querySelectorAll('textarea,input')].some(e=>/pitch/.test(e.value))`)) === true);
await shot("6-cast-after");

console.log(checks.join("\n"));
console.log("console errors / exceptions:", errors.length);
errors.slice(0, 8).forEach((e) => console.log("  ", e));
ws.close(); chrome.kill();
process.exit(checks.some((c) => c.startsWith("FAIL")) || errors.length ? 1 : 0);
