"""Local OpenAI-compatible speech bridge for Chatterbox multilingual.

Run only with a Greenroom-managed environment and local, verified weights.
This development bridge exposes only a single built-in voice and plain speech.
"""
import argparse
import io
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

MAX_BODY = 32 * 1024
LANGUAGES = {"ar", "da", "de", "el", "en", "es", "fi", "fr", "he", "hi", "it", "ja", "ko", "ms", "nl", "no", "pl", "pt", "ru", "sv", "sw", "tr", "zh"}


def run(model_dir: Path, port: int, device: str) -> None:
    import torch
    import torchaudio
    from chatterbox.mtl_tts import ChatterboxMultilingualTTS

    if device == "cuda" and not torch.cuda.is_available():
        raise RuntimeError("CUDA is not available in this runtime")
    model = ChatterboxMultilingualTTS.from_local(model_dir, device=device, t3_model="v3")
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, format, *args):
            pass  # Never log scripts or request bodies.

        def respond(self, code: int, data: bytes, mime: str) -> None:
            self.send_response(code)
            self.send_header("Content-Type", mime)
            self.send_header("Content-Length", str(len(data)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(data)

        def error_json(self, code: int, message: str) -> None:
            self.respond(code, json.dumps({"error": message}).encode(), "application/json")

        def do_GET(self):
            if self.path == "/health":
                self.respond(200, b'{"ready":true}', "application/json")
            elif self.path == "/v1/audio/voices":
                self.respond(200, b'{"voices":["chatterbox-default"]}', "application/json")
            else:
                self.error_json(404, "Not found")

        def do_POST(self):
            if self.path != "/v1/audio/speech":
                return self.error_json(404, "Not found")
            if self.headers.get("Origin"):
                return self.error_json(403, "Browser origins are not accepted")
            try:
                size = int(self.headers.get("Content-Length", "0"))
                if size <= 0 or size > MAX_BODY:
                    return self.error_json(400, "Invalid request size")
                data = json.loads(self.rfile.read(size))
                text = data.get("input", "")
                voice = data.get("voice", "chatterbox-default")
                language = data.get("language", "en")
                if not isinstance(text, str) or not text.strip() or len(text) > 1000:
                    return self.error_json(400, "Speech text must contain 1–1000 characters")
                if voice != "chatterbox-default" or language not in LANGUAGES:
                    return self.error_json(400, "Unsupported voice or language")
                with lock, torch.inference_mode():
                    waveform = model.generate(text.strip(), language_id=language)
                    result = io.BytesIO()
                    torchaudio.save(result, waveform.cpu(), model.sr, format="wav")
                self.respond(200, result.getvalue(), "audio/wav")
            except Exception:
                self.error_json(500, "Local speech generation failed. Check the runtime log.")

    ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-dir", type=Path, required=True)
    parser.add_argument("--port", type=int, default=18880)
    parser.add_argument("--device", choices=("cpu", "cuda", "mps"), default="cpu")
    args = parser.parse_args()
    if not 1024 <= args.port <= 65535:
        parser.error("port must be between 1024 and 65535")
    run(args.model_dir, args.port, args.device)
