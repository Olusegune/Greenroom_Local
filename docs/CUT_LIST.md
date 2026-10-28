# Cut list (.edl) export (v0.13)

Export screen, "For other software": **A cut list (.edl)**.

It writes a CMX 3600 edit decision list, the oldest and most widely read cut list format. DaVinci Resolve, Premiere, Avid and most conform tools can read it.

- One event for each clip: every line, sound clip, music clip and each loop of the atmosphere.
- **Record times** count from the picture's start timecode (for example 01:00:00:00); with no picture they start at 00:00:00:00. **Source times** count from the start of each original file, and a trimmed music clip starts where its trim starts.
- Overlapping clips are separate events at overlapping record times. The stem (character, sound clips, atmosphere, music) is named in a comment on each event, with any level change and whether it dips under dialogue.
- The original audio files are copied next to it, and each event names its file, so an editor can relink.
- Non-drop frame only. Clips shorter than one frame are left out.

## Checked
Unit tests for the header, event numbering and order, four timecodes on every event, source and record times, picture start timecode, overlaps, atmosphere looping, music trims and file and stem comments.

## Not checked
It has not been opened in Resolve, Premiere, Avid or Pro Tools. EDL has no way to say levels, fades or ducking, so those travel only as comments; the WAV mix and stems carry them. EDL audio tracks are decided by the importing program, so overlapping clips may need moving onto separate tracks there. AAF export is not built: it is a binary container that needs its own library and testing in the target programs.
