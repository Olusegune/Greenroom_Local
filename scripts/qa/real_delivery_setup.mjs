// REAL app, free path only: creates ONE throwaway project ("ZZ Delivery test") with real Piper audio takes, so a delivery export can be
// run on it without touching any of the owner's projects. Delete the folder Documents\Greenroom Local\projects\zz-delivery-test afterwards (the app has no delete command).
// Usage: node real_delivery_setup.mjs <debug port> [delete]
const port = Number(process.argv[2] ?? 9411);
const del = process.argv[3] === "delete";
const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const ws = new WebSocket(list.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const send = (m, p) => new Promise((res) => { const i = ++id; ws.addEventListener("message", function f(e) { const d = JSON.parse(e.data); if (d.id === i) { ws.removeEventListener("message", f); res(d.result); } }); ws.send(JSON.stringify({ id: i, method: m, params: p })); });
const ev = async (x) => { const r = await send("Runtime.evaluate", { expression: x, returnByValue: true, awaitPromise: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval failed"); return r.result?.value; };
const PID = "zz-delivery-test";

if (del) {
  console.log(await ev(`window.__TAURI_INTERNALS__.invoke('project_delete', { id: '${PID}' }).then(()=> 'deleted', e => 'ERR ' + e)`));
  ws.close(); process.exit(0);
}

const out = await ev(`(async () => {
  const inv = window.__TAURI_INTERNALS__.invoke;
  const lib = JSON.parse(await inv('library_load').then(x => typeof x === 'string' ? x : JSON.stringify(x)));
  const pip = (Array.isArray(lib) ? lib : lib.voices ?? []).filter(v => v.provider === 'piper');
  if (pip.length < 2) return 'NEED 2 PIPER VOICES, found ' + pip.length;
  const [v1, v2] = pip;
  const now = new Date().toISOString();
  const texts = [
    ['a', 'Good evening to you. I hope the road was kind.'],
    ['b', 'It was long, and the rain never stopped.'],
    ['a', 'Then sit by the fire and tell me everything.'],
    ['b', 'There is not much to tell, only a name.'],
  ];
  const wavSeconds = (b64) => { const bin = atob(b64.slice(0, 64)); const u = (i) => bin.charCodeAt(i) | (bin.charCodeAt(i+1) << 8) | (bin.charCodeAt(i+2) << 16) | (bin.charCodeAt(i+3) << 24); const br = u(28); const total = Math.floor(b64.length * 3 / 4) - 44; return br > 0 ? total / br : 1.5; };
  const lines = [];
  for (const [k, [who, text]] of texts.entries()) {
    const v = who === 'a' ? v1 : v2;
    const clip = await inv('run_clip', { req: { provider: 'piper', text, voice: v.id, speed: 1 } });
    const tid = 'zz-take-' + (k + 1);
    await inv('take_write', { project: '${PID}', take: tid, ext: 'wav', audioB64: clip.audioB64 });
    lines.push({ id: 'zz-l' + (k + 1), characterId: 'zz-' + who, scene: 1, text, direction: { emotion: '', note: '', sounds: [], speed: 1, pauseAfter: 0.4 }, takes: [{ id: tid, at: now, model: 'piper', ext: 'wav', voiceId: v.id, sent: text, seconds: Math.round(wavSeconds(clip.audioB64) * 100) / 100 }], chosen: tid, events: [] });
  }
  const approval = (v) => ({ voiceId: v.id, engine: 'piper', voiceName: v.name, modelId: null, speakerId: null, approvedAt: now, version: 1, basis: 'NEEDS_AUDITION', acknowledged: [], by: 'owner' });
  const project = {
    version: 1, id: '${PID}', name: 'ZZ Delivery test', script: texts.map(([w, t]) => (w === 'a' ? 'ADA: ' : 'BEN: ') + t).join('\\n'), scenes: ['Intro', 'Opening'],
    characters: [
      { id: 'zz-a', name: 'Ada', language: 'English', voiceId: v1.id, casting: { version: 1, history: [], approval: approval(v1) } },
      { id: 'zz-b', name: 'Ben', language: 'English', voiceId: v2.id, casting: { version: 1, history: [], approval: approval(v2) } },
    ],
    lines, bed: { prompt: '', volume: 0.25 }, gap: 0.4, pronunciations: [], createdAt: now, updatedAt: now,
  };
  await inv('project_save', { id: '${PID}', json: JSON.stringify(project) });
  return 'created with ' + lines.length + ' real Piper takes: ' + v1.name + ' / ' + v2.name;
})()`);
console.log(out);
ws.close();

