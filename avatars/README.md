# Avatar assets

- `library.json`: the curated entries. Each has metadata and the `source` file name of its portrait.
- `masters/`: the 1024 x 1024 PNG masters (not bundled into the app).
- `plan.json`: the 88 portraits still to be made, with a prompt for each. **Not assets.**
- Derivatives and the runtime manifest are in `app/public/avatars/`.

Status: **12 of 100** full-resolution portraits, plus **22 preview-resolution** portraits (256 px, cut from contact sheets, no master) that do not count toward the 100. See `docs/AVATAR_LIBRARY.md` for the pipeline, the rights status and the QA results.

Rules: no scraped or copyrighted character art, no recognizable franchise characters, no celebrity likenesses, no text or watermarks, no recoloured duplicates, and no upscaling. Never add an entry to `library.json` without its real files, and never count a plan slot as an avatar.
