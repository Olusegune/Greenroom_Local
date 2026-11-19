// Helper for driving the REAL built app (see docs/HANDOVER.md, "How to test the REAL app"). connect(port) -> {ev, send, shot, logs}; H(c) -> {nav, click, clickStarts, setText, text, buttons}.
// Beware: in strings you evaluate in the page, avoid backslashes (use String.fromCharCode(10) for newlines).
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export async function connect(port = 9343) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const pend = new Map(); const logs = [];
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); }
    else if (d.method === "Runtime.exceptionThrown") logs.push("EXC " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 400));
    else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") logs.push("console.error " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 300)); };
  const send = (method, params = {}) => new Promise((res) => { const i = ++id; pend.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
  await send("Runtime.enable"); await send("Page.enable");
  const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.result?.exceptionDetails) return "EVALERR " + (r.result.exceptionDetails.exception?.description ?? "").slice(0, 300); return r.result?.result?.value; };
  const shot = async (p) => { const r = await send("Page.captureScreenshot", { format: "png" }); (await import("node:fs")).writeFileSync(p, Buffer.from(r.result.data, "base64")); };
  return { ev, send, shot, logs, close: () => ws.close() };
}
export const H = (c) => ({
  nav: (t) => c.ev(`(()=>{const b=[...document.querySelectorAll('.rail button.nav')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)}));if(b)b.click();return !!b})()`),
  click: (t, scope = "main.stage") => c.ev(`(()=>{const b=[...document.querySelectorAll('${scope} button')].find(x=>x.textContent.trim()===${JSON.stringify(t)});if(b)b.click();return !!b})()`),
  clickStarts: (t, scope = "main.stage") => c.ev(`(()=>{const b=[...document.querySelectorAll('${scope} button')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)}));if(b)b.click();return !!b})()`),
  setText: (sel, v) => c.ev(`(()=>{const t=document.querySelector(${JSON.stringify(sel)});const p=t.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(p,'value').set.call(t,${JSON.stringify(v)});t.dispatchEvent(new Event('input',{bubbles:true}));return t.value.length})()`),
  text: (sel = "main.stage") => c.ev(`document.querySelector(${JSON.stringify(sel)})?.innerText`).then((t) => (t ?? "").split(String.fromCharCode(10)).join(" | ")),
  buttons: (sel = "main.stage") => c.ev(`[...document.querySelectorAll('${sel} button')].map(b=>b.textContent.trim().slice(0,40)+(b.disabled?'(off)':'')).filter(Boolean).join(' || ')`),
});
