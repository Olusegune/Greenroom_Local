// Agent Studio in headless Chrome against the demo build (mock backend: nothing is spent, no keys are used).
// Plans a production, runs it in Guided mode approving each checkpoint, and checks that delivery still waits for a person,
// that the local-only switch blocks cloud steps, and that Undo is available.
// Usage: node scripts/qa/agent_e2e.mjs <outdir>   (needs `npx vite --port 5173` running)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const port = 9446;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1100", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-agent-profile", "about:blank"], { stdio: "ignore" });
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
const click = (t, sel = "button,a,[role=tab]") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)})&&!x.disabled);if(b){b.click();return true}return false})()`);
const setValue = (sel, v, proto = "HTMLTextAreaElement") => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});Object.getOwnPropertyDescriptor(window.${proto}.prototype,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event('input',{bubbles:true}))})()`);
const flatDbg = (t) => (t ?? '').split(String.fromCharCode(10)).join(' ');
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);
const colOf = (title) => ev(`(()=>{const a=[...document.querySelectorAll('.board-card')].find(x=>x.getAttribute('aria-label')===${JSON.stringify(title)});return a?a.closest('.board-col').getAttribute('aria-label'):null})()`);
const colsText = () => ev(`[...document.querySelectorAll('.board-col')].map(c=>c.getAttribute('aria-label')+': '+[...c.querySelectorAll('.board-card')].map(x=>x.getAttribute('aria-label')).join(' | ')).join('\\n')`);

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1100, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);
await ev("localStorage.clear()"); await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);

check("no project: asks to open one", (await click("Agent Studio", ".rail button.nav")) === false && (await ev(`!!document.querySelector('.rail')`)));
await click("Animation story"); await sleep(1500);
await click("Voices", ".rail button.nav"); await sleep(600);
await click("Find a voice"); await sleep(500);
await ev(`(()=>{const b=[...document.querySelectorAll('button.tile')].find(x=>x.textContent.trim().startsWith('English'));if(b)b.click()})()`); await sleep(1800);
await ev(`(()=>{const h=[...document.querySelectorAll('h2')].find(x=>x.textContent.trim()==='Inworld');const sec=h.closest('.stack');[...sec.querySelectorAll('button')].find(x=>x.textContent.trim().endsWith('Add')).click()})()`); await sleep(700);

