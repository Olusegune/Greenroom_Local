# What would make Greenroom Hollywood-ready

Written 2026-10-26 after the 0.11 build. Honest status first, then ideas ranked by what they unlock.

## Where it stands
Strong for a solo creator or a small team making AI dialogue: 48 kHz 24-bit BWF with timecode, markers, stems, OTIO, cue sheet, loudness, picture sync, a real timeline with crossfades and ducking, provenance and consent records, a production report, a video with the new mix.

What has never been proven (the gap between a good tool and a trusted one):
1. **Nobody has listened to the results systematically.** Accent quality (Yoruba, Igbo, Hausa, Filipino), emotion tags and effort sounds are all unrated. Claims about quality come only from your ears.
2. **No interchange test in real post software.** WAV, OTIO and the video were verified with ffmpeg/ffprobe, never opened in Resolve, Premiere, Pro Tools or Reaper.
3. **No real run of Kie sound effects, Kie Suno, VoiceKiller or Piper through the installed app** (they are tested against fake servers).
4. **Installer is unsigned**, so Windows SmartScreen will warn, and there is no auto-update.

## Do first (unlocks trust)
1. **Listening sheets.** A built-in A/B and rating sheet per accent and per voice, saved to the project, so choices are evidence not memory. The Lab exists; extend it to your accent list and your own designed voices, and export the ratings.
2. **Interchange proof.** Import the OTIO, BWF stems and cue markers into Resolve, Premiere and Reaper; fix whatever breaks; add AAF and CMX EDL output, which most post houses actually ask for.
3. **Code-sign the installer and add auto-update**, with opt-in crash reports.
4. **Project-wide undo, automatic versions and backups.** Today only the Timeline has undo.

## Do next (production workflow)
5. **ADR and revoicing:** loop a picture region with cue beeps, record a human line against it, keep it next to the AI takes, and mark a line approved, alt or rejected.
6. **Dub-fit:** stretch or re-time a take to land inside a target duration (for lip-sync dubbing), with the change shown and limits so it never sounds sped up.
7. **Review and approval:** comments on lines, a status per line (draft, approved, locked), and a shareable review bundle (video with mix plus a notes PDF).
8. **Drop-frame and more frame rates**, source start timecode carried into the video, and 29.97/59.94 checks.
9. **Deliverables:** M&E and dialogue-only stems named to common specs, loudness presets per streaming service plus a gated dialogue measure, and a real true-peak meter.
10. **Multichannel:** 5.1 and Atmos beds are out of scope today (stereo only); at least mono dialogue stems and a panned stereo mix.

## Protect the studio (legal and ethical)
11. **Content credentials:** embed C2PA or an equivalent signed label saying the audio is AI-generated, in addition to the production report.
12. **Consent and union terms:** a consent template per jurisdiction, expiry dates on consent, and a warning when a cloned voice is used beyond its stated purpose. Keep the audit log append-only.
13. **Licence tracking for music and sounds:** required licence fields before export, and a clear flag on AI-generated music whose terms the user has not confirmed.

## Quality of the voices themselves
14. **Pronunciation by phoneme (IPA)**, not only respelling, and a shared studio lexicon.
15. **Take comparison tools:** waveform and spectrum A/B, pitch and pace curves, and "regenerate just this phrase".
16. **Fallback and reliability:** retries with backoff, a resumable render queue, offline fallback voices, and per-engine health checks.
17. **Local high-end models** (open expressive TTS) through the local server connector, with benchmarks on your accent list.

## Housekeeping
18. Translate the app interface (the voices already cover many languages).
19. Accessibility pass with a screen reader and keyboard-only run; High-contrast theme.
20. Performance test with a feature-length script (thousands of lines) and many takes.
21. Screenshots and a short guide for each screen, kept in step with the app.
