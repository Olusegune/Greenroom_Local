# Greenroom: notes for Claude

Windows desktop app (Tauri 2 + React/TypeScript + Rust) for directing lifelike AI voice performances: write a scene, cast voices, direct delivery and body sounds, make takes, export audio. Plan: `PLAN.md`. Decisions: `DECISIONS.md`.

Commands (run from `app/`): `npx tsc --noEmit` · `npx vitest run` · `cd src-tauri && cargo clippy --all-targets -- -D warnings && cargo test` · `npx tauri build` (installer in `src-tauri/target/release/bundle/nsis`).

## Rules that matter here
- The owner does not use a terminal. Everything is done in the app window; deliver a built `.exe` or installer.
- Money: every paid call (speech, sound effects, voice design, samples) goes through `confirmSpend` in `ctx.tsx` first. Never add a path that spends without that sheet. Do not make paid calls yourself while testing: use the fake servers in Rust tests and the demo backend `mock.ts` (used only in a plain browser, never in the app).
- Keys live only in the Windows Credential Manager (`lib.rs`). Never log them, return them to the UI or write them to a file. Cloning needs the permission flag, checked again in `voice_clone`.
- Provider code sits behind small clients (`eleven.rs`, `voicekiller.rs`, `kie.rs`) that take a base URL so tests run against `eleven::fake`. Do not hardcode unverified model ids or endpoints: check the provider docs and note the date.
- Takes are immutable files (`store::take_write` refuses to overwrite). Saves are atomic (write then rename).
- Names from outside go through `store::safe_filename`/`valid_id` before becoming paths.
- Claims about quality (accents, sounds) come only from the owner listening, and are recorded in `DECISIONS.md`.
- Use the shared UI pieces and tokens in `src/styles/`. Accent colour is green; structure follows Soundstage (dark stage, thin wide-tracked display type, small radii).
- On Windows, write files containing apostrophes with the Write tool, not shell heredocs.
- Report test counts honestly, with a "Not checked" list.
