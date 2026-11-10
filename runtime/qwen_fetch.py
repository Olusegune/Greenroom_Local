"""Downloads one Qwen3-TTS model into the Hugging Face folder (HF_HOME), surviving stalls. argv[1] is the model id.
The download runs in a child process that is killed and restarted if nothing arrives for 90 seconds (a stalled connection never errors by
itself); Hugging Face resumes where a file stopped, so a restart loses nothing. Exit code 0 means the model is complete on this PC.
"""
import os
import subprocess
import sys
import time

model_id = sys.argv[1]
if not model_id.startswith("Qwen/Qwen3-TTS-"):
    print("refusing to download an unexpected model", file=sys.stderr)
    sys.exit(2)

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


fetch = "import sys; from huggingface_hub import snapshot_download as d; print(d(sys.argv[1]))"
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
        sys.exit(0)
    time.sleep(3)
print("the model download did not finish", file=sys.stderr)
sys.exit(1)
