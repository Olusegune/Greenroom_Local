# Listening checklist (0.12.0)

Nothing in Greenroom has been judged by ear. Only you can do that. This is the order that tells us the most for the least time and money. Allow about 90 minutes in total; Parts 1 and 2 need no key and cost nothing.

**Setup:** headphones, a quiet room, the app open, a pen. For each item write **P** (pass), **F** (fail) or **?** (not sure) and a few words. Anything marked F or ? goes to the owner of the code with the line, the engine and what you heard.

---

## Part 1: the four demo scenes (15 min, free)

Files are in the `Demo audio` folder. Play each once through, then once more listening for one thing at a time.

| # | Listen for | Venomspur | Children | RPG | Science |
|---|---|---|---|---|---|
| 1 | Every word is understandable | | | | |
| 2 | Both or all speakers sit at a similar loudness (no one suddenly much louder or quieter) | | | | |
| 3 | No clicks, crackle or distortion, especially at the start and end of each line | | | | |
| 4 | Gaps between lines feel natural, not rushed or dead | | | | |
| 5 | No line is cut off at the end | | | | |
| 6 | Names and unusual words are said acceptably (Venomspur, Grimble, Rayleigh, Ashfall) | | | | |

**What to expect:** these are Piper voices. They read plainly and do not act, so **flat is correct**. In the Venomspur and RPG scenes you should hear *no* throat clearing, chuckle, shout, pant or timed pause. If you do, something is wrong, because Piper cannot make them. Note any word Piper says wrongly: those go in the pronunciation list.

Also check the technical claim: the exported level was about -16 LUFS. If one scene feels much louder than another, mark it F.

---

## Part 2: do the cast voices suit the presets? (15 min, free if you use local voices)

Open **Presets**. For five presets, choose a voice you can hear, press Audition, and judge the match, not the acting (local voices are a plain read).

Suggested five: Noir detective, Curious child, Heroic protagonist, Science explainer, Elderly grandparent.

| Preset | Voice used | Does the voice fit the description? | Age feels right? | Portrait suits the preset? |
|---|---|---|---|---|
| | | | | |

Mark F if the voice contradicts the card (a young voice for the elder, a flat voice for "warm"). Mark F on the portrait if the face seems wrong for the role. **A portrait is only ever a suggestion about role and age; it says nothing about accent.**

---

## Part 3: does written acting direction work? (20 min, a few cents on ElevenLabs)

This is the test that matters most, and it needs your ElevenLabs key. Use **Perform**, one short line, an ElevenLabs voice, and the cost sheet each time (confirm it before you press Go).

Use this line: *"Good evening. I do hope you are well. Your soul is overdue."*

1. Make a take with **no direction** (the control).
2. Open "Direct in your own words" and paste:
   *begins with impeccable British politeness, clears his throat, chuckles quietly, pauses, then delivers the final sentence with restrained menace.*
   Read the preview ("ElevenLabs will get") and note what it lists as sent, approximated and not sent. Make a take.
3. Press **Make it phrase by phrase** and make a take again (this costs one request per phrase).

| Listen for | Take 2 | Take 3 |
|---|---|---|
| A throat clear is audible as a sound (not spoken as the words "clears throat") | | |
| A quiet chuckle is audible | | |
| The first sentence is polite, the last is quieter and colder than the control | | |
| **Bad sign:** the voice reads a tag aloud ("clears throat", "menacing") | | |
| There is a real pause before the last sentence | (not expected) | |
| The joins between phrases sound smooth (take 3) | n/a | |

Mark F on anything the preview said was **sent** but you cannot hear. That is the most important kind of failure: it means a tag does not work on that voice. Write down exactly which tag and which voice.

Then try **Presets, a card, Audition** on one ElevenLabs voice: does the directed audition sound different from the plain read of the same line?

---

## Part 4: accents (30 min, needs a native speaker for a real label)

Greenroom cannot judge accents; only a person's recorded review changes a label.

1. **Presets, search "Nigerian"**, pick a card, **More, then Listening test for this accent**.
2. Choose the voice you actually use, play each phrase, and fill in the form.
3. **If you are not a native speaker of that accent, choose "Someone else".** That records your opinion but never changes the label, which is correct.
4. For a real label: ask a native speaker of each (Yoruba-, Igbo-, Hausa-influenced Nigerian English, Pidgin) to run the same test on their own copy, then **Export my reviews** and send you the file. Import it with **Import reviews**: it can lift a label to "community reviewed" at most, and one native speaker reviewing on this computer earns "native-speaker reviewed".

Questions the reviewer should answer in their own words: Is it a respectful rendering or a caricature? Does the rhythm sound like a person from that community? Are names said as a speaker would say them? Which region were they judging? **The Spanish and Pidgin test phrases were written by Greenroom and not checked by a speaker; ask the reviewer to correct them.**

---

## Part 5: the Agent Studio, live (15 min, set a $1 limit)

1. **Local only on:** run Guided on a project with an ElevenLabs voice. It must refuse cloud steps and say so. For proof, turn off Wi-Fi first: the run should still finish with local voices.
2. **Local only off, limit $1:** plan, Start, approve each checkpoint. Compare the cost sheets with what ElevenLabs actually billed. **Any mismatch is an F.**
3. Try to export before approving delivery: it must wait for you.
4. A cloned voice with no consent record must be refused.
5. Press **Stop** mid-run, then **Continue**: finished steps must not be repeated (no double charge).

---

## Part 6: record the results

Copy this into `DECISIONS.md` as a new row, one per finding, with the date:

> D-__ | date | **Heard:** [engine, voice, tag or direction] sounded [good / wrong because ...]. **Decision:** [keep / change the tag / mark the engine as not acting / fix X]. | Owner listening.

If a tag the preview called **sent** was not audible on a voice, the capability table (`app/src/engineCaps.ts`) is the place to change what that engine is declared to do. Do not change a preset's accent label by hand: use the Listening test so the review is on record.

## What a good outcome looks like

- Part 1: all pass, the speakers feel evenly loud and nothing acted.
- Part 3: the throat clear and chuckle are audible as sounds and the last sentence is colder. If they are not, we learn which tags to drop, which is just as valuable.
- Part 5: nothing is billed that the cost sheet did not show first.
