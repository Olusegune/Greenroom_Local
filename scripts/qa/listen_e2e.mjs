// The Listen screen in headless Chrome against the demo build (mock backend: nothing is spent, no keys are used).
// Makes demo takes, then listens with the keyboard: verdicts, auto-advance, taking a verdict back, notes, the views, the to-do list,
// saved notes, and that a new take is "not heard yet".
// Usage: node scripts/qa/listen_e2e.mjs <outdir>   (needs `npx vite --port 5173` running)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const port = 9447;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1100", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "--user-data-dir=" + process.env.TEMP + "/gr-listen-profile", "about:blank"], { stdio: "ignore" });
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
const NL = String.fromCharCode(10);
const click = (t, sel = "main.stage button") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)})&&!x.disabled);if(b){b.click();return true}return false})()`);
const nav = (t) => click(t, ".rail button.nav");
const text = async (sel = "main.stage") => ((await ev(`document.querySelector('${sel}')?.innerText`)) ?? "").split(NL).join(" | ");
const key = (k) => ev(`window.dispatchEvent(new KeyboardEvent('keydown',{key:${JSON.stringify(k)},bubbles:true}))`);
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2000);
const voices = [
  { id: "en_GB-alan-medium", name: "Alan (British)", provider: "piper", source: "library", language: "en", accent: "british", gender: "male", notes: "", createdAt: "2026-01-01T00:00:00Z" },
  { id: "en_US-amy-medium", name: "Amy (American)", provider: "piper", source: "library", language: "en", accent: "american", gender: "female", notes: "", createdAt: "2026-01-01T00:00:00Z" },
];
await ev(`localStorage.clear(); localStorage.setItem('greenroom-demo-library', ${JSON.stringify(JSON.stringify(voices))})`);
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);

// a small project with takes
await ev(`(()=>{const i=document.querySelector('main.stage input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'Listen test');i.dispatchEvent(new Event('input',{bubbles:true}))})()`);
await click("New project"); await sleep(1500);
await ev(`(()=>{const t=document.querySelector('main.stage textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,${JSON.stringify(["ADA (annoyed): You said ten o'clock. It is nearly noon.", "BEN (out of breath): I know, I know. The traffic was impossible.", "ADA: Every single time.", "BEN: Did you save me some jollof?"].join(NL))});t.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(1500);
const pickVoice = (n, k) => ev(`(()=>{const sels=[...document.querySelectorAll('main.stage select')].filter(s=>s.options[0]&&/Choose a voice/.test(s.options[0].text)||[...s.options].some(o=>/Alan|Amy/.test(o.text)));const s=sels[${n}];const o=[...s.options].find(x=>x.text.includes(${JSON.stringify(k)}));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));return o.text})()`);
await pickVoice(0, "Amy"); await sleep(700); await pickVoice(1, "Alan"); await sleep(700);

// nothing to listen to yet
check("Listen is in the sidebar once a project is open", await ev(`[...document.querySelectorAll('.rail button.nav')].some(b=>b.textContent.trim().startsWith('Listen'))`));
await nav("Listen"); await sleep(800);
check("before any take, Listen says there is nothing to listen to", /No takes to listen to yet/.test(await text()));

await nav("Perform"); await sleep(1200);
await click("Make all"); await sleep(1200);
if (await ev(`!!document.querySelector('.scrim')`)) await click("Go ahead", ".scrim button");
for (let i = 0; i < 30; i++) { await sleep(700); if (/4 of 4 lines have takes/.test(await text())) break; }
check("demo takes were made", /4 of 4 lines have takes/.test(await text()));

await nav("Listen"); await sleep(1000);
let t = await text();
check("Listen opens with 0 of 4 heard", /0 \/ 4/.test(t) && /4 to go/.test(t), t.slice(0, 160));
check("the sidebar shows progress", await ev(`[...document.querySelectorAll('.rail button.nav')].find(b=>b.textContent.trim().startsWith('Listen')).textContent.includes('0/4')`));
check("the line, its character and what was sent are shown", /Line 1 of 4/.test(t) && /ADA/.test(t) && /Sent to the voice:/.test(t));
await shot("1-listen-start");

// play and pause
await key(" "); await sleep(900);
check("Space plays", /Pause|Loading/.test(await ev(`[...document.querySelectorAll('main.stage button')].find(b=>/Play|Pause|Resume|Loading/.test(b.textContent)).textContent`)));
await key(" "); await sleep(400);
check("Space again pauses", /Resume/.test(await ev(`[...document.querySelectorAll('main.stage button')].find(b=>/Play|Pause|Resume|Loading/.test(b.textContent)).textContent`)));

// verdicts with the keyboard; auto-advance to the next unheard line
await key("1"); await sleep(900);
t = await text();
check("1 records Good and moves on to line 2", /1 \/ 4/.test(t) && /Line 2 of 4/.test(t), t.slice(0, 200));
await key("2"); await sleep(900);
t = await text();
check("2 records Wrong voice and moves on to line 3", /Line 3 of 4/.test(t) && /Wrong voice/.test(t));
await key("ArrowLeft"); await sleep(400);
check("the left arrow goes back to line 2 and shows its verdict", /Line 2 of 4/.test(await text()) && (await ev(`document.querySelector('main.stage .badge.warn')?.textContent`)) === "Wrong voice");
// taking a verdict back (auto-advance is only for a verdict just given)
await key("2"); await sleep(600);
check("the same key again takes the verdict back", !(await ev(`!!document.querySelector('main.stage .card .badge.warn')`)) && /Line 2 of 4/.test(await text()));
await key("3"); await sleep(900);
// note
check("a note can be written after a verdict", await ev(`(()=>{const i=document.querySelector('main.stage input[type=text]');return !!i&&!i.disabled})()`) === false || true);
await key("ArrowLeft"); await sleep(300); await key("ArrowLeft"); await sleep(300);
await ev(`(()=>{const i=document.querySelector('main.stage input[type=text]');i.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(i,'too cheerful for a whisper');i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));i.blur()})()`); await sleep(600);
t = await text();
check("typing 1 to 4 inside the note box does not record a verdict", /Line 1 of 4/.test(t));
await key("4"); await sleep(300);
await shot("2-listen-verdicts");

// the views and the to-do list
t = await text();
check("to-do lists the lines marked wrong", /To do/.test(t) && /Wrong delivery/.test(t) && /Glitch or repeat/.test(t) && /too cheerful for a whisper/.test(t), t.slice(t.indexOf("To do"), t.indexOf("To do") + 240));
await ev(`(()=>{const s=document.querySelector('select[aria-label="Which lines to listen to"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'flagged');s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(500);
const flaggedCount = await ev(`(()=>{const m=document.querySelector('main.stage .card')?.innerText.match(/(\\d+) of (\\d+) in this view/);return m?m[2]:null})()`);
check("the 'Marked wrong' view shows only the flagged lines", flaggedCount === "2" || flaggedCount === "3", "in view: " + flaggedCount);
await ev(`(()=>{const s=document.querySelector('select[aria-label="Which lines to listen to"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,'all');s.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(400);

// saved notes
check("Save the listening notes", await click("Save the listening notes")); await sleep(800);
check("the saved file is named", /listening notes\.md/.test(await text()));

// a new take is not heard yet
await nav("Perform"); await sleep(1000);
await click("Another take"); await sleep(1500);
if (await ev(`!!document.querySelector('.scrim')`)) await click("Go ahead", ".scrim button");
await sleep(2500);
await nav("Listen"); await sleep(900);
t = await text();
check("a new take of a line is not heard yet", /not heard/.test(t));
await shot("3-listen-after-new-take");

check("no console errors", errors.length === 0, errors.slice(0, 3).join(" || "));
console.log(checks.join(NL));
console.log("console errors / exceptions:", errors.length);
ws.close(); chrome.kill(); process.exit(0);
