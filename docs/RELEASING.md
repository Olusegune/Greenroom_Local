# Releasing, updating and signing (v0.15)

Two different signatures are involved. Do not confuse them.

| | What it protects | Status |
|---|---|---|
| **Update signature** (minisign) | An installed Greenroom only accepts an update that was signed with Greenroom's own key. Protects you from a fake update. | **Set up and tested** |
| **Windows code signing** (Authenticode) | Tells Windows who published the installer, so SmartScreen does not warn "unknown publisher". | **Prepared, not active: needs a certificate you must obtain** |

## Auto-update (done)
- Greenroom checks `https://github.com/Olusegune/Greenroom/releases/latest/download/latest.json` shortly after it starts (can be turned off in Settings, Updates) and when you press **Check for updates**.
- It never installs by itself. When a newer version exists, Settings shows its notes and **Download, install and restart**. Pressing it downloads the installer, checks it against the public key built into Greenroom, refuses it if the check fails, installs it and restarts.
- The check sends an ordinary web request to GitHub, which can see the internet address. Nothing about you or your projects is sent.

### The update signing key
- Public key: in `app/src-tauri/tauri.conf.json` (safe to share).
- Private key: `C:\Users\eduni\.greenroom\update-key`, outside the repository, **with no password**. Back it up somewhere private (a password manager or an encrypted drive). **If it is lost, installed copies can never be updated again** and everyone would have to install a new build by hand. If it is stolen, anyone who can also publish to your GitHub releases could push a malicious update. You can set a password by generating a new key, which means one more manual install for everyone, because the public key inside the app changes.
- Never commit it. `.gitignore` does not list it because it is not in the repository folder.

### Making a release
1. Bump the version (`package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src/version.ts`).
2. Run `powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Notes "What changed"`. It runs the checks, builds, signs the update and makes `release\v<version>` with the installer, its `.sig` and `latest.json`. It publishes nothing.
3. On GitHub: Releases, Draft a new release, tag `v<version>`, drag in the three files, Publish. Installed copies find the new `latest.json` on their next check.

## Windows code signing (not active yet)
Without it, Windows SmartScreen warns when someone runs the installer. This needs a certificate issued to you or your company, which I cannot obtain for you. Options, with approximate costs that you should check before buying:
- **Azure Artifact (Trusted) Signing**: Microsoft's service, roughly ten dollars a month. Needs a verified identity. Good for a solo developer if you are in a supported country.
- **An OV or EV code-signing certificate** from a certificate authority such as DigiCert or Sectigo: roughly a few hundred dollars a year; EV gives the best SmartScreen reputation. Since 2023 the private key must be on a hardware token or cloud HSM, so the signing step runs on the machine that holds it.
- **SignPath Foundation**: free signing for open-source projects, if the repository is public and openly licensed.

When you have one, put the certificate in the Windows certificate store, copy its thumbprint, and set `GREENROOM_SIGN_THUMBPRINT` before running `release.ps1`: it signs the installer with SHA-256 and a timestamp. A signed installer builds SmartScreen reputation over time; the first downloads may still warn.

## Checked
- The signing key was generated, its public half is in the app, and `tauri build` produces the installer and its `.sig`.
- Against a local test server (not GitHub), a test build of an older version: found the newer version at start-up and showed its notes and the Settings badge; downloaded and accepted the correctly signed installer; **refused an installer changed by one byte**; refused a damaged signature. Unit tests cover the check, install and error states.
- `cargo audit` shows no vulnerabilities (the updater's zip feature was switched off).

## Not checked
- A real update from GitHub (nothing is published yet), and the install-and-restart step itself: I did not run an installer on your computer.
- Whether `/passive` NSIS installs of an update keep user settings (the install mode is per-user, so they should).
- Windows code signing, and SmartScreen behaviour.
