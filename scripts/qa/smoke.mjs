// Visits every screen of the demo build in headless Chrome and reports console errors and uncaught exceptions.
import { spawn } from "node:child_process";
const port = 9444;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,900", "--user-data-dir=" + process.env.TEMP + "/gr-smoke-profile", "about:blank"], { stdio: "ignore" });
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
await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(1500);
const click = (t, sel = "button,a,[role=tab]") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)}));if(b){b.click();return true}return false})()`);
const report = [];
const step = async (name, fn) => { const before = errors.length; let ok; try { ok = await fn(); } catch (e) { ok = "threw " + e.message; } await sleep(450); report.push(`${errors.length === before ? "ok  " : "FAIL"} ${name}${ok === false ? " (control not found)" : ""}`); };

await step("create project from template", () => click("Animation story"));
await sleep(900);
for (const t of ["Script", "Cast", "Perform", "Timeline", "Picture", "Export", "Studio", "History", "Voices", "Model Center", "Engines", "SFX Studio", "Voice lab", "Settings", "Help & guide"]) {
  await step("screen: " + t, () => click(t));
}
await step("Voices tabs", async () => { for (const t of ["My library", "Casting call", "Find a voice", "Design a voice", "Clone a voice", "Accent test"]) { await click(t); await sleep(300); } });
await click("Voices"); await sleep(400); await click("Find a voice"); await sleep(500);
await ev(`(()=>{const b=[...document.querySelectorAll('button.tile')].find(x=>x.textContent.trim().startsWith('English'));if(b)b.click()})()`); await sleep(1800);
await ev(`(()=>{const h=[...document.querySelectorAll('h2')].find(x=>x.textContent.trim()==='Inworld');const sec=h.closest('.stack');[...sec.querySelectorAll('button')].find(x=>x.textContent.trim().endsWith('Add')).click()})()`); await sleep(700);
await click("Cast"); await sleep(600);
await ev(`(()=>{document.querySelectorAll('select').forEach(s=>{const o=[...s.options].find(o=>o.textContent.includes('Alex'));if(o){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}))}})})()`); await sleep(600);
await step("Cast: open every character profile", () => ev(`document.querySelectorAll('details.char-profile').forEach(d=>d.open=true)`));
await click("Perform"); await sleep(600);
await step("Perform: Simple view", () => click("Quick Perform", "button.ptab"));
await step("Perform: Director view", () => click("Director", "button.ptab"));
await step("Perform: Advanced view", () => click("Advanced", "button.ptab"));
await step("Perform: Reaction Library tab", async () => { await click("Reaction Library", "button.ptab"); await sleep(400); await click("Director", "button.ptab"); });
await step("Perform: character rail jump", () => click("NARRATOR", "button.rc-text"));
await step("Avatar browser: search, assign, create and save a custom avatar", async () => {
  await ev(`document.querySelector('.lc-portrait button.avatar-btn').click()`); await sleep(700);
  console.log("avatar cells:", await ev(`document.querySelectorAll('.av-cell').length`));
  await ev(`(()=>{const el=document.querySelector('input[aria-label="Search avatars"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'cyberpunk');el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(400);
  console.log("cyberpunk results:", await ev(`[...document.querySelectorAll('.av-cell .av-name')].map(x=>x.textContent).join(',')`));
  await click("Suggest avatars", ".dialog button"); await sleep(300);
  await click("Create a custom avatar", ".dialog button"); await sleep(400);
  await ev(`(()=>{const el=document.querySelector('.dialog [aria-label="Create a custom avatar"] input');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'a stern elderly bureaucrat');el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(300);
  await click("Make the picture", ".dialog button"); await sleep(500); await click("Go ahead", "button"); await sleep(2500);
  await ev(`(()=>{const el=document.querySelector('input[aria-label="Name for this avatar"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,'Demo Bureaucrat');el.dispatchEvent(new Event('input',{bubbles:true}))})()`); await sleep(300);
  await click("Save to my avatars", ".dialog button"); await sleep(800);
  console.log("my avatars:", await ev(`[...document.querySelectorAll('.av-cell .av-name')].map(x=>x.textContent).join(',')`));
  await click("Replace with this", ".dialog button"); await sleep(500); await click("Use for", ".dialog button"); await sleep(600);
  console.log("portrait is custom data image:", await ev(`document.querySelector('.lc-portrait img.avatar')?.src.startsWith('data:image')`));
});
await step("Perform: open Director panels", () => ev(`document.querySelectorAll('details.director-panel').forEach(d=>d.open=true)`));
await step("Perform: Script Doctor open", () => click("Script Doctor"));
await sleep(500);
await step("Script Doctor close", () => click("Done"));
await step("Perform: Plan the performance", async () => { await click("Plan the performance"); await sleep(400); await click("Go ahead"); await sleep(2200); await click("Apply to"); });
await step("Perform: Direct whole scene", async () => { await click("Direct whole scene"); await sleep(400); await click("Go ahead"); await sleep(2200); await click("Cancel"); });
await step("Perform: Direct with AI", async () => { await click("Direct with AI"); await sleep(400); await click("Go ahead"); await sleep(2200); await click("Cancel"); });
await step("Perform: More menu", () => click("More"));
await step("Perform: Make a take (spend sheet)", async () => { await click("Make a take"); await sleep(500); await click("Go ahead"); await sleep(1500); });
await step("Perform: use as acting reference", () => click("Use as acting reference"));
await step("Perform: Make 4 interpretations", async () => { await click("More"); await click("Make 4 interpretations"); await sleep(500); await click("Go ahead"); await sleep(4000); });
await step("Perform: Compare takes", async () => { await click("Compare takes"); await sleep(900); console.log("compare dialog open:", await ev("document.querySelectorAll('.dialog').length")); await click("Done", ".dialog button"); });
await step("Perform: Re-voice dialog", async () => { await click("More"); await click("Re-voice a recording"); await sleep(500); console.log("revoice dialog open:", await ev("document.querySelectorAll('.dialog').length")); await click("Close", ".dialog button"); });
console.log("buttons:", await ev("[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).filter(t=>/Play|Pause|Resume|Stop|Close|Done/.test(t)).join(' | ')"), "dialogs:", await ev("document.querySelectorAll('.scrim').length"));
await step("Perform: Play the scene", () => click("Play the scene"));
await click("Export"); await sleep(600);
await step("Export: tick every option", () => ev(`document.querySelectorAll('input[type=checkbox]').forEach(c=>{if(!c.checked)c.click()})`));
console.log(report.join("\n"));
console.log("\nconsole errors / exceptions:", errors.length);
[...new Set(errors)].slice(0, 20).forEach((e) => console.log(" -", e));
ws.close(); chrome.kill(); process.exit(0);
