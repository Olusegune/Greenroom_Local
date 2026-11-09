# QA scripts (headless Chrome, no extra dependencies)

These drive the **browser demo build** (the mock backend in `app/src/mock.ts`, so nothing is spent and no keys are used) through the real UI with Chrome's DevTools protocol. They need Node 22+ (global `WebSocket`) and Google Chrome at `C:/Program Files/Google/Chrome/Application/chrome.exe` (edit the path at the top of a script if yours differs).

```bash
cd app && npx vite --port 5173          # leave running in one terminal
node scripts/qa/smoke.mjs               # every screen; prints "console errors / exceptions: 0" when clean
node scripts/qa/layout_check.mjs        # Voices > Casting call scrolls to the last card; writes layout1.jpg in the current folder
node scripts/qa/import_e2e.mjs <outdir> # Add portraits with real and hostile files; screenshots into <outdir>
node scripts/qa/script_e2e.mjs <outdir> # Import a script (demo Fountain sample); screenshots into <outdir>
node scripts/qa/presets_e2e.mjs <outdir> # Voice presets: genres, search, compare, readiness gate, Add to Cast; screenshots into <outdir>
```

Notes: `cdp.mjs` is a tiny helper (`node cdp.mjs steps.json`) for ad-hoc steps. The scripts click by visible button text, so a renamed button needs the script updated. If a run shows a strange "does not provide an export named ..." error right after editing code, restart `vite` (stale hot reload) and run again. Stop stray servers with `taskkill //F //IM node.exe`.

**0.12.0:** `node scripts/qa/agent_e2e.mjs <outdir>` plays a whole guided Agent Studio run (including the approved export). `node scripts/qa/a11y.mjs <outdir>` runs axe-core on twelve screens in both themes and writes `a11y.json`. `node scripts/qa/keyboard.mjs` presses Tab, Enter, Space and arrow keys through Presets and Agent Studio. `node scripts/demo/make_results_md.mjs` regenerates `docs/DEMO_RESULTS.md` from `docs/demo-results.json`; the demos themselves are built with `cd app && GREENROOM_BUILD_DEMOS=1 npx vitest run src/demo/buildDemos.spec.ts` (writes to your data folder; runs Piper).
