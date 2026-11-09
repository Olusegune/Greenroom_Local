# Accent and language verification

Greenroom cannot judge an accent, and nothing in the code listens to audio. The only way an accent label can go up from "unverified" is a **recorded review by a person**. This page says how that works.

## The five labels

Native-speaker reviewed, Community reviewed, Model supported (unverified), Experimental, Unsupported. Every starter preset ships as *model supported, unverified* or *experimental*. None ships reviewed.

## The listening test

`app/src/presets/accentTests.ts` builds one test for every distinct language and accent the presets advertise (neutral and invented accents make no accent claim, so they have none): the four Nigerian English starters (Yoruba-, Igbo- and Hausa-influenced, plus Nigerian Pidgin), Northern English, Filipino English, Indian English, Latin American Spanish and the American and British starters. On a preset card choose **More, then Listening test for this accent**:

1. Pick a voice from your library that can perform the preset.
2. Play the short phrases (cloud voices ask before they spend).
3. Record what you heard: your name, whether you are a native speaker of the accent, a community member, or someone else; a yes, not sure or no on each criterion (easy to understand, pronunciation and stress, rhythm and intonation, respectful and not a caricature, consistent, names and everyday words); an overall verdict; a comment (region, what was off, whether the phrase wording was right).

The English phrases are ordinary test sentences. The **Spanish and Pidgin phrases were written by Greenroom and have not been checked by a speaker**; the panel says so and asks the reviewer to say if a phrase is wrong or to replace it. Latin American Spanish and Pidgin are not single accents, so the reviewer says which country or region they are judging.

## What earns a label (per voice, never across voices)

- **Native-speaker reviewed:** a native speaker, reviewing on this computer, answered Yes to every starred criterion, none No, verdict Yes, and no newer native review says otherwise.
- **Community reviewed:** two different people (native speakers or community members, files included) gave supportive reviews of that voice.
- **Unsupported:** the newest native review of that voice found it not supported.
- A review for one voice or engine never raises the label of another. A single speaker is never taken to represent a whole population.
- Reviews imported from a file are marked as imported and **cannot earn "native-speaker reviewed"**, because Greenroom cannot check who wrote them. An "other" reviewer never changes a label.

## Sharing reviews

**Export my reviews** writes a JSON file of reviews made on this computer; **Import reviews** reads one (validated, at most 500). A native speaker can run the test on their own PC and send the file back. Reviews are kept in the browser's local storage, which a blocked or full store can lose; the screen says when a save failed.

## Status

The suite and its rules are built and tested (15 tests). **No review has been recorded**, so no label has moved. The first useful step is to have a native speaker of each of the four Nigerian accents run the test on the voices you actually use.
