# Character voice profiles

A character keeps a lasting profile across scenes and projects. It lives in the character's Voice DNA (so it travels with a saved cast) and is edited on **Cast, then the character, then Character profile**.

## What it holds

From Voice DNA: timbre, accent, performance tendencies, emotional range, preferred acting presets, pronunciations only for this character, the approved voice (engine, voice, model; changing engine or voice later raises a warning) and up to six acting references.

Added in 0.12.0 (`app/src/characterProfile.ts`): **background**, **age range**, **presentation** (only when stated, never guessed), **pitch**, **voice texture**, **signature vocal behaviours** (up to eight), an **audition script**, a **rights and consent note**, and **provenance**: a revision number, created and updated times, the app version, and where it began (typed, from a preset with the preset id and version, or imported).

**Compatibility** is shown, not stored: the engines whose declared abilities meet what the profile asks (written direction when there is anything to act on, sounds from tags when a signature behaviour is a sound). It says what an engine accepts, not how it sounds.

Add to Cast from a preset fills empty profile fields (audition, texture, pitch, age range, presentation) and records the preset and version. Text you already wrote is kept unless you choose Replace. A character's portrait is set only if it has none.

## Export, import, duplicate

- **Export profile** writes a JSON file with the description and no voice id, no consent record, no reference takes and no person's name.
- **Import profile** reads a file into the current character. It never brings a voice or an approved voice (you choose one), never creates a consent record, and keeps any consent text from the file only as a note marked "Imported, unverified". If the file's character used a cloned voice, it warns that consent does not travel. Files over 200 KB, foreign files and newer-schema files are refused.
- **Duplicate character** copies a character with a new id and a "(copy)" name, a fresh revision history, no acting references and no reactions.

## Rights

The consent note is a note for you. Consent for a **cloned voice** is recorded on the voice itself and is enforced everywhere (Agent Studio, quality check, preset application). See `COMMERCIAL_LICENSING.md`.
