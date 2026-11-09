# Performance engine

`app/src/performanceCompiler.ts`. Turns a director's own words into a structured acting plan, then maps the plan onto what one engine can actually be given. Rule based and offline: the same words always give the same plan, nothing is sent anywhere, nothing is spent.

## How it works

1. **Parse** (`parseDirection`). The brief is cut into clauses at commas, semicolons, full stops and "then". Each clause is read for emotions, vocal events, pauses, delivery (whisper, shout, quiet, loud, slow, fast, measured, halting), physical state, language or accent requests, intent and subtext, and "pronounce X as Y". A clause that starts with begin/start/open is placed at the start of the line; one with final/last/ends with at the end; the rest are spread in order. Intensity words (slightly, very, impeccable, extremely) and *restrained* set strength. **A clause nothing matched in is reported as not understood, never dropped quietly.**
2. **Compile** (`compileActing`). Produces the existing `PerformancePlan` (emotion arc, physical state, pace, projection, tension, breathiness, objective, subtext), per-phrase beats (emotion, pace, pause), positioned vocal events and timed pauses. It places things at phrase boundaries of the line: this is an approximation, shown in the preview for review. Continuity: `carryFrom` hands the last emotion and a fading physical state to the next line when that line says nothing of its own.
3. **Render for an engine** (`renderActing`). Uses the capability table (`engineCaps.ts`). For each behaviour it records **sent**, **approximated** or **not sent**, with the reason. Positioned sounds are written as `[tags]` in the *sent* text only. Pauses and per-phrase pace need the line made phrase by phrase (one request per phrase: the preview says how many).
4. **Generate.** `generate.ts` compiles a line's brief just before planning a take (`withActing`). The saved line text is never changed. Everything "not sent" goes into the plan's `notSent`, the cost sheet and the take's provenance, so an unsupported behaviour is never presented as generated.

## What it understands

Emotion and intensity, transitions within a line (start/end anchors and sequence), intent and subtext, pace and rhythm, pauses and hesitation, whispering and shouting, laughter, chuckling, crying, sobbing, coughing, throat clearing, sighing, gasping, groaning, breath, fatigue, strain, exertion, pain, sarcasm, irony, contempt, tenderness, physical states (running, lifting, injured, cold…), continuity across lines, and pronunciation requests. Tests: `performanceCompiler.test.ts` (45), including the Venomspur example.

## Engine support (declared, not judged by ear)

| Engine | Written direction | Sounds as tags | Speed | Timed pause |
|---|---|---|---|---|
| ElevenLabs | yes | yes (unverified ones say so) | yes | phrase by phrase |
| Inworld (TTS 2) | yes | five documented tags only | yes | phrase by phrase |
| VoiceKiller | yes | no | yes | phrase by phrase |
| Kie, Piper, local server | no | no | yes | phrase by phrase |
| Chatterbox, Wazobia | no | no | no | phrase by phrase |

## Limits (stated, not hidden)

- **Language and accent cannot change inside a line.** The cast voice decides them. A request such as "switches to Yoruba" is reported as not sent.
- A pause **before** a line cannot be placed.
- Event and beat placement is by phrase boundary, not by word or timing.
- The vocabulary is a fixed list. Words outside it are reported as not understood.
- Nothing here has been judged by ear. Whether `[menacing]` or `[chuckles]` sounds right on a given voice is the owner's call.
- Where a line has a brief, it replaces that line's structured performance plan for the take (the saved plan is untouched).
