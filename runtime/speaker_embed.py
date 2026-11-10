"""Speaker embeddings for takes, so Greenroom can measure whether several takes sound like ONE speaker.
JSON on stdin: {"paths": ["a.wav", ...]}. JSON on stdout: {"embeddings": [[256 numbers], ...], "failed": [index, ...]}.
Uses Resemblyzer's pretrained speaker encoder (it ships inside the package). It measures similarity of voices; it says nothing about
whether a performance is good, and it is not a statement about anyone's identity, age, gender or ethnicity.
"""
import contextlib
import json
import sys

request = json.load(sys.stdin)
paths = [str(p) for p in request.get("paths", [])][:200]
out = {"embeddings": [], "failed": []}
with contextlib.redirect_stdout(sys.stderr):
    from resemblyzer import VoiceEncoder, preprocess_wav

    encoder = VoiceEncoder(device="cpu")
    for i, p in enumerate(paths):
        try:
            wav = preprocess_wav(p)
            if len(wav) < 16000 * 0.8:
                raise ValueError("too short")
            out["embeddings"].append([round(float(x), 6) for x in encoder.embed_utterance(wav)])
        except Exception as e:
            print("embed failed", i, repr(e), file=sys.stderr)
            out["embeddings"].append(None)
            out["failed"].append(i)
sys.stdout.write(json.dumps(out))
