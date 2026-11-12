// REAL app, free path only: Voices, Design a voice, with Qwen3-TTS on this PC. Makes three previews and keeps NOTHING (no voice is saved,
// the library is not changed; unkept previews are pruned by the app). Usage: node real_design_local.mjs <debug port>
const port = Number(process.argv[2] ?? 9401);
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const send = (m, p) => new Promise((res) => { const i = ++id; ws.addEventListener("message", function f(e) { const d = JSON.parse(e.data); if (d.id === i) { ws.removeEventListener("message", f); res(d.result); } }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => (await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true })).result?.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const checks = [];
const check = (n, ok, d = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${n}${d ? " : " + d : ""}`);

await ev(`[...document.querySelectorAll('.rail button')].find(b=>b.textContent.trim().startsWith('Voices'))?.click()`); await sleep(1500);
await ev(`[...document.querySelectorAll('button,[role=tab]')].find(b=>b.textContent.trim().startsWith('Design'))?.click()`); await sleep(600);
check("the designer shows both engines", (await ev(`document.querySelectorAll('.design-engines input[type=radio]').length`)) === 2);
const t0 = Date.now();
await ev(`document.querySelectorAll('.design-engines input[type=radio]')[0].click()`);
let ready = false;
for (let i = 0; i < 20; i++) { ready = !/Checking|Not set up/.test(await ev(`document.querySelector('.design-engines').innerText`)); if (ready) break; await sleep(250); }
check("Qwen shows as ready within 5 seconds", ready, `${Date.now() - t0} ms`);
await ev(`(()=>{const t=document.querySelector('textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(t,'A calm elderly woman with a warm, slightly husky voice, speaking slowly and kindly'); t.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await sleep(300);
const enabled = await ev(`[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Make 3 previews')).map(b=>!b.disabled)[0]`);
check("Make 3 previews is on with Qwen and a description", enabled === true);
if (enabled) {
  await ev(`[...document.querySelectorAll('button')].find(b=>b.textContent.includes('Make 3 previews')).click()`);
  const start = Date.now(); let n = 0;
  while (Date.now() - start < 420000) { await sleep(5000); n = await ev(`document.querySelectorAll('.card.lit audio').length`); if (n >= 3) break; if (await ev(`!!document.querySelector('.note.err')`)) break; }
  check("three previews appear", n >= 3, `${n} players after ${Math.round((Date.now() - start) / 1000)} s`);
  check("no error is shown", !(await ev(`!!document.querySelector('.note.err')`)), await ev(`document.querySelector('.note.err')?.innerText ?? ''`));
  check("each preview can be kept (a Save button is there)", (await ev(`[...document.querySelectorAll('button')].filter(b=>b.textContent.includes('Save this voice')).length`)) >= 3);
}
console.log(checks.join("\n"));
ws.close();
