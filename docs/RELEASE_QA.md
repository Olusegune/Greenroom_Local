# Greenroom Local Release QA

This checklist is the release gate for a Windows installer. It separates automated verification from the hands-on checks that need a person, account or audio listener.

## Automated results

Run from `app`:

```text
npm run build
npm test -- --run
cd src-tauri && cargo test
npx tauri build
```

Latest release-readiness pass on 2026-10-29:

| Check | Result | Evidence |
|---|---:|---|
| TypeScript and production web build | Pass | `npm run build` |
| Frontend unit tests | Pass | 183 tests in 18 files |
| Rust native unit tests | Pass | 62 tests; 1 network-dependent test intentionally ignored |
| Windows NSIS bundle | Pass | `npx tauri build` produced the installer and portable executable |
| Installer icon configuration | Pass | `tauri.conf.json` bundles `icons/icon.ico` and PNG sizes |
| Wazobia managed-file setup | Pass at code level | Desktop/Downloads discovery and safe copy are covered by validation paths; actual speech remains blocked on an inference runtime |
| ElevenLabs Sound Effects v3 request | Pass | native test asserts model id, loop and prompt-influence payload fields |

## Manual acceptance checklist

Complete this on a clean Windows account before public distribution.

- [ ] Run the installer. Confirm the installer window and Start-menu entry display the Greenroom icon.
- [ ] Launch the installed app. Confirm no black command window appears during startup, Piper install or Chatterbox setup.
- [ ] Toggle Light, Dark and Auto appearance. Restart and confirm the choice persists.
- [ ] Create a project, save it, close it and reopen it.
- [ ] Add a Piper voice, play its sample, favourite it and assign it to a character.
- [ ] Create a take, place an effect in SFX Studio and confirm it appears on Timeline and in export.
- [ ] With a valid ElevenLabs account, generate a short Sound Effects v3 clip and confirm loop/prompt-influence controls are honoured.
- [ ] Enter an invalid cloud key and confirm the error explains the next action without exposing the key.
- [ ] Put `t3_mtl23ls_v2.safetensors` on Desktop, click Wazobia **Install automatically**, and confirm the original remains while Greenroom reports a locally stored model file.
- [ ] Export a WAV mix and open it in a normal media player.
- [ ] Uninstall Greenroom and confirm user projects and model files are not silently deleted.

## Release blockers

Do not publish if any of these are true:

- The installer is missing its icon or the app launches a visible helper console.
- A project, take or model file can be overwritten or deleted without an explicit user action.
- A cloud request can run without its spend/consent confirmation.
- The app claims a model is usable when it only stores a file.
- Tests, production build or installer build fail.

## What automated QA cannot prove

Automated tests cannot judge pronunciation, cultural authenticity, acting quality, paid-provider account permissions, commercial licensing or Windows SmartScreen reputation. Those require a listener, an account owner or a legal review.
