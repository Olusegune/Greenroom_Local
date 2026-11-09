import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
const S = process.argv[2];
const port = 9777;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1100", "--user-data-dir=" + process.env.TEMP + "/gr-script-profile", "about:blank"], { stdio: "ignore" });
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
const click = (t, sel = "button,a,[role=tab]") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)}));if(b){b.click();return true}return false})()`);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 }); writeFileSync(`${S}/${name}.jpg`, Buffer.from(r.result.data, "base64")); };

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(1500);
console.log("template:", await click("Animation story")); await sleep(900);
await ev(`document.querySelector('.script-area') && 0`);
console.log("write screen:", await click("Script", ".rail button, nav button, button")); await sleep(800);
await ev(`(()=>{const t=document.querySelector('.script-area'); if(t){Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'');t.dispatchEvent(new Event('input',{bubbles:true}))} return !!t})()`); await sleep(300);
console.log("import button:", await click("Import a script"));
await sleep(500);
console.log("choose:", await click("Choose a script", "[aria-labelledby=si-t] button")); await sleep(1200);
console.log("summary:", await ev(`document.querySelector('[aria-labelledby=si-t] p.small strong')?.parentElement?.textContent`));
console.log("characters:", JSON.stringify(await ev(`[...document.querySelectorAll('[aria-labelledby=si-t] strong')].map(x=>x.textContent)`)));
console.log("selects set:", JSON.stringify(await ev(`[...document.querySelectorAll('[aria-labelledby=si-t] select')].map(s=>s.getAttribute('aria-label')+'='+s.value).slice(0,6)`)));
console.log("about boxes:", JSON.stringify(await ev(`[...document.querySelectorAll('[aria-labelledby=si-t] textarea:not([aria-label])')].map(t=>t.value.slice(0,90))`)));
await shot("script1");
console.log("add:", await click("Add to the project", "[aria-labelledby=si-t] button")); await sleep(900);
console.log("script now:", JSON.stringify(await ev(`document.querySelector('.script-area')?.value.slice(0,260)`)));
console.log("cast names:", JSON.stringify(await ev(`[...document.querySelectorAll('.speaker')].map(x=>x.textContent)`)));
await ev(`document.querySelectorAll('details').forEach(d=>{if(/Who is/.test(d.textContent))d.open=true})`); await sleep(300);
await shot("script2");
console.log("errors:", errors.length, errors.slice(0, 3));
ws.close(); chrome.kill(); process.exit(0);
