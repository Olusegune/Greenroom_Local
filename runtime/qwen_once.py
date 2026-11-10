"""Private one-shot Qwen3-TTS worker (VoiceDesign). JSON comes from stdin; a WAV (mono, 16-bit) goes to stdout.

Input: {"text", "instruct", "language", "model"}. "instruct" is a written description of the voice (VoiceDesign has no fixed
voices), "model" is the Hugging Face id of the VoiceDesign checkpoint.

The first run downloads the model weights from Hugging Face into HF_HOME (Greenroom runs it once during setup with a short
line), so later runs need no internet. Everything the libraries print goes to stderr: stdout carries only the WAV.
Runs on the processor: float32 on CPU, so no GPU or flash-attn is needed.
"""
import contextlib
import io
import json
import os
import sys
import time
import wave

request = json.load(sys.stdin)
text = str(request.get("text") or "").strip()
if not text:
    sys.exit(2)
instruct = str(request.get("instruct") or "")
language = str(request.get("language") or "English")
model_id = str(request.get("model") or "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign")

with contextlib.redirect_stdout(sys.stderr):
    import numpy as np
    import torch
    from qwen_tts import Qwen3TTSModel

    # The weights are several GB. A dropped connection must not lose the download: huggingface_hub resumes a partly
    # downloaded file, so keep asking until it is complete (or give up after many tries and say so on stderr).
    def downloaded():
        # already on this PC: no internet needed (and none is used)
        from huggingface_hub import snapshot_download

        try:
            return snapshot_download(model_id, local_files_only=True)
        except Exception:
            return None

    local_dir = None if os.path.isdir(model_id) else downloaded()
    if not os.path.isdir(model_id) and not local_dir:
        import subprocess

        # hf_xet is Hugging Face's faster, more reliable downloader. Without it the plain download stalled on a real PC.
        # Best effort: if it cannot be installed the plain download still works.
        try:
            import hf_xet  # noqa: F401
        except ImportError:
            subprocess.run([sys.executable, "-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--only-binary=:all:", "hf_xet"], stdout=sys.stderr, stderr=sys.stderr, check=False)

        def cache_bytes():
            total = 0
            for base, _dirs, files in os.walk(os.environ.get("HF_HOME") or os.path.expanduser("~/.cache/huggingface")):
                for name in files:
                    try:
                        total += os.path.getsize(os.path.join(base, name))
                    except OSError:
                        pass
            return total

        # The download runs in a child process that is killed and restarted if nothing arrives for 90 seconds (a stalled
        # connection never errors by itself). Hugging Face resumes where the file stopped, so a restart loses nothing.
        fetch = "import sys; from huggingface_hub import snapshot_download as d; d(sys.argv[1])"
        for attempt in range(1, 41):
            child = subprocess.Popen([sys.executable, "-c", fetch, model_id], stdout=sys.stderr, stderr=sys.stderr)
            last, quiet_since = cache_bytes(), time.time()
            while child.poll() is None:
                time.sleep(5)
                now_bytes = cache_bytes()
                if now_bytes != last:
                    last, quiet_since = now_bytes, time.time()
                elif time.time() - quiet_since > 90:
                    print(f"download stalled at {last // 1048576} MB; restarting (attempt {attempt})", file=sys.stderr, flush=True)
                    child.kill()
                    child.wait()
                    break
            if child.returncode == 0:
                break
            if attempt == 40:
                raise RuntimeError("the model download did not finish; check your internet connection and try again")
            time.sleep(3)

    torch.manual_seed(1234)
    # Load from the folder on this PC, so running needs no internet at all (the libraries otherwise ask the hub for details).
    local_dir = local_dir or downloaded()
    model = Qwen3TTSModel.from_pretrained(local_dir or model_id, device_map="cpu", dtype=torch.float32)
    with torch.inference_mode():
        waves, rate = model.generate_voice_design(text=text, instruct=instruct, language=language)
    if not waves:
        sys.exit(3)
    audio = np.asarray(waves[0], dtype=np.float32).reshape(-1)
    if audio.size == 0:
        sys.exit(3)
    samples = (np.clip(audio, -1.0, 1.0) * 32767.0).round().astype("<i2")
    result = io.BytesIO()
    with wave.open(result, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(int(rate))
        w.writeframes(samples.tobytes())
sys.stdout.buffer.write(result.getvalue())
