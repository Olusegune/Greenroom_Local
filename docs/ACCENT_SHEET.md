# Accent listening sheet (v0.12)

Voices → **Accent test**.

## What it does
1. You choose accents (the ten in Design a voice, plus a "no accent asked for" control) and a voice type (woman or man in their forties).
2. **Make the samples** asks once, showing the number of previews (accents × 3) and the cost from your Studio prices, then designs a voice for each accent. Every accent is told the same description except the accent phrase, and every voice speaks the same passage, so the accent is the only thing that changes.
3. You hear each preview (A, B, C) and rate **Accent** and **Natural** from 1 to 5, add a note, and mark one **Preferred** per accent. Ratings save as you go.
4. **Keep as a voice** saves a preview to your ElevenLabs account and library (this may need a plan that allows saving voices).
5. **Save report and table** writes a Markdown report and a CSV to `Documents\Greenroom\accent-sheet\reports`. The CSV is safe to open in a spreadsheet (cells that look like formulas are neutralised).

Samples and ratings are kept in `Documents\Greenroom\accent-sheet`, so you can come back later. The run saves after each accent, so a failure keeps everything made so far. It never claims an accent is authentic: the report says the scores are the listener's.

## Checked
Unit tests for the plan, saved-data parsing, grouping, averages, the Markdown and CSV reports, and the Rust storage (names are never trusted as paths). In demo mode, the sheet made 33 previews in 11 groups.

## Not checked
A real run with ElevenLabs (no paid call was made), the sound of any accent, and the "Keep as a voice" step against a real account.

# Also in 0.12
- **Voice cards** are redesigned: a stylised illustrated face for each voice, a round play button on it, a name and one-line description, and one action. Notes, rights and delete fold under "More". The faces are drawn from the voice's id, so a voice always keeps its face; they are illustrations, not photographs of anyone.
- **Perform**: every line has a voice and engine switcher (grouped by engine) and, when a character has no voice, a picker right on the line.
- **Look and feel**: rounder, softer surfaces, new type scale, floating action bar, motion on dialogs.
