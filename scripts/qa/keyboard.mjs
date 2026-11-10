// Keyboard-only pass over the Presets and Agent Studio screens in the demo build: real Tab key presses through Chrome.
// Checks that every control is reachable, that focus is never trapped, that the focused control always has a visible
// indicator, and that Enter and Space activate buttons. A person using a screen reader or switch device is still needed.
// Usage: node scripts/qa/keyboard.mjs   (needs `npx vite --port 5173`)
import { spawn } from "node:child_process";
const port = 9449;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1000", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-kb-profile", "about:blank"], { stdio: "ignore" });
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
const key = async (k, code, vk) => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: k, code, windowsVirtualKeyCode: vk, text: k === "Enter" ? "\r" : k === " " ? " " : undefined }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: k, code, windowsVirtualKeyCode: vk }); };
const tab = () => key("Tab", "Tab", 9);
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);
await ev("localStorage.clear()"); await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2500);
await click("Animation story"); await sleep(1500);

/** Tabs through the stage area and reports what was reached, whether focus got stuck, and which focused controls had no visible indicator. */
async function walk(label, rootSel) {
  // Tag every control that should be reachable, so an unreached one can be named.
  const expected = await ev(`(()=>{const els=[...document.querySelector('${rootSel}').querySelectorAll('button,a[href],input,select,textarea,summary,[tabindex]')].filter(e=>!e.disabled&&e.tabIndex>=0&&e.offsetParent!==null&&getComputedStyle(e).visibility!=='hidden'&&e.type!=='hidden'&&(e.tagName==='SUMMARY'||!e.closest('details:not([open])'))&&!(e.type==='radio'&&!e.checked)); els.forEach((e,i)=>e.setAttribute('data-kb',String(i))); return els.length})()`);
  await ev(`document.querySelector('${rootSel}').scrollIntoView(); (document.querySelector('${rootSel}').querySelector('h1')||document.body).setAttribute('tabindex','-1'); (document.querySelector('${rootSel}').querySelector('h1')||document.body).focus(); true`);
  const seen = new Set(); const noRing = []; let stuck = 0, last = "";
  for (let i = 0; i < expected + 25; i++) {
    await tab();
    const f = await ev(`(()=>{const e=document.activeElement; if(!e||e===document.body) return null; const c=getComputedStyle(e); const inRoot=!!e.closest('${rootSel}'); const ring=(c.outlineStyle!=='none'&&parseFloat(c.outlineWidth)>0)||(c.boxShadow&&c.boxShadow!=='none')||(c.borderColor!==''&&false); return {inRoot, key:e.getAttribute('data-kb')||((e.getAttribute('aria-label')||e.textContent||e.tagName).trim().slice(0,40)+'#out'), ring, tag:e.tagName}})()`);
    if (!f) continue;
    if (f.key === last) stuck++; else stuck = 0;
    last = f.key;
    if (stuck > 2) { check(`${label}: focus not trapped`, false, f.key); return; }
    if (f.inRoot) { seen.add(f.key); if (!f.ring) noRing.push(f.key); }
  }
  const missed = await ev(`[...document.querySelector('${rootSel}').querySelectorAll('[data-kb]')].filter(e=>!${JSON.stringify([...seen])}.includes(e.getAttribute('data-kb'))).map(e=>(e.getAttribute('aria-label')||e.textContent||e.tagName).trim().slice(0,30)+' <'+e.tagName.toLowerCase()+(e.type?' '+e.type:'')+'>')`);
  check(`${label}: Tab reaches the controls (${seen.size} of ${expected})`, seen.size >= expected, `${seen.size}/${expected}; not reached: ${missed.slice(0, 6).join(' | ')}`);
  check(`${label}: every focused control shows a focus indicator`, noRing.length === 0, noRing.slice(0, 4).join("; "));
  check(`${label}: focus is not trapped`, true);
}

await click("Presets", ".rail button.nav"); await sleep(600);
await walk("Presets genres", ".presets");
await click("Film and television", ".genre-tile"); await sleep(600);
await walk("Presets cards", ".presets");

// Enter and Space on a button
// Since 0.12.8 Compare lives under the card's "More": it must be opened first, like a person would.
await ev(`document.querySelectorAll('.preset-card details').forEach(d=>d.open=true)`);
await ev(`(()=>{const b=[...document.querySelectorAll('.preset-card button')].find(x=>x.textContent.trim()==='Compare'); b.focus(); return true})()`);
await key("Enter", "Enter", 13); await sleep(300);
check("Enter activates Compare", (await ev(`!!document.querySelector('.compare')`)) === true);
await ev(`(()=>{const b=document.querySelector('.compare button'); b.focus(); return true})()`);
await key(" ", "Space", 32); await sleep(300);
check("Space activates Clear", (await ev(`!document.querySelector('.compare')`)) === true);

await click("Agent Studio", ".rail button.nav"); await sleep(600);
await click("Plan the production"); await sleep(700);
await walk("Agent Studio", ".agent");

// A radio group: Tab lands on the chosen option, arrow keys move within it
await ev(`document.querySelector('input[name=mode]:checked').focus(); true`);
await key("ArrowDown", "ArrowDown", 40); await sleep(300);
check("arrow keys move between the three agent modes", (await ev(`document.querySelector('input[name=mode]:checked').closest('label').textContent.includes('Autonomous')`)) === true);
await key("ArrowUp", "ArrowUp", 38); await sleep(200);

// The Cast panel opens with Enter on the keyboard and its fields are reachable
await click("Presets", ".rail button.nav"); await sleep(500); await click("Film and television", ".genre-tile"); await sleep(500);
await ev(`(()=>{const b=[...document.querySelectorAll('.preset-card button')].find(x=>x.textContent.trim()==='Add to Cast'); b.focus(); return true})()`);
await key("Enter", "Enter", 13); await sleep(400);
check("Enter opens the Add to Cast panel", (await ev(`!!document.querySelector('.cast-panel')`)) === true);
check("the panel has a name and can be closed from the keyboard", (await ev(`!!document.querySelector('.cast-panel[aria-label]') && [...document.querySelectorAll('.cast-panel button')].some(b=>b.textContent.trim()==='Close')`)) === true);

console.log(checks.join("\n"));
ws.close(); chrome.kill();
process.exit(checks.some((c) => c.startsWith("FAIL")) ? 1 : 0);
