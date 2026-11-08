# Cinematic Engine audit

Written 2026-11-08 on branch `feat/cinematic-engine-2`, from the code and the project's own test notes. Statuses use five words: **Working and tested**, **Implemented but incompletely verified**, **Experimental**, **Partially implemented**, **Not implemented**. "Evidence" says where each status comes from. Nothing here was judged by ear: Greenroom's rule is that quality claims come only from the owner listening (see `DECISIONS.md`).

## Voice engines

| Engine | Status | Evidence and gaps |
|---|---|---|
| ElevenLabs v4 / v3 | Working and tested | Owner listened and recorded the result (D-01, written direction check 2026-11-08). Library, designed and cloned voices all speak. |
| VoiceKiller | Implemented but incompletely verified | Tested against a fake server only (`voicekiller.rs` tests). Delivery goes in `instructions`, which is a request. Never run live through the installed app (`HOLLYWOOD_READINESS.md`). |
| Kie voices | Implemented but incompletely verified | Fake-server tests. Dialogue v3 had an open error (D-03). |
| Piper | Working and tested | Pinned download, voices, offline speech. Plain speech only. |
| Chatterbox | Partially implemented | Speaks with the default voice only. Acting controls and reference cloning are not connected (`engines.ts` blurb, Model Center card). Voice conversion works (below). |
| WazobiaVoice | Experimental | One-click gated install and 13 built-in voices. Research licence, non-commercial. Accent quality not verified. |
| My local server | Implemented but incompletely verified | Loopback only; no live test with a real server recorded. |
| **Kokoro** | **Partially implemented** | A managed runtime can be installed and checked (`kokoro_runtime_*`). There is **no synthesis route**: `make_clip` has no Kokoro provider and `Engine` has no Kokoro value. A user can install it and still cannot speak with it. |
| **Qwen3-TTS** | **Partially implemented** | Same: runtime install and status exist (`qwen_runtime_*`), no synthesis route, no voice-design adapter. `DESIGN_FOR_CHARACTER.md` says so. |
| **Inworld** (new, this branch) | Implemented, tested against a fake server, **not tested live** | See `INWORLD.md`. |

## AI Director and performance

| Feature | Status | Evidence and gaps |
|---|---|---|
| Local Director (Qwen3 4B, llama.cpp) | Working and tested | Real model on an RTX 3060 12 GB: 8 of 8, 8 of 8 and 7 of 7 lines directed, every answer parsed (`LOCAL_DIRECTOR.md`). |
| Director review and apply | Working and tested | Unit tests; owner-directed lines left alone by default. |
| Written direction per line, styles, AI write | Working and tested | Owner confirmed it works on ElevenLabs (2026-11-08). |
| Direct whole scene | Implemented but incompletely verified | Unit tests and a demo run; not yet run against a real Kie or local model reply. |
| **`PerformancePlan` (`performance.ts`)** | **Connected on 2026-11-08 (later commit), not yet judged by ear** | Originally not connected: the interface (objective, subtext, arc, physical state, events, pace, projection, tension, breathiness, accent strength) and `physicalDirection()` exist with a unit test, but **no screen, no saved project field and no generation path uses them**. Emotional arcs, physical state, breathlessness, fatigue and pain are therefore **not** acting features yet; the only physical controls a user can reach are the situation presets and the written direction. |
| Positioned vocal events | Working and tested (as inline tags) | `VisualLine` places tags between words. This is the ElevenLabs tag system, not a performance compiler. |
| Beat-by-beat acting inside a line | Not implemented | |
| Performance variations (natural, restrained, expressive, intense) | Not implemented | "Make 3 takes" exists but repeats the same direction. |
| A/B take comparison with waveforms | Not implemented | Voice lab plays clips side by side; Perform has no A/B. |
| Character Voice DNA (persistent profile across projects) | Partially implemented | Saved casts and a voice library exist and persist, with consent records. No performance tendencies, approved reference takes or engine-change warning. |
| Acting reference from an approved take | Not implemented | |
| Smart engine router | Not implemented | Engine is chosen by the voice. `engineChip` only reports readiness. |
| Script Doctor (IPA, breath groups, rhythm) | Not implemented | Pronunciation dictionary and CSV import work (D-14). |

## Production

| Feature | Status | Evidence and gaps |
|---|---|---|
| Casting, Auto-cast, saved casts | Working and tested | `AUTO_CAST.md`, unit tests. |
| Timeline, ducking, picture sync | Working and tested (ffprobe-level) | Never opened in Resolve, Premiere or Reaper (`HOLLYWOOD_READINESS.md`). |
| Professional export (48 kHz 24-bit BWF, stems, OTIO, EDL, cue sheet, report) | Working and tested | Same caveat. |
| Speech to speech (Chatterbox VC) | Working and tested | Real run on a CPU runtime; timing kept to 0.01 s (`SPEECH_TO_SPEECH.md`). Microphone recording in the installed app and the GPU were not checked. |
| Local music (ACE-Step) | Working and tested | RTX 3060 (`LOCAL_MUSIC.md`). `acestep_once.py` was later reconstructed and is **untested on a real model**. |
| Local sound effects (Stable Audio Open Small) | Experimental | Gated model; a Python version blocker is recorded (`PRODUCT_ROADMAP.md`). `sfx_once.py` is a reconstruction, **untested on a real model**. |
| Cinematic Performance Manifest | **New, partial** | `manifest.ts` and an Export checkbox. Records line, voice, model, direction, chosen take, fingerprint, consent and what could not be sent. Word and phoneme timing are `null`. No local API or CLI yet. |
| Reaction libraries, spatial perspective, Foley planning, sound-clip validation | Not implemented | |

