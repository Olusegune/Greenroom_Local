"""Private one-shot sound-effects worker (Stable Audio Open Small). JSON comes from stdin; a WAV file is written to "out".

Input: {"weights", "config", "t5_dir", "prompt", "seconds", "seed", "out"}. Everything is read from local files.
"""
import contextlib
import json
import os
import sys

request = json.load(sys.stdin)
os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

with contextlib.redirect_stdout(sys.stderr):
    import torch
    import wave
    from stable_audio_tools.inference.generation import generate_diffusion_cond
    from stable_audio_tools.models.factory import create_model_from_config
    from stable_audio_tools.models.utils import load_ckpt_state_dict

    with open(request["config"], "r", encoding="utf-8") as f:
        config = json.load(f)
    # Point the text encoder at the local copy so nothing is downloaded.
    for cond in config.get("model", {}).get("conditioning", {}).get("configs", []):
        if cond.get("id") == "prompt":
            # The library only accepts known model names; its model_path option says where the files really are.
            cond.setdefault("config", {})["model_path"] = request["t5_dir"]

    device = "cuda" if torch.cuda.is_available() else "cpu"
    model = create_model_from_config(config)
    model.load_state_dict(load_ckpt_state_dict(request["weights"]))
    model = model.to(device).eval().requires_grad_(False)

    sample_rate = config["sample_rate"]
    seconds = max(1, min(int(request["seconds"]), 11))
    conditioning = [{"prompt": str(request["prompt"]), "seconds_total": seconds}]
    with torch.inference_mode():
        audio = generate_diffusion_cond(
            model,
            conditioning=conditioning,
            sample_size=int(config["sample_size"]),
            steps=8,
            cfg_scale=1.0,
            sampler_type="pingpong",
            seed=int(request.get("seed", 0)),
            device=device,
        )
    clip = audio[0].to(torch.float32).cpu()[:, : seconds * sample_rate]
    peak = clip.abs().max().clamp(min=1e-6)
    clip = (clip / peak).clamp(-1, 1) * 0.89
    # Written with the standard library: torchaudio has no audio backend in this private engine.
    pcm = (clip.t().contiguous() * 32767.0).round().clamp(-32768, 32767).to(torch.int16).numpy().tobytes()
    with wave.open(request["out"], "wb") as w:
        w.setnchannels(clip.shape[0])
        w.setsampwidth(2)
        w.setframerate(int(sample_rate))
        w.writeframes(pcm)
