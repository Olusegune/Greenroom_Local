# Security review (2026-11-08, version 0.8.8)

Scope: the voice-face work of versions 0.8.0 to 0.8.8 (automatic faces, voice gender/age/heritage, avatar library, portrait handling) and a check of the app's overall posture. Method: automated tests, tool scans, and reading the code and configuration. **Rafter's remote scan (`rafter run`) could not run: the account's fast-scan quota is used up for this billing period.** Everything below was done locally instead, and the remote scan should be run when the quota resets.

## Tools run

| Check | Result |
|---|---|
| `rafter secrets .` (offline secret scan of the repository) | No secrets detected |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `cargo audit` (531 Rust crates) | 0 vulnerabilities; 6 warnings (unmaintained: `proc-macro-error`, `zbus_names`, `zvariant`, `zvariant_derive`; unsound: `glib` 0.18; yanked: `async-executor`). All come in through Tauri's Linux desktop stack, not the Windows build; nothing to act on except updating Tauri when a release drops them |
| Static source tests (`faceSecurity.test.ts`) | No `dangerouslySetInnerHTML`, `innerHTML =`, `eval`, `new Function` or `document.write`; the avatar and face code makes no network request of its own; no key, token or private key in source |
| Rust tests and `clippy -D warnings` | 110 passed; clean |

## Found and fixed

1. **Slow input (ReDoS-style).** A voice name of 200,000 spaces took 13 seconds to read, because a pattern that splits a name on " - " backtracked badly. A hostile or corrupted `voices.json` could freeze the Voices screen. Fixed: every stored string is cut short (name 200, accent and language 80, notes 1,500, whole hint 2,000) before any pattern runs, and the split uses a pattern that cannot backtrack. A test now throws nine kinds of hostile text of up to 200,000 characters at the reader and requires each to finish in under a second.
2. **Crash on odd stored data.** A voice whose name was a number, or whose gender was an object, made the face picker throw (`split is not a function`), which would blank the screen. Fixed: only strings are read, everything else is treated as "not stated".
3. **Crash on an unknown stored age or heritage.** A hand-edited or corrupted `age` such as `"hacked"` made the picker throw. Fixed: only the known values are accepted; others are ignored.
4. **Prototype keys.** Lookup tables are now null-prototype objects, so a portrait or voice id like `__proto__`, `constructor` or `toString` finds nothing instead of an inherited function. Tested.
5. **A stray "male" read from "for women".** Descriptions such as "great for kids' stories" or "a voice for women's health" were read as the voice's own age and gender. Not a security flaw, but wrong data that drove the pictures; fixed and tested.

## Checked and found sound

- **Pictures a voice can carry** must be small image data addresses of type jpeg, png or webp; SVG, HTML, `javascript:` and links are refused (tested, including a 500,000-character one).
- **The avatar manifest** cannot point outside the app: absolute paths, `..`, drive letters, `file:`, `http(s):`, `//host` and `data:` asset paths are all refused and the entry dropped (tested for ten forms). The shipped manifest contains only `folder/name.png|webp` paths.
- **Text from a voice or a character** is only ever rendered by React as text (no HTML sink anywhere in the source).
- **Content-Security-Policy** (`tauri.conf.json`): `default-src 'self'`, scripts only from the app, `object-src 'none'`, `form-action 'none'`, `frame-ancestors 'none'`, `connect-src` limited to the app and its IPC (all provider traffic goes through the Rust side). The one loosened item is `style-src 'unsafe-inline'`, needed for React's inline styles; it cannot run script.
- **Asset protocol** is enabled with an empty scope, so it exposes no files.
- **Keys** live only in the Windows Credential Manager (earlier review), are never logged or returned to the page.
- **Paid calls** all go through the spend sheet (tested).
- **Privacy of the test data:** the real-voice test fixture has the owner's custom voice names replaced by `Voice NN` and the names removed from the notes; it contains no ids, keys, previews or audio.

## Open risks and recommendations

1. **Installers are unsigned** (no code-signing certificate), so Windows SmartScreen warns on first run, and the updater has a public key but **no private key is set up**, so auto-update cannot ship safely yet. Get a code-signing certificate and generate/store the updater key (offline, backed up).
2. **`rafter run` (remote SAST/SCA) has not been run on this branch**; run it when the quota resets, and `rafter run --mode plus` (paid, asks first) before a public release.
3. **Capabilities:** the main window may open links (`opener:default`), restart and exit the app, and show an open-file dialog. Reasonable, but `opener:default` could be narrowed to the reveal-in-folder permission already listed.
4. **Dependencies:** re-run `npm audit` and `cargo audit` before each release (a CI job would do this on every push).
5. **Rights:** portraits are recorded as the owner's on their statement; the generator and its terms were not recorded. Keep that record.
6. **Not tested:** behaviour of the installed build under a real restart with a corrupted `voices.json` (the same code path is unit-tested); a network capture of the running app; fuzzing of the Rust parsers beyond the existing unit tests.

## Added in 0.9.0: the "Add portraits" importer (secure-design walk, then tests)

The importer takes untrusted files from the owner's computer, so it was designed with the ingestion checklist before it was written.

| Question | Decision |
|---|---|
| What is accepted? | PNG, JPEG, WebP only. The declared type, the file's first bytes and its extension must all agree. SVG, GIF, HTML, programs and anything renamed are refused with a plain message. |
| Size and count | 15 MB per file, 24 files per batch, 300 portraits in total, and a 400,000-character cap on each stored picture. |
| Decompression bombs | The picture's size is read from its header **before anything decodes it**; more than 40 megapixels is refused (a 30,000 x 30,000 PNG that is a few kilobytes), and the decoded size is checked again afterwards. |
| What is kept | The picture is decoded by the browser and drawn onto a canvas, then saved as a fresh JPEG (512 and 128 pixels). So EXIF data, embedded payloads and polyglot tricks are not kept. The file's own name and path are never stored; a name is made from it only as a suggestion and cleaned. |
| Names and labels | Control, invisible and direction-changing characters are removed and the length is capped. Gender, age and heritage come from fixed lists and are checked again when the saved file is loaded; anything else is dropped. Names are shown as text by React, never as HTML. |
| Where does it go | Only to the local avatar file (`avatars.json`, which the Rust side already validates as an object and caps at 48 MB). No network use at all (a source test checks the importer files for `fetch`, sockets and URLs). |
| Never enlarged | A picture under 256 pixels on its short side is refused, so nothing is blown up. |
| Duplicates | A perceptual hash flags a picture that is already in the library or in the same batch (tested in the real browser). |

Tested: 22 unit tests (`importer.test.ts`) for the signature checks, the header size reader on real WebP and PNG files and on a crafted bomb, name cleaning, the crop staying inside the picture for hostile control values, duplicate matching, owner portraits taking part in automatic faces without crossing gender or age, and hostile saved files being cleaned on load; plus a real-Chrome run that fed the screen two real pictures, a picture already in the library, a text file named `.png`, an SVG and an empty file: the three bad ones were refused with the right messages and the others were added with no console errors.

Not tested: files over the size cap through the real file picker (the cap is a unit test), animated or multi-frame images, and the installed build.
