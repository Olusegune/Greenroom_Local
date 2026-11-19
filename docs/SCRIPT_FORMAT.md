# Script format

Greenroom reads a script you type, paste or import. Everything below works in the Script screen and in **Import a script...**. Source: `app/src/script.ts` (the reader), `app/src/scriptImport.ts` (files), `app/src/directionTags.ts` (directions).

## Lines, speakers and directions

| You write | Greenroom reads |
|---|---|
| `ADA: Hello there.` | a line for ADA |
| `ADA (whispering): Keep quiet.` | a line with the direction "whispering" |
| `ADA: (whispering) Keep quiet.` | the same (direction after the colon) |
| `**ADA:** (whispering) Keep quiet.` or `**ADA** (whispering): Keep quiet.` | the same (bold names, as written by many people and AI tools) |
| `# Scene 2` or `**SCENE 2 - The kitchen**` | a new scene (a title heading right before a scene heading is replaced by it, so no empty scene) |
| `---`, `*italic-only line*`, `**END**` | ignored (not spoken) |
| `[PAUSE: 2 seconds]` (also `1.5s`, `a beat`) | adds that pause after the line before (at most 10 seconds) |
| `[SFX: A door creaks open. Distant thunder.]` | a sound cue. At the start of a scene it plays **before** the next line; in the middle it plays **after** the line before. Length is about 2 seconds a sentence (4 seconds at most when placed before a line, 8 otherwise). It has no audio until you press **Make this sound** (or **Make all N missing sounds...**) in Perform, which asks about cost first. |

A line with no speaker straight under a speaker continues it. Text after a blank line with no speaker is ignored as stage direction (unless the whole script has no speakers, which is read as one narrator). Sample: `docs/samples/the-wrong-department.md` (4 characters, 3 scenes, 55 lines, 9 sound cues).

## What a direction becomes

A written direction is turned into **short tags** the voice engine can use, never pasted whole. Silent stage business is left out of what is sent.

| Direction | Sent to the engine |
|---|---|
| `Soft throat clearing` | `[softly] [clears throat]` |
| `Nervous laugh, then silence` | `[nervous] [laughs nervously]` |
| `Long irritated exhale` | `[annoyed] [exhales]` |
| `Furious, projecting` | `[angry] [loudly]` |
| `Slowly removes his glasses; dry` | `[dry]` (the glasses are silent; "removes" is not sent) |
| `Defensive, fast` | `[defensive]` and speed 1.12 |
| `Very soft, deliberate` | `[softly]` and speed 0.9 |

At most three feeling tags and two sound tags are sent per line. Engines without tags (Piper, Kokoro, Qwen, Chatterbox, Wazobia) ignore the sound tags and use what they can. Which tags a particular voice really acts on is for you to hear; `DECISIONS.md` records what has been heard.

## Making it sound human (ElevenLabs)

- Each line is made as its own request. Greenroom sends the words of the line before and after (same scene, tags removed) as `previous_text` and `next_text`, which ElevenLabs documents for keeping delivery continuous across separate requests (docs read 2026-11-19). If the service rejects them for a model, the line is made again without them, so context can never block a take.
- ElevenLabs recommends Eleven v4 over v3 for most use; v4 is the default here. Tags are described in their prompting guide as short descriptive words (`[laughs]`, `[whispers]`, `[sarcastic]`); long phrases can be read aloud.
- Nothing has been judged by ear by an agent. Listen, then change the direction on the line or the voice.
