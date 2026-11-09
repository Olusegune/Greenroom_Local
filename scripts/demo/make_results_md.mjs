// Writes docs/DEMO_RESULTS.md from docs/demo-results.json (produced by app/src/demo/buildDemos.spec.ts), so the numbers are the
// recorded ones and never typed by hand.   node scripts/demo/make_results_md.mjs
import { readFileSync, writeFileSync } from "node:fs";
const root = new URL("../../", import.meta.url);
const j = JSON.parse(readFileSync(new URL("docs/demo-results.json", root), "utf8"));
const L = [];
L.push("# Demonstration projects", "");
L.push(`Built ${j.builtAt.slice(0, 10)} with Greenroom ${j.appVersion}. Generated from \`docs/demo-results.json\` by \`scripts/demo/make_results_md.mjs\`; the builder is \`app/src/demo/buildDemos.spec.ts\` (guarded: it runs only with \`GREENROOM_BUILD_DEMOS=1\`).`, "");
L.push("## What is real and what is not", "");
L.push("- **Real:** the Agent Studio's own planner, steps, quality check and export ran headlessly in **local-only** mode with a spending limit of **zero**. The only engine was **Piper**, called directly with the same binary, voice files and arguments the app's Piper route uses. Every take is real Piper inference, saved in the app's project format under `Documents\\Greenroom Local\\projects\\demo-*`, so the projects open in Greenroom.");
L.push("- **Verified independently:** each exported WAV was checked with ffprobe and ffmpeg's EBU R128 meter, and the figures matched the app's own report.");
L.push("- **Not real:** the delivery approval was given by the build script standing in for a person (the audit log says so). **Nothing was judged by ear.** No cloud engine was called, no key was read, nothing was spent.");
L.push("- **Stand-ins:** only four Piper voices exist here (two British or Scottish, two American). Piper cannot act on written direction, play laughs or coughs, hold a timed pause, or do children's, Nigerian, Yoruba, Igbo or Hausa voices. So those behaviours are listed below as **not sent**, the child character is voiced by an adult, and the Nigerian family drama is **not rendered at all**.", "");
for (const d of j.results) {
  L.push(`## ${d.name}`, "");
  if (!d.rendered) {
    L.push("**Planned, not rendered.**", "", d.blocked, "");
    L.push(`${d.characters} characters and ${d.lines} lines are cast on your own ElevenLabs library voices, with a Guided run planned (cloud limit 3). Open it in Agent Studio to see the estimate and start it yourself; nothing was generated or spent.`, "");
    continue;
  }
  L.push(`| | |`, `|---|---|`, `| Engine | ${d.engine} |`, `| Characters, lines, takes | ${d.characters}, ${d.lines}, ${d.takes} |`, `| Speech made | ${d.seconds} s |`, `| Average take loudness | ${d.lufs} LUFS |`, `| Spent | ${d.spent} |`);
  if (d.export) L.push(`| Exported scene | ${d.export.seconds} s, ${d.export.lufs} LUFS, true peak ${d.export.truePeakDb} dBTP |`, `| SHA-256 of the export | \`${d.export.sha256.slice(0, 16)}…\` |`);
  L.push(`| Audio check | ${d.qc.problems} problem${d.qc.problems === 1 ? "" : "s"}, ${d.qc.listen} to listen to |`, "");
  L.push("Steps: " + Object.entries(d.steps).filter(([k]) => !k.startsWith("take:")).map(([k, v]) => `${k} ${v}`).join(", ") + `, ${Object.keys(d.steps).filter((k) => k.startsWith("take:")).length} takes ${Object.entries(d.steps).filter(([k]) => k.startsWith("take:")).every(([, v]) => v === "completed") ? "completed" : "not all completed"}.`, "");
  if (d.notSent.length) L.push("**Asked for, not sent (Piper cannot do these):**", "", ...d.notSent.map((n) => `- ${n}`), "");
  else L.push("Nothing was asked for that Piper cannot do.", "");
  if (d.qc.sample.length) L.push("Audio-check findings:", "", ...d.qc.sample.map((n) => `- ${n}`), "");
  if (d.verified) L.push("Checked on disk after writing:", "", ...d.verified.map((n) => `- ${n}`), "");
}
L.push("## Honest summary", "");
L.push("Four of five demos exercise real generation, casting, direction, a quality check and export end to end on local hardware. They do **not** show how the acting sounds on an engine that can act (ElevenLabs, Inworld), how any accent sounds, or the cloud path. Those need your keys and your ears. The Venomspur and fantasy-RPG demos deliberately carry acting that Piper cannot perform, so the not-sent list and the audio check are exercised for real.");
writeFileSync(new URL("docs/DEMO_RESULTS.md", root), L.join("\n") + "\n");
console.log("written");
