# Greenroom Local Product Roadmap

The immediate priority is to make the working audio-production loop exceptionally clear: script, voice, direction, sound, review and export. New model labels should follow working capability, not lead it.

## Next release priorities

### 1. Finish the local voice engine

Connect the Chatterbox local runtime to selectable voices, reference-audio cloning and testable acting controls. Add a short built-in listening suite before advertising an accent or expression as ready.

### 2. Make local models operational, not collectible

Add a pinned, tested inference route for WazobiaVoice only after its complete runtime, required files, licence and performance behaviour can be verified. Until then, Greenroom may manage the downloaded weight but must not offer it as a usable voice.

### 3. Local transcription

Integrate Whisper as a real in-app transcription workflow: import audio, transcribe locally, review timing and attach the result to the project. The model should not reappear in Model Center until this route works end to end.

### 4. Better guided onboarding

Add a first-run checklist that recognizes whether the person wants offline voices, cloud voices, sound effects or a combination. It should install only the selected essentials and make disk size and privacy tradeoffs obvious.

### 5. Listening-led accent quality

Build curated audition packs for Nigerian English, Yoruba, Igbo, Hausa, British English, Filipino English and Korean. Record listener ratings, speaker/reference context and limitations rather than making broad accent claims.

## Product design principles

- A button must perform a useful action, not open a research link.
- A model download is not a working engine. The interface must say which is true.
- Local-first means no terminal, no hand-managed folders and no surprise network calls.
- Cloud features remain optional, visible and confirmed before paid work.
- Voice cloning requires consent, and accent quality is validated by listening rather than marketing labels.

## Later opportunities

- A scene-level performance board for pace, energy and physical continuity.
- Versioned sound-design presets for podcasts, drama, training and games.
- Guided model update channels with license/change notices.
- A commercial-rights report that surfaces provider terms alongside each final asset.

## Cinematic Engine 2.0 (requested 2026-11-08)
Audit and status are in `docs/CINEMATIC_ENGINE_AUDIT.md`. Done so far: Inworld as a cloud engine (`docs/INWORLD.md`) and a versioned performance manifest. Not started: new local engines, the Acting Director beat editor, Voice DNA, performance memory, the engine router, Script Doctor and the 60-second stress test. `PerformancePlan` in `performance.ts` is not connected to any screen and is the first thing to wire.

## Lessons from Vois Studio (reviewed 2026-11-02, from a screenshot and its public site)
- **A pipeline-shaped top bar** (Home, Projects, Listen, Voices, Tutorials) and a home screen of three big actions, then templates, then tutorials. Greenroom opens on an empty project list: add templates (Podcast, Audiobook, Game dialogue, Ad, Training) that create a cast and sample script.
- **A visible engine tier chip** ("Expressive") with a status dot, always in the header: show the active voice engine and whether it is ready.
- **Engines downloaded on first use with the size and hardware shown first**, grouped as quality tiers. Group Model Center by tier (Fast, Expressive, Direct-in-words) rather than by model name.
- **Export presets** per destination (ACX, Spotify, Apple, YouTube). Greenroom has loudness; add named presets.
- **Pronunciation dictionary with CSV import.**
- What Vois does not appear to have, and Greenroom can own: performance direction by body state, a consent ledger, picture sync, local SFX and music.

## Done from the Vois review (v0.2.2)
Home templates and the engine-ready chip (see `docs/HOME_AND_TEMPLATES.md`). Still open from that review: Model Center grouped by quality tier, named export presets, pronunciation CSV import.

## Done (v0.2.4 to v0.2.8)
Speech to speech (`docs/SPEECH_TO_SPEECH.md`, tested on a real machine) and a fix for the Chatterbox install (missing setuptools). Also:
Local AI Director with Qwen3 4B (`docs/LOCAL_DIRECTOR.md`, tested on a real model); auto-cast and per-character export grouping (`docs/AUTO_CAST.md`). Also:
Local sound effects with Stable Audio Open Small (`docs/LOCAL_SFX.md`, real model untested: gated); local music with ACE-Step, tested on an RTX 3060 (`docs/LOCAL_MUSIC.md`); export presets; pronunciation CSV.

## Still to build (requested 2026-11-02, not started)
Foley from picture, local Acting Director, speech-to-speech, performance compiler, one-click packs for every model. WazobiaVoice is the first model on the new gated one-click path (`docs/WAZOBIA_INSTALL.md`); the same pattern (pinned manifest, token, verified download, golden-path card) is the template for the rest.

