# Pro audio (v0.5)

What Greenroom writes for a studio, and what is still unproven.

## Output
| Item | Detail |
|---|---|
| Mixed file | WAV, stereo, 44.1 / 48 / 96 kHz, 16-bit (dithered), 24-bit or 32-bit float. Default 48 kHz, 24-bit. |
| Broadcast Wave | A `bext` chunk (description = project name, originator = Greenroom, date, time). |
| Markers in the WAV | `cue ` and `LIST adtl labl` chunks, one per spoken line, named `01 ADA`. |
| Stems | One WAV per character, one for sound clips, one for atmosphere. Same length and format as the mix, so they add back to it. |
| Loudness | One static gain on the mix and every stem. Targets: -23 LUFS (EBU R128), -24 LKFS (ATSC A/85), -16 (online), -14 (streaming). Peak ceiling -1, -2 or -3 dBTP. No limiter: if the ceiling stops the gain, the report says so. |
| Per-line level | -18 to +9 dB per line, applied in the mix and stems, not in the original line files. |
| Original lines | Untouched takes, one folder per character. |
| Label track | `.txt`, start / end / name, for Audacity and Reaper. |
| Cue sheet | `.csv` with timecode, text, direction, level, voice id, model, take id and exactly what was sent to the voice. |
| Timeline | `.otio` (OpenTimelineIO 1.0 JSON): a track per stem, clips at exact times, pointing at the exported originals by file URL. |

## Source quality
ElevenLabs takes arrive as MP3 128 kbps by default. Engines > Audio quality can ask for MP3 192 (Creator plan), WAV 44.1 kHz (Pro plan) or WAV 48 kHz (plan not stated by ElevenLabs). A 24-bit export of an MP3 take is clean but not more detailed than the MP3.

## Measured and tested
- BS.1770 loudness reads -23.0 LUFS for a -23 dBFS 997 Hz stereo tone at 44.1, 48 and 96 kHz; gating ignores silence; mono reads 3 dB lower than the same tone on both channels.
- True peak is a 4x windowed-sinc estimate and finds peaks between samples. It is not a certified meter.
- A demo-mode export was decoded again: 48 kHz, 24-bit, stereo, 7 cue points, stems equal to the mix in length and summing to it with zero difference, mix measured -23.0 LUFS after normalising.

## Not yet verified (owner to try)
1. Open the `.wav` in Pro Tools, Reaper, Audition or Resolve and check the markers appear.
2. Import the `.otio` in DaVinci Resolve (File > Import > Timeline) and check the tracks, positions and that the media links. OTIO audio clips are placed in frames at the chosen frame rate, so a clip can be off by up to half a frame; the mixed file and stems are sample accurate.
3. Compare the loudness reading with a trusted meter (for example the one in Resolve, Reaper or Youlean) on the same file.
4. Check what plan your ElevenLabs account needs for the lossless WAV options.
