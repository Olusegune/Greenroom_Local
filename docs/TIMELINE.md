# Timeline editing (v0.8)

The Timeline screen shows the whole performance on lanes: one per character, then sound clips, atmosphere and music. It is where you arrange, not where you generate. Nothing on it costs credit.

## Moving lines
- Drag a speech block to move it. The new start is stored as the line's cue (seconds from the start of the mix, or from picture start when a picture is set).
- Snap to edges and (with a picture) to frames is on by default. Hold Shift while dragging to turn it off.
- Click a block, then use the arrow keys: 10 ms, Shift for 100 ms, Alt for one frame. The Starts at box takes `1:23.5` or `83.5`.
- Follow previous removes the cue so the line goes back to following the line before it.
- Sound clips and the atmosphere move with their line.

## Overlap and crossfades
Lines may overlap. Different characters talking over each other are simply summed. When the same character's lines overlap, the earlier line fades out and the later one fades in across the overlap with equal-power curves, so the level stays steady (measured: -0.0005 dB difference with two different tones). A line entirely inside another is left alone. Each line also has its own fade in and fade out, 5 ms and 10 ms by default so edges never click.

## Music
Add music... copies an audio file (mp3, wav, ogg, m4a, flac, aac, up to 120 MB) into the project as a take, so the project keeps working if the original moves. Drag to place it; drag the edges to trim; set level, fades, and whether it dips under dialogue. The source and licence box is copied into the production report, which says plainly when it is empty. Greenroom does not check rights.

## Ducking
Music dips while anyone speaks. The curve is worked out from where the lines are, so it follows them when you move them: it starts before the line (attack), holds a little after (hold), and returns over the release time. Where lines are close, the deepest dip wins and the music never goes below the chosen amount. Defaults are -12 dB, 150 ms, 250 ms, 700 ms. Dipping the atmosphere is optional. The same curve is applied in playback, exports and the Music stem.

Measured in the app's own mixer with a constant tone: -12.000 dB under dialogue and back to full level after the release.

## Export
Music is its own stem ("Music"), is included in the mix, is listed in the OTIO timeline with its trim and the licence note, and its original is copied into a Music folder.

## Limits
- Undo and Redo here are the project-wide ones (see docs/HISTORY.md): Ctrl+Z and Ctrl+Shift+Z, up to 100 steps. A quick run of the same kind of change is one step. Making a take ends the undo history; versions go further back.
- Scene-by-scene exports use the lines only, without cues or music.
- Not yet checked in Resolve, Premiere or Pro Tools, and not yet judged by ear.
