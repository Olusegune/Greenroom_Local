# Handover note: Greenroom Local (for a Claude agent on another PC)

## Update at 0.13.0 (2026-11-10): casting integrity, built on the other PC's 0.12.8

New code in `app/src/casting/` (types, voice profiles with provenance, requirements, the matching engine, the approval lock and generation guard, validated persistence, auto-cast, script reading, expression matrix, audition scripts) and screens `CastingPanel.tsx`, `VoiceReview.tsx`, `genreArt.tsx`. Every voice change goes through `assignVoice` (hook `useCasting`); `generate.ts` takes `opts.casting` and refuses a voice that is not the approved one. The agent has a new step `approve_cast` (gate `rights`, never automatic). Read `docs/CASTING_INTEGRITY_AUDIT.md` first, then `docs/CASTING_MATCH_ENGINE.md`. QA: `scripts/qa/casting_e2e.mjs`, `scripts/qa/real_app_readonly.mjs` (drives the REAL built exe read-only through WebView2 remote debugging), `app/src/demo/acceptance.spec.ts` (`GREENROOM_ACCEPTANCE=1`, real Piper and Kokoro). Gate at 0.13.0: 1,067 JavaScript and 130 Rust tests. Still nothing judged by ear; the Yoruba, child and teen characters of the acceptance run need voices that are not installed on this PC. Note for the build traps: this build was made once, in the foreground, with no other node or cargo process running.


Written 2026-11-10 at version **0.12.8**. Read this first, then `CLAUDE.md` (project rules), `DECISIONS.md` (D-1 to D-51) and `docs/QA_RESULTS.md` (what was checked in each release, newest at the bottom). The owner is Victor Edun (git user "Victor Edun", GitHub account **Olusegune**). They do **not** use a terminal: everything is done in the app window, and what they receive is a built installer in a versioned Desktop folder. Everything in this note was checked against the live repository and the owner's PC on the day it was written; anything not checked says so.

## 1. Get the code (git): verified facts

| Item | Value |
|---|---|
| Repo | https://github.com/Olusegune/Greenroom_Local (remote `origin`) |
| Working branch | **`feat/agent-studio-presets`**. HEAD **`902431a`** ("0.12.8: Chatterbox/Wazobia worker fixed, six Piper voices fixed, Kokoro Ready, calmer preset cards"). Local and `origin/feat/agent-studio-presets` were **identical** and the working tree was **clean** when this was written. |
| Recent history | `902431a` 0.12.8, `bc56108` 0.12.6 (Kokoro install fix, Qwen Ready), `f78109c` 0.12.5, `beba963` embedded-file guard test, `c020f60` 0.12.4, `4f1c59b` Qwen (0.12.3, from the other PC), `4bd4238` Kokoro (0.12.2), `d9bece9` 0.12.1. |
| `main` | **Stale.** `origin/main` is 0 commits ahead of the working branch and the working branch is **62 commits ahead of it**. No pull request is known to be open (the `gh` CLI was never signed in here). Open one at https://github.com/Olusegune/Greenroom_Local/pull/new/feat/agent-studio-presets when the owner wants to merge. |
| Other remote branches | `feat/cinematic-engine-2` (the older line; this branch is built on top of it), `feat/written-direction-perform-ui` (old, ignore) |
| Second remote | `rc` = https://github.com/Olusegune/GreenRoomRelease-Candidtate.git (a release-candidate repo; **do not push to it unless asked**) |
| Size | About 320 MB `.git` (172 portrait masters are tracked in `avatars/masters/`). A clone takes a minute. |

```bash
git clone https://github.com/Olusegune/Greenroom_Local.git
cd Greenroom_Local
git checkout feat/agent-studio-presets
git log --oneline -3        # expect 902431a (or later) on top
```

- Push rights: sign in to GitHub as a user who can push to `Olusegune/Greenroom_Local` (Git Credential Manager prompts on the first push). The owner has asked for a push after each version.
- Commit messages end with `Co-Authored-By: Claude <model> <noreply@anthropic.com>` (use the attribution your own session tells you to). Never skip hooks.
- Git prints "LF will be replaced by CRLF" warnings on Windows; harmless.
- **If this PC already has its own untracked `runtime/qwen_once.py`** (the other PC had one that was never committed), move it aside before `git pull`; git refuses to overwrite an untracked file. The committed worker is a rebuilt, tested one (see section 6); it replaces the old one.
- The git GitHub **MCP connector** in the Claude desktop app failed to connect ("Authorization header is badly formatted") on the PC that wrote this note, so all git work was done with the plain `git` CLI.

