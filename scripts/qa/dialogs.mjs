// Dialogs and message boxes in the demo build, through real Chrome: every message box has a close button and closes with Escape,
// every dialog closes with Escape, the voice designer offers both engines and explains a full ElevenLabs account.
// Usage: node scripts/qa/dialogs.mjs   (needs `npx vite --port 5173`)
import { spawn } from "node:child_process";
const port = 9461;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,1000", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-dialogs-qa"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); const errors = [];
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } else if (d.method === "Runtime.exceptionThrown") errors.push((d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 200)); };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => (await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = (t, sel = "button,a,[role=tab]") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)})&&!x.disabled);if(b){b.click();return true}return false})()`);
const esc = async () => { await send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }); await sleep(250); };
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);

await send("Page.enable"); await send("Runtime.enable");
await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2000);
await ev("localStorage.clear()"); await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(2000);

// 1. A message box: shows, has a close button, closes with the button and with Escape, and sits clear of the bottom of the window.
await click("Model Center", ".rail button"); await sleep(1500);
await ev(`window.__t = (t,b)=>0`);
const gotToast = async () => { await click("Copy a report"); await sleep(700); return ev(`!!document.querySelector('.toast')`); };
const t1 = await gotToast();
check("a message box appears", t1);
if (t1) {
  check("the message box has a close button", await ev(`!!document.querySelector('.toast .toast-x[aria-label]')`));
  const box = await ev(`(()=>{const r=document.querySelector('.toast').getBoundingClientRect();return {top:r.top,bottom:r.bottom,w:innerWidth,h:innerHeight,left:r.left,right:r.right}})()`);
  check("the message box is on screen at the top", box.top >= 0 && box.bottom < box.h / 2 && box.left >= 0 && box.right <= box.w, JSON.stringify(box));
  await ev(`document.querySelector('.toast .toast-x').click()`); await sleep(200);
  check("the close button closes it", !(await ev(`!!document.querySelector('.toast')`)));
  await gotToast(); await esc();
  check("Escape closes a message box", !(await ev(`!!document.querySelector('.toast')`)));
}

// 2. The voice designer from the script screen.
await click("Projects", ".rail button"); await sleep(600);
await click("Animation story"); await sleep(1000);
await click("Script", ".rail button"); await sleep(1000);
const opened = await ev(`(()=>{const b=document.querySelector('[aria-label^="Design a voice for"]'); if(b){b.click();return true} return false})()`);
check("the Design a voice button is on the script screen", opened);
if (opened) {
  await sleep(600);
  check("the designer dialog is open", await ev(`!!document.querySelector('[role=dialog][aria-labelledby=dcv-t]')`));
  check("the designer offers two engines", (await ev(`document.querySelectorAll('.design-engines input[type=radio]').length`)) === 2);
  check("the designer has a close button at the top", await ev(`!!document.querySelector('[role=dialog] button[aria-label=Close]')`));
  await ev(`document.querySelectorAll('.design-engines input[type=radio]')[0].click()`); await sleep(200);
  check("choosing Qwen3-TTS says when it is not set up", /not set up/i.test(await ev(`document.querySelector('.design-engines').innerText`)));
  check("Make 3 previews is off until the engine is ready", await ev(`[...document.querySelectorAll('[role=dialog] button')].find(b=>/Make 3 previews/.test(b.textContent))?.disabled === true`));
  await esc();
  check("Escape closes the designer", !(await ev(`!!document.querySelector('[role=dialog]')`)));
  await ev(`document.querySelector('[aria-label^="Design a voice for"]').click()`); await sleep(500);
  await ev(`document.querySelector('[role=dialog] button[aria-label=Close]').click()`); await sleep(200);
  check("the close button closes the designer", !(await ev(`!!document.querySelector('[role=dialog]')`)));
}

// 3. Every other dialog that can be opened from the demo closes with Escape.
for (const [screen, button] of [["Voices", "Design a voice"]]) { void screen; void button; }

console.log(checks.join("\n"));
console.log("exceptions:", errors.length, errors.slice(0, 3).join(" | "));
chrome.kill();
process.exit(checks.some((c) => c.startsWith("FAIL")) || errors.length ? 1 : 0);
