# Greenroom Local

Private, accent-aware AI voice production for Windows and macOS. Greenroom Local builds on the proven Greenroom editing and production workflow while making local models, managed installation, voice acting and accent verification the center of the product.

> This is a separate application and repository. Development here does not modify the original Greenroom repository, projects, installers, signing identity or update channel.

## Current foundation (v0.1 development)

- Tauri 2 + React 19 + TypeScript + Rust desktop application
- Existing Greenroom script, cast, take, timeline, picture, trust, history and professional export foundations
- New Model Center for hardware-tiered local AI setup
- Local model catalogue with download size, memory requirements, capabilities and licence visibility
- Structured Performance Engine for emotional arcs, objectives, breath, physical effort, fatigue, pain and timed expressions
- Windows and macOS bundle configuration
- 183 frontend tests and 62 native backend tests passing

The native installer foundation now detects hardware, keeps model state outside projects, resumes partial downloads, emits real progress, enforces manifest byte counts and SHA-256, stages new versions and activates them atomically. Production model buttons remain unavailable until their exact release artifacts and licences are pinned in application-owned manifests; moving URLs are deliberately never guessed.

See [docs/LOCAL_AI_ARCHITECTURE.md](docs/LOCAL_AI_ARCHITECTURE.md) for the installation and runtime design.

## Release documentation

- [User guide](docs/USER_GUIDE.md) - the golden path with screenshots: script, cast, direct in your own words, take, export. Menus and shortcuts.
- [Getting started](docs/GETTING_STARTED.md) - install, first project, local voices, keys and export.
- [Release QA](docs/RELEASE_QA.md) - automated coverage, manual acceptance checks and release gates.
- [Product roadmap](docs/PRODUCT_ROADMAP.md) - the next practical improvements and what is intentionally not represented as working today.

## Develop

From `app/`:

```text
npm install
npm run build
npm test
npm run tauri dev
```

The browser build uses the demo backend. Native model installation and inference are available only in the Tauri application.

## Inherited Greenroom capabilities

Sound without limits. Write a scene, give each character a voice, direct how they sound (excited, whispering, laughing, coughing, out of breath), make takes, and export the finished audio. A Windows desktop app.

![Perform: written direction on a line](docs/img/guide-5-perform-direction.jpg)

## What is in v0.15

| Area | What it does |
|---|---|
| Script | Write `NAME: line` scenes, with `(directions)` and `# Scene titles`. Any language, mixed languages in a line. Editing never throws away voices or takes. |
| Engines | ElevenLabs, Inworld, VoiceKiller, Kie, Piper (offline, free) and your own local server. A voice belongs to an engine, so choosing a voice chooses the engine. |
| Find a voice | Pick a language by flag (84 languages and accents), see voices from every engine for it. No names needed. |
| Voices | One library: find in ElevenLabs' shared library by language and accent, design a voice from a description, clone from a recording (with a permission tick), add VoiceKiller voices, browse and clone Inworld voices (see [Inworld](docs/INWORLD.md); tested against a fake server only), import your ElevenLabs account voices. |
| Written direction (0.5) | Every line has a Direction box: write how it should be played in plain words (up to 400 characters), click a style (Whisper, Villain, Deadpan and more) to add a full sentence, or let the AI write it, for one line or for the whole scene with each character's feeling followed through. Works with ElevenLabs library, designed and cloned voices and VoiceKiller; other engines say plainly that they cannot act on words. Recent directions are remembered. |
| Menus (0.5) | A standard File, Edit, View and Help menu bar with Ctrl+N, O, S, Shift+S, W and Q. |
| Directing | Each line is a row of words: click between any two words to drop in a sound (laugh, sigh, gasp, grunt, your own), drag the coloured pill to move it, click its x to remove it. Per line: emotion and sound chips (including effort: grunt, strain, pant, wince), style presets (lifting something heavy, out of breath, crying while talking), a plain-language director's note, an insert menu that puts a sound into the words at the cursor, speed and pause. |
| AI Director | Reads the script and suggests the direction for every line; you review and apply. Uses a Kie text model. |
| Cast | A voice and a language label per character, with a sample of their first line. |
| Perform | Emotion and sound chips per line (laugh, sigh, crying, gasp, cough, out of breath and more), speed and pause, three takes at a time, pick the best, add sound clips (sneeze, door) before or after a line. Eleven v4 by default, v3 selectable. |
| Export | Pro audio: 44.1/48/96 kHz, 16/24/32-bit WAV, loudness to a broadcast or online target (BS.1770), stems per character, per-line level, markers inside the WAV, a label track, a cue sheet with provenance and an OpenTimelineIO timeline for editors. Also one file per scene and every line as an original file. Optional looping atmosphere. See docs/PRO_AUDIO.md. |
| Updates | Settings > Updates: Greenroom checks for a newer signed version and installs it only when you press the button. See docs/RELEASING.md. |
| History | Project-wide undo and redo, automatic versions, and daily backups you can open as a new project. See docs/HISTORY.md. |
| Cut list | On Export: a CMX 3600 .edl with every clip at its timecode, for conforming in editing and audio programs. See docs/CUT_LIST.md. |
| Accent test | On Voices: samples of each accent with the same voice and passage after one confirmation, A/B rating, saved and exportable. See docs/ACCENT_SHEET.md. |
| Music | Make music with Suno through Kie on the Timeline (instrumental or vocal, V6 versions), hear each track, put one on the timeline. See docs/MUSIC.md. |
| Saved casts | On Cast: keep who speaks with which voice, reuse it in another project by character name. |
| Timeline | Lanes per character, sound clips, atmosphere and music. Drag lines, overlap dialogue (same-character overlaps crossfade), add music that dips under the voices, with snapping, fades and a source and licence note. See docs/TIMELINE.md. |
| Video with the mix | On Export, with a picture set: write a copy of your video with the Greenroom mix as its sound. The picture is copied, not re-encoded. Needs ffmpeg, which Greenroom can download once and check. See docs/VIDEO_MIX.md. |
| Picture | Add a video, read its exact frame rate, place each line at a timecode (scrub, step by frame, drag on a strip, type a timecode), listen with the picture, and export audio that stays in sync: exact picture length, Broadcast Wave time reference, picture-based timecodes in the cue sheet and editor timeline. See docs/PICTURE_SYNC.md. |
| Studio | Voice rights and consent records (required for clones), prices and a project budget with an over-budget warning, a spend ledger, where every take came from with a fingerprint check, and a production report with an AI disclosure. See docs/STUDIO_TRUST.md. |
| Voice lab | The listening comparison used to pick models. |
| Safety | Every paid action shows a cost sheet first. Keys live in the Windows Credential Manager only. |

