<#
  Builds Greenroom, signs the update, and gathers everything for a GitHub release in one folder.

  Run it from the repository folder:   powershell -ExecutionPolicy Bypass -File scripts\release.ps1 -Notes "What changed"

  It does NOT publish anything. It makes  release\v<version>\  with the installer, its update signature and latest.json.
  Then, on GitHub: Releases > Draft a new release > tag v<version> > drag those three files in > Publish.
  Installed copies of Greenroom find latest.json at
  https://github.com/Olusegune/Greenroom/releases/latest/download/latest.json

  Needs: the update signing key (default  %USERPROFILE%\.greenroom\update-key , never commit it).
  Optional Windows code signing: set GREENROOM_SIGN_THUMBPRINT to the certificate's thumbprint (SHA-1) in your
  Windows certificate store. The installer is then signed with it and timestamped; see docs/RELEASING.md.
#>
param(
  [string]$Notes = "",
  [string]$KeyPath = (Join-Path $env:USERPROFILE ".greenroom\update-key"),
  [string]$Repo = "Olusegune/Greenroom"
)
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
$app = Join-Path $root "app"
$conf = Get-Content (Join-Path $app "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$version = $conf.version
if (-not (Test-Path $KeyPath)) { throw "The update signing key was not found at $KeyPath. Without it, installed copies will refuse the update." }

$env:TAURI_SIGNING_PRIVATE_KEY = $KeyPath
if ($null -eq $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD) { $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = "" }

$extra = @()
if ($env:GREENROOM_SIGN_THUMBPRINT) {
  $cfg = @{ bundle = @{ windows = @{ certificateThumbprint = $env:GREENROOM_SIGN_THUMBPRINT; digestAlgorithm = "sha256"; timestampUrl = "http://timestamp.digicert.com" } } } | ConvertTo-Json -Compress -Depth 6
  $extra = @("--config", $cfg)
  Write-Host "Windows code signing is ON (certificate $($env:GREENROOM_SIGN_THUMBPRINT))."
} else {
  Write-Host "Windows code signing is OFF: Windows SmartScreen will warn when people run the installer."
}

Push-Location $app
try {
  npm ci
  npx tsc --noEmit
  npx vitest run
  npm run tauri build -- @extra
} finally { Pop-Location }

$nsis = Join-Path $app "src-tauri\target\release\bundle\nsis"
$exe = Join-Path $nsis "Greenroom_${version}_x64-setup.exe"
$sig = "$exe.sig"
if (-not (Test-Path $exe) -or -not (Test-Path $sig)) { throw "The installer or its .sig file was not produced. Is createUpdaterArtifacts on?" }

$out = Join-Path $root "release\v$version"
New-Item -ItemType Directory -Force $out | Out-Null
Copy-Item $exe, $sig $out -Force
$latest = [ordered]@{
  version  = $version
  notes    = $Notes
  pub_date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
  platforms = [ordered]@{
    "windows-x86_64" = [ordered]@{
      signature = (Get-Content $sig -Raw).Trim()
      url       = "https://github.com/$Repo/releases/download/v$version/Greenroom_${version}_x64-setup.exe"
    }
  }
}
# Without a byte-order mark: the updater's JSON reader rejects one, and Windows PowerShell 5.1 adds it by default.
[System.IO.File]::WriteAllText((Join-Path $out "latest.json"), ($latest | ConvertTo-Json -Depth 6), (New-Object System.Text.UTF8Encoding $false))
Write-Host ""
Write-Host "Done. Files for the GitHub release are in $out :"
Get-ChildItem $out | ForEach-Object { Write-Host "  $($_.Name)  ($([math]::Round($_.Length/1KB)) KB)" }
Write-Host "Upload all three to a release tagged v$version. Nothing has been published."
