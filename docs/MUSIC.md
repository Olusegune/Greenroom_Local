# Making music with Suno through Kie (v0.11)

Timeline screen, **Make music with Suno** (a folded card under the lanes).

## How it works
You give a title, a style description (up to 1000 characters), and choose a version: V6, V6 Mini or V6 Wild. Optional: no vocals (the default, best under dialogue), lyrics, a singer hint (female or male), things to avoid, and a length of 10 to 360 seconds (0 lets Suno decide).

Greenroom sends this to Kie (`POST /api/v1/jobs/createTask`, model `ai-music-api/generate`, always in Kie's custom mode), then polls `GET /api/v1/jobs/recordInfo` for up to about five minutes. It usually returns two tracks. Every track is saved in the project as a take that is never overwritten, with its SHA-256. You hear each one and choose **Put on the timeline**, where it behaves like any imported music: drag, trim, fade, dip under dialogue.

The request is checked against Kie's documented limits before anything is sent, so a mistake costs nothing. It always asks first with a confirmation sheet; the price comes from "Per music request" in Studio (unknown until you set it) and counts toward the project budget and the ledger.

## Rights
Music made this way is not cleared by Greenroom. Each clip gets a source note saying it was made with Suno through Kie, the date and the style prompt, which goes in the production report. Whether you may use the result commercially depends on your Kie and Suno plans. Check before release.

## Source of the API details
docs.kie.ai, Suno "Generate Music" page (`/suno-api/generate-music.md`), read 2026-10-26. The same page marks older model names (V4 to V5.5) as discontinued and says to use V6, V6 Mini or V6 Wild. Kie keeps generated files for 14 days, so Greenroom downloads them straight away.

## Checked
- Request building and validation, polling, failure messages and track reading, against a fake Kie server (unit tests).
- The whole flow in demo mode: sheet, two tracks, playback, placing one on the timeline with its source note.

## Not checked
- A real Suno request. No paid call has been made; the field names for the finished tracks (`audio_url`, `title`, `duration`) come from the documented callback format and the response path `data.response.data[]`, and the first real run may show a difference.
- How long real jobs take, or their credit cost.
- How the music sounds, or whether it suits your scene.
