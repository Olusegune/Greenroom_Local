// A stricter sweep of the demo build: every screen, three widths, both themes, with a realistic voice library.
// It flags: broken text ("undefined", "NaN", "[object"), sideways overflow, images that did not load, buttons with no name,
// inputs with no label, text clipped inside its box, and console errors. Screenshots go in <outdir>.
// Usage: node scripts/qa/sweep.mjs <outdir>   (needs `npx vite --port 5173` running)
import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const out = process.argv[2] ?? ".";
mkdirSync(out, { recursive: true });
const port = 9447;
const chrome = spawn("C:/Program Files/Google/Chrome/Application/chrome.exe", ["--headless=new", `--remote-debugging-port=${port}`, "--hide-scrollbars", "--user-data-dir=" + process.env.TEMP + "/gr-sweep-profile", "about:blank"], { stdio: "ignore" });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let list;
for (let i = 0; i < 40; i++) { try { list = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); if (list.length) break; } catch {} await sleep(250); }
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pending = new Map(); let errors = [];
ws.onmessage = (m) => {
  const d = JSON.parse(m.data);
  if (d.id && pending.has(d.id)) { pending.get(d.id)(d); pending.delete(d.id); }
  else if (d.method === "Runtime.exceptionThrown") errors.push("EXCEPTION " + (d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text).slice(0, 200));
  else if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") errors.push("console.error " + d.params.args.map((a) => a.value ?? a.description ?? "").join(" ").slice(0, 200));
};
const send = (method, params = {}) => new Promise((res) => { const i = ++id; pending.set(i, res); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (js) => (await send("Runtime.evaluate", { expression: js, awaitPromise: true, returnByValue: true })).result?.result?.value;
const click = (t, sel = "button,a,[role=tab]") => ev(`(()=>{const b=[...document.querySelectorAll('${sel}')].find(x=>x.textContent.trim().startsWith(${JSON.stringify(t)}));if(b){b.click();return true}return false})()`);
const shot = async (name) => { const r = await send("Page.captureScreenshot", { format: "jpeg", quality: 70 }); writeFileSync(`${out}/${name}.jpg`, Buffer.from(r.result.data, "base64")); };

const fixture = JSON.parse(readFileSync(new URL("../../app/src/fixtures/voices.sample.json", import.meta.url)));
const lib = [
  ...fixture.filter((v) => v.provider === "elevenlabs").map((v) => ({ ...v, source: "account", createdAt: "" })),
  { id: "en_GB-alan-low", name: "Alan (British, male)", provider: "piper", source: "library", language: "English", accent: "British", gender: "male", notes: "", createdAt: "" },
  { id: "en_US-amy-medium", name: "Amy (American, female)", provider: "piper", source: "library", language: "English", accent: "American", gender: "female", notes: "", createdAt: "" },
];

const AUDIT = `(() => {
  const out = [];
  const vw = document.documentElement.clientWidth;
  const text = document.body.innerText;
  for (const bad of ["undefined", "NaN", "[object", "null null", "TODO", "Lorem"]) { if (text.includes(bad)) out.push("text contains " + bad); }
  if (document.documentElement.scrollWidth > vw + 2) out.push("page scrolls sideways (" + document.documentElement.scrollWidth + " > " + vw + ")");
  const main = document.querySelector("main.stage"); if (main && main.scrollWidth > main.clientWidth + 2) out.push("main area scrolls sideways (" + main.scrollWidth + " > " + main.clientWidth + ")");
  const nameless = [...document.querySelectorAll("button, [role=button], a[href]")].filter((b) => !(b.textContent || "").trim() && !b.getAttribute("aria-label") && !b.getAttribute("title") && !b.querySelector("img[alt]:not([alt=''])"));
  if (nameless.length) out.push(nameless.length + " button(s) with no name: " + nameless.slice(0, 3).map((b) => b.outerHTML.slice(0, 80)).join(" | "));
  const unlabeled = [...document.querySelectorAll("input:not([type=hidden]), select, textarea")].filter((i) => !i.getAttribute("aria-label") && !i.getAttribute("aria-labelledby") && !i.id && !i.closest("label") && !i.getAttribute("placeholder") && !i.getAttribute("title"));
  if (unlabeled.length) out.push(unlabeled.length + " input(s) with no label: " + unlabeled.slice(0, 2).map((b) => b.outerHTML.slice(0, 70)).join(" | "));
  const broken = [...document.images].filter((i) => i.complete && i.naturalWidth === 0 && i.src);
  if (broken.length) out.push(broken.length + " image(s) did not load: " + broken.slice(0, 2).map((i) => i.src.slice(-60)).join(" | "));
  const clipped = [...document.querySelectorAll("button, .badge, .chip, h1, h2, h3, label, summary")].filter((e) => e.offsetParent && e.scrollWidth > e.clientWidth + 3 && getComputedStyle(e).overflow !== "visible" && getComputedStyle(e).textOverflow !== "ellipsis");
  if (clipped.length) out.push(clipped.length + " element(s) with clipped text: " + clipped.slice(0, 3).map((e) => (e.textContent || "").trim().slice(0, 30)).join(" | "));
  const outside = [...document.querySelectorAll("main.stage *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.right > vw + 4) && getComputedStyle(e).position !== "fixed"; });
  if (outside.length) out.push(outside.length + " element(s) extend past the right edge, e.g. " + outside[0].tagName + "." + String(outside[0].className).slice(0, 30));
  return out;
})()`;

const SCREENS = ["Script", "Cast", "Perform", "Timeline", "Picture", "Export", "Studio", "History", "Presets", "Agent Studio", "Voices", "Model Center", "Engines", "SFX Studio", "Voice lab", "Settings", "Help & guide"];
const SIZES = [[1360, 900], [900, 800], [560, 900]];
const findings = [];
await send("Page.enable"); await send("Runtime.enable");
for (const theme of ["dark", "light"]) {
  for (const [w, h] of SIZES) {
    await send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false });
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(1200);
    await ev(`localStorage.clear(); localStorage.setItem('greenroom-demo-library', ${JSON.stringify(JSON.stringify(lib))}); localStorage.setItem('greenroom-theme', '${theme}')`);
    await send("Page.navigate", { url: "http://127.0.0.1:5173/" }); await sleep(1800);
    await ev(`document.documentElement.setAttribute('data-theme','${theme}')`);
    await click("Animation story"); await sleep(1000);
    for (const s of SCREENS) {
      errors = [];
      const ok = await click(s, ".rail button, nav button, button.nav");
      await sleep(700);
      if (!ok) { findings.push(`${theme} ${w}px ${s}: nav item not found`); continue; }
      const issues = await ev(AUDIT);
      for (const i of issues ?? []) findings.push(`${theme} ${w}px ${s}: ${i}`);
      for (const e of errors) findings.push(`${theme} ${w}px ${s}: ${e}`);
      if (theme === "dark" && w === 1360) await shot(s.replace(/[^A-Za-z]+/g, "_"));
    }
  }
}
writeFileSync(`${out}/sweep.txt`, findings.join("\n"));
console.log(findings.length ? findings.join("\n") : "no findings");
ws.close(); chrome.kill(); process.exit(0);
