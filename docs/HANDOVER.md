# Handover note: Greenroom Local (for a Claude agent on another PC)

> **UPDATE (0.12.5, 2026-11-09): the working branch is `feat/agent-studio-presets`** (the other PC's 0.11 to 0.12.3 work, built on top of `feat/cinematic-engine-2`; use it, not the older branch below). `runtime/qwen_once.py` and `runtime/kokoro_once.py` are now both committed (a `.gitignore` rule used to hide them). The Qwen worker was rebuilt on the PC that wrote this note and tested for real (download, speech, and a second run with no internet). **If your PC still has its own untracked `runtime/qwen_once.py`, move it aside before `git pull` (git refuses to overwrite it), then pull.** What 0.12.4 and 0.12.5 changed is in `docs/QA_RESULTS.md`.

Written 2026-11-09 at version **0.10.0** (sections below describe 0.10.0; later work is in `docs/` and the git log). Read this first, then `CLAUDE.md` (project rules), `DECISIONS.md` (D-1 to D-51) and `docs/SECURITY_REVIEW.md`. The owner is Victor Edun (git user "Victor Edun", GitHub account **Olusegune**). They do **not** use a terminal: everything is done in the app window, and what they receive is a built installer.

## 1. Get the code (git)

| Item | Value |
|---|---|
| Repo | https://github.com/Olusegune/Greenroom_Local (remote `origin`) |
| Working branch | **`feat/cinematic-engine-2`** (pushed; HEAD `cf289f8` "Script import ... OpenAI and Gemini ... version 0.10.0"). Local and GitHub were identical when this was written; nothing uncommitted. |
| `main` | Stale: still at `4dc2e4c` (0.4.0). The working branch is about 40 commits ahead of it. **No pull request has been opened yet** (the `gh` CLI was not signed in). Open one at https://github.com/Olusegune/Greenroom_Local/pull/new/feat/cinematic-engine-2 when the owner wants to merge. |
| Other branch | `feat/written-direction-perform-ui` (old, ignore) |
| Second remote | `rc` = https://github.com/Olusegune/GreenRoomRelease-Candidtate.git (a release-candidate repo; do not push to it unless asked) |
| Size | about 320 MB `.git` because 172 portrait masters (1024 px PNG, about 145 MB) are tracked in `avatars/masters/`. Clone takes a minute. |

```bash
git clone https://github.com/Olusegune/Greenroom_Local.git
cd Greenroom_Local
git checkout feat/cinematic-engine-2
git log --oneline -3        # expect cf289f8 (or later) on top
```

- You need to be signed in to GitHub as a user with push rights to `Olusegune/Greenroom_Local` (Git Credential Manager prompts on first push). `gh auth login` is optional; it is only needed for opening PRs from the terminal.
- Commit messages end with: `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>` (adjust to the model you are). Never skip hooks. Commit and push only when the owner asks or the release routine below says so; the owner has asked for a push after each version so far.
- Git prints "LF will be replaced by CRLF" warnings on Windows; they are harmless.

## 2. Tools needed on the new PC

Windows 10/11, **Node 22+** (24 used), **Rust stable** (1.96 used) with the MSVC toolchain + Visual Studio Build Tools, **WebView2** (ships with Windows 11), **Python 3** with **Pillow** (`pip install pillow`; only for `scripts/build_avatars.py`), **Google Chrome** (only for the headless QA scripts). `npx tauri build` downloads NSIS and WiX itself.

```bash
cd app
npm ci                      # install JavaScript dependencies
```

## 3. Commands (run from `app/` unless noted)

| What | Command |
|---|---|
| Typecheck | `npx tsc --noEmit` |
| JavaScript tests | `npx vitest run` (708 pass, 66 test files) |
| Rust lint + tests | `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test` (121 pass, 1 ignored) |
| Dev server (browser demo with the mock backend, never real keys) | `npx vite --port 5173` |
| Build the installers | `npx tauri build` (installer: `src-tauri/target/release/bundle/nsis/Greenroom Local_<ver>_x64-setup.exe`, plus `.../msi/...msi`; the portable exe is `src-tauri/target/release/greenroom-local.exe`) |
| Secret scan | `rafter secrets .` (from the repo root) |
| Dependency audits | `npm audit --omit=dev` and, in `src-tauri`, `cargo audit` |

`npx tauri build` ends with "A public key has been found, but no private key ... TAURI_SIGNING_PRIVATE_KEY". That is the **updater** signing step and is expected: the installers and the MSI are already built before it. There is no signing key yet (see section 9).

## 4. Rules that matter (from `CLAUDE.md`, the owner's wishes and what went wrong before)

- **Deliver a built `.exe`/installer; the owner never uses a terminal.** After every change they want to try, bump the version and make a **new Desktop folder** `C:\Users\<user>\Desktop\Greenroom Local <version>` containing: the NSIS setup exe, the MSI, `Portable\Greenroom Local.exe`, `Avatar library\` (README, library.json, plan.json, masters, app-derivatives), `SHA256SUMS.txt`, and a plain-language `READ ME FIRST.txt` (what changed, honest limits). **Never delete or modify older version folders.** Windows installers with the same version keep the old exe, so every release needs a new version number.
- **Bump the version in five places:** `app/package.json`, `app/src-tauri/Cargo.toml`, `app/src-tauri/tauri.conf.json`, `app/src/version.ts`, and the `greenroom-local` entry in `app/src-tauri/Cargo.lock` (find it by name: `grep -n 'name = "greenroom-local"' -A1`; line numbers move).
- **Money:** every paid call (speech, sound effects, voice design, samples, portrait generation, AI Director/script reading on any cloud provider) goes through `confirmSpend` in `ctx.tsx` first. Never add a path that spends without that sheet. **Do not make paid calls yourself while testing**: use the Rust fake servers (`eleven::fake`) and the demo backend `app/src/mock.ts` (used only in a plain browser, never in the app).
- **Keys** live only in the Windows Credential Manager (`lib.rs`, service "Greenroom Local", names allow-listed: elevenlabs, kie, voicekiller, voicekiller-userid, inworld, huggingface, openai, gemini). Never log them, return them to the UI or write them to a file.
- **Provider code** sits behind small clients that take a base URL so tests run against a fake server (`eleven.rs`, `voicekiller.rs`, `kie.rs`, `inworld.rs`, `llm.rs`). Do not hardcode unverified model ids or endpoints: check the provider docs and note the date.
- Takes are immutable files; saves are atomic; names from outside go through `store::safe_filename` / `valid_id`.
- **Claims about quality** (accents, sounds, how a voice sounds) come only from the owner listening, and are recorded in `DECISIONS.md`. Nothing in this project has been judged by ear by an agent.
- Use the shared UI pieces and tokens in `app/src/styles/`; accent colour is green; "Soundstage" look (dark stage, thin wide-tracked display type, small radii).
- **Report test counts honestly, with a "Not checked" list.** The owner values plain statements of what was and was not verified.
- **Windows quirks:** write files that contain apostrophes or backslashes with the **Write tool** (or a Python script written with it), not shell heredocs (they break; this happened repeatedly). Bash is Git Bash; PowerShell is also available. When piping vitest output through `grep`, use `grep -a` (the output can contain control characters). If the dev server shows a strange "does not provide an export" error after edits it is stale hot-reload: restart `vite`. Stop stray servers with `taskkill //F //IM node.exe`.
- **Security process (the owner's global `~/.claude/CLAUDE.md` "Rafter" rules):** before building anything that touches untrusted input, files, keys, network or deletion, run the `rafter-secure-design` skill and record the decisions; before calling such work done run `rafter-code-review` and `rafter run`. In practice `rafter run` (remote scan) has been **out of quota** ("Fast scan limit reached 1/1") since the first use; `rafter secrets .` works offline. `rafter run --mode plus` is paid: ask the owner first. The pattern used so far: secure-design walk, hostile-input unit tests, real-browser run, `rafter secrets`, `npm audit`, `cargo audit`, and write the outcome in `docs/SECURITY_REVIEW.md`.

## 5. Map of the code

**Frontend `app/src/`** (React + TypeScript, vitest tests sit beside the code as `*.test.ts[x]`):
- Screens `screens/`: `Write` (script, imports), `Cast`, `Perform` (the main directing screen, tabs Quick/Director/Advanced/Reaction Library), `Timeline`, `Voices` (library, casting call, find, design, clone), `Engines`, `Settings`, `Models`, `AvatarBrowser`, `PortraitImporter`, `ScriptImporter`, `CharacterLooks`, `AvatarButton` (voice picture + `VoiceLooks`), plus many small dialogs.
- Cinematic engine: `performance.ts`, `acting.ts`, `beats.ts`, `reactions.ts`, `foley.ts`, `analysis.ts`, `voiceDna.ts`, `scriptDoctor.ts`, `soundQa.ts`, `engineCaps.ts`, `modelStatus.ts`, `manifest.ts`, `generate.ts`, `direct.ts` (direction budgeting that fixed the repeated "Twice, actually." bug), `director.ts`.
- **Avatars and faces:** `avatarLibrary.ts` (manifest validation, filters, suggestions, **`LOOKS` table: what each portrait shows**, `readVoice`, `autoAvatar`, `STORY` creature/role rules, `customFaces`), `avatarState.ts`, `avatar.tsx` (`Avatar` component: voice picture, else automatic face), `portrait.ts` (`syncPortraits`, `voiceHint`, `assignedFace` spread assignment), `importer.ts` (portrait file checks).
- **Script import:** `scriptImport.ts` (screenplay/Fountain/colon/prose to the app's `NAME (direction): line` format + character descriptions), `scriptAi.ts` (AI character reading: prompt + strict reply parsing), `autocast.ts` (`planCast`, now steered by a character's stated look).
- AI Director routing: `engines.ts` (`directorReady`, `directorCloud`, `directorLabel`), `directorCall.ts` (`askCloud`).
- Fixture of the owner's real voice library (anonymised, no ids): `fixtures/voices.sample.json`, used by `realLibrary.test.ts`.
- `mock.ts` is the demo backend for plain-browser runs.

**Backend `app/src-tauri/src/`** (Rust): `lib.rs` (Tauri commands, key storage), `eleven.rs`, `kie.rs`, `inworld.rs`, `voicekiller.rs`, **`llm.rs`** (OpenAI + Gemini text), **`script_import.rs`** (txt/md/fountain/docx/pdf reading), `local.rs`, `model_manager.rs`, `managed_python.rs`, `mux.rs`, `video.rs`, `store.rs` (atomic saves, `avatars.json`, `voices.json`), `net.rs`, `history.rs`.

**Other:** `avatars/` (`library.json` = curated entries, `masters/` 1024 px PNGs, `plan.json` empty, `README.md`), `app/public/avatars/` (built 512/256 WebP cards, 128 px thumbnails, `manifest.json`, bundled into the app), `scripts/build_avatars.py` (see section 7), `scripts/release.ps1`, `scripts/qa/` (headless-Chrome QA scripts, see its README), `docs/` (about 40 documents), `brand/`, `runtime/`.

**Runtime data (not in git)**: `C:\Users\<user>\Documents\Greenroom Local\` holds `voices.json` (the voice library), `avatars.json` (own portraits, favourites), `engines.json`, `projects\`, `backups\`, `runtime\`, `engines\`.

## 6. State of the product at 0.10.0

- **Cinematic acting engine** (PerformancePlan, acting presets, beats, Voice DNA, acting references, Script Doctor, foley ideas, reaction libraries, spatial pan, engine capability table, Inworld support) built and wired; AI writes plans; direction is budgeted per voice engine (`direct.ts`).
- **Avatar library:** **172 full-resolution (1024 px) masters + 69 previews** (256 px). The original 100 target is met (10 per collection plus extras). Rights recorded as owner-supplied on the owner's statement; generator not recorded.
- **Automatic faces** for any voice/character without a chosen picture, never a cartoon: only everyday portraits unless a creature/role is stated; gender never crossed; child only for a child; stated heritage matched exactly; unstated age gets a young adult to middle-aged face; faces are spread across the library (22 faces for the owner's 41 voices, none more than 4 times); the owner's own portraits can join; `LOOKS` was labelled **by eye by an agent and may contain mistakes**.
- **Voices carry Gender, Age, Heritage** (editor under More on a voice card; ElevenLabs age labels are imported; Piper voice genders come from a name table `PIPER_GENDER` that was written **from memory, not verified by ear**).
- **Add portraits** screen (multi-file, crop, tags, duplicate flags, strict file checks).
- **Script import** (txt, md, fountain, docx, pdf) with a preview, character descriptions, replace/append, optional AI reading; characters have `about` and `look`.
- **AI providers:** Kie (default), **OpenAI** (`/v1/responses`), **Google Gemini** (`generateContent`), local Director. See `docs/PROVIDERS.md` for exactly what was confirmed from their docs on 2026-11-08 and what was not.
- Tests: 708 JS, 121 Rust; clippy `-D warnings` clean; `rafter secrets` clean; `npm audit` 0; `cargo audit` 0 vulnerabilities (6 old warnings from Tauri's Linux stack).

## 7. Avatar pipeline (how portraits were added; the one-off helper scripts were not saved)

1. Source images from the owner go in a staging folder (copied to `<id>.png|jpg|webp` file names).
2. Add the entry to `avatars/library.json` (id, name, collection, period, genre, style, age_category, archetype, clothing, tags, `source` file name, `license`, `tier`). Previews use `tier: "preview"` plus a `crop` box and never get a master or a 512 card.
3. Add the portrait's gender/heritage to the `LOOKS` table in `app/src/avatarLibrary.ts` (a test fails if a master has no entry).
4. `python scripts/build_avatars.py --source "<staging for masters>" --preview-source "<staging for previews>"` writes masters (never upscales; refuses under 1024 px), WebP cards and thumbnails, and the manifest; `python scripts/build_avatars.py --check` validates everything.
5. Run `npx vitest run`, bump the version, build, package.

Lessons: source images can have a strip of another portrait along the edge (found in the 512 px "previous batch" files; detect with a row-gradient check and crop), and must be checked for look-alikes of known characters, text/watermarks and full-body framing. Several earlier source folders on the owner's Desktop are **not** in git.

## 8. QA scripts

`scripts/qa/` (see its README): `smoke.mjs` visits every screen in headless Chrome and reports console errors; `import_e2e.mjs` runs the Add portraits screen with real and hostile files; `script_e2e.mjs` runs the script import flow; `layout_check.mjs` checks the Voices page scrolls to its last card. They need the dev server (`npx vite --port 5173`) and Chrome. Run the smoke script before every release.

## 9. Known limits and things never verified

- **No live call** has ever been made to OpenAI, Gemini, Inworld, or Kie's image route; all tested against fake servers. A few OpenAI/Gemini request details could not be confirmed (see `PROVIDERS.md`); the first real use is the real test.
- **Nothing judged by ear**: no voice quality, accent, preset, beat or Inworld result has been listened to by an agent. The repeated-line fix ("Twice, actually.") is unit-tested but not confirmed by ear.
- **The installed builds were never clicked through** by an agent; only the same screens in a browser build and headless smoke runs.
- **Installers are unsigned** (SmartScreen warns) and the **updater has a public key but no private key**, so auto-update cannot ship yet.
- `rafter run` remote scan has not completed on this branch (quota). Run it when the quota resets.
- Not done: whole-scene re-voice, beats in `VisualLine`, a local API/CLI for the manifest, Kokoro/Qwen speech routes, new local engines (only evaluated in `docs/LOCAL_ENGINE_EVALUATION.md`), a 60-second stress test (kit only), avatars in the Voice Library cards beyond automatic faces / the dialogue timeline.
- Script import was tested on samples, generated PDF/Word files and hostile files, **not on the owner's own scripts**; two-column PDFs and lower-case speaker names may read badly. A hostile PDF built to exhaust time or memory is not tested.
- Smooth scrolling and memory with thousands of avatars was not measured (only about 240 exist).

## 10. Not in git; to carry over by hand if wanted

- **API keys**: Credential Manager is per PC. Re-enter them in the app (Settings).
- **Owner's data**: `Documents\Greenroom Local\` (voices.json, projects, avatars.json). Copy the folder if the same library is needed; the real voice library is mirrored (anonymised) only in `app/src/fixtures/voices.sample.json`.
- **Released installers** in Desktop folders `Greenroom Local 0.5.0 ... 0.10.0`; rebuild from git instead (`npx tauri build`).
- The owner's raw portrait folders (Desktop: "Green Local avatars", "NEW IMAGES FOR GREEN ROOM", "Greenroom Avatar Images Vs 2", "... - 22101221", "Women", "Others", "mideastern", and the zip in Downloads). The built masters are in git; the originals are not. Unused candidates remain there (for example demon/devil characters that were left out, and the 512 px "previous batch" images).
- Claude's own memory files live per machine (`~/.claude/projects/.../memory/`); their useful content is in this note (Desktop version folders, honest reporting, owner does not use a terminal).

## 11. Suggested next steps

See `docs/IDEAS.md` (20 ideas). Highest value next: (1) the owner tries script import with real scripts and reports misreads; (2) first real use of OpenAI/Gemini (owner's keys), fixing any request-field issue in `llm.rs`; (3) a "Voice library health" panel (bulk confirm of gender/age/heritage); (4) estimating gender/age from the audio (pitch analysis already exists in `analysis.ts`); (5) code-signing certificate + updater key; (6) open the PR into `main`; (7) CI that runs typecheck, tests, clippy, audits and the smoke script on every push.

## 12. A prompt to paste into the new agent

> You are continuing work on Greenroom Local, a Windows Tauri 2 + React/TypeScript + Rust app for directing AI voice performances. Clone https://github.com/Olusegune/Greenroom_Local, check out branch `feat/cinematic-engine-2`, and read `docs/HANDOVER.md`, `CLAUDE.md` and `DECISIONS.md` before doing anything. The owner does not use a terminal: finish work as a built installer in a new versioned Desktop folder, with a plain-language READ ME FIRST, and report test counts honestly with a "Not checked" list. Do not make paid API calls; never log or write keys. Start by running `cd app && npm ci && npx tsc --noEmit && npx vitest run` to confirm the baseline (708 JS tests), then ask the owner what to do next.