## 2. Tools needed

Windows 10/11, **Node 22+** (24 used), **Rust stable** with the MSVC toolchain + Visual Studio Build Tools, **WebView2**, **Python 3** (only for `scripts/build_avatars.py` with Pillow and for ad-hoc checks), **Google Chrome** (only for the headless QA scripts). `npx tauri build` downloads NSIS and WiX itself.

```bash
cd app
npm ci
```

## 3. Commands (run from `app/` unless noted)

| What | Command |
|---|---|
| Typecheck | `npx tsc --noEmit` |
| JavaScript tests | `npx vitest run` (**971 pass, 1 skipped**) |
| Rust lint + tests | `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test` (**130 pass, 3 ignored**; the ignored ones are real-engine runs) |
| Dev server (browser demo with the mock backend; never real keys) | `npx vite --port 5173` |
| Build the installers | `npx tauri build`. Outputs: `src-tauri/target/release/bundle/nsis/Greenroom Local_<ver>_x64-setup.exe`, `.../bundle/msi/...msi`, and the portable `src-tauri/target/release/greenroom-local.exe` |
| Secret scan (from the repo root) | `rafter secrets .` |
| Dependency audits | `npm audit --omit=dev`; in `src-tauri`, `cargo audit` (0 vulnerabilities; 6 old allowed warnings from Tauri's Linux stack) |

`npx tauri build` ends with "A public key has been found, but no private key ... TAURI_SIGNING_PRIVATE_KEY". That is the **updater** signing step and is **expected**: the installers and MSI are already built before it. There is no signing key yet.

## 3a. THE BUILD TRAPS (these each cost a release; read before building)

1. **Never run two `npx tauri build` at once, and never start a build while another is still running.** Vite empties `app/dist` at the start of its build; if a second build starts while the first is compiling Rust, the exe is compiled **without the app's screens** and shows **"asset not found: index.html"** when installed. That is exactly what shipped in the first 0.12.8 (the owner saw it). Symptoms of a bad build: exe about 26 MB instead of about 30 MB, installers about 11 and 13 MB instead of about 15.4 and 17.6 MB. Fix: make sure nothing runs (`tasklist | grep -iE "cargo|rustc|node"`), then `cd src-tauri && cargo clean -p greenroom-local --release` and build once in the foreground.
2. **After every build, look at the real window.** Starting the exe and seeing "alive and responding" proved nothing. Launch it (PowerShell `Start-Process`), wait about 14 s, and capture the window (`CopyFromScreen` of its rectangle), then look at the picture: you should see the Projects screen with the sidebar.
3. **In Git Bash a command like `a && b | tail; cd x && build &` puts only the last AND-list in the background**, so monitors can start early and read a **stale** `/tmp/build.log` or `/tmp/build.done`. Use one command per build, delete the log first, and wait on a specific end marker (the log containing "public key has been found" AND the new installer file existing).
4. `runtime/*.py` are compiled into the exe with `include_str!`. Do not edit them while a build compiles. `.gitignore` used to have `/runtime/*`, which hid `kokoro_once.py` and `qwen_once.py` for several releases (nobody could build from a clean clone). They are now un-ignored, and `app/src/repoCompleteness.test.ts` fails if any `include_str!` file is missing, ignored or uncommitted. Keep it.
5. **Bash quoting trap:** in this Git Bash `"$T\\$v.json"` expands to a literal `$v` (the `\$` is read as an escaped dollar). Use forward slashes (`cygpath -m`) or `${T}/...`. Windows Python/exe cannot see Git Bash's `/tmp`; use `cygpath -w`.
6. Write files containing apostrophes or backslashes with the **Write tool** (or a Python script written with it), not shell heredocs.
7. Background `sleep` loops are blocked; use the Monitor tool with an `until` loop and a specific condition.

## 4. Rules that matter (from `CLAUDE.md`, the owner's wishes and what went wrong before)

- **Deliver a built installer; the owner never uses a terminal.** After every change they want to try, **bump the version** and make a **new Desktop folder** `C:\Users\<user>\Desktop\Greenroom Local <version>` with: the NSIS setup exe, the MSI, `Portable\Greenroom Local.exe`, `SHA256SUMS.txt`, `HANDOVER.md` and a plain-language `READ ME FIRST.txt` (what changed; honest "NOT CHECKED" list). **Never delete or modify older version folders.** (Existing folders: 0.8.8, 0.9.0, 0.9.1, 0.10.0, 0.12.4 to 0.12.8, plus a "Greenroom Handover" folder. 0.12.5 was overwritten several times during its own release, before 0.12.6 existed; that is the only exception.) Installers with the same version keep the old exe, so every release needs a new number.
- **Bump the version in five places:** `app/package.json`, `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`, `app/src/version.ts`, and the `greenroom-local` entry in `app/src-tauri/Cargo.lock` (find it by name: `grep -n 'name = "greenroom-local"' -A1`).
- **Money:** every paid call goes through `confirmSpend` in `ctx.tsx` first. Never add a path that spends without that sheet. **Do not make paid calls yourself while testing**: use the Rust fake servers (`eleven::fake`) and the demo backend `app/src/mock.ts` (browser only, never in the app).
- **Keys** live only in the Windows Credential Manager (`lib.rs`, service "Greenroom Local"). Never log them, return them to the UI or write them to a file.
- Provider code sits behind small clients that take a base URL (`eleven.rs`, `voicekiller.rs`, `kie.rs`, `inworld.rs`, `llm.rs`). Do not hardcode unverified model ids or endpoints.
- Takes are immutable files; saves are atomic; names from outside go through `store::safe_filename` / `valid_id`.
- **Claims about quality** (how a voice or accent sounds) come only from the owner listening. Nothing in this project has been judged by ear by an agent; "valid audio" is all an agent can claim.
- UI: shared pieces and tokens in `app/src/styles/`; green accent; "Soundstage" look (dark stage, thin wide-tracked display type, small radii).
- **Report test counts honestly, with a "Not checked" list.** The owner values plain statements of what was and was not verified, and **will notice if a release is broken**.
- **Security process (the owner's global Rafter rules):** run `rafter-secure-design` before touching untrusted input, files, keys, network or deletion, and `rafter-code-review` plus `rafter run` before calling such work done. In practice `rafter run` (remote scan) has been **out of quota** since the first use; `rafter secrets .` works offline. `rafter run --mode plus` is paid: ask the owner first. Record outcomes in `docs/SECURITY_REVIEW.md`.

## 5. Map of the code

**Frontend `app/src/`** (React + TypeScript; vitest tests sit beside the code):
- Screens `screens/`: `Write`, `Cast`, `Perform` (main directing screen), `Timeline`, `Voices` (library, casting call, find, design, clone), `Presets` (voice presets and the redesigned card), `Engines`, `Models` (Model Center) with `LocalEngineSetup.tsx` and `SetupCheck.tsx`, `Settings` (including Inworld), `AvatarBrowser`, `PortraitImporter`, `ScriptImporter`, `OwnAudioDialog` (use your own audio, add expressions), and many small dialogs.
- Presets: `presets/match.ts` (**voice-to-preset fit**: gender, age, language; never guesses from a name), `presets/schema.ts`, `localStandIn.ts` (free preview voice).
- Model status/setup: `modelStatus.ts` (`UNVERIFIED` lists engines not yet proven; now only `stable-audio-open-small` and `ace-step-v1`), `setupPlan.ts` / `setupExec.ts` (the "Set up my PC" steps), `ownAudio.ts`, `finder.ts` (voice finder per engine; Inworld now lists without a language).
- Cinematic engine, avatars/faces, script import, AI Director routing: unchanged from the 0.10.0 note; see the file headers.

**Backend `app/src-tauri/src/`** (Rust): `lib.rs` (Tauri commands, key storage, Chatterbox/Wazobia/Kokoro/Qwen speak, managed runtime installers, `setup_check`/`setup_report`), `setup_check.rs` (preflight, install log, `why()` error tail), `local.rs` (Piper, including `sanitize_voice_config`), `model_manager.rs`, `managed_python.rs`, `eleven.rs`, `kie.rs`, `inworld.rs`, `voicekiller.rs`, `llm.rs`, `script_import.rs`, `mux.rs`, `store.rs`, `net.rs`.

**Python workers `runtime/`** (compiled into the exe; JSON on stdin, WAV on stdout, everything else to stderr): `chatterbox_once.py`, `chatterbox_vc_once.py`, `kokoro_once.py`, `qwen_once.py`, `sfx_once.py`, `acestep_once.py`, plus the legacy `chatterbox_server.py` (see 7).

**Runtime data on the owner's PC (not in git):**
- `Documents\Greenroom Local\` : `voices.json` (voice library), `engines.json`, `projects\`, `logs\setup.log` (every install step and worker failure, capped at 1 MB), `engines\piper\{piper\piper.exe, voices\}`, `runtime\chatterbox` (a Python 3.11 venv, **chatterbox-tts 0.1.7**), `runtime\{kokoro,qwen,sfx,acestep}-managed` (embedded Python per engine; Qwen is about 6.4 GB with its model in `qwen-managed\hf`).
- `%LOCALAPPDATA%\app.greenroom.local\models\` : `chatterbox-multilingual-v3\5bb1f6ee` and `wazobia-voice\8ca840df` (model files).
- The installed app is at `%LOCALAPPDATA%\Greenroom Local\greenroom-local.exe`.

## 6. State of the product at 0.12.8 and how each local engine was proven (2026-11-09, owner's PC, CPU runs)

"Valid audio" = a real WAV came back from the real runtime. **No one has listened to any of these.**

| Engine | Result | Notes |
|---|---|---|
| Piper (21 voices) | All 21 make audio | **6 failed before 0.12.8** (Amy, Thorsten, Siwis, KSS, Cadu, Tsync2): newer `rhasspy/piper-voices` configs list diphthongs ("aɪ") as multi-letter phoneme keys that the installed Piper (2023.11.14-2) rejects ("not a single codepoint"). `local::sanitize_voice_config` drops those keys before every speak (idempotent, covers voices already downloaded). Quality effect of the split diphthongs is **unheard**. Piper must run with its working directory set to `engines\piper\piper` (the app does). |
| Chatterbox V3 default voice | Valid audio, 39 s | The worker always passed `t3_model`, which `chatterbox-tts 0.1.7` does not accept, so **every Chatterbox line had been failing**. `chatterbox_once.py` now loads `t3_mtl23ls_<v2/v3>.safetensors` by wrapping `load_safetensors`. |
| WazobiaVoice | English 62 s, Yoruba 30 s, Hausa 29 s, Igbo 39 s | Same fix, plus `SUPPORTED_LANGUAGES` is extended with `yo`, `ha`, `ig` (0.1.7 refuses them before reading the model). Gated model: the Hugging Face account must have accepted the terms; `Check my setup` explains this. |
| Kokoro | American and British voices, 11 s each | The runtime would not install ("metadata-generation-failed"): `docopt` is source-only and its legacy `setup.py` cannot build in the embedded Python. The package installer step now passes `--use-pep517`. Marked Ready in Model Center. |
| Qwen3-TTS (VoiceDesign) | Valid audio 2.7 s, a second voice offline 2.8 s in 25 s | `qwen_once.py` was **rebuilt from the installed `qwen-tts 0.1.1` API** (the original was never committed). Download watchdog: the 3.8 GB model download runs in a child process restarted after 90 s of silence (the plain download stalled twice); `hf_xet` is installed on demand; once downloaded it loads from the local snapshot folder, so it needs **no internet** (transformers otherwise asks the hub). Marked Ready. In-app Set up completed on the owner's PC (their screenshot). |
| Sound effects (Stable Audio Open Small) | **Not tested** | Runtime installed, **model weights not installed** on the owner's PC. Still "Installed, not Ready". |
| ACE-Step music | **Not tested** | Not installed. Needs an NVIDIA GPU; the owner's PC has an RTX 4070 SUPER (12 GB), so it should be testable. |

Other 0.12.x features (details in `docs/QA_RESULTS.md`): voice presets "Hear with" ranked by fit (a voice that does not fit is never auto-picked; voices with no stored gender show "Male / Female" tag buttons); Agent Studio and presets (the other PC's 0.11 to 0.12.3 work, `docs/AGENT_STUDIO.md`); Model Center "Check my setup" and "Copy a report"; use-your-own-audio and add expressions in Perform; Inworld voices list without choosing a language, plus Settings > Inworld > "Add all my Inworld voices to my library"; Perform line card decluttered; **preset card redesigned** (one picker, three actions, rest under More).

## 7. Known issues, limits and things never verified

- **Nothing judged by ear** (any engine, accent, preset, repaired Piper voice, Wazobia Yoruba/Hausa/Igbo). The owner must listen.
- **The installed app has not been clicked through** by an agent, including the in-app "Set up" buttons for Chatterbox, Kokoro, Qwen and Wazobia (workers were run directly with the app's runtimes, and the owner confirmed Qwen's Set up in a screenshot).
- `runtime/chatterbox_server.py` (the legacy "Local Server" script) still passes `t3_model="v3"` and has the same bug; it was not changed.
- **Unsigned installers** (SmartScreen warns) and the **updater has a public key but no private key**, so auto-update cannot ship.
- `rafter run` (remote scan) is out of quota; `rafter secrets .` is clean.
- No live call was ever made to OpenAI, Gemini, Kie images, or **Inworld with the owner's account** (their account list was never fetched; the code path was only type-checked and run against the demo).
- The redesigned preset card was checked in a browser demo and the real app window opened, but the preset page in the **real installed app** was not looked at. The Perform line-card layout (0.12.5 declutter) was type-checked only, never viewed.
- Other screens' cards (Voices voice cards, Model Center cards) still have the older busy look; only presets were redesigned.
- The owner said "there are issues all over the app" and gave no examples beyond those fixed; ask for screenshots.
- Qwen runs on the CPU (about 25 s for a short line); the owner's GPU is not used for it. Idea: offer a CUDA torch build.
- A console window titled "Credential Pool Status" that appeared during setup was **not Greenroom**: it is the user's Hermes tool (`hermes auth`).
- Piper voice genders come from a name table written from memory (`PIPER_GENDER`); the `LOOKS` portrait table was labelled by eye; both may have mistakes.

## 8. Suggested next steps (highest value first)

1. Ask the owner to install **0.12.8** from `Desktop\Greenroom Local 0.12.8`, confirm the app opens, and **listen** to: Wazobia in Yoruba, Hausa and Igbo; Amy and the other five repaired Piper voices; Qwen and Kokoro voices. Record verdicts in `DECISIONS.md`.
2. Click through the installed app: Model Center Set up buttons (Kokoro, Qwen, Wazobia), Presets, Voices, Perform. Fix what is found.
3. Test the engines that were not installed: sound effects (needs the Stable Audio Open Small weights, a gated model) and ACE-Step (4070 SUPER available).
4. Redesign the Voices and Model Center cards with the same restraint as the preset card (summary line, one primary action, the rest under "More").
5. Fix `runtime/chatterbox_server.py`; consider a CUDA option for Qwen and Chatterbox.
6. Have the owner use their Inworld account (Settings > Inworld > Test connection, then "Add all..."), and OpenAI/Gemini for the first time.
7. Code-signing certificate and updater key; open the PR into `main`; CI that runs typecheck, tests, clippy, audits and the QA scripts; run `rafter run` when the quota resets.
8. Make a **build-verification script** (`scripts/verify_build.ps1`) that checks sizes, starts the exe and screenshots the window, so section 3a traps cannot ship again.

## 9. QA scripts

`scripts/qa/` (see its README): `smoke.mjs` (every screen, console errors), `presets_e2e.mjs`, `presets_voices_e2e.mjs`, `ownaudio_e2e.mjs`, `sweep.mjs`, `script_e2e.mjs`, `import_e2e.mjs`, `agent_e2e.mjs`, `a11y.mjs`, `keyboard.mjs`, `layout_check.mjs`. They drive the **browser demo build** in headless Chrome (needs `npx vite --port 5173` running and a warm server; the first run right after starting vite can hit a blank page). Run `smoke.mjs` and the presets scripts before every release.

## 10. Not in git; carry over by hand if wanted

- **API keys**: Credential Manager is per PC; re-enter them in Settings.
- **Owner's data**: `Documents\Greenroom Local\` (voices.json, projects, engines.json). The real voice library is mirrored (anonymised) in `app/src/fixtures/voices.sample.json`.
- **Installers** in the Desktop version folders; rebuild from git instead.
- Portrait source folders on the owner's Desktop (the built masters are in git; the originals are not).
- Claude's own memory files live per machine; their useful content is in this note.

## 11. A prompt to paste into the new agent

> You are continuing work on Greenroom Local, a Windows desktop app (Tauri 2 + React/TypeScript + Rust) for directing AI voice performances. The repository is https://github.com/Olusegune/Greenroom_Local; check out the branch `feat/agent-studio-presets` (HEAD should be `902431a` or later). Read `docs/HANDOVER.md` fully (especially section 3a, the build traps), then `CLAUDE.md`, `DECISIONS.md` and the newest section of `docs/QA_RESULTS.md`. The owner, Victor Edun, does not use a terminal: deliver every change as a new version in a new Desktop folder (`Greenroom Local <version>`) with installers, checksums, a READ ME FIRST.txt and an honest "NOT CHECKED" list; never touch older folders; never make paid API calls while testing; never log or write keys. Never run two builds at once, and always launch the built app and look at its window before handing it over. Start with section 8 of the handover: get the owner to install 0.12.8 and listen to the engines, then click through the installed app and fix what is found. Report test counts honestly and say what you did not check.
