# Release readiness: 0.13.0 (2026-11-10)

An honest status, not a sign-off. "Ready" here means the checks below passed; it does not mean anything was judged by ear.

## What passed

| Check | Result |
|---|---|
| Type check (`npx tsc --noEmit`) | clean |
| JavaScript tests (`npx vitest run`) | **1,067 pass**, 2 skipped (the demo builder and the acceptance run, which only run on request) |
| Rust (`cargo clippy --all-targets -- -D warnings`, `cargo test`) | clippy clean; **130 pass**, 3 ignored (real-engine runs) |
| Dependency audits | `npm audit --omit=dev`: 0 vulnerabilities; `cargo audit`: 0 vulnerabilities, 6 allowed warnings (unchanged) |
| Secret scan (`rafter secrets .`) | no secrets detected |
| Installers | NSIS and MSI built (14.66 and 16.70 MiB, the healthy size); portable exe 28.6 MiB. The updater-signing step reports no private key, as before. |
| Real window | the built exe was started, its window looked at, and a **read-only** script drove every screen of the real app against the owner's real data: all opened, no console errors, 17 real voices listed with honest statuses, twelve genre tiles with icons |
| Browser runs on the demo build | smoke (every screen), presets, presets with voices, own audio, sweep (every screen, three widths, both themes), script and picture import, agent (whole guided run including the approval step), keyboard, setup (Kokoro, Qwen, wizard), casting (panel, approve, lock, change, unlock, metadata review), accessibility (axe, WCAG 2.1 A/AA, both themes): no findings |
| Real audio | the six-character acceptance production through the casting rules with real Piper and Kokoro (see `VOICE_QUALITY_QA.md`) |

## What was found and fixed during QA

- The Cast cards stretched when one casting panel opened; the new text inputs lacked the app's input style; the voice list items clipped their text; the genre tiles' decoration made the sweep report clipped text. All fixed.
- Three browser tests were out of date with earlier releases (Compare moved under "More" in 0.12.8; Kokoro and Qwen became "Ready" in 0.12.6; the agent's cast step changed in this release) and were updated.
- The rules are stricter than before, by design: with nothing listened to, **no voice is "verified" and auto-cast assigns nothing**. Expect to confirm voices in Voice metadata before the agent can cast alone.

## Commercial release blockers

1. **Nothing has been judged by ear.** Every gender, age and accent fact is a claim until you listen. Accent authenticity needs a native speaker of each accent.
2. **Unsigned installers** (Windows SmartScreen warns) and **no updater signing key**, so auto-update cannot ship.
3. **Licences.** L2-ARCTIC (CC BY-NC) and WazobiaVoice (research licence) are non-commercial and are refused in a commercial project; the licences of Piper's own voices and of every other voice must be recorded per voice before a commercial release (`COMMERCIAL_LICENSING.md`).
4. **The installed app has not been clicked through with real data** beyond the read-only check: no project was opened, no voice approved, no take generated in the real app by a test. Upgrade over an older install and uninstall are untested.
5. **Engines not exercised on this PC:** WazobiaVoice (gated model; needed for the Yoruba grandfather), sound effects (weights not installed), ACE-Step, and every cloud engine (never called, by design). Chatterbox was not re-run.
6. `rafter run` (the remote scan) has not been run (no key on this PC).

## Known limits

- No voice installed here is recorded as a child or a teenager, so those characters cannot be cast until you add and confirm such a voice.
- Qwen3-TTS re-designs its voice from a written description on every line, so it can drift between lines; it is about a minute per line on a CPU.
- Renaming a speaker in the script creates a new character; two characters with the same name are one character.
- The expression table says what an engine accepts; none is verified.
- Screen-reader, zoom and high-contrast testing were not done.
