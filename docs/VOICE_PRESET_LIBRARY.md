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
  - *Ready to hear*: a compatible engine is connected and a voice from it is in your library. Audition reads the preset's audition line with the voice you pick, carrying the preset's acting direction on ElevenLabs and as a plain read on other engines (the card says which, and lists what was not sent). Cloud voices ask before spending, through the existing cost sheet.
  - *Requires voice selection*: a compatible engine is ready but no voice is. The button opens Voices.
  - *Needs an engine*: no connected engine can perform the preset. The button opens Model Center.
- **Compare**: up to three presets side by side.
- **Add to Cast**: choose a speaking character and (optionally) a compatible voice. The panel previews what will be filled, what is kept, and warnings (unknown voice licence, cloned voice without a consent record, engine that cannot perform the preset, unverified accent). Apply is one undoable change; nothing is generated and nothing is spent. Existing profile text is kept unless you tick Replace.
- **Duplicate to edit**, **Remove** (only presets you made or imported), **Import** and **Export** of preset files. Imports are validated, can never overwrite a starter id and are marked imported.
- Favorites, recents and custom presets are kept in the browser's local storage; if that is blocked the screen says the change will not survive a restart. A project saves the character the preset was applied to, so nothing important lives only there.

## Accent labels

Every starter preset is *Model supported, unverified* or *Experimental*. Greenroom never sets *Native-speaker reviewed* or *Community reviewed* by itself; only a recorded human review can. The four Nigerian English and Pidgin starters are limited to WazobiaVoice and ElevenLabs, the two engines that declare Nigerian English or accent voices in this code base. That is a declaration, not a listening result. They are starter profiles, not claims that one accent represents a population. Language, accent, culture and appearance are separate fields, and starter presets store no portrait of their own (a face is chosen from the avatar library when the card is shown; see Portraits).

## Portraits (0.12.0)

Every card shows a face from the existing avatar library (172 portraits); nothing is generated and no path is invented. The matcher sees only the preset's **role, age range and stated presentation**. It never sees language, accent or culture: any heritage-like word in a preset's text is removed first, and the international starters are matched on age and presentation alone, so an accent can never pick a face. The library's hard rules apply: a child preset gets only a child or teen face, an adult preset never does (even if its name says "children's"), a stated presentation is never crossed, and faces are spread (no portrait on more than three presets). Creatures and roles (the demon judge, the dragon, the alien) get the matching portrait. Add to Cast gives a character the face only if it has none. A preset's own `portraitId` wins. Tests: `presets/portraits.test.ts` (13, against the real library).

## Audition with the preset's direction (0.12.0)

On ElevenLabs an audition now carries the preset's acting direction through the same planning code as a real take. Other engines get a plain read and the card says so, with a "Not sent" list (a preview has no speed setting, so pace is never claimed). See `presets/audition.ts`.

## Listening tests (0.12.0)

A card's More menu opens a listening test for its accent. See `ACCENT_VERIFICATION.md`. No label has moved yet because no review has been recorded.

## Free preview on this computer

When the voice chosen for a card is a cloud voice and the library holds a local voice (Piper, Chatterbox, Wazobia or your own server) in the same language, the card offers a free preview: a plain read of the audition line by the closest local voice. "Closest" means language (must match), then gender, age band and accent as the library states them. It is a stand-in, not a copy of the cloud voice, and the card says so. Settings, Local first, makes the free preview the main Audition button and moves the real cloud audition to a second button marked "uses credits". The cloud audition still asks first.

## Not built yet

A Venomspur signature preset (his profile and portrait are not in the repository); editing a custom preset's fields in place (duplicate and import exist); portrait choice per preset (a preset's own `portraitId` is honoured but there is no picker); a regrouping of the library by capability.
