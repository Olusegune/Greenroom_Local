# OpenAI and Gemini as AI Director providers (version 0.10.0)

The AI Director (suggested directions, plans, scene directions, "write this direction") and "Read the characters with AI" can run on Kie (as before), **OpenAI**, **Google Gemini** or the local Director. Choose in **Engines > AI Director**, and add the key in **Settings** (keys live only in the Windows Credential Manager). They are used for text only, never for voices. Every request goes through the cost sheet first, names the provider and model, and is billed by that provider to the owner's own account; Greenroom cannot see the price.

## What was read from the providers' own documentation (2026-11-08) and relied on

| Provider | Request | Source |
|---|---|---|
| OpenAI | `POST https://api.openai.com/v1/responses`, header `Authorization: Bearer <key>`, body `model`, `instructions`, `input`; the reply text is every `output_text` part of every `message` item in `output` | developers.openai.com/api/docs/guides/text |
| OpenAI models | `gpt-6-astra` (flagship), `gpt-6.1-sol` (balanced), `gpt-6.1-terra` (fast, the default), `gpt-6-luna` (cheapest) | developers.openai.com/api/docs/models |
| Gemini | `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent`, header `x-goog-api-key`; reply text is the `text` parts of `candidates[0].content`; a refused prompt is `promptFeedback.blockReason` | aistudio.google.com/api-reference/generate-content |
| Gemini models | `gemini-4-argon` (flagship), `gemini-3.8-flash`, `gemini-3.6-flash` (Stable, the default), `gemini-3.5-flash-lite`, `gemini-3.1-flash-lite` | aistudio.google.com/docs/models |

## What could NOT be confirmed, and what was done about it

- The OpenAI reference page for the request body refused access, so only `model`, `instructions` and `input` are sent. No output-token limit and no temperature are sent (not confirmed; the newest Gemini models ignore temperature anyway).
- For Gemini the docs now lead with a newer "Interactions" API. The older `generateContent` endpoint is listed in the reference and is used, but its request field names were only partly confirmed, so the request is the minimal stable shape (`contents[0].parts[0].text`) with the system text joined into the prompt. If Google or OpenAI change a field, the call will fail with an error message (not silently), and the fix is in `src-tauri/src/llm.rs`.
- The exact error bodies for a bad key or a rate limit were not confirmed. Errors are mapped from the HTTP status (401/403, 402, 404, 429), and the provider's own wording is not repeated for a rejected key (it can echo part of the key).
- **No live call has been made to either provider.** Everything is tested against a fake local server that checks the address, the header, the body and the way the reply is read. The first real use will be the real test; model names can also change (the list is shown in Engines and a default is used when none is chosen).

## Safety

Fixed provider addresses only; the model name is checked (letters, digits, dot, dash, underscore; never a path) on the Rust side whatever the screen sent; the key goes in a header and never in an address or a log; the request size is capped; a model's reply is treated as data.
