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


## 0.12.4 (2026-11-09): fixes after the owner's report, on the other PC's 0.12.3 work

- **Voice presets, "Hear with":** the list used to show every voice on a compatible engine and pre-selected the first, so a female preset could default to a male voice (and changing the voice changed nothing about the free preview). Now each voice is compared with the preset's stated gender, age and language (`presets/match.ts`); fitting voices come first, the default is the best fit, a plain note says how the chosen voice fits (or that it does not, and that none of the library does), voices that do not fit are listed under their own heading, a language code and its name are the same language (`en` = English), the free-preview voice can be picked, and the Cast panel orders and defaults the same way. Tests use the owner's real voice library (anonymised fixture).
- **Engine installs:** every pip step now keeps a log (`Documents\Greenroom Local\logs\setup.log`), retries once or twice on a network hiccup, uses a longer pip timeout and the person's own proxy, and when it fails shows the part of the output that says why (the end, not the noise before it). **Model Center > Check my setup** (and "Find out why it failed" on the WazobiaVoice card) checks disk space, folder path length, the internet addresses the installers use (python.org, pypi, files.pythonhosted, download.pytorch.org, huggingface.co) and, for WazobiaVoice, the Hugging Face token and whether the account accepted the model terms. **Copy a report** puts those checks and the end of the log on the clipboard (no keys). `src-tauri/src/setup_check.rs`.
- **Use my own audio / add expressions** (Perform line menu): record or choose your own audio for a line and use it as it is, and add a laugh, sigh or gasp from the character's reaction library (or a clip already on the line) to it or to any take, over the speech or pausing it, with a preview. Always a new take that records what it is made of; the original is never changed. `ownAudio.ts`, `screens/OwnAudioDialog.tsx`. To change the VOICE of a recording use "Re-voice a recording" (local Chatterbox); to change how it is performed, record it again.
- **Repository gap found:** `runtime/kokoro_once.py` and `runtime/qwen_once.py` are compiled into the app (`include_str!`) but were hidden by `.gitignore` (`/runtime/*`) and never committed. `kokoro_once.py` was recovered byte-for-byte from the 0.12.2 installer; `qwen_once.py` was rebuilt in 0.12.5 (see below). Both are committed and `.gitignore` lets them through; `repoCompleteness.test.ts` fails if any `include_str!` file is missing, ignored or uncommitted.

## 0.12.5 (2026-11-09)

