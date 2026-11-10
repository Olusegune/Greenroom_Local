"""Warm Qwen3-TTS worker. It keeps its models loaded between lines, so only the first line pays the load.

Protocol (stdin/stdout, one request at a time):
  request : one JSON line. "op" is one of
              "design"    {"text", "instruct", "language", "model", "seed"}            speak with VoiceDesign (a new voice from a description each time)
              "reference" {"text", "instruct", "language", "model", "seed"}            make a reference clip with VoiceDesign (same as design; the app stores it)
              "clone"     {"text", "language", "base_model", "ref_path", "ref_text"}   speak with the Base model, copying the reference clip's voice
  response: one header line  "OK <bytes> <device> <seconds>\\n" followed by that many WAV bytes (mono, 16-bit), or "ERR <message>\\n"
Everything the libraries print goes to stderr; stdout carries only responses. The process exits when stdin closes (the app quit or
stopped it) and after 15 minutes without a request, so it never keeps several GB of memory for nothing.

The models run on the graphics card (bfloat16) when PyTorch can see one, otherwise on the processor (float32). Models come from the
local Hugging Face folder only: nothing is downloaded here.

`design` with a seed makes the same text in the same voice come out the same; it does not make different lines sound like one person.
`clone` does: it copies one reference clip's voice for every line (see docs/QWEN_STABILITY.md).
"""
import io
import json
import os
import sys
import threading
import time
import wave

IDLE_SECONDS = 900
OUT = sys.stdout.buffer
sys.stdout = sys.stderr  # nothing a library prints may reach the protocol

state = {"last": time.time(), "busy": False}


def watchdog():
    while True:
        time.sleep(30)
        if not state["busy"] and time.time() - state["last"] > IDLE_SECONDS:
            os._exit(0)


threading.Thread(target=watchdog, daemon=True).start()


def reply(ok, payload=b"", info=""):
    if ok:
        OUT.write(f"OK {len(payload)} {info}\n".encode("utf8"))
        OUT.write(payload)
    else:
        OUT.write(("ERR " + str(payload).replace("\n", " ")[:400] + "\n").encode("utf8"))
    OUT.flush()


models = {}
prompts = {}
device = "cpu"


def load(model_id):
    global device
    if model_id in models:
        return models[model_id]
    import torch
    from huggingface_hub import snapshot_download
    from qwen_tts import Qwen3TTSModel

    path = model_id if os.path.isdir(model_id) else snapshot_download(model_id, local_files_only=True)
    if torch.cuda.is_available():
        device = "cuda:0"
        m = Qwen3TTSModel.from_pretrained(path, device_map=device, dtype=torch.bfloat16)
    else:
        device = "cpu"
        m = Qwen3TTSModel.from_pretrained(path, device_map="cpu", dtype=torch.float32)
    models[model_id] = m
    return m


def to_wav(waves, rate):
    import numpy as np

    if waves is None or len(waves) == 0:
        raise RuntimeError("the model returned no audio")
    audio = np.asarray(waves[0], dtype=np.float32).reshape(-1)
    if audio.size == 0:
        raise RuntimeError("the model returned empty audio")
    pcm = (np.clip(audio, -1.0, 1.0) * 32767.0).round().astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(rate))
        w.writeframes(pcm.tobytes())
    return buf.getvalue()


def seed_all(req):
    import torch

    seed = int(req.get("seed") or 0)
    if seed:
        torch.manual_seed(seed)
        if torch.cuda.is_available():
            torch.cuda.manual_seed_all(seed)


def serve(req):
    import torch

    op = str(req.get("op") or "design")
    t0 = time.time()
    language = str(req.get("language") or "English")
    if op in ("design", "reference"):
        model = load(str(req.get("model") or "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign"))
        seed_all(req)
        with torch.inference_mode():
            waves, rate = model.generate_voice_design(text=str(req["text"]), instruct=str(req["instruct"]), language=language)
    elif op == "clone":
        model = load(str(req.get("base_model") or "Qwen/Qwen3-TTS-12Hz-1.7B-Base"))
        ref_path, ref_text = str(req["ref_path"]), str(req["ref_text"])
        if not os.path.isfile(ref_path):
            raise RuntimeError("the reference clip is missing")
        key = (ref_path, os.path.getmtime(ref_path))
        if key not in prompts:
            with torch.inference_mode():
                prompts[key] = model.create_voice_clone_prompt(ref_audio=ref_path, ref_text=ref_text)
        seed_all(req)
        with torch.inference_mode():
            waves, rate = model.generate_voice_clone(text=str(req["text"]), language=language, voice_clone_prompt=prompts[key])
    else:
        raise RuntimeError("unknown operation")
    return to_wav(waves, rate), f"{device} {time.time() - t0:.1f}"


for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    state["busy"] = True
    try:
        wav, info = serve(json.loads(line))
        reply(True, wav, info)
    except Exception as e:  # report and keep serving: one bad line must not lose the loaded models
        print("qwen_server error:", repr(e), file=sys.stderr, flush=True)
        reply(False, repr(e))
    finally:
        state["busy"] = False
        state["last"] = time.time()
