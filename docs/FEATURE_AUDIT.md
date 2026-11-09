# Feature audit (Phase 1)

Written 2026-11-09 on branch `feat/agent-studio-presets` (cut from `feat/cinematic-engine-2` at `edcf81f`, version 0.10.0).

**How to read this.** Status words: **Working and tested**, **Implemented, not verified live**, **Partial**, **Experimental**, **Not implemented**. A button, a component, a document entry or a model weight is never enough for "implemented". Nothing here was judged by ear: Greenroom's rule is that quality, accent and sound claims come only from the owner listening (`DECISIONS.md`).

**Depth of this audit.** This pass re-ran the baseline and read the capability table, the performance plan, voice DNA, casting, director, manifest and type files. It then reconciled them with the detailed audit already in [`CINEMATIC_ENGINE_AUDIT.md`](CINEMATIC_ENGINE_AUDIT.md) (written 2026-11-08, with per-engine evidence). It did **not** trace every feature from a UI click to generated audio, and it did not run any engine. Rows marked "from earlier audit" were carried over, not re-verified today.

## Baseline (run today, 2026-11-09)

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Clean |
| `npx vitest run` | 66 files, **708 passed** before this work; 79 files, **909 passed** after (plus 1 guarded demo builder) |
| `cargo test` | **121 passed**, 1 ignored |
| `cargo clippy --all-targets -- -D warnings` | Failed on arrival (one lint, `chunks_exact_to_as_chunks`, new in Rust 1.98); **fixed**, now clean |
| `npm audit` / `cargo audit` / `rafter secrets` | Re-run at the end: 0 vulnerabilities, 0 vulnerabilities (6 allowed warnings), no secrets. `rafter run` (remote) not run: no API key on this PC |
| `npx tauri build`, headless smoke script | Not run today |

## Capability audit

