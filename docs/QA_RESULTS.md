# QA results: 0.11.0 (2026-11-09)

Branch `feat/agent-studio-presets`. Windows 11, Node 24, Rust 1.98. All figures below are from runs made on this date.

## Automated

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx vitest run` | **840 passed**, 71 files (708 before this work) |
| `cargo test` | **121 passed**, 1 ignored |
| `cargo clippy --all-targets -- -D warnings` | Clean (one lint fixed) |
| `rafter secrets .` | No secrets detected |
| Key-format scan of tracked files | Nothing found |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `cargo audit` | 0 vulnerabilities, 6 allowed warnings (Tauri's Linux stack, as before) |
| `npx tauri build` | NSIS installer and MSI built; the updater signature step reports no private key, as expected (no key exists yet) |
| Built app starts | The portable exe launched, stayed running 8 seconds and showed its window "Greenroom Local" |

New tests by area: presets 28 (schema, exactly 120 unique ids, genre counts, no unverified claims, search, readiness gate, import/export, state, casting), performance compiler 45, agent 59 (planning, approval checkpoints, budget, local-only, consent, interruption and resume, retry rules, selective regeneration, replanning, quality check, brief reading, hostile saved runs, backward compatibility), security 12.

## Headless Chrome against the demo backend (nothing spent, no keys)

| Script | Result |
|---|---|
| `scripts/qa/smoke.mjs` (every screen, Perform tabs, spend sheet, Export) | All steps ok, 0 console errors |
| `scripts/qa/presets_e2e.mjs` | 19 of 19 checks, 0 console errors |
| `scripts/qa/agent_e2e.mjs` | 19 of 19 checks, 0 console errors: brief reading, local-only refusal, plan update keeping finished steps, a full guided run through every checkpoint, delivery still waiting, audit log, Undo |

## What was not checked (read this)

- **No real audio.** No engine was run and no take was generated in any of this. The five demonstration projects were not made as real generation. Template projects exist.
- **Nothing was judged by ear**: no voice, accent, preset, tag (`[chuckles]`, `[menacing]`), pause or acting result.
- **No live provider call** (ElevenLabs, Inworld, OpenAI, Gemini, Kie, VoiceKiller). Paid calls are against project rules for testing; the Agent Studio was exercised with fake engines and the demo backend. The real cost sheet versus a provider bill is unconfirmed.
- The installed build was **started but not clicked through**. Its screens were checked only in a browser build.
- **Not checked at all:** installer upgrade over an older install, uninstall, Windows SmartScreen behaviour (installers are unsigned), screen readers and contrast, keyboard navigation beyond native controls, high-DPI scaling, `rafter run` (remote scan, no quota), a penetration test.
- Behaviour not built (see `FEATURE_AUDIT.md`): per-accent listening tests, character profile import/export, agent-made audio for ambience and effects, agent export (it prepares and checks only), a Venomspur preset.
- Real-machine local engine runs (Piper, Chatterbox, Wazobia, local Director, music, effects) were **not repeated**; their status is carried from earlier audits.
