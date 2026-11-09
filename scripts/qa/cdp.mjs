// Tiny Chrome DevTools helper: node cdp.mjs <steps.json>. Each step: {go:url} | {eval:js} | {wait:ms} | {shot:path}
import { spawn } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

const steps = JSON.parse(readFileSync(process.argv[2], "utf8"));
const port = 9333;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--window-size=1360,900", "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-cdp-profile", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 40; i++) {
  try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch {}
  await sleep(250);
}
const page = list.find((t) => t.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); } };
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 1360, height: 900, deviceScaleFactor: 1, mobile: false });
for (const s of steps) {
  if (s.go) { await send("Page.navigate", { url: s.go }); await sleep(1500); }
  else if (s.wait) await sleep(s.wait);
  else if (s.eval) {
    const r = await send("Runtime.evaluate", { expression: s.eval, awaitPromise: true, returnByValue: true });
    console.log("eval:", JSON.stringify(r.result?.result?.value ?? r.result?.exceptionDetails?.text ?? null).slice(0, 300));
  } else if (s.shot) {
    const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 80 });
    writeFileSync(s.shot, Buffer.from(r.result.data, "base64"));
    console.log("saved", s.shot);
  }
}
ws.close();
chrome.kill();
process.exit(0);
