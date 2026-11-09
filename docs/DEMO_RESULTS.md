# Demonstration projects

Built 2026-11-09 with Greenroom 0.12.0. Generated from `docs/demo-results.json` by `scripts/demo/make_results_md.mjs`; the builder is `app/src/demo/buildDemos.spec.ts` (guarded: it runs only with `GREENROOM_BUILD_DEMOS=1`).

## What is real and what is not

- **Real:** the Agent Studio's own planner, steps, quality check and export ran headlessly in **local-only** mode with a spending limit of **zero**. The only engine was **Piper**, called directly with the same binary, voice files and arguments the app's Piper route uses. Every take is real Piper inference, saved in the app's project format under `Documents\Greenroom Local\projects\demo-*`, so the projects open in Greenroom.
- **Verified independently:** each exported WAV was checked with ffprobe and ffmpeg's EBU R128 meter, and the figures matched the app's own report.
- **Not real:** the delivery approval was given by the build script standing in for a person (the audit log says so). **Nothing was judged by ear.** No cloud engine was called, no key was read, nothing was spent.
- **Stand-ins:** only four Piper voices exist here (two British or Scottish, two American). Piper cannot act on written direction, play laughs or coughs, hold a timed pause, or do children's, Nigerian, Yoruba, Igbo or Hausa voices. So those behaviours are listed below as **not sent**, the child character is voiced by an adult, and the Nigerian family drama is **not rendered at all**.

## Demo: Venomspur (dark comedy)

| | |
|---|---|
| Engine | Piper (local, real inference) |
| Characters, lines, takes | 2, 8, 8 |
| Speech made | 34.6 s |
| Average take loudness | -16.9 LUFS |
| Spent | 0 |
| Exported scene | 37.8 s, -16 LUFS, true peak -2.9 dBTP |
| SHA-256 of the export | `3f8ae7e2fac8df41…` |
| Audio check | 9 problems, 1 to listen to |

Steps: analyze completed, cast completed, audition completed, direct completed, qc completed, sound planned, timeline completed, export completed, 8 takes completed.

**Asked for, not sent (Piper cannot do these):**

- emotion: nervous (piper does not act on written direction)
- physical state: still (piper does not act on written direction)
- voice: quiet, tense (piper does not act on written direction)
- emotion: polite → menacing (piper does not act on written direction)
- clear throat (piper does not play sounds from tags)
- chuckle (piper does not play sounds from tags)
- pause 0.7s (one-request lines cannot hold a timed pause)
- a pause after a phrase (needs assemble mode)

Audio-check findings:

- GRIMBLE: more than 51% of the take is silence. Listen.
- GRIMBLE: not played by the engine: emotion: nervous (piper does not act on written direction).
- GRIMBLE: not played by the engine: physical state: still (piper does not act on written direction).
- GRIMBLE: not played by the engine: voice: quiet, tense (piper does not act on written direction).
- VENOMSPUR: not played by the engine: emotion: polite → menacing (piper does not act on written direction).

Checked on disk after writing:

- 2 characters, each with a library voice, a profile and a portrait
- 8 take files present, each matching its recorded SHA-256
- agent run reads back through the strict reader (16 steps, 34 audit entries, local-only: true)
- exported WAV present on disk

## Demo: Nigerian family drama

**Planned, not rendered.**

Needs a voice engine that can do Nigerian English, Yoruba, Igbo and Hausa accents (ElevenLabs with your key, or WazobiaVoice installed). Piper here has none, and rendering these characters in an unrelated accent would be misleading. The accent labels are unverified; use the Listening test before relying on them. The dialogue is English: lines in Yoruba, Igbo or Hausa need a native writer.

4 characters and 8 lines are cast on your own ElevenLabs library voices, with a Guided run planned (cloud limit 3). Open it in Agent Studio to see the estimate and start it yourself; nothing was generated or spent.

## Demo: Children's adventure (animated)

| | |
|---|---|
| Engine | Piper (local, real inference) |
| Characters, lines, takes | 3, 8, 8 |
| Speech made | 35.6 s |
| Average take loudness | -16.9 LUFS |
| Spent | 0 |
| Exported scene | 38.8 s, -16 LUFS, true peak -1.8 dBTP |
| SHA-256 of the export | `0655fe6a8a0acf96…` |
| Audio check | 0 problems, 0 to listen to |

Steps: analyze completed, cast completed, audition completed, direct completed, qc completed, sound planned, timeline completed, export completed, 8 takes completed.

Nothing was asked for that Piper cannot do.

Checked on disk after writing:

- 3 characters, each with a library voice, a profile and a portrait
- 8 take files present, each matching its recorded SHA-256
- agent run reads back through the strict reader (16 steps, 34 audit entries, local-only: true)
- exported WAV present on disk

## Demo: Fantasy RPG dialogue

| | |
|---|---|
| Engine | Piper (local, real inference) |
| Characters, lines, takes | 4, 8, 8 |
| Speech made | 38 s |
| Average take loudness | -16.4 LUFS |
| Spent | 0 |
| Exported scene | 41.2 s, -16 LUFS, true peak -2.4 dBTP |
| SHA-256 of the export | `39c4fb7f6759f0bd…` |
| Audio check | 6 problems, 0 to listen to |

Steps: analyze completed, cast completed, audition completed, direct completed, qc completed, sound planned, timeline completed, export completed, 8 takes completed.

**Asked for, not sent (Piper cannot do these):**

- physical state: still (piper does not act on written direction)
- voice: projected (piper does not act on written direction)
- shouting (piper cannot whisper or shout on request)
- grunt (piper does not play sounds from tags)
- pant (piper does not play sounds from tags)

Audio-check findings:

- MARA: not played by the engine: physical state: still (piper does not act on written direction).
- MARA: not played by the engine: voice: projected (piper does not act on written direction).
- MARA: not played by the engine: shouting (piper cannot whisper or shout on request).
- MARA: not played by the engine: grunt (piper does not play sounds from tags).
- MARA: not played by the engine: pant (piper does not play sounds from tags).

Checked on disk after writing:

- 4 characters, each with a library voice, a profile and a portrait
- 8 take files present, each matching its recorded SHA-256
- agent run reads back through the strict reader (16 steps, 34 audit entries, local-only: true)
- exported WAV present on disk

## Demo: Science explainer (narration)

| | |
|---|---|
| Engine | Piper (local, real inference) |
| Characters, lines, takes | 2, 7, 7 |
| Speech made | 37.1 s |
| Average take loudness | -18.1 LUFS |
| Spent | 0 |
| Exported scene | 39.9 s, -16.2 LUFS, true peak -1 dBTP |
| SHA-256 of the export | `592c07ed29b8346b…` |
| Audio check | 0 problems, 0 to listen to |

Steps: analyze completed, cast completed, audition completed, direct completed, qc completed, sound planned, timeline completed, export completed, 7 takes completed.

Nothing was asked for that Piper cannot do.

Checked on disk after writing:

- 2 characters, each with a library voice, a profile and a portrait
- 7 take files present, each matching its recorded SHA-256
- agent run reads back through the strict reader (15 steps, 32 audit entries, local-only: true)
- exported WAV present on disk

## Honest summary

Four of five demos exercise real generation, casting, direction, a quality check and export end to end on local hardware. They do **not** show how the acting sounds on an engine that can act (ElevenLabs, Inworld), how any accent sounds, or the cloud path. Those need your keys and your ears. The Venomspur and fantasy-RPG demos deliberately carry acting that Piper cannot perform, so the not-sent list and the audio check are exercised for real.
