"""Private one-shot Chatterbox worker. JSON comes from stdin; WAV goes to stdout."""
import contextlib
import io
import json
import sys
from pathlib import Path

request = json.load(sys.stdin)
with contextlib.redirect_stdout(sys.stderr):
    import torch
    import torchaudio
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = ChatterboxMultilingualTTS.from_local(Path(request["model_dir"]), device=device, t3_model="v3")
    with torch.inference_mode():
        audio = model.generate(request["text"], language_id="en")
        result = io.BytesIO()
        torchaudio.save(result, audio.cpu(), model.sr, format="wav")
sys.stdout.buffer.write(result.getvalue())
