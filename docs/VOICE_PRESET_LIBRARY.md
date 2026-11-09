# Voice preset library

A **preset** describes a kind of character voice (who they are, how they act, what an engine must be able to do). It is text and numbers only: no audio and no model weights ship with it, and it is not a voice. Rights to any voice belong to that voice's own engine and licence.

Code: `app/src/presets/` (schema, data, state, casting) and `app/src/screens/Presets.tsx` (screen). Tests: `app/src/presets/*.test.ts`, browser check `scripts/qa/presets_e2e.mjs`.

## What is in it

120 starter presets in 12 genres (counts asserted by a test): film and television 16, video games 14, animation 14, education 10, audiobooks 10, podcasts and radio 10, advertising 8, faith and inspirational 8, fantasy/horror/science fiction 10, corporate 6, international 8, family 6.

Not included: a Venomspur signature preset. The repository has no Venomspur profile or portrait, so none was invented.

## The screen (sidebar: Presets, also Voices menu)

- **Start with a genre**: twelve tiles; choose one to browse its presets. Recently used presets appear underneath.
- **Search** across name, description, language, accent, tags and genre. **Advanced filters**: age, presentation, accent review label, "only presets I can hear now". **Favorites** filter.
- **Card**: name, genre, description, language, accent and its review label, ages, the engines whose declared abilities meet the preset's needs, and a status.
- **Status** is never faked:
  - *Ready to hear*: a compatible engine is connected and a voice from it is in your library. Audition reads the preset's audition line in a plain voice with the voice you pick. It does **not** apply the preset's acting direction, and says so on the card. Cloud voices ask before spending, through the existing cost sheet.
  - *Requires voice selection*: a compatible engine is ready but no voice is. The button opens Voices.
  - *Needs an engine*: no connected engine can perform the preset. The button opens Model Center.
- **Compare**: up to three presets side by side.
- **Add to Cast**: choose a speaking character and (optionally) a compatible voice. The panel previews what will be filled, what is kept, and warnings (unknown voice licence, cloned voice without a consent record, engine that cannot perform the preset, unverified accent). Apply is one undoable change; nothing is generated and nothing is spent. Existing profile text is kept unless you tick Replace.
- **Duplicate to edit**, **Remove** (only presets you made or imported), **Import** and **Export** of preset files. Imports are validated, can never overwrite a starter id and are marked imported.
- Favorites, recents and custom presets are kept in the browser's local storage; if that is blocked the screen says the change will not survive a restart. A project saves the character the preset was applied to, so nothing important lives only there.

## Accent labels

Every starter preset is *Model supported, unverified* or *Experimental*. Greenroom never sets *Native-speaker reviewed* or *Community reviewed* by itself; only a recorded human review can. The four Nigerian English and Pidgin starters are limited to WazobiaVoice and ElevenLabs, the two engines that declare Nigerian English or accent voices in this code base. That is a declaration, not a listening result. They are starter profiles, not claims that one accent represents a population. Language, accent, culture and appearance are separate fields, and no portrait is attached to any preset.

## Not built yet

Preset-driven audition with acting direction applied; portraits mapped to avatar-library ids; editing a custom preset's fields in place (duplicate and import exist); a listening-test suite per accent; saving a character as a reusable cast entry from this screen (Cast's own *Save cast* already carries the profile); a beginner/advanced split beyond the filters.
