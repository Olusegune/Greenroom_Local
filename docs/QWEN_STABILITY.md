# Qwen3-TTS stability

Measured on the owner's PC (i5-10400F, 32 GB, RTX 3060 12 GB) on 2026-11-10. Real audio, six different lines per voice, two voices (warm narrator, gravel man). "Similarity" is the cosine similarity of Resemblyzer speaker vectors between two takes (runtime/speaker_embed.py). It measures whether voices are alike. It does not measure acting, quality or fit, and **nobody has listened to these takes**: every statement here is about the measurement, not about how it sounds.

## The problem

Qwen3-TTS VoiceDesign makes a new voice from a text description on every line, so one character drifts from line to line.

| Setup | Same voice, different lines (mean) | Min | Different voices (mean) |
|---|---|---|---|
| Piper (reference) | 0.83 | 0.70 | 0.48 |
| Kokoro (reference) | 0.87 | 0.81 | 0.49 |
| Qwen, free-running | 0.686 | 0.519 | 0.469 |
| Qwen, one fixed seed | 0.704 | 0.576 | 0.485 |
| **Qwen, locked to a reference clip** | **0.842** | **0.754** | 0.419 |

## What was tried

1. **A fixed seed** makes the same text come out the same. For different lines it barely helps (0.686 to 0.704). Not a fix. The seed is still sent so a retake of the same line is repeatable.
2. **A reference-clip lock** (the fix). The app has VoiceDesign make one short reference clip for the voice (the fixed sentence in `QWEN_REFERENCE_TEXT`), keeps it in the library folder, and then speaks every line with the Qwen3-TTS **Base** model cloning that clip. Similarity rises to the Piper/Kokoro range.
3. **Warm worker** (`runtime/qwen_server.py`, `qwen_warm.rs`): the models stay loaded between lines, exits after 15 minutes idle, is killed if it stalls for 25 minutes. On the processor a line fell from about 43 s (cold) to about 24 s (warm).
4. **Graphics card**: CUDA PyTorch (about 2.5 GB) installed into the Qwen runtime, installed in 92 s. `torch.cuda.is_available()` is true on the RTX 3060. Locked lines then took about 6 to 12 s each (first line 42 s because of model load).

## Limits, stated plainly

- The thresholds in `casting/consistency.ts` (0.75 consistent, below 0.65 likely different) were set from Piper and Kokoro and the numbers above. A locked Qwen voice has a minimum of 0.754, so it sits just above the line. Two voices only; this is not a large study.
- A locked voice copies the reference clip's timbre. It can still read some emotions differently from line to line. Whether it sounds right is for the owner's ears.
- A clone follows the reference clip, so a poor reference makes every line poor. The app lets the owner unlock a voice and lock it again for a new reference.
- Locking applies to the four built-in Qwen voices. Locking costs one Base model download (about 4 GB, 1058 s on this connection) and one short local generation.
- The speaker tool is a separate download of about 100 MB and runs offline.
- The real run is an ignored Rust test (`real_qwen_gpu_and_lock`), run only when asked: it downloads several GB.
