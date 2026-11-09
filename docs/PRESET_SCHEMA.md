# Preset schema (version 1)

Defined in `app/src/presets/schema.ts`. A preset is engine-independent data. It carries no audio and no model weights. `validatePreset` checks anything from outside (an import, a saved file), returns a cleaned copy or the reasons it was refused, and never throws.

| Field | Meaning |
|---|---|
| `schema` | Always `1`. Later versions add a migration step in `migratePreset`. |
| `id` | Unique, `a-z 0-9 _ . -`, 2 to 63 characters. Starter ids are `genre.slug`. |
| `version` | The preset's own version number. |
| `name`, `description`, `archetype` | Display text. Rendered as text, never as HTML. |
| `genre`, `subgenres`, `tags` | One of the 12 genres; free subgenres and lower-case tags for search. |
| `ageRange` | One or more of child, teen, young_adult, adult, middle_aged, older_adult, elderly, ageless. |
| `gender` | Optional presentation: male, female, nonbinary. Never inferred. |
| `language`, `accent {label, quality}`, `culture` | **Separate fields.** Accent never implies appearance, and culture is optional free text. |
| `accent.quality` | `native_reviewed`, `community_reviewed`, `model_supported_unverified`, `experimental` or `unsupported`. Greenroom never sets the first two itself; all starters are unverified or experimental. |
| `designPrompt` | Words for engines that design a voice from a description. |
| `acting` | `emotionalRange`, default `direction`, `pace`, `projection`, `tension`, `breathiness`. |
| `pitch`, `texture` | low/mid/high and a short description. |
| `audition` | A short line for hearing the voice. |
| `needs` | `words`, `nonverbal`, `cloning`, and `onlyEngines` (engines that declare the preset's language or accent). `compatibleEngines()` derives the compatible list from the capability table. |
| `license` | `authored_text`, author, `voiceRights: "defined_by_voice"` and a note. A preset cannot grant rights to any voice. |
| `portraitId` | An avatar-library id, or absent. No starter preset stores one. The screen picks a face from the library at run time (role, age range and stated presentation only; never language, accent or culture), and a preset's own valid `portraitId` wins. |
| `availability` | `starter`, `custom` or `imported`. |
| `signature` | Marks a signature character. None shipped (see below). |

## Behaviour

- **Readiness** (`readiness`): `ready` (a compatible engine is connected and has a voice in the library), `needs_voice` ("Requires voice selection") or `needs_engine`. There is never a playable audition without both.
- **Search and filter**: words, genre, age, presentation, language, accent review label, engine, favourites.
- **Recommend**: scores genre, age, presentation, language and keywords; private text rules out cloud-only presets.
- **Import**: files over 1 MB are refused by the screen; at most 500 presets are read; a bad entry is skipped with its reason; ids that clash are renamed; imports are marked `imported`.
- **Duplicate**: copies are `custom` with a fresh id; starter presets are never edited or removed.
- **State** (`state.ts`): favourites, recents and custom presets in local storage, validated on load. A blocked store is reported.

## Not included

A Venomspur signature preset: the repository has no Venomspur profile or portrait. Presets mapped to avatar-library portraits and a listening-test suite per accent are not built.
