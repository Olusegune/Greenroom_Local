# Local engine evaluation (2026-11-08)

What the official repositories and model cards say about the engines on the Cinematic Engine list. Each fact was read from the project's own GitHub page or its Hugging Face card on 2026-11-08 by a research pass; nothing was downloaded, nothing was run, **no weight was hashed**, and none of these was tested on 12 GB hardware. Where a page did not say, this document says "not stated". Greenroom's rules apply: no unverified URL or hash goes into Model Center, and a model is not "usable" because its files downloaded.

**Result: no engine was added to Model Center in this pass.** The table says why, and the order below is what to do first.

## Summary

| Engine | Licence (as stated) | Already in Greenroom? | Controls (as stated) | Verdict |
|---|---|---|---|---|
| Chatterbox Multilingual V3 | MIT; Perth watermark in every output | **Yes**: runtime, pinned files, speaks with the default voice | Cloning from a clip; "exaggeration" documented for the original model, not stated for Multilingual | Connect cloning and exaggeration; **project is retired** (below) |
| Chatterbox Turbo | MIT; Perth watermark | No | 350M, English; native tags `[cough]` `[laugh]` `[chuckle]`; cloning from a reference clip | Candidate: tags map to Greenroom's sounds. Retired project |
| Qwen3-TTS (VoiceDesign, CustomVoice, Base) | Apache-2.0 | **Runtime installs, no speech route** | VoiceDesign: natural-language `instruct`; CustomVoice: 9 named speakers plus `instruct`; Base: clone from `ref_audio` (3-second clone mentioned) | Best fit for written direction. Needs a speech route |
| VoxCPM2 | Apache-2.0, "free for commercial use"; strictly forbids impersonation, fraud, disinformation | No | 2B, 30 languages, 48 kHz, ~8 GB VRAM stated; voice design and style steering by a parenthesised description; cloning | Strong candidate for local direction and 48 kHz output |
| Kokoro-82M | Apache-2.0 | **Runtime installs, no speech route** | 82M, 24 kHz, preset voices; no cloning, no emotion control stated | Quick win: connect the route |
| Supertonic 3 | MIT code, OpenRAIL-M weights | No | 99M ONNX, 31 languages, 44.1 kHz, inline tags like `<laugh>`; **no cloning** in the open repo | **Archived by its owner (no updates)**. Avoid |
| Pocket TTS | Code MIT; **card says CC-BY-4.0 and is gated** | No | 100M, CPU, cloning from a wav; prohibits cloning without consent; no emotion control | Possible; licence needs resolving |
| VibeVoice | MIT, but "research and development purposes only"; TTS code removed by Microsoft | No | Realtime-0.5B: English, single speaker | **Not suitable** |
| KittenTTS 2 | Code Apache-2.0; **weights under the Stellon Labs Community License** | No | 1.7B 1-bit, 24 kHz, cloning from 5-30 s, emotion tags in beta | Commercial limits; see below |

## Details and risks

### Chatterbox (Turbo, Multilingual, original)
- Sources: https://github.com/resemble-ai/chatterbox and the ResembleAI cards on Hugging Face.
- The README says: "As of August 2026, Chatterbox is retired research and is no longer maintained," kept public as an archive under MIT with no support or updates. **Greenroom already ships Chatterbox**, so this is a risk to record: bugs will not be fixed upstream.
- Turbo: 350M, English, `from chatterbox.tts_turbo import ChatterboxTurboTTS`; one-step decoder; paralinguistic tags are "native". Hugging Face lists about 4.04 GB across `t3_turbo_v1.safetensors` (1.92 GB), `s3gen.safetensors` and `s3gen_meanflow.safetensors` (1.06 GB each) and small files. No hash is shown on the page.
- Multilingual V3: 500M, 23 languages, `t3_model="v3"`. Greenroom's existing install already pins the V3 file set.
- Every output carries Resemble's Perth watermark; the README says it survives MP3 compression. Disclose it in the production report if Chatterbox is used.
- Install: `pip install chatterbox-tts` (no version stated), tested on Python 3.11. VRAM and torch/CUDA requirements: not stated.
- The Turbo language list contradicts itself on the card (English in the table, 23 in a section); treat it as English.

### Qwen3-TTS
- Sources: https://github.com/QwenLM/Qwen3-TTS and the three 1.7B cards (VoiceDesign, CustomVoice, Base); 0.6B CustomVoice and Base also exist (no 0.6B VoiceDesign).
- Languages: Chinese, English, Japanese, Korean, German, French, Russian, Portuguese, Spanish, Italian.
- Direction by words is the native mechanism (`instruct`), which makes it the most natural fit for Greenroom's written direction and the Director panel. Greenroom's catalogue already lists it and installs `qwen-tts==0.1.1`, but **no speech route exists**: it cannot speak in Perform.
- Python 3.12 environment recommended; FlashAttention 2 recommended and "can only be used" with fp16 or bf16 (building it can need lots of RAM). VRAM, sample rate and file sizes: not stated.

### VoxCPM2
- Sources: https://github.com/OpenBMB/VoxCPM and https://huggingface.co/openbmb/VoxCPM2 (the model exists; the org page did not list it but the repo page loads).
- 2B parameters, 30 languages, 48 kHz output, about 8 GB VRAM. `pip install voxcpm`; Python 3.10 to 3.12, PyTorch 2.5+, CUDA 12+. File names and sizes: not stated.
- Style is steered by a parenthesised description at the start of the text, which Greenroom's compiler can produce.
- The card's snippet writes a 16 kHz file while the README uses the model's own sample rate: the two disagree, so confirm on a real run.

### Others
- **Supertonic**: archived on 2026-09-09 ("no updates, bug fixes, security patches, or support"). Do not build on it.
- **Pocket TTS**: gated on Hugging Face; the card's licence (CC-BY-4.0) differs from the code's (MIT); per-voice licences are on a separate page that was not read. Language lists differ between the GitHub page and the card.
- **VibeVoice**: Microsoft removed the TTS code after misuse; the model is marked research-only. Not suitable for a production tool.
- **KittenTTS 2**: the weights licence allows research, non-commercial and limited commercial use free of charge, ends the commercial grant above USD 1,000,000 in revenue or funding, requires registering for commercial use, requires "Powered by KittenML" attribution when distributing, and forbids using it to train or distill another model. A studio would need to read it in full.

## What should happen next (in this order)

1. **Kokoro speech route.** Its runtime already installs; Apache-2.0; plain speech only, so it improves the free local option without new downloads logic.
2. **Qwen3-TTS route**, VoiceDesign first, so a character voice can be designed from a description with no cloud (the page `DESIGN_FOR_CHARACTER.md` already notes this gap). Must be tested on the owner's 12 GB card before it is shown as Ready.
3. **VoxCPM2** as the high-quality local engine with direction, after confirming VRAM and the sample-rate discrepancy on a real run.
4. **Chatterbox Turbo** only if its tags prove worth it, remembering the upstream project is retired.

Each step needs: a pinned revision and a SHA-256 taken from the downloaded file by Greenroom (never copied from a page), an offline health check with a known-answer run, an isolated runtime (the existing managed-Python pattern), load and unload, and a real audio test before the Model Center status changes from "Installed" to "Ready". `modelStatus.ts` already refuses to call any model Ready unless it appears in its `CONNECTED` list.
