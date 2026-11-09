// Use my own audio, then add an expression to a take, in headless Chrome against the demo build.
// Usage: node scripts/qa/ownaudio_e2e.mjs <outdir>   (needs `npx vite --port 5173` running)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const port = 9448;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1100", "--hide-scrollbars", "--autoplay-policy=no-user-gesture-required", "--user-data-dir=" + process.env.TEMP + "/gr-ownaudio-profile", "about:blank"], { stdio: "ignore" });
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
const click = (t, sel = "button,a,[role=tab],[role=menuitem]") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)})&&!x.disabled);if(b){b.click();return true}return false})()`);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 75 }); writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.result.data, "base64")); };
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);

// a two-second 220 Hz tone as a real WAV file to choose in the dialog
const rate = 16000, n = rate * 2; const buf = Buffer.alloc(44 + n * 2);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22); buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 220 * i) / rate) * 9000), 44 + i * 2);
const wavPath = `${out}/my-line.wav`; writeFileSync(wavPath, buf);

await send("Page.enable"); await send("Runtime.enable"); await send("DOM.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(1500);
await click("Animation story"); await sleep(900);
await click("Perform", ".rail button, button.nav"); await sleep(800);
const takesBefore = await ev(`document.querySelectorAll('.line-card, .linecard, [class*=linecard]').length`);
// open the first line's menu
check("the line menu opens", await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>/^More/.test(x.textContent.trim())&&x.getAttribute('aria-haspopup'));if(b){b.click();return true}const c=[...document.querySelectorAll('button')].filter(x=>/^More/.test(x.textContent.trim()));if(c.length){c[0].click();return true}return false})()`));
await sleep(300);
const items = await ev(`[...document.querySelectorAll('[role=menuitem]')].map(x=>x.textContent.trim()+(x.disabled?' (disabled)':''))`);
console.log("menu:", JSON.stringify(items));
check("menu offers Use my own audio", items.some((t) => t.startsWith("Use my own audio")));
check("menu offers Add an expression to this take", items.some((t) => t.startsWith("Add an expression")));
await click("Use my own audio"); await sleep(500);
check("the dialog opens", await ev(`!!document.querySelector('[aria-labelledby=oa-t]')`));
const doc = (await send("DOM.getDocument", { depth: -1 })).result.root.nodeId;
const node = (await send("DOM.querySelector", { nodeId: doc, selector: 'input[aria-label="Choose an audio file"]' })).result.nodeId;
await send("DOM.setFileInputFiles", { files: [wavPath], nodeId: node }); await sleep(1500);
check("the chosen audio is loaded and shown with its length", await ev(`/2\\.0 s/.test(document.querySelector('[aria-labelledby=oa-t]').textContent)`), await ev(`document.querySelector('[aria-labelledby=oa-t] .muted.small:last-of-type')?.textContent`));
await shot("own1");
check("saving as it is makes a take", await click("Use my audio as it is", "[aria-labelledby=oa-t] button")); await sleep(1500);
check("the dialog closed", !(await ev(`!!document.querySelector('[aria-labelledby=oa-t]')`)));
await shot("own2");
// make a laugh with "Add a sound clip" (the demo makes it for free), then add it to the take
const openMenu = () => ev(`(()=>{const c=[...document.querySelectorAll('button')].filter(x=>/^More/.test(x.textContent.trim()));if(c.length){c[0].click();return true}return false})()`);
await openMenu(); await sleep(300); await click("Add a sound clip"); await sleep(400);
await ev(`(()=>{const el=document.querySelector('input[aria-label="Describe the sound"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'a warm short laugh');el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
console.log("sound form buttons:", JSON.stringify(await ev(`[...document.querySelectorAll('.sound-form button')].map(b=>b.textContent.trim())`)));
await ev(`[...document.querySelectorAll('.sound-form button')].find(b=>/Make|Generate|Add/.test(b.textContent))?.click()`); await sleep(600);
await click("Go ahead", "button"); await sleep(2500);
await openMenu(); await sleep(300);
check("Add an expression is now available", await click("Add an expression")); await sleep(800);
check("the expression dialog opens", await ev(`!!document.querySelector('[aria-labelledby=oa-t]')`));
const opts = await ev(`[...document.querySelectorAll('[aria-label="Expression to add"] option')].map(o=>o.textContent)`);
console.log("expressions:", JSON.stringify(opts));
check("the made laugh is offered", opts.some((o) => /laugh/.test(o)));
await ev(`(()=>{const el=document.querySelector('[aria-label="Expression to add"]');const o=[...el.options].find(o=>/laugh/.test(o.textContent));Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,o.value);el.dispatchEvent(new Event('change',{bubbles:true}))})()`); await sleep(1200);
await ev(`(()=>{const r=document.querySelector('[aria-label="Where to put the expression"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(r,'0.8');r.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(300);
check("hear it first works", await click("Hear it first", "[aria-labelledby=oa-t] button")); await sleep(800);
check("a preview player appears", await ev(`document.querySelectorAll('[aria-labelledby=oa-t] audio').length>=2`));
await shot("own3");
check("saving the expression makes a new take", await click("Use it with the expression", "[aria-labelledby=oa-t] button")); await sleep(1500);
check("the dialog closed again", !(await ev(`!!document.querySelector('[aria-labelledby=oa-t]')`)));
console.log(checks.join("\n"));
console.log("console errors:", errors.length, errors.slice(0, 4));
ws.close(); chrome.kill(); process.exit(0);
