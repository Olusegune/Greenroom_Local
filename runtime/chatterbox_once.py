"""Private one-shot Chatterbox worker. JSON comes from stdin; WAV goes to stdout.

Input: {"text", "model_dir", "language", "prompt" (optional reference voice), "t3_model" ("v2" for WazobiaVoice, "v3" default)}.
Everything the libraries print goes to stderr, so stdout carries only the WAV and a failure can be explained.
"""
import contextlib
import inspect
import io
import json
import sys
from pathlib import Path

request = json.load(sys.stdin)
with contextlib.redirect_stdout(sys.stderr):
    import torch
    import torchaudio
    import chatterbox.mtl_tts as mtl
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    t3_model = request.get("t3_model", "v3")
    if t3_model == "v2":
        # WazobiaVoice adds Yoruba, Hausa and Igbo to the model's vocabulary, but chatterbox-tts 0.1.7 refuses any language
        # outside its own 23 before it looks at the model. Allow the three the model was trained on.
        mtl.SUPPORTED_LANGUAGES.update({"yo": "Yoruba", "ha": "Hausa", "ig": "Igbo"})
    if "t3_model" in inspect.signature(ChatterboxMultilingualTTS.from_local).parameters:
        model = ChatterboxMultilingualTTS.from_local(Path(request["model_dir"]), device=device, t3_model=t3_model)
    else:
        # The released chatterbox-tts (0.1.7) always loads "t3_mtl23ls_v2.safetensors" and has no t3_model option, which made every
        # line fail. Load the file the model folder really has (v2 for WazobiaVoice, v3 for Chatterbox V3) instead.
        wanted = f"t3_mtl23ls_{t3_model}.safetensors"
        original = mtl.load_safetensors

        def load_safetensors(path, *args, **kwargs):
            if Path(path).name == "t3_mtl23ls_v2.safetensors":
                path = Path(path).with_name(wanted)
            return original(path, *args, **kwargs)

        mtl.load_safetensors = load_safetensors
        model = ChatterboxMultilingualTTS.from_local(Path(request["model_dir"]), device=device)
    options = {"language_id": request.get("language", "en")}
    if request.get("prompt"):
        options["audio_prompt_path"] = request["prompt"]  # reference voice for cloned or built-in voices
    with torch.inference_mode():
        audio = model.generate(request["text"], **options)
        result = io.BytesIO()
        torchaudio.save(result, audio.cpu(), model.sr, format="wav")
sys.stdout.buffer.write(result.getvalue())
