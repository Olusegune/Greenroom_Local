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
    def trim_tail(wav, sr):
        """Cuts the silence after the last speech. The WazobiaVoice weights never signal the end of a line, so the model keeps going until
        its length limit and a 3-second sentence came back as 40 seconds. Speech is the last 50 ms frame louder than 2% of the peak (and
        above a small floor); 0.3 s is kept after it, with a short fade so the cut makes no click. Audio with no speech is returned as is."""
        mono = wav.abs().max(dim=0).values if wav.dim() > 1 else wav.abs()
        peak = float(mono.max()) if mono.numel() else 0.0
        if peak <= 0.0:
            return wav
        frame = max(1, int(sr * 0.05))
        limit = max(0.004, 0.02 * peak)
        last = -1
        for i in range(0, mono.numel() - frame + 1, frame):
            if float(mono[i:i + frame].max()) > limit:
                last = i + frame
        if last < 0:
            return wav
        end = min(wav.shape[-1], last + int(sr * 0.3))
        out = wav[..., :end].clone()
        fade = min(int(sr * 0.05), end)
        if fade > 1:
            out[..., end - fade:] *= torch.linspace(1.0, 0.0, fade)
        return out

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
    if t3_model == "v2":
        # The WazobiaVoice weights do not reliably emit the end-of-speech token, so generation ran to the library's limit of 1000 speech
        # tokens (40 s, about 75 s of waiting) for every line. Speech takes well under 2.5 speech tokens per character even read slowly,
        # so 4 tokens per character plus a margin is a ceiling no real line reaches, and a line that does not stop is cut there.
        _infer = model.t3.inference
        _cap = min(1000, max(100, 4 * len(request["text"]) + 50))

        def _capped(*args, **kwargs):
            kwargs["max_new_tokens"] = _cap
            return _infer(*args, **kwargs)

        model.t3.inference = _capped
    options = {"language_id": request.get("language", "en")}
    if request.get("prompt"):
        options["audio_prompt_path"] = request["prompt"]  # reference voice for cloned or built-in voices
    with torch.inference_mode():
        audio = model.generate(request["text"], **options)
        result = io.BytesIO()
        torchaudio.save(result, trim_tail(audio.cpu(), model.sr), model.sr, format="wav")
sys.stdout.buffer.write(result.getvalue())