## Broken or missing connections found

1. `PerformancePlan` is not connected to anything (above).
2. Kokoro and Qwen3-TTS can be installed but not used to speak.
3. Chatterbox speaks but its acting and cloning controls are not wired in, so Model Center and Perform disagree about what it can do.
4. Before this branch the "Direction reaches the voice" line was hard-coded to ElevenLabs and VoiceKiller; any new engine had to be added by hand in three places (`engines.ts`, `generate.ts`, `Perform.tsx`). Inworld was added that way. A capability table per engine would remove that, and is listed below.
5. The three reconstructed runtime scripts (`acestep_once.py`, `sfx_once.py`, `chatterbox_vc_once.py`) have never run against a real model since being rebuilt.
6. `rafter run` has no quota left this billing period, so no remote SAST/SCA scan of this branch has run. `rafter secrets .` ran clean.

## Scope of this branch against the assignment (updated 2026-11-08, end of session)

| Assignment part | State |
|---|---|
| 1 Read the code | Done |
| 2 Audit | This document |
| 3 Expand local engines | **Evaluated, not added.** `LOCAL_ENGINE_EVALUATION.md` records licences and facts from the official pages. No engine was added, downloaded, hashed or tested on 12 GB: Chatterbox's own project is retired, Supertonic is archived, VibeVoice is research-only, and Kokoro and Qwen3-TTS still have no speech route |
| 4 Cinematic Acting Director 2.0 | **Mostly built, none judged by ear.** Per-line performance plan; AI Director writes plans for the whole scene; 12 acting presets; four interpretations with a single cost sheet. **Built:** a Compare takes view with waveforms on one time scale and measured timing. Beat-by-beat acting is built (per-phrase feeling, intention, emphasis, pace and pause, as cues or as separately made and joined phrases) but is **not in the VisualLine editor** (it has its own editor in the Director panel) and **not run against a real voice**; the plan's arc is still only a start and an end. A single phrase of a joined take can be remade (one request, new take, old kept). |
| 5 Character Voice DNA | **Built**: profile on the character, travels with saved casts, engine/voice/model change warning, per-character pronunciations. Not built: stored language/engine compatibility beyond a capability note |
| 6 Director's Performance Memory | **Built (estimates)**: Use as acting reference measures pace, pauses, level and rough pitch; Match acting reference applies pace, projection and the pause. Pitch contour is measured but not applied to a line |
| 7 Smart engine router | **Partly built**: a capability table and a pure suggester (private text is never routed to the cloud, nothing is switched silently) used by Perform to name your voices that can act on a direction. No automatic selection and no cross-engine A/B for the same line |
| 8 Speech-to-speech improvements | **Partly built, unit-tested only**: recording quality warnings, a before/after comparison (timing drift, pauses, liveliness, pitch), saved phrase timings for lip-sync. Not built: whole-scene conversion, character-consistency scoring |
| 9 Script Doctor | **Built without a lexicon**: breath, names and abbreviations needing a spoken form, emphasis for Inworld, rhythm. No IPA, no accent-aware reference pronunciations |
| 10 FilmCrafter/Pulseframe bridge | Versioned manifest with performance plans, in Export. **No local API or command line** |
| 11 Sound production | **Partly built**: automatic technical checks on sound clips and a QA report export; per-character reaction libraries (reuse a clip for free). Also built: Foley sound ideas read from stage directions (keyword-based, 18 sounds), and stereo position and distance per line in the mix. Not built: a room simulation, better ambience transitions (dialogue-aware ducking already existed) |
| 12 UI/UX | **Built**: Simple/Director/Advanced on Perform; Model Center shows Download required, Installed, Ready, Requires setup or Unsupported, never "Ready" for a model Greenroom cannot use, and no longer offers to install runtimes that do nothing. Not built: a regrouping of Model Center by capability |
| 13 60-second stress test | **Kit written, not run**: `STRESS_TEST.md` has the original three-character script, procedure and listening sheet. No audio was generated |
| 14 Delivery | Installers rebuilt, screenshots captured, branch pushed. No pull request (no GitHub login) |
| Phase 15 Inworld | Done and tested against a fake server; **not run live**. See `INWORLD.md` |

## Suggested order for what remains

1. Connect `PerformancePlan` to real data (a versioned `performance` field on a line, migrated from the existing direction) and compile it for the engines that can act on it. Everything else in section 4 depends on this.
2. Give each engine a small capability table (steering, non-verbal tags, cloning, language list, sample rate) read by Perform, the cost sheet and the router.
3. Add a Kokoro synthesis route, since its runtime already installs, before adding new engines.
4. For each new local engine: verify the official repo, licence and weights hash first, then run a real generation on 12 GB before showing it in Model Center.