| Capability | Status | Evidence |
|---|---|---|
| Script editor, import (txt, md, fountain, docx, pdf) | Working and tested (samples and hostile files; not the owner's real scripts) | `scriptImport.ts`, `script_import.rs`, tests; `HANDOVER.md` §9 |
| Cast assignment, auto-cast, saved casts | Working and tested | `cast.ts`, `autocast.ts`, `cast.test.ts`, `autocast.test.ts` |
| Persistent character identity | Partial | `Character` has name, voice, language, `look`, `about`, avatar, `dna` (`types.ts`). `VoiceDna` holds timbre, accent, tendencies, range, presets, pronunciations, references and a voice identity with an engine-change warning (`voiceDna.ts`). Missing against the brief: age range and presentation as structured fields, background, audition script, consent metadata on the profile, model compatibility list, versioned provenance, profile import/export. |
| Voice library, design, cloning, import | Working and tested for ElevenLabs (owner listened); others from earlier audit | `Voices.tsx`, `CINEMATIC_ENGINE_AUDIT.md` |
| Local engines | Mixed (see below) | `engineCaps.ts`, earlier audit |
| Cloud engines | ElevenLabs working (owner listened); VoiceKiller, Kie, Inworld tested against fake servers only | earlier audit, `INWORLD.md` |
| Emotional acting, vocal events | Working for ElevenLabs as written tags; per-engine support is declared in one table | `engineCaps.ts` (`words`, `nonverbal`), `performance.ts` |
| Performance compiler | Partial. `compilePerformance()` turns a structured `PerformancePlan` (objective, subtext, arc, physical state, events, pace, projection) into delivery text. There is **no** compiler from free-text direction ("clears his throat, chuckles, pauses...") to a plan, and no per-engine report of what could not be sent beyond Inworld's `notSent`. | `performance.ts:117-190` |
| AI Director, Acting Director | Working and tested for the plain Director (real local model, 8/8); per-line plans and scene direction written by an AI, none judged by ear | `director.ts`, `LOCAL_DIRECTOR.md` |
| Acting styles asked for (naturalistic, restrained, comedic timing, horror suspense, ...) | Partial: 12 acting presets and four variations exist (`acting.ts`); the nine requested scene styles are not a named set | `acting.ts` |
| Speech to speech | Working and tested (Chatterbox VC, CPU) | `SPEECH_TO_SPEECH.md` |
| Accent and language verification | **Not implemented.** Accent is a free-text label. No listening-test suite exists. | `Character.language` is a free label |
| SFX generation and placement | ElevenLabs working; local Stable Audio Open Small experimental and untested on a real model | earlier audit |
| Music | ACE-Step working on an RTX 3060; the script was later reconstructed and is untested | `LOCAL_MUSIC.md` |
| Timeline, picture sync, ducking | Working and tested at ffprobe level; never opened in Resolve, Premiere or Reaper | earlier audit |
| Takes, comparison | Take generation working; Compare view with waveforms built | earlier audit |
| Export formats and presets | Working and tested (BWF 48 kHz 24-bit, stems, OTIO, EDL, cue sheet, manifest) | `exportPresets.ts`, `EXPORT_PRESETS.md` |
| Consent, licensing, provenance | Consent and licence records on voices; provenance on every take (engine, voice, sha256, version) | `types.ts` (`Consent`, `LicenceUse`, `Provenance`), `trust.ts` |
| Budget and cost confirmations | Every paid call goes through `confirmSpend` (`ctx.tsx`); no live spend recorded in any test | `CLAUDE.md` rule |
| Onboarding, help, accessibility | Help screen and templates exist; no accessibility audit has been done | not audited |
| Voice presets | **Not implemented before this branch.** `acting.ts` has 12 *acting* presets (delivery styles), which are not voice presets. | grep of `app/src` |
| Agent Studio / job graph / producer orchestrator | **Not implemented.** No job graph, checkpoints, budget governor or agent tools exist. | grep of `app/src` |

## Local engines (carried over from the earlier audit; not re-run)

| Engine | Status |
|---|---|
| Piper | Working and tested, plain speech only |
| Chatterbox | Speaks with the default voice; acting and cloning not wired; voice conversion works |
| WazobiaVoice | Experimental; research licence, non-commercial; accent quality unverified |
| Kokoro, Qwen3-TTS | Runtime installs but **no synthesis route**: a user can install them and still not speak |
| My local server | Loopback only; no live test recorded |

## Documentation versus code

- `CINEMATIC_ENGINE_AUDIT.md` says `PerformancePlan` "connected on 2026-11-08 (later commit)"; the code confirms `effectiveLine()` uses it. Consistent.
- The handover says clippy is clean; on Rust 1.98 it is not (see baseline). Documentation is behind the toolchain, not the code.
- Not yet compared line by line: `README.md`, `PRODUCT_ROADMAP.md`, `GETTING_STARTED.md`, `RELEASE_QA.md`.

## What this branch adds (0.12.0), and its honest state

| Item | State |
|---|---|
| Preset schema, 120 starter presets in 12 genres, Presets screen (genres, search, filters, favourites, recents, compare, readiness gate, Add to Cast, import and export) | Built and tested; all accents unverified or experimental |
| Preset portraits from the avatar library, matched on role, age and stated presentation only | Built; 13 tests against the real library |
| Audition with the preset's acting direction | Built for ElevenLabs; other engines get a plain read and say so |
| Performance compiler and "Direct in your own words" | Built; 45 tests including the Venomspur example; wired into take planning, the cost sheet and provenance. Accents and languages cannot change inside a line |
| Character profile extras (background, age, presentation, pitch, texture, signature behaviours, audition, consent note, provenance, compatibility) with export, import and duplicate | Built; 14 tests. Files carry no voice id or consent |
| Accent listening-test suite and review store | Built; 15 tests. **No review recorded, so no label has moved** |
| Agent Studio: plan, modes, gates, budget, local-only, resume, regeneration, audit log; steps for auditions, sound effects (six at most) and gated full-scene export | Built; run for real only against Piper (local, free) |
| Quality check: missing, flat-top clipping, silence, timing, unsupported sounds, wrong voice, rights, **loudness consistency, music ducking, picture sync** | Built and tested |
| Accessibility | axe-core: 108 light-theme failures fixed, 0 on 12 screens in both themes; keyboard pass on the new screens. No screen reader test |
| Demonstration projects | Four rendered with real Piper audio and verified with ffmpeg; the Nigerian family drama **planned, not rendered** |
| Security tests for the new code | 12 tests; `rafter secrets`, `npm audit`, `cargo audit` clean; `rafter run` not run (no API key on this PC) |
| Clippy on Rust 1.98 | Fixed |
| Whole-scene re-voice | **Not built** (needs per-character reference recordings and source performances) |
| Venomspur signature preset | **Blocked:** no profile or portrait in the repository |
| Real cloud engine run, ear judgement, installed-app click-through | **Not done** (keys, ears and a person are needed) |

## Known blockers for the remaining work

- Real-machine audio verification needs the owner's installed engines and keys; no paid call may be made while testing (project rule).
- Accent authenticity and voice quality can only be recorded after the owner listens.
- Nigerian presets are limited to the two engines that declare Nigerian English in this code base (WazobiaVoice, ElevenLabs); this is a declaration, not a tested result.
