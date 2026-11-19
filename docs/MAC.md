# Greenroom Local on a Mac

**Status: prepared, not yet built or run on a Mac.** The Mac build is made by GitHub (a Mac cannot be built on a Windows PC), and nobody has opened the result on a Mac. Treat the first Mac build as a test.

## Getting the installer

1. On GitHub open **Actions > Release > Run workflow**, choose the branch `feat/agent-studio-presets` (or `main` once merged), and run it. About 15 to 25 minutes later the run page lists downloadable **artifacts**: `macos-installer` (the `.dmg`), `windows-installers` (the NSIS `.exe`, the `.msi` and a portable `.zip`) and `all-installers` (everything plus `SHA256SUMS.txt`).
2. Or push a tag such as `v0.20.0`: the same workflow then also attaches everything to a public GitHub Release.

The Mac job also runs the type check, all 1,235 JavaScript tests and the Rust lint and tests **on a Mac**. If the Rust code has a problem that only shows on macOS, this is where it will show, and the job stops there.

## The app it makes

- A **universal** `.dmg` (Apple Silicon and Intel), macOS 11 (Big Sur) or newer. Drag Greenroom Local to Applications.
- The icon is made from the existing 512 x 512 picture, so it is a little soft at the largest sizes.

## Opening it the first time (unsigned)

Without an Apple Developer certificate the app is only ad-hoc signed, so macOS says it "cannot be opened because Apple cannot check it for malicious software". Either:

- **Control-click (right-click) the app > Open > Open**, once; or
- in Terminal: `xattr -dr com.apple.quarantine "/Applications/Greenroom Local.app"`

To remove this warning you need an **Apple Developer ID certificate** (a paid Apple Developer membership, about USD 99 a year) and notarisation. The workflow is ready for it: add the repository secrets `APPLE_CERTIFICATE` (the .p12, base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`; it then signs and notarises. Nobody can obtain these for you.

## What works on a Mac, and what does not

| Works (by design; **not tested on a Mac**) | Does not work on a Mac |
|---|---|
| Writing and importing scripts, casting, Perform, Listen, Timeline, Export, History, Studio | **Every engine that runs on the PC itself**: Piper, Kokoro, Qwen3-TTS, Chatterbox, WazobiaVoice, local sound effects, ACE-Step music, the local Director. Their set-up downloads a Windows-only Python (`managed_python.rs` is limited to Windows on a 64-bit Intel or AMD chip) and Windows tools. |
| Cloud engines with your own keys: ElevenLabs, Inworld, VoiceKiller, Kie, and the OpenAI and Gemini Director | Anything that starts a Windows program (for example ffmpeg set-up for video) |
| Agent Studio (local-only runs need local voices, so on a Mac use a cloud limit), Draft casting for cloud voices is off by design, the MCP server | Windows Credential Manager: on a Mac keys go in the macOS Keychain (the `keyring` library supports it; untested here) |

So on a Mac, today, Greenroom is a **cloud-voice production tool**. Making the local engines work on macOS (Apple Silicon: MLX or Metal builds of Kokoro, Piper and the others) is a separate piece of work: see [IDEAS.md](IDEAS.md).

## Not checked

The Mac build itself; opening the `.dmg`; every screen on macOS; keys in the Keychain; audio playback and export on macOS; window and menu behaviour; the universal binary on an Intel Mac.

## Windows

The Windows installers (NSIS and MSI) and a portable exe are built on this PC and are in the `Greenroom Local <version>` folders; the same workflow also builds them on GitHub. They are unsigned (SmartScreen warns); see [RELEASING.md](RELEASING.md) for signing.