## Local SFX and music: findings (checked on Hugging Face and PyPI, 2026-11-02)
| Model | Use | Licence | Gated | Runtime |
|---|---|---|---|---|
| Stable Audio Open Small | sound effects, short loops | Stability AI Community (free below a revenue limit, read before commercial use) | Yes, accept terms with a Hugging Face account (same flow as WazobiaVoice: `install_gated`) | `stable-audio-tools` |
| ACE-Step v1 3.5B | full songs, optional vocals | Apache-2.0 | No (can be pinned like Chatterbox) | diffusers-style pipeline |
| AudioLDM2, MusicGen | effects, music | CC-BY-NC (non-commercial) | No | skip for commercial users |

**Blocker found:** `stable-audio-tools` 0.0.20 requires Python 3.10 (`<3.11`) and `torch==2.7.1`, but Greenroom's managed runtime is Python 3.11.9 with torch 2.6.0. Local SFX therefore needs its own pinned Python 3.10 runtime (separate from Chatterbox, Kokoro and Qwen), several GB, and a real-machine test of install and generation. Nothing was built for it blind, because install and generation could not be checked here (the weights are gated).

**Suggested next spike (needs the owner's Hugging Face token on a real PC):** build the Python 3.10 runtime, install stable-audio-tools, run one 8-step generation from the local weights, then wrap it in the Model Center card pattern used for WazobiaVoice. ACE-Step is the easier first win because it is ungated and Apache-2.0.

**Update (v0.2.5):** the Python 3.10 blocker above was solved with a separate managed runtime; install and worker were tested on a real PC with a stand-in model. Still needed: a first real run with the owner's Hugging Face token.

## Foley from picture: findings (2026-11-02)
| Model | Licence | Verdict |
|---|---|---|
| HunyuanVideo-Foley | Tencent Hunyuan Community: excludes the EU, UK and South Korea and forbids using the output outside its territory | Cannot ship in a distributable tool |
| MMAudio | CC-BY-NC weights | Non-commercial |
| ThinkSound | Apache-2.0 code and weights, **but its pipeline loads MetaCLIP-huge (CC-BY-NC 4.0)** as the video encoder and a ~34 GB T5-XL, and its VAE is a Stability AI Community fine-tune | Installs and imports on an RTX 3060 (tested), but the non-commercial component rules it out |

So there is no commercially usable one-model "video in, sound out" option today. A possible alternative built only from licensed parts: sample frames, have a local vision-language model (Apache-2.0) list the sound events with times, then make each sound with the existing local or cloud sound-effects engine and place it on the timeline. It is coarser than a true video-to-audio model (timing comes from sampled frames), and it needs a vision model through the already-managed llama.cpp.

## Status at 0.11.0 (2026-11-09)
Done in this release: voice preset library (120 starters), performance compiler, Agent Studio (plan, gates, budget, local-only, resume, selective regeneration, audio check). Tested with unit tests, fake engines and the demo backend; **not run against live engines, and nothing was judged by ear.**

Next, in order:
1. Run a real production through the Agent Studio with the owner's keys and listen: confirm which sound tags and directions actually work per engine, and record it in `DECISIONS.md`.
2. Map presets to avatar-library portraits and add a per-accent listening test (Nigerian English, Yoruba, Igbo, Hausa, Pidgin first) so accent labels can honestly move up from "unverified".
3. Agent audition step (comparison clips), agent-generated ambience and effects, whole-scene re-voice.
4. A Venomspur signature preset once his profile and portrait are in the repository.
5. Persistent character profile fields (background, audition script, consent note, model compatibility) and profile import/export. Voice DNA covers timbre, accent, tendencies, range, pronunciations, references and the approved voice today.
6. Code-signing certificate and updater key.

## Status at 0.12.0 (2026-11-09)
Added since 0.11.0: preset portraits, directed auditions, character profile extras with import and export, the accent listening-test suite and review store, agent steps for auditions, sound effects and gated export, loudness, ducking and sync checks, an accessibility audit with fixes, and four demo projects rendered with real Piper audio. Still true: **nothing has been judged by ear and no cloud engine has been run through the agent.**

Next, in order:
1. **Listen.** Run the Agent Studio on a real project with ElevenLabs and a small limit; listen to the tags and the acting; record what works per engine in `DECISIONS.md`.
2. **Accent reviews.** Have a native speaker of each Nigerian accent run the listening test on the voices you use, so labels can honestly move.
3. Render the Nigerian family drama with ElevenLabs or WazobiaVoice once the owner has listened to the voices.
4. Screen-reader, zoom and high-contrast testing; axe on the screens not yet covered.
5. A Venomspur signature preset when his profile and portrait are added; whole-scene re-voice once per-character references exist; agent-made music.
6. Code-signing certificate and updater key; a Rafter API key for the remote scan.
