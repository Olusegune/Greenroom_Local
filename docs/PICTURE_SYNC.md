# Picture sync (v0.7)

Work to a video: place each line at an exact timecode, listen to the sound with the picture, and export audio that stays in sync.

## What it does
- **Import:** Picture > Choose a video (MP4, MOV, M4V, WebM, MKV, AVI, MPEG). The file stays where it is; Greenroom remembers its path. The Windows file picker is used, and the player is allowed to read only that one file.
- **Frame rate:** read from the file for MP4, MOV and M4V (a 23.976 file reads as exactly 24000/1001). Other types do not state it, so you choose it. The timecode of the first frame is yours to set (for example 01:00:00:00).
- **Placing lines:** scrub or step by frame (arrow keys, or the buttons), then "Set to playhead"; type a timecode; nudge by a frame; or drag a block on the timeline strip. "Line them up from the playhead" places every line one after another as a starting point. A line without a cue follows the line before it. Dialogue may overlap.
- **Listening:** Play runs the picture (its own sound muted) with Greenroom's mix, re-aligned if they drift by more than about 35 ms. The preview is to within about a twentieth of a second. Exports are sample accurate.
- **Export, with a picture:**
  - "Make the mix exactly as long as the picture" (on by default): the mix and every stem are exactly the picture's length; sound after the end is cut off, and the Picture screen warns about lines that run past it.
  - Mixed and stem WAVs carry a Broadcast Wave time reference, so a DAW can place them at the start timecode.
  - Markers, the cue sheet and the editor timeline use the picture's exact frame rate and start timecode. The timeline (.otio) has a Video track pointing at the file, and extra lanes ("ADA 2") where one character's lines overlap.
  - After exporting, the Export screen states the mix length in samples against the picture length and the first sample's timecode.

## Measured
- MP4/MOV header reading is tested on synthetic files: 23.976, 25, 29.97, a stray long frame, header at the end of the file, no video track, corrupt sizes.
- Timecode: one real hour of 23.976 video reads 00:59:56:10 (non-drop); round trips between time and timecode are exact for every preset rate.
- A demo-mode export against a real recorded video (25 fps, start 01:00:00:00) was decoded again: the mix was 293,664 samples at 48 kHz, equal to the picture; the time reference was 172,800,000 samples (01:00:00:00); the markers were at samples 23,040, 96,000 and 192,000 for cues at 0.48, 2.0 and 4.0 s; the stems were the same length and summed to the mix; the cue sheet and editor timeline carried the right timecodes.

## Limits and not yet verified
- **Non-drop timecode only.** Drop-frame timecode at 29.97 or 59.94 is not supported.
- **Start timecode from the file is not read.** MOV timecode tracks are ignored: type the start timecode.
- **No video is written.** Greenroom does not produce a video with the new sound; the .otio links the picture and the audio for an editor.
- **The editor timeline is not yet opened in DaVinci Resolve or Premiere.** OTIO places clips in frames, so a clip can be up to half a frame off; the mixed file and stems are exact.
- **Variable frame rate files** are treated as their most common frame rate.
- Preview sync depends on the computer; the player is the system's WebView2.
- Per-scene exports ignore cues and run in order from zero.

## Writing a video with the mix (v0.9)
On the Export screen, with a picture set, **Write the video** makes a copy of the video with the Greenroom mix as its sound. See docs/VIDEO_MIX.md.
