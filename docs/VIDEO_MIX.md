# A video with the new sound (v0.9)

Export screen, Picture card: **Write the video**.

## What it does
1. Mixes the project to exactly the picture's length at your loudness target and writes that mix as `<project> - mix for video.wav` in the project's exports folder (with the Broadcast Wave time reference, as in a normal export).
2. Copies your video into a new file in `exports\Video`, named `<video name> with Greenroom mix`, with the mix as the first audio track. The picture is copied, never re-encoded, so it is the same video frame for frame. Your original file is never changed or overwritten.
3. Optionally keeps the video's own sound as a second track.

The sound is stored as AAC 320 kbps for MP4/M4V, 24-bit PCM for MOV, and lossless FLAC (in an MKV) for other types.

## ffmpeg
Greenroom needs ffmpeg, a free video tool. It uses its own copy if present, or one already on this PC's PATH. Otherwise the Export screen offers **Download ffmpeg**: about 115 MB, fetched once from the public gyan.dev essentials 9.0.2 release on GitHub, and installed only if its size and SHA-256 (`60f46726…047ba`) match what was checked on 2026-10-26. It is stored in `Documents\Greenroom\engines\ffmpeg`. Greenroom does not redistribute ffmpeg; it is licensed under the LGPL/GPL.

## Checked
In the installed app, with a 191-frame 23.976 fps H.264 test film:
- Picture stream MD5 identical to the original; 191 frames; 24000/1001 fps.
- New audio track 7.966 s (the picture's length), 48 kHz AAC; ffmpeg's EBU R128 meter reads the same loudness as the WAV (-13.4 LUFS).
- The downloaded pinned build installs and reports `ffmpeg version 9.0.2`.
- A failed run leaves no half-written file.

## Limits
- The source's start timecode (for example 01:00:00:00) is not carried into the new file. The WAV mix keeps its time reference.
- Not played in Resolve, Premiere, QuickTime or on a phone; not judged by ear.
- MOV with PCM sound and MKV output were built and unit-tested for their command line only; the real run used MP4.
- Needs a working internet connection once, to get ffmpeg, unless it is already installed.
