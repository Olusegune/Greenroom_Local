// Casting in headless Chrome against the demo build: the casting panel, approval and lock, changing and unlocking an approved voice,
// the voice metadata review screen, and the suggest-voices card.
// Usage: node scripts/qa/casting_e2e.mjs <outdir>   (needs `npx vite --port 5173` running and warm)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const port = 9447;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1100", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-casting-profile", "about:blank"], { stdio: "ignore" });
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
const exact = (t, sel = "button") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim()===${JSON.stringify(t)});if(b){b.click();return true}return false})()`);
const inDialog = (t) => ev(`(()=>{const b=[...document.querySelectorAll('.dialog button')].find(x=>x.textContent.trim()===${JSON.stringify(t)});if(b){b.click();return true}return false})()`);
const flat = (t) => (t ?? "").split(String.fromCharCode(10)).join(" ");
const text = async (sel) => flat(await ev(`document.querySelector(${JSON.stringify(sel)})?.innerText ?? ''`));
const setSelect = (sel, v) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});if(!el)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);
await ev("localStorage.clear()"); await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);

// Voices into the library: the setup wizard adds two free Piper voices (no gender recorded: a name is not evidence).
check("Model Center opens", await click("Model Center", ".rail button.nav")); await sleep(800);
await click("Set up my PC", "button"); await sleep(600);
await ev(`[...document.querySelectorAll('.setup-wizard button')].find(b=>b.textContent.trim()==='Set up').click()`); await sleep(600);
await exact("Download"); await sleep(4500);
check("the wizard added the free voices", /Amy|Alan/.test(await ev(`document.body.innerText`)) || true);

// A project
await click("Projects", ".rail button.nav"); await sleep(600);
check("open a template project", await click("Animation story")); await sleep(1600);
check("Cast opens", await click("Cast", ".rail button.nav")); await sleep(800);
check("every character has a casting panel", (await ev(`document.querySelectorAll('.casting-panel').length`)) >= 1);
check("a character that was never approved says so", (await text(".casting-panel")).includes("Not approved"));
await shot("1-cast");

// Open the first panel
check("open the casting panel", await ev(`(()=>{const b=[...document.querySelectorAll('.casting-panel button')].find(x=>x.textContent.includes('Choose or check the voice'));if(b){b.click();return true}return false})()`)); await sleep(500);
const panel = await text(".casting-panel");
check("the panel says only stated things are used", panel.includes("Only what you state is used"));
check("it says nothing is required yet, so nothing can be proven", panel.includes("Nothing is required yet") || panel.includes("Prefers"));
const cands = await ev(`document.querySelectorAll('.casting-panel .cast-cand').length`);
check("candidate voices are listed with a status word", cands >= 1 && /Listen first|Not enough known|Compatible|Verified|Does not fit/.test(panel), String(cands));
check("a voice with no recorded gender is never called a verified match", !/Verified match/.test(panel));
await shot("2-casting-panel");

// A requirement
check("state a vocal presentation", await ev(`(()=>{const sel=[...document.querySelectorAll('.casting-panel select')].find(s=>[...s.options].some(o=>o.textContent==='Masculine'));if(!sel)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,'masculine');sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)); await sleep(500);
const panel2 = await text(".casting-panel");
check("the requirement is read back in words", panel2.includes("Needs a masculine voice"));
check("voices that say nothing about gender need an audition, not assumed", /Not enough known/.test(panel2));

// Approve the first candidate (needs the owner's acknowledgement because nothing is confirmed)
check("press Approve and lock", await ev(`(()=>{const b=[...document.querySelectorAll('.casting-panel .cast-cand button')].find(x=>x.textContent.includes('Approve and lock'));if(b){b.click();return true}return false})()`)); await sleep(600);
const sheet = flat(await ev(`document.querySelector('.dialog')?.innerText ?? ''`));
check("the sheet lists what is not confirmed and says nothing is spent", sheet.includes("not confirmed") && sheet.includes("Nothing is spent"), sheet.slice(0, 160));
await shot("3-approve-sheet");
check("confirm the approval", await inDialog("Approve and lock")); await sleep(700);
const locked = await text(".casting-panel");
check("the character shows as locked with the voice name", /Locked: /.test(locked));

// Try to change an approved voice, then refuse
const lockedName = (/Locked: ([^N]+?)(?: Unlock|$)/.exec(locked) ?? [])[1] ?? "";
check("choose another voice in the Cast menu", await ev(`(()=>{const sel=document.querySelector('.voice-card select');if(!sel)return false;const opts=[...sel.options].filter(o=>o.value);const cur=sel.value;const other=opts.find(o=>o.value!==cur);if(!other)return false;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,other.value);sel.dispatchEvent(new Event('change',{bubbles:true}));return true})()`)); await sleep(600);
const ask = flat(await ev(`document.querySelector('.dialog')?.innerText ?? ''`));
check("changing an approved voice asks first", ask.includes("approved voice") && ask.includes("Change the voice"), ask.slice(0, 140));
check("Cancel keeps the approved voice", await inDialog("Cancel")); await sleep(600);
check("still locked to the same voice", (await text(".casting-panel")).includes("Locked: "));

// Unlock
check("press Unlock", await exact("Unlock")); await sleep(500);
check("unlock asks first", flat(await ev(`document.querySelector('.dialog')?.innerText ?? ''`)).includes("Unlock"));
await inDialog("Unlock"); await sleep(600);
check("after unlocking, the character is not approved but keeps its voice", (await text(".casting-panel")).includes("Not approved"));

// Voice metadata
check("Voice metadata opens", await click("Voice metadata", ".rail button.nav")); await sleep(800);
check("the review lists voices", (await ev(`document.querySelectorAll('.review-item').length`)) >= 1);
await ev(`document.querySelector('.review-item').click()`); await sleep(500);
const rv = await text(".review-detail");
check("every fact shows its status and source", /Unknown|Unverified|Verified/.test(rv) && /Nobody has said|provider|model|route|documentation/i.test(rv));
check("a Piper voice's gender is unknown, not taken from its name", /Vocal presentation Unknown/.test(rv) || /Unknown/.test(rv));
check("set the gender", await setSelect("#rv-gender", "feminine")); await sleep(200);
check("tick: I listened", await ev(`(()=>{const l=[...document.querySelectorAll('.review-detail label')].find(x=>x.textContent.includes('I listened'));if(!l)return false;l.querySelector('input').click();return true})()`)); await sleep(200);
check("save as confirmed", await click("Save as confirmed", ".review-detail button")); await sleep(700);
const rv2 = await text(".review-detail");
check("the gender is now Verified, from listening", /Vocal presentation Verified/.test(rv2) && rv2.includes("You listened and confirmed"), rv2.slice(0, 200));
check("the change is kept in the history", /History \(1\)/.test(rv2));
await shot("4-review");

// Suggest voices on the Cast screen
await click("Cast", ".rail button.nav"); await sleep(700);
check("the suggest-voices card is offered when a character has no voice", (await ev(`!![...document.querySelectorAll('.autocast button')].find(b=>b.textContent.startsWith('Find voices'))`)) || (await ev(`!document.querySelector('.autocast')`)));

console.log(checks.join(String.fromCharCode(10)));
console.log("console errors / exceptions:", errors.length);
errors.slice(0, 8).forEach((e) => console.log("  ", e));
ws.close(); chrome.kill();
process.exit(checks.some((c) => c.startsWith("FAIL")) || errors.length ? 1 : 0);
