# Agent Studio

Sidebar: **Agent Studio** (project open). The creator stays the director; Greenroom plans and works through the production with them. It is not a chat box: it is a plan, a board, gates and an audit log over the services Greenroom already has.

Code: `app/src/agent/` (`graph.ts` run rules, `plan.ts` planner, `brief.ts` instruction reader, `services.ts` what each step does, `quality.ts` audio check, `persist.ts` safe reading of saved runs) and `app/src/screens/AgentStudio.tsx`, `agentEnv.ts`. Tests: `app/src/agent/*.test.ts` (59) and `scripts/qa/agent_e2e.mjs`.

## Modes

- **Manual Studio**: the agent runs nothing. All the usual screens work as before.
- **Guided Agent** (default, recommended): works through the plan and stops for approval at creative, spending, voice-rights and delivery steps.
- **Autonomous Draft**: makes a first draft inside the limits you set. Creative and spend checkpoints are covered by the cloud spending limit you set; **voice-rights decisions and final delivery still wait for you.**

## The plan

Analyze the script, recommend and approve the cast, compile acting direction, make one take per line, check the audio, plan ambience and effects (off by default; generating sounds is a separate paid step), assemble the timeline, prepare the export. Each step has dependencies, a gate, an estimate and a status on the board: planned, running, awaiting approval, completed, failed or stopped. You can turn optional steps on or off, approve or reject, try a failed step again, remake one line, and resume after an interruption. Updating a plan keeps finished steps whose inputs did not change, and a line with an approved take is never remade unless you ask.

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

## Audio check

Flags missing takes, clipping, long silence, timing far from the usual length, sounds an engine could not play, a take made with a different voice than the one now cast, and unconsented clones. Measurable problems are "problems"; anything subjective is "listen". It never calls a performance good or bad.

## Not built, honestly

- Exporting: the agent prepares and checks, then you export from Export.
- Generating ambience and sound effects: planned from stage directions only.
- A voice audition step that generates comparison clips: auditions remain on the Presets screen.
- Whole-scene re-voicing, and agent-driven picture sync.
- A real run against live engines. Everything here was tested with fake engines and the demo backend; no paid call was made.
