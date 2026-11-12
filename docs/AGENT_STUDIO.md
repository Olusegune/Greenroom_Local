# Agent Studio

Sidebar: **Agent Studio** (project open). The creator stays the director; Greenroom plans and works through the production with them. It is not a chat box: it is a plan, a board, gates and an audit log over the services Greenroom already has.

Code: `app/src/agent/` (`graph.ts` run rules, `plan.ts` planner, `brief.ts` instruction reader, `services.ts` what each step does, `quality.ts` audio check, `persist.ts` safe reading of saved runs) and `app/src/screens/AgentStudio.tsx`, `agentEnv.ts`. Tests: `app/src/agent/*.test.ts` (59) and `scripts/qa/agent_e2e.mjs`.

## Modes

- **Manual Studio**: the agent runs nothing. All the usual screens work as before.
- **Guided Agent** (default, recommended): works through the plan and stops for approval at creative, spending, voice-rights and delivery steps.
- **Autonomous Draft**: makes a first draft inside the limits you set. Creative and spend checkpoints are covered by the cloud spending limit you set; **voice-rights decisions and final delivery still wait for you.**

## The plan

Analyze the script, recommend and approve the cast, line up voice auditions, compile acting direction, make one take per line, check the audio, make ambience and sound effects (off by default), assemble the timeline, export the full scene. Each step has dependencies, a gate, an estimate and a status on the board: planned, running, awaiting approval, completed, failed or stopped. You can turn optional steps on or off, approve or reject, try a failed step again, remake one line, and resume after an interruption. Updating a plan keeps finished steps whose inputs did not change, and a line with an approved take is never remade unless you ask.

## What the agent will not do (each is enforced and tested)

- **Local-only** runs never use a cloud voice and send nothing to a company; the switch is on by default, and a saved run with a missing flag reads as local-only.
- A cloud step never runs past the **cloud spending limit**, and a step that would cross it is stopped before it is made.
- A **paid step is never retried automatically**, so a failure cannot charge twice. A local step gets one retry.
- A **cloned voice with no consent record** is never used.
- It never exports or delivers: the last step prepares and opens Export. Delivery is yours.
- Autonomous mode asks once, before starting, to spend up to your limit. Guided mode asks per paid step. Both use the existing cost sheet and ledger.
- It makes no direct provider call. Takes go through the same generation path as Perform, so they keep their normal provenance, `notSent` list and cost record.
- Every change to the project is an Undo step; every state change is in the audit log (last 500 entries).

## Reading a brief

`interpret` turns instructions such as "Keep total cloud spending below $5", "Use local models unless cloud generation is necessary", "Make this scene more emotionally restrained", "Give the villain a more sophisticated British voice", "Use Nigerian English where appropriate", "Make the dialogue feel less robotic", "Regenerate only the lines that sound unnatural" and "Create a version suitable for a children's animated film" into **explicit proposals**. Budget and privacy proposals can be applied to the limits with one button; everything else is a suggestion. Sentences it does not understand are shown back.

## The steps added in 0.12.0

- **Voice auditions:** for each character, the voices in your library that suit their preset, with a Play button on the board. Nothing is generated until you press Play; local voices are free, cloud voices ask first. A local-only run offers only local voices.
- **Sound effects:** reads up to **six** sounds from the stage directions and makes them with your chosen sound engine, placing each next to its line. Off until you turn it on; a cloud sound engine makes it a spend step inside the cloud limit; it never remakes a sound a line already has.
- **Export:** after you approve delivery, mixes the approved takes on the timeline with the project's saved export settings, brings the level to the chosen loudness target without exceeding the peak ceiling (it says when the ceiling stopped the target) and writes one 24-bit WAV into the project's export folder (`app/src/exportScene.ts`). Stems, OTIO, EDL, the cue sheet and the report stay on the Export screen. It refuses while there are real problems (a line with no take, an unconsented clone, a take with flat-topped clipping). Acting an engine could not perform is listed in the result, not hidden, and does not block the file.

## Casting in the agent (0.13.0)

The plan now has two casting steps. **Recommend the cast** runs freely: it reads what the script states about each character (age, gender word, "Yoruba-speaking", "with a British accent"), asks about what it leaves open (a nationality is not an accent), and assigns a voice only when it is **proven** to fit. Everything else is listed with candidates and reasons, and the step stops with "The cast needs your decision". It never invents a gender, age, language or accent, never writes a preset's guesses onto a character, and never touches an approved voice. **Approve and lock the cast** is a separate step whose gate is never automatic, in every mode: only you can approve a voice. Takes are made only after it, through the same casting guard as the Perform screen. Details: `docs/CASTING_MATCH_ENGINE.md`.

## Audio check

Flags missing takes, **clipping** (counts runs of flat-topped samples; a take normalised to full scale is not called clipped, and a peak-only measurement is only a reason to listen), long silence, timing far from the usual length, **loudness** far from the scene's typical level (more than 6 LU), **music that does not duck** under dialogue (ducking off, no clip set to duck, or a dip under 6 dB), **picture sync** (a line running past the end of the picture, lines that overlap, no cues), sounds an engine could not play, a take made with a different voice than the one now cast, and unconsented clones. Measurable problems are "problems"; anything subjective is "listen". It never calls a performance good or bad.

## Not built, honestly

- **Whole-scene re-voice.** It needs a source performance and a target reference recording for every character, which a script does not have. Single-line re-voice on Perform is unchanged.
- Agent-made **music**; agent-driven picture sync; more than six sounds per run.
- Exporting stems, OTIO, EDL, cue sheets or the production report from the agent (use Export).
- A run against live cloud engines. It has been run for real only against Piper, in local-only mode (see `DEMO_RESULTS.md`).

## Delivery to a destination (0.15.0)

After you approve delivery, the export step reads the brief for a destination and for stems. "Export this as a podcast with stems" gives two reviewable proposals: the Podcast preset and stems. Words are matched only when an export verb (export, deliver, master, publish, hand, send) is in the same sentence, so story words such as "film" never choose a format. Files written: the full mix; one file per scene when the preset asks (audiobook, training); a Stems folder with one track per character, sound clips, atmosphere and music; and each chosen line in a folder per character (game, editor). All share the gain of the full mix. The step reports the preset, the loudness target, and the file list. OTIO, EDL, the cue sheet and the production report remain on the Export screen. The agent makes no music.
