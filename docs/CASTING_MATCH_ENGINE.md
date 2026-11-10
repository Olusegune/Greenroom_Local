# The casting match engine

Code: `app/src/casting/engine.ts` (the matcher), `requirements.ts`, `lock.ts` (approval and guard), `autocast.ts`, `presetSpec.ts`, `extract.ts`. It is the **only** place that decides whether a voice fits a character. The Cast screen, auto-casting, the preset cards, the agent and generation all call it; `presets/match.ts` only translates a preset into requirements and the engine's status into three words.

## Results

Every voice is judged against a character's requirements and gets one of six statuses, always with reasons:

| Status | Meaning |
|---|---|
| `VERIFIED_MATCH` | Something was required, and every required fact is proven (confirmed by listening, or fixed by the route). |
| `COMPATIBLE_WITH_LIMITATIONS` | Nothing required is contradicted, but a limit remains: an age one band away, a related accent, a preference not met, or nothing was required at all. |
| `NEEDS_AUDITION` | Every required fact is stated and agrees, but at least one was never confirmed by listening. |
| `UNKNOWN_METADATA` | A required fact is unknown for this voice. Unknown is never proof of a fit. |
| `INCOMPATIBLE` | A stated or verified fact contradicts a requirement, or the voice is not eligible (a cloned voice with no consent, a voice not licensed for a commercial project). |
| `UNAVAILABLE` | It would fit, but it cannot be used right now (the engine is not set up, no key, a local-only project). It is reported, never swapped for another voice. |

Order: `INCOMPATIBLE` first, then `UNAVAILABLE`, `UNKNOWN_METADATA`, `NEEDS_AUDITION`, then limits, then `VERIFIED_MATCH`. Voices of the same status are ordered by a soft score.

## Hard and soft

Hard (never relaxed): required language, vocal presentation, vocal age, a required accent, consent, licence for commercial projects, availability. Soft (only order voices of the same status): pitch, texture, style, favourites, previous casting, a preferred accent or language. Weights are configurable (`MatchContext.weights`, defaults in `DEFAULT_WEIGHTS`) and every reason is shown.

Rules that follow from this, each tested:

- A woman with a deep voice stays eligible for a feminine character, and a man with a high voice for a masculine one: **pitch is never a gender test**.
- A character's ethnicity, nationality, cultural background or picture is never a requirement. "Nigerian" is not "Nigerian English", not Yoruba, not a gender.
- An English-only route (Piper, Kokoro, Chatterbox and Qwen as Greenroom uses them) is `INCOMPATIBLE` for a required Yoruba. A cloud voice labelled English is `UNKNOWN_METADATA` for Yoruba ("may speak it; audition first"), not assumed either way.
- A required accent that differs (Nigerian English against American) is `INCOMPATIBLE`; a related one (Scottish for British) is a limit.
- A voice that is a fit on paper but never listened to is `NEEDS_AUDITION`, not `VERIFIED_MATCH`.

## Where requirements come from

`requirementsOf(character)` reads only: the character's casting spec (`cast`), its stated `look.gender` and `look.age`, and its language label. A language is required when the owner set it (or when the label is a known language other than the default English); otherwise it is a preference. `describeRequirements` writes them in words for the screen.

The agent reads a script's character descriptions with `extractStated`: an explicit age (a number, a decade or an age word), a gendered word or kinship term, "Yoruba-speaking" / "speaks Yoruba", "with a British accent". Each becomes a requirement with the words it came from in the notes. A nationality is recorded and **asked about**; a kinship word alone ("grandfather") is not an age; conflicting words are a question; creative ideas are listed as suggestions and never applied.

## Approval and the guard

`assignVoice` is the only way a character's voice changes.

- **Approving** is the owner's alone. A voice that is `NEEDS_AUDITION`, `UNKNOWN_METADATA` or `UNAVAILABLE` needs the owner's acknowledgement, recorded in words. An `INCOMPATIBLE` voice needs an explicit override and is recorded as such.
- **Once approved**, nothing but the owner, confirming, can change the voice: not auto-casting, the agent, a preset, an imported cast, a script edit or a model switch. Each refused attempt is written to the character's history. Unlocking is the owner's alone and leaves the voice in place.
- The auto-caster and the agent may fill an **empty** slot only with a `VERIFIED_MATCH`. Presets and imported casts never replace an existing voice.
- `castingGuard` runs before audio is made: the voice that is about to speak must be the approved one (same id, engine and model). If not, nothing is made. If the approved voice is gone, the error says it was **not replaced** and lists the voices that fit, as choices.
- `auditCasting` runs before export: a chosen take made with another voice, or for another character, is a problem; a take from an earlier approval is flagged.

## Persistence

The approval, requirements and history live on the character in the project file. `readProjectCasting` re-checks every field when a project is opened; if a damaged file disagrees with itself the approval wins. `readLibraryMeta` does the same for the voice library.