check("Agent Studio is in the sidebar", await click("Agent Studio", ".rail button.nav")); await sleep(500);
check("local-only is the default", (await ev(`document.querySelector('.agent-brief input[type=checkbox]').checked`)) === true);
check("Guided is the default mode", (await ev(`document.querySelector('input[name=mode]:checked').closest('label').textContent.includes('Guided Agent')`)) === true);
await setValue(".agent-brief textarea", "Create a version suitable for a children's animated film. Keep total cloud spending below $5. Make it more restrained. Paint the moon purple.");
await sleep(300);
const understood = await ev(`document.querySelector('.agent-brief [aria-live]').textContent`);
check("shows what it understood, and what it did not", /children's animated/.test(understood) && /spending to 5/.test(understood) && /Paint the moon purple/.test(understood), understood.slice(0, 80));
await click("Use these limits"); await sleep(300);
check("budget applied, local-only switched off? (spending proposal alone keeps local-only until chosen)", (await ev(`typeof document.querySelector('.agent-brief input[type=number]').value`)) === "string");
await shot("1-brief");

// Local-only plan: cloud steps must not run
await click("Plan the production"); await sleep(600);
check("plan has the five columns", (await ev(`document.querySelectorAll('.board-col').length`)) === 5);
check("analyze is planned", (await colOf("Analyze the script")) === "Planned");
check("delivery step exists and is gated", (await ev(`[...document.querySelectorAll('.board-card')].some(x=>x.getAttribute('aria-label')==='Export the full scene'&&x.textContent.includes('delivery'))`)) === true);
await click("Start"); await sleep(1500);
check("analyze completed", (await colOf("Analyze the script")) === "Completed");
// 0.13: the cast step only proposes. With nothing stated about a character, and the only voice a cloud voice in a local-only run,
// it must refuse and ask the person, never pick a voice for them.
check("guided: the cast step stops and asks instead of choosing for you", (await colOf("Recommend the cast")) === "Failed or stopped" && (await ev(`document.body.innerText.includes('The cast needs your decision')`)) === true, await colsText());
await shot("2-awaiting-cast");
check("the approval of the cast is a separate step that is still waiting", (await colOf("Approve and lock the cast")) !== "Completed");
check("local-only: no cloud take was made", (await ev(`!document.body.innerText.includes('"takeId"')`)) === true);
await shot("2b-local-only-refusal");

// The person chooses the voices (the agent will not), then comes back and allows cloud.
await click("Cast", ".rail button.nav"); await sleep(800);
await ev(`document.querySelectorAll('.voice-card').forEach((card)=>{const sel=card.querySelector('select');const o=[...sel.options].find(x=>x.value);if(o){Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(sel,o.value);sel.dispatchEvent(new Event('change',{bubbles:true}))}})`); await sleep(800);
check("the person chose a voice for each character", (await ev(`[...document.querySelectorAll('.voice-card')].every(c=>c.querySelector('select').value!=='')`)) === true);
await click("Agent Studio", ".rail button.nav"); await sleep(600);
// Allow cloud inside a $5 limit, update the plan (finished steps are kept), retry
await ev(`(()=>{const c=document.querySelector('.agent-brief input[type=checkbox]');c.click()})()`); await sleep(300);
await setValue('.agent-brief input[type=number]', "5", "HTMLInputElement"); await sleep(200);
await click("Update the plan"); await sleep(600);
check("plan update kept the finished analyze step", (await colOf("Analyze the script")) === "Completed");
await click("Try again", ".board-card button"); await sleep(400);
for (let i = 0; i < 40; i++) {
  const did = (await click("Approve", ".board-card button")) || (await click("Go ahead", "button"));
  if (!did) {
    if (await ev(`[...document.querySelectorAll('button')].some(b=>b.textContent.trim()==='Stop')`)) { await sleep(800); continue; }
    if (!(await click("Continue", "button.primary")) && !(await click("Start", "button.primary"))) break;
  }
  await sleep(1200);
  if ((await colOf("Export the full scene")) === "Awaiting your approval") break;
}
await sleep(800);
await shot("3-board");
const final = await colsText();
check("assembled the timeline", (await colOf("Assemble the timeline")) === "Completed", final);
check("delivery waits for the person", (await colOf("Export the full scene")) === "Awaiting your approval");
check("audio check ran and reports honestly", (await ev(`document.body.innerText.includes('The check measures; whether a performance sounds natural is your call.')`)) === true);
check("audit log recorded the run", (await ev(`parseInt((document.body.innerText.match(/Audit log \\((\\d+)\\)/)||[])[1]||'0')`)) > 10);
check("Undo is available for the agent's changes", (await ev(`[...document.querySelectorAll('.rail-foot button')].some(b=>b.textContent.trim()==='Undo'&&!b.disabled)`)) === true);

// Approve delivery: the agent now mixes and writes the full scene (the demo backend stands in for the disk)
await click("Approve", ".board-card button"); await sleep(4000);
check("after approval the export step writes the full scene", (await colOf("Export the full scene")) === "Completed" && (await ev(`document.body.innerText.includes('Written:')`)) === true, await colsText());
await shot("4-exported");

console.log(checks.join("\n"));
console.log("console errors / exceptions:", errors.length);
errors.slice(0, 8).forEach((e) => console.log("  ", e));
ws.close(); chrome.kill();
process.exit(checks.some((c) => c.startsWith("FAIL")) || errors.length ? 1 : 0);