- **Preset voices, second cause found:** many library voices are saved with no gender (Kie, VoiceKiller, Wazobia, designed, cloned), so they could not be checked and one was auto-picked; the free preview also fell back to any local voice. Now a voice that does not fit is never picked for the owner (the card says none fits), the free preview only uses a fitting voice, and a chosen voice with no gender shows "It is male / It is female" buttons that save the answer to the library.
- **Qwen3-TTS rebuilt and tested on a real PC** (`runtime/qwen_once.py`, reconstructed from the installed `qwen-tts 0.1.1` API): model download (3.8 GB) now runs in a child process that is restarted if nothing arrives for 90 seconds (the plain download stalled twice on this PC), uses `hf_xet` (installed on demand), and the model is then loaded from its local folder so running needs no internet. Verified: first line 2.72 s of 24 kHz mono 16-bit audio; a second voice with `HF_HUB_OFFLINE=1` 2.8 s in 25 s. `qwen_speak` now keeps the worker's error output, writes it to the setup log and shows the cause.
- **Inworld:** the voice list shows in Voices > Casting call without choosing a language, and Settings > Inworld has "Add all my Inworld voices to my library".
- **Perform line card decluttered:** quick styles fold away, summary boxes became pills showing only what is set, presets and sliders in one row, Compare takes next to Another take, shorter notices.
- **Checks:** 971 JavaScript tests, 129 Rust tests (3 ignored), clippy clean, `rafter secrets` clean, `npm audit` 0 vulnerabilities, `cargo audit` 6 allowed warnings (unchanged). `rafter run` was not run (out of quota).
- **Not checked:** the installed app was not clicked through; the in-app Qwen Set up button was not pressed (the worker was tested directly with the app's runtime); Inworld not tried with a real account; the Perform layout was type-checked but not viewed; nothing judged by ear; installers unsigned.

## 0.12.6 (2026-11-09)

- **Kokoro would not install** ("metadata-generation-failed", seen in the owner's screenshot and in `logs\setup.log`, three times): Kokoro needs `docopt`, a source-only package whose legacy `setup.py` cannot run inside the embedded Python. The package installer step now passes `--use-pep517`. Verified on the owner's Kokoro runtime: `docopt` fails to build without the flag and builds with it, and the full `kokoro==0.9.4` resolve got past metadata into installing (stopped only by a file locked by the running app). Kokoro was not completed or heard end to end.
- **Qwen3-TTS is now marked Ready** in Model Center: the in-app setup (runtime, model and test line, voices) completed on the owner's PC, and the worker was tested directly (valid audio, also offline). Not heard by ear.
- Unrelated: the "Credential Pool Status" console window seen during setup is the Hermes tool's `hermes auth` menu, not Greenroom.
- Tests: 971 JavaScript passed (1 skipped); clippy clean and 129 Rust tests passed on the code before the one-line installer change.

## 0.12.7 and 0.12.8 (2026-11-09)

- **Chatterbox and WazobiaVoice never spoke** ("Chatterbox could not generate this line"). Reproduced on the owner's PC with the real Wazobia model: the released `chatterbox-tts 0.1.7` has no `t3_model` option (the worker always passed it, so every Chatterbox line failed, default voice included) and refuses Yoruba, Hausa and Igbo. `runtime/chatterbox_once.py` now loads the model file the folder really has (v2 for Wazobia, v3 for Chatterbox V3) and allows those three languages for Wazobia. Verified, each a valid WAV: default V3 voice (39 s), Wazobia English (62 s), Yoruba (30 s), Hausa (29 s), Igbo (39 s), on the CPU. Not heard by ear. `runtime/chatterbox_server.py` (legacy local server) has the same old option and was not changed. `chatterbox_run` now keeps the worker's error output, shows it and writes it to the setup log.
- **Six of 21 Piper voices never spoke** (Amy, Thorsten, Siwis, KSS, Cadu, Tsync2): newer `rhasspy/piper-voices` configs list diphthongs ("aɪ", "eɪ") as multi-letter phoneme keys, which the installed Piper (2023.11.14-2) rejects ("not a single codepoint"). `local::sanitize_voice_config` drops those keys before every speak (idempotent, atomic, covers voices already installed). Verified with the real Piper on all six (2.5 to 3.3 s of audio each); the unmodified Amy file still fails, confirming the cause. Not heard by ear: Piper reads each diphthong as its two single sounds, which should be intelligible but is a change from how the newest files were trained.
- **Kokoro** verified end to end on the real runtime (American and British voices, 11 s each) and Model Center now marks it Ready; Qwen3-TTS likewise (0.12.6).
- **Preset card redesigned:** one line of facts under the name, a two-line description, accent (and a warning chip only when experimental) plus status, one voice picker with a one-line fit note (a quiet tick when it fits), Audition / Free preview, a full-width Add to Cast, and everything else (works on, free preview voice, audition text, Compare, listening test, duplicate, remove) under "More". Checked in a real browser (demo build): voices QA and the full presets QA pass, no console errors.
- **Not installed on the owner's PC, so not tested:** the sound-effects model (Stable Audio Open Small, runtime present, weights missing) and ACE-Step music (not installed). Their status stays "Installed, not Ready".
- Checks: 971 JavaScript tests, 130 Rust tests (3 ignored), clippy clean, `rafter secrets` clean.

## 0.13.0 (2026-11-10): casting integrity

- **Casting rules** are covered by `app/src/casting/*.test.ts` (examples, 3,000 random character-and-voice pairs, 1,500 random attempts to change approved voices, hostile saved files, the L2-ARCTIC speaker map against the model's own file). 1,067 JavaScript tests, 130 Rust tests, clippy clean, `npm audit` 0, `cargo audit` 6 allowed warnings, secret scan clean.
- **Real audio**: the six-character acceptance run (`docs/acceptance-results.json`) with real Piper and Kokoro. Three characters cast and spoke; three correctly not cast (no suitable voice installed). Every take verified against the approved voice, character, file hash and manifest. Mix -18.8 LUFS at -1.0 dBTP, measured with ffmpeg.
- **Real app**: the built exe was started and its window looked at; `scripts/qa/real_app_readonly.mjs` drove every screen read-only against the real library (17 voices): no errors.
- **Browser runs**: smoke, presets, presets with voices, own audio, sweep, script and picture import, agent, keyboard, setup, casting, accessibility. Three out-of-date tests were updated; layout defects found and fixed (stretching cards, unstyled inputs, clipped list items).
- **Not checked**: nothing judged by ear; no project opened, no voice approved and no take generated in the real app by a test; WazobiaVoice, sound effects, ACE-Step and every cloud engine not run; screen reader, zoom and high contrast not tested; `rafter run` not run.
