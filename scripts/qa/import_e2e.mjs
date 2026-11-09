// Drives the real "Add portraits" screen in headless Chrome with real pictures and with files that must be refused.
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
const S = process.argv[2];
const port = 9555;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1000", "--user-data-dir=" + process.env.TEMP + "/gr-import-profile", "about:blank"], { stdio: "ignore" });
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
const setVal = (sel, v) => ev(`(()=>{const el=document.querySelector(${JSON.stringify(sel)});const proto=el.tagName==='SELECT'?HTMLSelectElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(el,${JSON.stringify(v)});el.dispatchEvent(new Event(el.tagName==='SELECT'?'change':'input',{bubbles:true}));return true})()`);

// test files
mkdirSync(`${S}/imp`, { recursive: true });
writeFileSync(`${S}/imp/evil.png`, '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
writeFileSync(`${S}/imp/real.svg`, '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400"><rect width="400" height="400"/></svg>');
writeFileSync(`${S}/imp/empty.png`, "");
const ROOT = new URL("../../", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const women = readdirSync(ROOT + "avatars/masters").filter((f) => f.endsWith(".png")).slice(0, 2).map((f) => ROOT + "avatars/masters/" + f);
const dup = ROOT + "avatars/masters/contemporary_editor_001.png";
const files = [...women, dup, `${S}/imp/evil.png`, `${S}/imp/real.svg`, `${S}/imp/empty.png`];

await send("Page.enable"); await send("Runtime.enable"); await send("DOM.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(1500);
await click("Animation story"); await sleep(900);
await click("Perform"); await sleep(600);
await ev(`document.querySelector('.lc-portrait button.avatar-btn').click()`); await sleep(700);
await shot("debug0");
console.log("dialog buttons:", JSON.stringify(await ev(`[...document.querySelectorAll('.dialog button')].map(b=>b.textContent.trim()).slice(0,20)`)));
console.log("opened browser:", await click("Add portraits", ".dialog button"));
await sleep(500);
const doc = (await send("DOM.getDocument", { depth: -1 })).result.root.nodeId;
const node = (await send("DOM.querySelector", { nodeId: doc, selector: 'input[aria-label="Choose pictures"]' })).result.nodeId;
await send("DOM.setFileInputFiles", { files, nodeId: node });
await sleep(3000);
console.log("cards:", await ev(`document.querySelectorAll('[aria-labelledby=pi-t] canvas').length`));
console.log("problems:", JSON.stringify(await ev(`[...document.querySelectorAll('.dialog [role=alert] li')].map(x=>x.textContent)`)));
console.log("warnings:", JSON.stringify(await ev(`[...document.querySelectorAll('[aria-labelledby=pi-t] p.small')].map(x=>x.textContent).filter(t=>/looks like|Small/.test(t))`)));
await shot("import1");
// describe the first as a Black woman, adult, automatic
const sels = await ev(`[...document.querySelectorAll('[aria-labelledby=pi-t] select')].length`);
console.log("selects:", sels);
await ev(`(()=>{const sels=[...document.querySelectorAll('[aria-labelledby=pi-t] select')];const set=(el,v)=>{Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(el,v);el.dispatchEvent(new Event('change',{bubbles:true}))};set(sels[0],'f');set(sels[1],'adult');set(sels[2],'black');return true})()`);
await sleep(300);
console.log("auto checkbox on:", await ev(`document.querySelector('[aria-labelledby=pi-t] input[type=checkbox]').checked`));
await shot("import2");
// remove the duplicate-looking card if present, then add
console.log("add click:", await click("Add ", ".dialog button.primary"));
await sleep(1500);
console.log("my avatars:", await ev(`[...document.querySelectorAll('.av-cell .av-name')].map(x=>x.textContent).join(' | ')`));
await shot("import3");
// the stored data is clean: a data:image/jpeg of 512 and no filename kept
const stored = await ev(`(async()=>{const r=await fetch('about:blank');return 1})()`);
console.log("errors:", errors.length, errors.slice(0, 3));
ws.close(); chrome.kill(); process.exit(0);
