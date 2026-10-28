# Greenroom Local: inherited historical plan

> This document came from the original Greenroom codebase and is retained as implementation history only. It is not the active Greenroom Local plan. Greenroom Local is local-first, cross-platform, accent-first and centered on a structured acting engine. See `README.md` and `docs/LOCAL_AI_ARCHITECTURE.md` for the active direction.

Status: proposed, awaiting owner approval. No app code is written until approved.

## What it is
A Windows desktop app where you paste a scene, give each character a voice, direct each line with emotion and sound chips (laugh, sigh, cry, gasp, cough, sneeze, whisper, out of breath), and export a lifelike audio scene. One screen, no gated steps.

## Principles
0. Everything is done in the app window. The owner never needs a terminal: keys are pasted into Settings, tests and exports are buttons, releases are an installer.
1. One path, nothing blocks you. Warnings, not walls.
2. Cloud-first for v1. Local models come after the listening spike.
3. Provider-independent: every model sits behind one adapter interface. No unverified model IDs are hardcoded.
4. Paid generation always shows an estimated cost and asks first.
5. Keys live only in Windows Credential Manager. Never logged.
6. Nothing is claimed (accents, sounds) until heard and recorded.
7. Licence and consent: a one-line notice, shown only when cloning a voice or marking a project commercial.

## Product shape
1. Write: paste a scene or `NAME: line` text.
2. Cast: pick a voice per character (search by language and accent, preview).
3. Perform: a card per line with emotion chips and intensity, sound chips, Re-take (3 takes), Play scene.
4. Export: one mixed file; per-line and per-character files optional; optional ambience or music bed with one slider.
Later: an AI Director button that proposes emotion and sound chips from the script.

## How lifelike is achieved (all candidates, to be verified in Slice 0)
- Emotional speech: ElevenLabs v3 audio tags ([laughs], [whispers]) driven by the chips.
- Cough, sneeze, gasp, exertion: short non-speech clips from a sound-effects model, spliced into the line. Warn only when a voice truly cannot do it.
- Local option later: Chatterbox (licence and hardware check first).

## Stack
Tauri 2, React, TypeScript, Rust services, FFmpeg for mixing and export. Local project files, no database, no cloud backend. Atomic saves; generated takes are immutable.

## Slices (each demoable; stop for sign-off between slices)
| # | Slice | Done when |
|---|---|---|
| 0 | Listening Lab inside the Windows app: a Settings box to paste keys (stored in Windows Credential Manager), a Run test button showing the cost first, then clips side by side with play buttons and a 1-5 rating | Owner hears results in the app; provider choice recorded with evidence. This screen stays as a Settings/Lab page |
| 1 | App shell, Write and Cast, key storage | Pasted scene shows characters with previewable voices |
| 2 | Perform: line cards, chips, takes | One line can be directed and audibly changes |
| 3 | Play scene and Export | A finished scene exports as WAV/MP3 plus per-line files |
| 4 | Ambience/music bed and AI Director | One click proposes a performance the owner can edit |
| 5 | Polish, installer, landing page | Ready to share |

## Left out of v1
Model Lab, hardware profiles, capability registry, video import and generation, OTIO export, loudness targets, multi-bus mixer. They remain in the Soundstage repo.

## Reuse from Soundstage
Script parser, ElevenLabs adapter, Credential Manager access, take handling. Copy and simplify; do not carry over the gated flow.

## Acceptance (v1)
- Paste a scene, cast it, direct lines, hear it, export it, without leaving one screen.
- Laugh, sigh and cry audible on a supported voice; unsupported sounds flagged before render.
- Re-taking one line changes nothing else.
- Reopening a project after a crash loses no committed work.
- No paid call happens without a shown cost and a click.

## Open items
- Name is not trademark or domain checked.
- Whether it is for personal use or to sell (affects pricing and who pays API costs).
- Third-party model facts are unverified until Slice 0.
- Tests: each slice ships with tests for its workflow and an honest "not checked" list.
