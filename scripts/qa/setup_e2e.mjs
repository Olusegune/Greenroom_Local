// Model Center setup in headless Chrome against the demo build (simulated downloads): the Kokoro card and the Set up my PC wizard.
// Usage: node scripts/qa/setup_e2e.mjs <outdir>   (needs `npx vite --port 5173` running)
import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const port = 9446;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1000", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-setup-profile", "about:blank"], { stdio: "ignore" });
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
// One line of text for a card, with no regular expressions so no escaping can go wrong.
const flat = (t) => (t ?? "").split(String.fromCharCode(10)).join(" ");
const kokoroCard = `[...document.querySelectorAll('.model-card')].find(c=>c.innerText.includes('Kokoro 82M'))`;

await send("Page.enable"); await send("Runtime.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 1000, deviceScaleFactor: 1, mobile: false });
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);
await ev("localStorage.clear()"); await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);

check("Model Center opens", await click("Model Center", ".rail button.nav")); await sleep(900);
check("Kokoro card offers automatic setup", (await ev(`${kokoroCard}?.innerText.includes('Set up Kokoro automatically')`)) === true);
check("Kokoro card no longer says it cannot speak", (await ev(`!${kokoroCard}?.innerText.includes('cannot speak')`)) === true);
await shot("1-kokoro-before");
check("press Set up Kokoro automatically", (await ev(`(()=>{const b=[...${kokoroCard}.querySelectorAll('button')].find(x=>x.textContent.includes('Set up Kokoro automatically'));if(b){b.click();return true}return false})()`)) === true); await sleep(700);
const sheet = flat(await ev(`document.body.innerText`));
check("one confirmation sheet names the downloads, says no credits and needs internet once", sheet.includes("Set up Kokoro on this PC?") && sheet.includes("Kokoro runtime") && sheet.includes("no credits") && sheet.includes("internet this once"));
await shot("2-kokoro-sheet");
// The sheet's own button is exactly "Download"; the Chatterbox card also has buttons that begin with that word.
check("confirm", await ev(`(()=>{const b=[...document.querySelectorAll('button')].find(x=>x.textContent.trim()==='Download');if(b){b.click();return true}return false})()`)); await sleep(4500);
const after = flat(await ev(`${kokoroCard}?.innerText`));
const order = ["Kokoro runtime", "Kokoro model and test line", "Kokoro voices"].map((s) => after.indexOf(s));
check("all three steps are listed in order", order.every((n) => n >= 0) && order[0] < order[1] && order[1] < order[2], after.slice(0, 160));
check("all three finished", (after.match(/done/g) ?? []).length >= 3);
check("the card says Installed, not Ready (never run for real)", after.includes("Installed") && after.includes("not marked Ready"), after.slice(after.indexOf("Installed"), after.indexOf("Installed") + 90));
await shot("3-kokoro-after");
await click("Voices", ".rail button.nav"); await sleep(900);
check("Voices library has the Kokoro voices", (await ev(`document.body.innerText.includes('Heart (American, female)')`)) === true);
await shot("4-voices");
await click("Model Center", ".rail button.nav"); await sleep(700);
check("Set up my PC opens", await click("Set up my PC", "button")); await sleep(700);
const plan = flat(await ev(`document.querySelector('.setup-wizard')?.innerText`));
check("wizard offers Chatterbox and Kokoro as ticks", plan.includes("Also set up Chatterbox") && plan.includes("Also set up Kokoro"));
await ev(`[...document.querySelectorAll('.setup-wizard label')].find(l=>l.innerText.includes('Also set up Kokoro')).querySelector('input').click()`); await sleep(500);
const plan2 = flat(await ev(`document.querySelector('.setup-wizard')?.innerText`));
check("with Kokoro ticked the wizard says it is already set up and has nothing to add for it", plan2.includes("Already set up") && plan2.includes("Kokoro runtime") && !plan2.includes("Kokoro model and test line"), plan2.slice(0, 220));
await shot("5-wizard");

console.log(checks.join(String.fromCharCode(10)));
console.log("console errors / exceptions:", errors.length);
errors.slice(0, 8).forEach((e) => console.log("  ", e));
ws.close(); chrome.kill();
process.exit(checks.some((c) => c.startsWith("FAIL")) || errors.length ? 1 : 0);
