# Chatterbox development bridge

`runtime/chatterbox_server.py` is an experimental local bridge for the official Chatterbox multilingual V3 implementation. It is not yet a one-click installer, a managed background service, or a release feature.

It expects an existing Python environment with the official Chatterbox dependencies, PyTorch and torchaudio, plus a model directory containing the verified official V3 weights and associated files. The bridge binds only to IPv4 loopback, rejects browser-origin POST requests, accepts only short text, serializes inference and does not log request bodies. The endpoint has no authentication, so run it only for local development in a trusted environment and stop it after testing. It does not expose voice cloning or the structured acting engine.

The existing Greenroom local-server connector can request the built-in voice `chatterbox-default` at `http://127.0.0.1:18880`. Its current request format does not carry a language, so the bridge defaults to English. Non-English selection, clone consent, model lifecycle, secure process authentication, installation, resource management and progress remain to be implemented and tested before shipping.

Official source: https://github.com/resemble-ai/chatterbox. Official weights: https://huggingface.co/ResembleAI/chatterbox. Review the licences of all dependencies before redistribution.
