# Voice and character metadata (version 1)

Code: `app/src/casting/types.ts`, `voiceProfile.ts`, `requirements.ts`, `persist.ts`.

## A fact

Every recorded fact about a voice is a `Fact<T>`: a value, a **status**, a **source**, a confidence and (when a person checked it) a date and a note.

| Status | Meaning |
|---|---|
| `verified` | The owner listened and confirmed it, or the way the route works fixes it (a Piper voice file is made for one language; Greenroom sends English to Kokoro, Chatterbox and Qwen). |
| `unverified` | Stated by a provider, a document or the owner without listening. Plausible; worth a listen; never proof. |
| `unknown` | Nobody has said. Never treated as a fit. |
| `not_applicable` | The question does not apply. |

Sources: `owner_listening`, `owner_entered`, `provider_label`, `model_config`, `engine_documentation`, `corpus_documentation`, `name_table`, `description_text`, `none`. The last two are guesses; they can be shown as a note and are never evidence.

A saved file cannot promote a fact: `readMeta` downgrades any "verified" that does not come from `owner_listening` or `model_config`.

## A voice profile (`VoiceProfile`, built by `profileOf`, never stored)

Immutable voice id, provider, model id (when a checkpoint matters), speaker id (`file@7` → `7`, `ife@yo` → `yo`), display name, and facts for vocal gender presentation (`masculine`, `feminine`, `androgynous`), vocal age (`child`, `teen`, `young`, `mid`, `old`: how the voice **sounds**), languages, accent, pitch and texture. Also: whether the route may speak other languages (cloud voices can), commercial status (`allowed`, `forbidden`, `unknown` with a note) and whether consent is recorded for a cloned voice.

What the owner records is stored with the voice in `voices.json` as `meta` (`VoiceMeta`): the facts, an optional speaker id and licence, and a **revision list**. Each change keeps the previous fact and the evidence text, so nothing is lost when a value is corrected (the review screen shows the history; the last 50 are kept).

## How a profile is derived

| Voice | Gender | Age | Languages | Accent | Licence |
|---|---|---|---|---|---|
| Piper (not L2-ARCTIC) | unknown (a name table suggests one; it is not used) | unknown | verified: one language, from the voice file | unverified: the dataset's locale | unknown |
| Piper L2-ARCTIC speaker | unverified: the corpus documents each speaker's gender; the speaker number was checked against the model (24 of 24) but nobody has listened | unknown | verified: English | unverified: the speaker's first language | **forbidden** (CC BY-NC 4.0) |
| Kokoro | unverified: Kokoro's voice list | unknown | verified: English | unverified | unknown |
| Qwen3-TTS | unverified: the written description Greenroom sends | unverified if stated | verified: English | unknown | unknown |
| Chatterbox default | unknown | unknown | verified: English | unknown | unknown |
| WazobiaVoice (13 speakers × 4 languages) | unknown (no mapping of speakers to gender or age is invented) | unknown | unverified: the model accepts the language | unverified: "Nigerian" | **forbidden** (research licence) |
| ElevenLabs, Inworld, VoiceKiller, Kie | unverified: the provider's label | unverified if stated | unverified: the label; the voice may speak others | unverified: the label | from the owner's record |
| Cloned voice | as above | as above | as above | as above | refused without a consent record |

## A character

`Character.cast` (`CastingSpec`) holds what the character needs, as stated: vocal presentation (`masculine`, `feminine`, `any`), vocal age (one or more bands), language and whether it is required, preferred or ignored, accent and its strictness, pitch, texture and style. Nationality, cultural background and notes are stored for the owner and **never used to match**. The stated `look.gender` and `look.age` are also read as requirements, and the screen says so.

Defaults are not statements: a new character's label "English" is only a preference.

`Character.casting` holds the **approval**: voice id, engine, voice name, model, speaker, the approval version, the status it was approved as, the unverified facts the owner accepted (in words), who approved, and a history of assigned, approved, changed, unlocked and **refused** attempts (last 100).

`Take.cast` records the character, voice, engine, model, speaker and approval version a take was made for.

The portrait (`avatarId`) and the voice are separate references. Changing one never changes the other, and a portrait is never evidence of a voice.