## Not built yet
Fountain/PDF/Word import, saved casts reused across projects, a translated interface and a version of the video with the new sound.

## Develop
From `app/`: `npm install`, `npx tsc --noEmit`, `npx vitest run`, `cd src-tauri && cargo test`, `npx tauri build`.
Opening the front end in a plain browser (`npx vite`) uses a free demo backend, so every screen can be viewed without spending.

## New in 0.11.0
- **Voice presets** (sidebar: Presets): 120 starter character voices in 12 genres, with search, filters, compare, favourites, readiness ("Requires voice selection" until a compatible voice exists) and Add to Cast. See `docs/VOICE_PRESET_LIBRARY.md` and `docs/PRESET_SCHEMA.md`.
- **Performance compiler**: type how a line should be played ("begins politely, clears his throat, chuckles quietly, pauses, then delivers the final sentence with restrained menace") under Perform. Greenroom shows exactly what the chosen voice will get, what is approximated and what cannot be sent. See `docs/PERFORMANCE_ENGINE.md`.
- **Agent Studio** (sidebar, with a project open): a production brief, a plan, a board, approval gates, a cloud spending limit and a local-only switch. Manual, Guided (recommended) and Autonomous Draft modes. Delivery is always yours. See `docs/AGENT_STUDIO.md`.
- Quality and honesty: `docs/FEATURE_AUDIT.md`, `docs/QA_RESULTS.md`, `docs/COMMERCIAL_LICENSING.md`.

## New in 0.12.3
- **Qwen3-TTS is connected** (experimental). Model Center, Qwen card, "Set up Qwen3-TTS automatically", or the tick in Set up my PC. It makes four described English voices. It is slow on a CPU (about a minute per short line here), a voice can differ a little between lines, and the install is about 6.4 GB. Nobody has listened to it, so it shows as Installed, not Ready.
- The shared installer now installs setuptools first, which a real run showed Qwen needs.

## New in 0.12.2
- **Kokoro is connected.** Model Center, Kokoro card, "Set up Kokoro automatically" (or the Kokoro tick in Set up my PC): installs its runtime, downloads the model and speaks a test line, then adds four English voices to your library. About 2 GB in all; needs internet once. Nobody has listened to it yet, so it shows as Installed, not Ready.

## New in 0.12.1
- **Set up my PC** (Model Center): one confirmation, then Piper and two free English voices are installed in order with progress. Chatterbox (for Re-voice) is an optional tick. Safe to run again: finished steps are skipped.
- **Free preview on this PC**: a preset audition on a cloud voice can play a plain-read local stand-in instead of spending credits. Settings, Local first, makes that the main Audition button. The stand-in is not the cloud voice.

## New in 0.12.0
- **Faces on presets** from the existing portrait library, matched on role, age and presentation, never on accent.
- **Audition with direction**, **character profiles** you can export and import, and an **accent listening test** whose reviews are the only way an accent label can go up.
- **Agent Studio** can line up voice auditions, make a few sound effects inside your limit, and write the finished scene after you approve delivery. The audio check also looks at loudness, music ducking and picture sync.
- **Five demo projects** (four with real local audio), an **accessibility audit** (axe: 0 violations in both themes) and a keyboard pass. See `docs/DEMO_RESULTS.md`, `docs/ACCESSIBILITY.md`, `docs/ACCENT_VERIFICATION.md`, `docs/CHARACTER_PROFILES.md`.
