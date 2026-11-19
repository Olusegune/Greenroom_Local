# Ideas for improving Greenroom (2026-11-08)

Ordered by what I think pays off most for someone who directs voices in the app window and never uses a terminal.

## Do next (closes gaps we hit this week)

1. **(Done in 0.9.0) "Add portraits" inside the app.** Right now a new picture has to go through me and a script. A screen where you drop files, crop them (with a face-aware square crop, so a 1376x768 picture becomes a good square), tick gender, age and heritage, and add them to the library, with the same checks the pipeline makes (size, duplicates, stray strips, text, rights note). This would have saved most of this week.
2. **A "Voice library health" panel.** One list of every voice with what the app thinks it is (gender, age, heritage, how sure) and a one-click confirm. Voices with a conflict or no answer float to the top ("River: neutral, no age"). Bulk edit instead of opening each card.
3. **Estimate gender and age from the sound.** The app already measures pitch from preview audio. Use it to suggest gender and an age band, and warn when the label disagrees ("labelled male, sounds female"). Labels from services are often wrong; ears and numbers beat them.
4. **"Why this face?" and "Shuffle / Lock".** A small tooltip on any automatic face ("female, young adult, Nigerian"), a Shuffle button for another fitting face, and Lock to keep one. Turns a guess into something you can steer in one click.
5. **Library growth targets.** The tests list which gender/age/heritage combinations have few faces. Add a panel showing counts, so you can see where more portraits are needed (for example Southeast Asian, older Latino women, children of each heritage).

## Make the performance better

6. **Speaking animation on the face** (a soft ring or mouth-open variant while a line plays) and **expression variants** (smile, angry, sad) using the expression slots already in the avatar system.
7. **A/B listening and "director memory".** Blind compare two takes; remember which direction wording won for each character and offer it first next time.
8. **Pronunciation dictionary per project and per character**, with a "say it back" button and a record of fixes that worked.
9. **Take quality checks before you listen:** flag clipped audio, long silences, a take that repeats a line (the "Twice, actually" problem), and sudden loudness changes.
10. **Script Doctor for dialogue rhythm:** overlapping lines, interruptions, and room for reactions (breaths, laughs) with the reaction library.

## Make it feel finished

11. **Video export for sharing:** the audio with the character's face and subtitles as an MP4 (an "audiogram"). Gives non-audio people something to watch.
12. **Faces everywhere:** show the portrait on the timeline lanes, in the scene list and in exports, as already done on Perform and Cast.
13. **First-run guide:** a three-step start (add a key or choose the offline voice, hear a sample, open a sample project that already has audio).
14. **Project history and crash recovery:** autosave with a visible "saved" state, restore a previous version, and recover after a power loss.
15. **Cost control:** a monthly cap and a per-project budget that stops paid calls at the limit, with a running total on screen.

## Make it safe and shippable

16. **Code-signing certificate and an updater key** (see the security review) so installs do not trigger SmartScreen and updates can be trusted.
17. **A continuous check on every change:** build, tests, `npm audit`, `cargo audit`, secret scan, and a smoke run over every screen with console-error capture. The pieces exist as scripts; wire them into GitHub so a bad change cannot be merged.
18. **Accessibility pass:** keyboard control of the avatar grid and take lists, screen-reader names on every control, high-contrast and reduced-motion respect.
19. **Performance test with big libraries** (1,000 voices, 5,000 portraits) to confirm smooth scrolling and memory use, since only 200 portraits exist today.
20. **Localization of the interface**, starting with the languages your voices serve.

## Things I would not do yet

- Training or cloning engines inside the app (heavy, legal weight, and the external engines already work).
- Generating the whole portrait library with an image model without listening to and looking at each result, given the likeness and rights risks we found.

## Ideas after the 0.17 stress test (2026-11-19)

Ordered by what I expect to matter most for sounding human and for professional use.

1. **(Done in 0.18.0: the Listen screen.) A listening pass built into the app.** Play the scene, and on each line press a key to mark "good", "wrong voice", "wrong delivery" or "repeat it". Marks become a to-do list, are saved with the project and, with the owner's say-so, recorded as the by-ear findings the project rules require. Today nothing is judged by ear because there is no easy place to do it.
2. **Read the character sheet.** The stress-test script came with a paragraph describing each character ("Elderly, highly educated British male, rich baritone...", "Young Nigerian male rapper, Lagos-influenced English with light Pidgin"). Greenroom ignores such blocks. Reading them (gender, age, accent, manner) would fill each character's look, drive casting and faces, and suggest a voice, using only what the text states.
3. **Show real remaining credit.** ElevenLabs exposes the account's character allowance; the confirm sheet could say "uses about 3,100 of your 48,000 remaining characters" instead of "cost unknown". Same idea for the other providers that expose usage.
4. **A true-peak limiter and clip levelling.** One loud sound effect capped the whole mix at -19.3 LUFS. Offer an optional limiter, and "level sound clips to the dialogue" so a thunderclap does not decide the loudness.
5. **Ambience beds under dialogue.** Cues such as "a faint furnace rumbles" read better as a quiet looped bed under the lines than as a clip before one; support a `[BED: ...]` cue that loops and ducks under speech.
6. **Warm local engines.** Wazobia and Chatterbox reload their model for every line (40 to 70 s); sound effects reload each time (33 s for 3 s). A warm worker like Qwen's would make local work practical. Also a "make 3 takes and keep the best by the app's checks" option for important lines.
7. **Mixed-language lines.** Mama T's Yoruba phrases ("Ẹ̀yin people!") are spoken by an English voice. Route marked phrases to a Yoruba-capable engine (WazobiaVoice) and join them, or warn which lines contain words the chosen voice may not pronounce.
8. **A sample project on first run**, with audio, so a new user hears what the app does before spending anything.
9. **MP3 / AAC / Opus export** next to WAV, for sharing on a phone.
10. **Shippable basics:** code-signing certificate and update key; a CI run of the gate (tsc, vitest, clippy, cargo test, smoke, accessibility) on every push; a clean-install and upgrade test on a second PC; a screen-reader pass.
11. **Tighten the sidebar and small details seen in the screenshots:** the project name in the sidebar truncates ("THE WRONG DEPARTMENT ("); the Script editor shows raw markdown with no preview; Perform's line card could show the tags that will be sent before a take is made.
12. **(Done in 0.19.0, first step) Let other agents drive Greenroom.** The MCP server and shared runner exist. Next: the owner's three decisions in docs/AGENT_AND_MCP.md (draft casting, character sheets, standing delivery authorisation) would let a script run all the way to listenable takes without a person in the middle.
