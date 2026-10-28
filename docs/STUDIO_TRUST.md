# Studio trust (v0.6)

What Greenroom records so a producer, studio or legal team can ask "where did this come from, who agreed to it, and what did it cost?". It is a record and a set of warnings. It never blocks the owner from working.

## Take provenance
Every take keeps: the engine, model and voice name; the audio quality asked for; speed; the director's direction (emotion, sounds, note); how many pronunciation rules applied; exactly what was sent to the engine; the time; the Greenroom version; and a SHA-256 fingerprint of the audio file as saved. Sound clips and the atmosphere keep their prompt and fingerprint. Takes made before 0.6 simply show that nothing was recorded.

Studio > "Check the fingerprints" re-reads each take file and reports a changed or missing file. This shows a file was altered; it does not prove who altered it.

## Consent and rights
- A **cloned voice needs a consent record** to be created: the speaker's name, the basis (own voice, written permission, licensed, other) and an optional reference such as a signed release. The permission tick-box and the backend check remain.
- **Designed voices** record "no real person" and the description.
- **Any voice** can carry a **commercial-use** note (cleared, personal only, not noted) with a free-text note on where it was checked.
- Status per voice: **clear**, **to review** (licence not noted, or basis Other without a reference, or personal use only) or **consent needed** (a clone with no record).
- Studio lists the voices a project actually uses. Export shows a warning if a clone has no record. Nothing is blocked.

## Cost and budget
Greenroom cannot see real prices, so the owner enters them (Studio): cost per 1,000 characters for ElevenLabs, VoiceKiller and Kie, and per sound clip, Director call and design preview. Offline engines are free. Every paid action shows an estimate in its confirmation sheet; if a **project budget** is set and the work would pass it, a red warning appears and the button changes to "Go over budget and continue". The warning is never skipped by "do not ask again". Spend is recorded in a per-project ledger (speech, sound clips, Director, design, samples) and totalled by engine. Costs are **estimates from the owner's own prices**; providers' invoices are the truth.

## Reports
- **Cue sheet (.csv):** every spoken line with timecode, text, direction, level, voice id, model, take id, what was sent, engine, audio quality, take fingerprint and voice rights status.
- **Production report (.md):** summary, an AI disclosure paragraph, voices and rights (with items to review), cost by engine against budget, and every take used with its fingerprint.
- **Rights register (.csv):** one row per voice used.
- **Integrity manifest (.sha256.txt):** `hash *filename` for every other exported file, in the format `sha256sum -c` reads.

## Verified
- SHA-256 matches the standard test vector; budget, estimate and rights rules have unit tests.
- A demo-mode export was read back: all manifest hashes matched the exported bytes; the cue sheet fingerprint equalled the take's; the report listed disclosure, rights, cost and takes; an over-budget job showed the warning and the changed button; fingerprint checking reported matches.

## Not verified / limits
- Not a legal document: the AI disclosure and consent wording should be reviewed by a lawyer before use in a contract or a delivery spec.
- The fingerprint shows change, not authorship; there is no signature or tamper-proof log.
- Whether a given engine's terms allow a given commercial use is for the owner to check and record; Greenroom does not know.
- Costs depend entirely on the prices entered.
