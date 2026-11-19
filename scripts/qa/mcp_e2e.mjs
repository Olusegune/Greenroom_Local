// The MCP server of the REAL built app, driven by a real MCP client (plain HTTP JSON-RPC). Spends nothing: it runs local-only.
// How: start the exe with WebView2 remote debugging and a separate profile (see docs/HANDOVER.md), then
//   node scripts/qa/mcp_e2e.mjs <debug port> [path of a script file]
// It turns the server on through the Settings screen, makes a throwaway project called "zz mcp test" (delete its folder afterwards:
// the app has no delete command) and turns the server off again.
import { readFileSync } from "node:fs";
import { connect, sleep, H } from "./real_app_lib.mjs";

const port = Number(process.argv[2] ?? 9355);
const scriptPath = process.argv[3] ?? new URL("../../docs/samples/the-wrong-department.md", import.meta.url);
const script = readFileSync(scriptPath, "utf8");
const c = await connect(port);
const h = H(c);
const checks = [];
const check = (name, ok, detail = "") => checks.push(`${ok ? "ok  " : "FAIL"} ${name}${detail ? " : " + detail : ""}`);
const URL_ = "http://127.0.0.1:47821/mcp";

// off by default: nothing listens
let refused = false;
try { await fetch(URL_, { method: "POST", signal: AbortSignal.timeout(1500) }); } catch { refused = true; }
check("off by default: nothing is listening", refused);

// turn it on the way the owner would
await h.nav("Settings"); await sleep(1500);
check("Settings has the MCP card", (await h.text()).includes("Let other AI agents use Greenroom"));
await h.click("Turn on"); await sleep(1500);
check("the card says On", (await h.text()).includes("Listening at http://127.0.0.1:47821/mcp"));
const token = await c.ev(`window.__TAURI_INTERNALS__.invoke('mcp_token_reveal')`);
check("a token of 48 hex characters exists", /^[0-9a-f]{48}$/.test(token));

const rpc = async (body, headers = {}) => {
  const r = await fetch(URL_, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...headers }, body: JSON.stringify(body) });
  const t = await r.text();
  return { status: r.status, json: t ? JSON.parse(t) : null };
};
const tool = async (name, args = {}) => {
  const r = await rpc({ jsonrpc: "2.0", id: Math.floor(Math.random() * 1e6), method: "tools/call", params: { name, arguments: args } });
  const text = r.json?.result?.content?.[0]?.text ?? "";
  let value = text;
  try { value = JSON.parse(text); } catch { /* an error message */ }
  return { isError: !!r.json?.result?.isError, error: r.json?.error, value, status: r.status };
};

// refused callers
const noTok = await fetch(URL_, { method: "POST", body: "{}" });
check("no token is refused (401)", noTok.status === 401);
const badTok = await fetch(URL_, { method: "POST", headers: { authorization: "Bearer " + "0".repeat(48) }, body: "{}" });
check("a wrong token is refused (401)", badTok.status === 401);
const evil = await rpc({ jsonrpc: "2.0", id: 1, method: "ping" }, { origin: "https://evil.example" }).catch((e) => ({ status: 0, e }));
check("a web page's Origin is refused (403)", evil.status === 403, String(evil.status));

// a session
const init = await rpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-03-26", capabilities: {}, clientInfo: { name: "mcp_e2e", version: "1" } } });
check("initialize answers with the server name and version", init.json?.result?.serverInfo?.name === "greenroom-local" && /^\d+\.\d+\.\d+$/.test(init.json.result.serverInfo.version), init.json?.result?.serverInfo?.version);
const list = await rpc({ jsonrpc: "2.0", id: 2, method: "tools/list" });
const names = (list.json?.result?.tools ?? []).map((t) => t.name);
check("tools/list has the tools and none that approve, spend or deliver", names.length >= 10 && !names.some((n) => /approve|deliver|export|spend/.test(n)), names.join(","));

const st = await tool("greenroom_status");
check("greenroom_status reports the version and key NAMES only", st.value?.app === "Greenroom Local" && Array.isArray(st.value.cloudKeysSaved) && !JSON.stringify(st.value).match(/[A-Za-z0-9]{32,}/), JSON.stringify(st.value).slice(0, 160));

const bad = await tool("create_project", { name: 5 });
check("a wrong argument is refused before anything runs", bad.error?.code === -32602, JSON.stringify(bad.error));
const unknown = await tool("approve_cast", {});
check("there is no approve tool", unknown.error?.code === -32602);

// make and run a production from a script
const created = await tool("create_project", { name: "zz mcp test", script });
const proj = created.value?.project;
check("create_project makes the project from the script", proj?.open === true && proj.lines === 55 && proj.soundCues === 9 && proj.characters?.length === 4, JSON.stringify(proj ?? created.value).slice(0, 200));
check("the app window shows that project", (await h.text(".rail")).toLowerCase().includes("zz mcp test"));

const noPlan = await tool("get_production_status");
check("before planning, status says nothing is planned", noPlan.value?.planned === false);

const planned = await tool("plan_production", { brief: "Make this a podcast with stems. Keep it local.", mode: "guided", local_only: true });
check("plan_production returns the planned steps", planned.value?.planned === true && planned.value.steps?.length >= 8, `${planned.value?.steps?.length} steps`);
check("the plan is local-only with no spending", planned.value?.localOnly === true && planned.value.cloudLimit === 0 && planned.value.spent === 0);

const ran = await tool("run_production");
const rv = ran.value;
check("run_production returns (does not hang) with a status", ran.status === 200 && rv && typeof rv === "object" && Array.isArray(rv.steps), JSON.stringify(rv).slice(0, 120));
check("it spent nothing", rv?.spent === 0);
check("voice approval is left to the person", (rv?.waitingForThePerson ?? []).some((w) => /voice-rights/.test(w.because)) || (rv?.steps ?? []).every((s) => !/Approve and lock the cast/.test(s.title) || s.status !== "completed"), JSON.stringify(rv?.waitingForThePerson));
check("the final delivery is not done by the agent", (rv?.steps ?? []).every((s) => !/Export the full scene/.test(s.title) || s.status !== "completed"));

const got = await tool("get_project");
check("get_project reflects the run", got.value?.open === true && got.value.production?.planned === true);
const todo = await tool("get_listening_todo");
check("get_listening_todo reports no verdicts (only the owner makes them)", todo.value?.summary?.heard === 0 && Array.isArray(todo.value.todo) && todo.value.todo.length === 0);

check("the app has no cost sheet left open and shows no error", !(await c.ev(`!!document.querySelector('.scrim')`)) && c.logs.length === 0, c.logs.join(" | "));

// off again
await h.nav("Settings"); await sleep(1200);
await h.click("Turn off"); await sleep(1500);
let closed = false;
try { await fetch(URL_, { method: "POST", signal: AbortSignal.timeout(1500) }); } catch { closed = true; }
check("turning it off stops the server", closed);

console.log(checks.join("\n"));
console.log(`${checks.filter((x) => x.startsWith("ok")).length} ok, ${checks.filter((x) => x.startsWith("FAIL")).length} failed`);
process.exit(0);
