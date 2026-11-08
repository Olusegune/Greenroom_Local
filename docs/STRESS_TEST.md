# Cinematic stress test: "The Night Inspection"

A 60-second, three-character scene that exercises the whole pipeline. **It has not been run.** Making it needs real voices, and Greenroom's rule is that automated tests do not spend cloud credits and quality claims come only from listening. This page is the script, the procedure, the checks Greenroom can do for you, and the sheet to listen with. Run it yourself, then record what you heard in `DECISIONS.md`.

## What it must contain (and where)

| Requirement | Where it is in the script |
|---|---|
| Three characters with distinct voices | VENOMSPUR, MIRA, TOLLEY |
| Restrained sarcasm | VENOMSPUR, lines 1 and 3 |
| A gasp | MIRA, lines 2 and 12 |
| A sigh | TOLLEY, line 4; VENOMSPUR, line 9 |
| Controlled laughter | VENOMSPUR, line 3; TOLLEY, line 6 |
| Whispered dialogue | MIRA, lines 2, 5 and 12 |
| Physical effort | TOLLEY, line 4 (lifting a crate) |
| Background ambience | Add the atmosphere on the Export screen: "rain on high windows, a distant ticking clock" |
| A dramatic emotional change | VENOMSPUR turns from polite menace (line 7) to suddenly soft (line 11); MIRA from nervous to breaking |

## The script

Paste this into **Script** (it is the normal `NAME (direction): line` format).

```text
# The Night Inspection
VENOMSPUR (polite, dry, faintly amused): Good evening, Miss Hale. I do hope the hour is not inconvenient. [clears throat]
MIRA (nervous, whispering): Mister Venomspur. I thought the office was closed. [gasps]
VENOMSPUR (restrained amusement, cold underneath): Closed. Yes. [laughs] Everything is closed, Miss Hale, until it has been inspected.
TOLLEY (out of breath, lifting a heavy crate): Mind your backs... this crate... is heavier than it looks. [grunts] [sighs]
MIRA (whispering, terrified): Tolley, do not. He is here about the ledger.
TOLLEY (exhausted, wry): Thirty years carrying other people's secrets. [laughs] What is one more crate?
VENOMSPUR (polite menace, growing colder): The ledger, Miss Hale. Page forty. The page you tore out.
MIRA (voice breaking): I did not tear anything.
VENOMSPUR (quiet, no warmth at all): Twice. You have lied to me twice. [sighs] I counted.
TOLLEY (gently, firm): Leave the girl alone.
VENOMSPUR (suddenly soft, almost kind): Of course. Take as long as you like, Miss Hale. I will wait. I am very patient.
MIRA (whisper, shaking): It is behind the third shelf. Please. [gasps] Please do not hurt him.
```

(Line 9 is the short line "Twice. You have lied to me twice." that exposed the repeated-line bug fixed on 2026-11-08. Keep it in the test: it is the best check that a long direction on a short line no longer repeats it.)

## Procedure

1. **Local first.** Cast the three characters from your local voices (Piper, or Chatterbox) and make the whole scene. Local voices cannot act on written direction, so they will ignore the Direction box and the Director panel; note this in the sheet. Greenroom says so under each line.
2. **Then a direction-following engine.** Cast ElevenLabs or Inworld (TTS 2) voices. Press **Plan the performance**, review and apply, then make the takes. Spend sheets appear for every paid step.
3. Use **Make 4 interpretations** on VENOMSPUR line 11 and listen to the four side by side.
4. Add the atmosphere on **Export**.
5. Export with: whole mix at **48 kHz, 24-bit**, **stems**, every line, the **performance manifest**, the **technical QA report** and the production report.

## Checks Greenroom does for you

- **Technical QA report** (`... - technical QA.md`): per file, length, sample rate, peak, loudness, clipping, silence at each end and anything unusual. It states measurements only.
- **"Check by ear" badge** on a take: a short line that came back far too slow or in several phrases (the repeated-line symptom).
- **Direction fit notice**: tells you when a short line only carries part of a long direction.
- **Performance manifest** (`... - performance manifest.json`): per line the voice, model, direction, plan, chosen take, fingerprint, what could not be sent.

## Listening evaluation sheet

Copy this table and fill it in by ear. Score 1 (wrong) to 5 (exactly right). "Native" means the engine did it from the direction; "composited" means a separate sound clip was added.

| Line | Character | What it should be | Heard (1-5) | Native or composited | Notes (repeats? read the direction aloud? artefacts?) |
|---|---|---|---|---|---|
| 1 | VENOMSPUR | Polite, dry, faint amusement; a throat clear | | | |
| 2 | MIRA | Nervous whisper; a gasp | | | |
| 3 | VENOMSPUR | Restrained amusement, cold underneath; controlled laugh | | | |
| 4 | TOLLEY | Out of breath, straining; grunt and sigh | | | |
| 5 | MIRA | Terrified whisper | | | |
| 6 | TOLLEY | Exhausted, wry; soft laugh | | | |
| 7 | VENOMSPUR | Polite menace, colder | | | |
| 8 | MIRA | Voice breaking | | | |
| 9 | VENOMSPUR | Quiet, no warmth; a sigh. **Said once, not repeated.** | | | |
| 10 | TOLLEY | Gentle and firm | | | |
| 11 | VENOMSPUR | The change: suddenly soft, almost kind | | | |
| 12 | MIRA | Shaking whisper; a gasp | | | |

Overall: the three voices sound like three different people (1-5) ___; the emotional change at line 11 lands (1-5) ___; the ambience sits under the dialogue without masking it (1-5) ___; anything that sounded like an engine fault ___.

## What to report back

Engine and model for each character, the scores above, whether any line repeated, and the three files Greenroom wrote (mix, QA report, manifest). Record it in `DECISIONS.md` so the result is evidence, not memory.

## Status

| Item | State |
|---|---|
| Scene script | Written |
| 48 kHz WAV, stems, manifest, QA report | Export options exist and are unit-tested; **not run on this scene** |
| Listening sheet | Template above; **no scores recorded** |
| Local-first generation | **Not run**: no local voices were generated in this session |
