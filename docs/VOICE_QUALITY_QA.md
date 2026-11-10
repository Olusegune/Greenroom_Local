# Voice and casting QA (0.13.0)

What was tested, how, and what it does and does not show. **Nothing here is a judgement of how a voice sounds**: an automated test can show that audio came back and that the rules hold, never that a voice is good, that an accent is convincing, or that a gender or age label is right. Only listening can.

## 1. The casting rules (automated)

`app/src/casting/*.test.ts`, `autocast.test.ts`, `castLook.test.ts`, `cast.test.ts`, `presets/match.test.ts`, `agent/*.test.ts`.

- **Examples** (`regression.test.ts`, `engine.test.ts`): one test for each way a character has been given the wrong voice (see `CASTING_INTEGRITY_AUDIT.md`), using fixture voices with known metadata: an elderly masculine voice stays with the elderly male character; a feminine voice is not substituted for a masculine requirement; a childlike requirement is not met by an adult voice; a Yoruba requirement rejects every English-only engine; a Nigerian English requirement does not fall back to American; unknown gender or age asks for review; ethnicity does not decide an accent; a woman with a deep voice and a man with a high one stay eligible; approvals survive save, reload, script edits and model changes; the right speaker number reaches the engine; takes keep the right character and voice ids; export uses the approved take; the agent cannot override a locked decision; a preset or cast import cannot corrupt an assignment; adversarial cases (malformed speaker ids, hostile saved files, duplicate names, two jobs racing for one character).
- **Invariants** (`invariants.test.ts`): 3,000 random character and voice pairs (fixed seed), and 1,500 random attempts by every actor to change approved voices. A verdict is never `VERIFIED_MATCH` unless something was required and every required fact is verified and agrees; a hard mismatch is always `INCOMPATIBLE`; heritage and nationality never change a verdict; no actor but the owner confirming ever changes an approved voice; the guard refuses every voice but the approved one.
- **Catalogue** (`catalogue.test.ts`): all 24 L2-ARCTIC speaker numbers match the model's own `speaker_id_map` (downloaded 2026-11-10, 5 KB); no catalogue voice gets a gender, age or accent from its name; L2-ARCTIC and WazobiaVoice are non-commercial; Wazobia speakers have no invented age or gender.

## 2. Real audio, real engines (this PC, 2026-11-10)

`app/src/demo/acceptance.spec.ts` (only runs with `GREENROOM_ACCEPTANCE=1`) runs the six-character acceptance production through the real casting rules and the real local engines (Piper's `piper.exe` and Kokoro's `kokoro_once.py` through the managed runtime), writing to `Documents\Greenroom Local\acceptance`. No cloud engine, no key, no credit. The owner's approval is performed by the test harness (actor `test_harness`) and the audit says so. Result: `docs/acceptance-results.json`.

| Character | Outcome | Why |
|---|---|---|
| Elderly Yoruba-speaking grandfather | **Not cast, correctly.** The only Yoruba voice (WazobiaVoice) is not installed on this PC, so it is `UNAVAILABLE`; every English voice is `INCOMPATIBLE`. Nothing was substituted. | A Yoruba model is gated and not installed here. |
| Middle-aged British female detective | Cast: Kokoro Emma, approved as "not enough known" (her age is unrecorded) with the owner's acknowledgement. | |
| Young American boy | **Not cast.** No voice has a recorded child age; every candidate says it must be auditioned. An automatic attempt to give him an adult voice was refused. | No child voice is installed. |
| Teenage Nigerian girl | **Not cast.** Nigerian English is required; the American voice was refused as incompatible. | No Nigerian-accent English voice is installed here. |
| Aristocratic British male demon | Cast: Kokoro George, approved as "listen first" with acknowledgement. | |
| Robotic sci-fi character | Cast: Piper Joe, a plain voice, as a stand-in (nothing was required, so nothing could be proven). | No robotic voice exists. |

The three cast characters spoke two lines each in two scenes with real audio (8 takes including two regenerated after the project was saved and reopened). Verified for every chosen take: it was made with exactly the approved voice, for the right character, with an unchanged file (sha-256), the manifest says `matchesCharacter`, the casting audit found no problem, and the approvals read back from disk are identical. Seven deliberate wrong moves were refused (a feminine voice for the approved demon, an adult voice for the boy by the auto-caster, an English voice for the Yoruba grandfather, an American voice where Nigerian English is required, the agent changing an approved voice, approving an unknown without acknowledging it, generating a demon line with the wrong voice). The final mix is 15.5 s at -18.8 LUFS with a -1.0 dBTP ceiling (the ceiling stopped the -16 LUFS target; checked with ffmpeg).

**What this does not show:** that Emma, George or Joe sound right for these characters; that anything was heard; that the three uncast characters could be cast well with voices that are not installed here.

## 3. Expressions

`casting/expressions.ts` is the capability matrix for ten controls (laughing, crying, whispering, shouting, sighing, coughing, breathlessness, sarcasm, emotional transitions, physical exertion) on every engine: native (written as a tag), approximated (a written instruction, or phrases joined), a separate sound clip, or unsupported. It says what an engine **accepts**. **Nothing is marked "verified"**: it would become so only when you record a listening result. Plain-text engines receive the words with the tags stripped (tested), never the tags read aloud. `LISTENING_TESTS` gives, for each control, the line to try, what to hear and what failing sounds like; the same list is in `LISTENING_CHECKLIST.md`.

## 4. Local model and voice-pack workflow

Install, download, verify, load, select speaker, audition, dialogue, play, save, export:

| Step | Piper | Kokoro | Qwen3-TTS | Chatterbox, Wazobia |
|---|---|---|---|---|
| Install and download | done in earlier releases on this PC (voices checksum-verified) | done 0.12.2 (real run) | done 0.12.3 (real run) | not repeated here |
| Select speaker | `--speaker N` tested (Rust) and checked against the model (L2-ARCTIC) | voice name allowlisted | voice name allowlisted | Wazobia id carries the language |
| Audition and dialogue | real audio in the acceptance run | real audio in the acceptance run | real audio 0.12.3 | not run on this PC |
| Export | acceptance mix | acceptance mix | | |

L2-ARCTIC voices stay marked non-commercial and the engine refuses them in a commercial project (`Project.commercial`). The browser demo's simulated downloads do not count as real installation.

## 5. Not covered

Screen-reader, zoom and high-contrast testing; the installed app clicked through with real data beyond the read-only check in `RELEASE_READINESS.md`; WazobiaVoice, sound effects and ACE-Step on this PC; any listening.
