# Local AI architecture

## Product rule

The owner installs models from inside Greenroom Local. They never need to install Python, Git, CUDA packages or use a terminal. Project text, recordings, voice embeddings and generated audio stay on the computer unless the owner explicitly selects a cloud engine.

## Managed layout

Greenroom stores replaceable AI components outside the application bundle:

```text
Greenroom Local data/
  runtime/<runtime-version>/
  models/<model-id>/<model-version>/
  voices/<voice-id>/
  cache/downloads/
  manifests/
  logs/
```

Projects do not live inside these folders. Updating or removing a model can never delete a project or its rendered takes.

## Installation transaction

1. Detect operating system, CPU, RAM, GPU, VRAM and free disk space.
2. Select a compatible signed manifest for Windows x64 or macOS arm64.
3. Show source, exact version, licence, download size, installed size and capabilities.
4. Download to a `.part` file with pause, resume and cancellation.
5. Verify size and SHA-256 before opening an archive.
6. Extract into a new staging directory with traversal protection.
7. Run an offline health check and a short known-answer inference.
8. Atomically rename staging to the versioned install directory.
9. Record the active version. Keep the last working version for rollback.

A failed or interrupted installation never replaces a working component.

## Runtime boundary

The desktop UI never imports ML frameworks. A managed sidecar owns inference and exposes a versioned loopback API on an unpredictable per-launch port. A random session secret is required on every request. The server binds only to `127.0.0.1` and rejects browser origins.

The runtime provides:

- model load, unload and health endpoints
- cancellable background jobs and progress events
- streaming PCM for previews
- deterministic seeds when supported
- GPU/Metal/CPU selection and out-of-memory recovery
- a single performance-plan request independent of model syntax
- immutable output plus model, voice and direction provenance

## Model adapters

Every speech adapter declares capabilities rather than relying on its name:

- languages and verified accents
- cloning and voice-design support
- word-level or line-level direction
- emotional controls and transitions
- supported paralinguistic events
- streaming, batching and deterministic generation
- minimum/recommended memory
- model and weight licences

The performance compiler maps Greenroom's model-independent acting plan into an adapter request. Unsupported controls are disclosed before rendering. A vocal-event compositor may blend consented voice-matched expressions only when the selected speech model cannot perform them naturally.

## Accent verification

Language coverage never implies accent authenticity. Each model/voice/accent combination carries one of: native-reviewed, community-reviewed, model-supported awaiting review, experimental, or reference-dependent. Only listening evidence can promote a combination.

Yoruba, Igbo, Hausa, Nigerian Pidgin, Nigerian English, British varieties, Filipino/Tagalog and Korean are first-wave evaluation suites.

## Security

- manifests are signed independently from HTTPS
- every artifact has an exact SHA-256 and byte length
- archive extraction rejects absolute paths, parent traversal, links and devices
- model processes receive only the files needed for a job
- cloned voices require a consent record
- logs exclude scripts, keys, recordings and voice embeddings
- uninstall moves a component to a recoverable trash area before later cleanup

## Delivery order

1. Hardware profiler and application-owned manifest schema — implemented foundation
2. Resumable verified downloader with progress and atomic activation — implemented foundation
3. Managed runtime bootstrap and health checks
4. Chatterbox adapter and lightweight CPU adapter
5. Local Acting Director through llama.cpp
6. Qwen3-TTS voice-design adapter
7. Nigerian specialist evaluation packs
8. Whisper alignment and clone-sample checks
