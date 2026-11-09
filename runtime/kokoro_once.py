"""Private one-shot Kokoro worker. JSON comes from stdin; a WAV (24 kHz, mono, 16-bit) goes to stdout.

The first run downloads the model weights and the small language data Kokoro needs from Hugging Face, so Greenroom
runs it once during setup with a short line (see kokoro_prefetch in lib.rs). Later runs are offline.

The WAV is written with Python's own wave module: the managed runtime has no torchaudio file backend (found in a real run).
"""
import contextlib
import io
import json
import sys
import wave

request = json.load(sys.stdin)
voice = request.get("voice") or "af_heart"
with contextlib.redirect_stdout(sys.stderr):
    import torch
    from kokoro import KPipeline

    # The first letter of a Kokoro voice name is its language code (a = American English, b = British English).
    pipeline = KPipeline(lang_code=voice[0])
    pieces = []
    for _graphemes, _phonemes, audio in pipeline(request["text"], voice=voice, speed=float(request.get("speed", 1.0))):
        if audio is not None:
            pieces.append(torch.as_tensor(audio).float().reshape(-1))
    if not pieces:
        sys.exit(2)
    samples = (torch.cat(pieces).clamp(-1.0, 1.0) * 32767.0).round().to(torch.int16).cpu()
    result = io.BytesIO()
    with wave.open(result, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(24000)
        w.writeframes(samples.numpy().tobytes())
sys.stdout.buffer.write(result.getvalue())
