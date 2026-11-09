# QA results: 0.12.0 (2026-11-09)

Branch `feat/agent-studio-presets`. Windows 11, Node 24, Rust 1.98, RTX 3060 12 GB. All figures are from runs made on this date.

## Automated

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx vitest run` | **909 passed**, 1 skipped, 79 files (708 before this work). The skipped test is the demo builder, which writes to your data folder and so runs only on request |
| `cargo test` | **121 passed**, 1 ignored |
| `cargo clippy --all-targets -- -D warnings` | Clean (one Rust 1.98 lint fixed) |
| `rafter secrets .` | No secrets detected |
| Key-format scan of tracked files | Nothing found |
| `npm audit --omit=dev` | 0 vulnerabilities (axe-core is a development-only dependency) |
| `cargo audit` | 0 vulnerabilities, 6 allowed warnings (Tauri's Linux stack, as before) |
| `rafter run` (remote scan) | **Not run:** this PC has no Rafter API key configured. Earlier it was out of quota. Needs your key |
| `npx tauri build` | NSIS installer and MSI built; the updater signature step reports no private key, as expected |

New tests by area: presets 28, portraits 13, directed audition 6, accent listening tests 15, character profile 14, performance compiler 45, agent 100+ (planning, gates, budget, local-only, consent, resume, retry rules, regeneration, replanning, quality including loudness, ducking, sync and flat-top clipping, audition, sound, export, hostile saved runs, backward compatibility), security 12.

## Headless Chrome against the demo backend (nothing spent, no keys)

| Script | Result |
|---|---|
| `scripts/qa/smoke.mjs` (every screen, Perform tabs, spend sheet, Export) | All steps ok, 0 console errors |
| `scripts/qa/presets_e2e.mjs` | 19 of 19 checks, 0 console errors |
| `scripts/qa/agent_e2e.mjs` | All checks ok, 0 console errors: brief reading, local-only refusal, plan update, a full guided run through every checkpoint, delivery waiting, approval then a real mix and write of the scene |
| `scripts/qa/a11y.mjs` (axe-core, WCAG 2.1 A and AA, 12 screens, dark and light) | **0 violations.** It first found 108 light-theme colour-contrast failures (white text on a light green, a muted grey at 4.1:1, a bright-green label, tag chips); all fixed at the source. See `ACCESSIBILITY.md` |
| `scripts/qa/keyboard.mjs` (real Tab, Enter, Space and arrow keys) | All checks ok: every control reachable, no focus trap, a visible focus indicator on every control, Enter and Space activate buttons, arrow keys move between the three agent modes |

## Real local audio (the demonstration projects)

Four demo projects were rendered with **real Piper inference** on this PC (four voices downloaded with your permission, checksum-verified), driven by the Agent Studio's own plan, steps, quality check and export in local-only mode with a spending limit of zero. Each exported scene was checked **independently with ffprobe and ffmpeg's EBU R128 meter**:

| Demo | Exported | Integrated loudness | Peak |
|---|---|---|---|
| Venomspur | 37.8 s, 24-bit 48 kHz stereo | -16.0 LUFS | -2.9 dBFS |
| Children's adventure | 38.8 s | -16.0 LUFS | -1.8 dBFS |
| Fantasy RPG | 41.2 s | -16.0 LUFS | -2.4 dBFS |
| Science explainer | 39.9 s | -16.2 LUFS | -1.0 dBFS |

Each demo was also re-read from disk: every character has a library voice, a profile and a portrait, every take file matches its recorded SHA-256, and the saved agent run reads back through the strict reader. Details and the not-sent lists: `DEMO_RESULTS.md`. Running the demo builder also found and fixed two real defects the mocks had hidden (see `DECISIONS.md` D-58).

## What was not checked (read this)

- **Nothing was judged by ear.** Whether any take, acting direction, tag (`[chuckles]`, `[menacing]`), accent or preset sounds right is for you to listen to. All accents remain labelled unverified or experimental; no listening review has been recorded.
- **No cloud engine was called and no key was read.** ElevenLabs, Inworld, VoiceKiller, Kie, OpenAI and Gemini were not exercised. The Nigerian family drama demo is planned but **not rendered**: Piper has no Nigerian, Yoruba, Igbo or Hausa voices and a stand-in accent would mislead.
- Piper cannot act, play sounds or hold pauses, so the demos show those behaviours as **not sent**, not as performed. The child character in the children's demo is voiced by an adult stand-in.
- The harness approved the delivery gate in place of a person.
- The installed program was started but **not clicked through**; the same screens were checked in a browser build. Upgrade over an older install and uninstall were not tested.
- **Accessibility:** automated and keyboard checks only. No screen reader (NVDA, JAWS, Narrator), no high-contrast mode, no zoom or reduced-motion check, no switch device, and axe finds only a share of real problems.
- Installers are unsigned (SmartScreen will warn) and there is no updater key. `rafter run` has not been run.
- **Not built:** whole-scene re-voice (it needs a source performance and a target reference recording for every character, which a single scene does not have; single-line re-voice on Perform is unchanged), agent-made music, and Piper has no way to carry the acting direction.
- Real-machine runs of the other local engines (Chatterbox, Wazobia, Kokoro, local Director, music, effects) were **not repeated**; their status is carried from earlier audits.
