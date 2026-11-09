//! Text models from OpenAI and Google Gemini, for the AI Director and for reading a script.
//
// What is relied on, and where it was read (both on 2026-11-08):
// - OpenAI: `POST https://api.openai.com/v1/responses` with `Authorization: Bearer <key>` and a body of `model`,
//   `instructions` and `input`; the reply text is every `output_text` part of every `message` item in `output`
//   (developers.openai.com/api/docs/guides/text; model ids from developers.openai.com/api/docs/models).
// - Gemini: `POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent` with the key in the
//   `x-goog-api-key` header; the reply text is every `text` part of `candidates[0].content`, and a refused prompt is
//   `promptFeedback.blockReason` (aistudio.google.com/api-reference/generate-content; ids from /docs/models).
// Output-token and temperature settings are not sent: the docs read did not confirm them for these models and the newest
// Gemini models ignore temperature. The system text is joined into the prompt for Gemini, because the field name for a
// separate system instruction was not confirmed in those docs. Model ids are checked and never trusted as a path.

use crate::net::{agent, read_json, short};
use serde_json::{json, Value};

pub const OPENAI_BASE: &str = "https://api.openai.com";
pub const GEMINI_BASE: &str = "https://generativelanguage.googleapis.com";

/// OpenAI model ids listed on developers.openai.com/api/docs/models on 2026-11-08: flagship, balanced, fast, cheapest.
pub const OPENAI_MODELS: [&str; 4] = ["gpt-6-astra", "gpt-6.1-sol", "gpt-6.1-terra", "gpt-6-luna"];
pub const OPENAI_DEFAULT: &str = "gpt-6.1-terra";
/// Gemini model ids listed on aistudio.google.com/docs/models on 2026-11-08 (the page marks 3.6 and the lite ones Stable).
pub const GEMINI_MODELS: [&str; 5] = ["gemini-4-argon", "gemini-3.8-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
pub const GEMINI_DEFAULT: &str = "gemini-3.6-flash";

/// A model id from the list or one the owner typed: letters, digits, dots, dashes and underscores, short, never a path.
pub fn valid_model(m: &str) -> bool {
    !m.is_empty() && m.len() <= 64 && m.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.' || b == b'_') && !m.starts_with(['-', '.'])
}

pub struct Client {
    base: String,
    key: String,
    agent: ureq::Agent,
}

fn api_error(who: &str, code: u16, r: ureq::Response) -> String {
    let body = r.into_string().unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body).ok().and_then(|v| v["error"]["message"].as_str().map(short)).unwrap_or_default();
    match code {
        // the provider's own text can echo part of a key, so it is not repeated for these
        401 | 403 => format!("{who} did not accept the key, or the key cannot use this model. Check it in Settings."),
        402 => format!("{who} says the account is out of credit."),
        404 => format!("{who} could not find that model. Pick another in Engines."),
        429 => format!("{who} is busy or you are over a limit. Wait a minute, or check your plan."),
        c if detail.is_empty() => format!("{who} returned an error ({c})."),
        c => format!("{who} returned an error ({c}). {detail}"),
    }
}

impl Client {
    pub fn new(base: &str, key: &str) -> Self {
        Client { base: base.trim_end_matches('/').to_string(), key: key.to_string(), agent: agent() }
    }

    fn post(&self, who: &str, path: &str, header: (&str, String), body: &Value) -> Result<Value, String> {
        match self.agent.post(&format!("{}{path}", self.base)).set(header.0, &header.1).set("content-type", "application/json").send_string(&body.to_string()) {
            Ok(r) => read_json(r, 8 << 20),
            Err(ureq::Error::Status(c, r)) => Err(api_error(who, c, r)),
            Err(ureq::Error::Transport(_)) => Err(format!("Could not reach {who}. Check your internet connection.")),
        }
    }

    /// One question to an OpenAI model. Returns the reply text.
    pub fn openai(&self, model: &str, system: &str, user: &str) -> Result<String, String> {
        if !valid_model(model) {
            return Err("That OpenAI model name is not valid.".into());
        }
        let v = self.post("OpenAI", "/v1/responses", ("Authorization", format!("Bearer {}", self.key)), &json!({ "model": model, "instructions": system, "input": user }))?;
        if v["status"] == "failed" {
            return Err(format!("OpenAI could not finish this request. {}", v["error"]["message"].as_str().map(short).unwrap_or_default()).trim().to_string());
        }
        let mut text = String::new();
        let mut refused = false;
        for item in v["output"].as_array().into_iter().flatten() {
            if item["type"] != "message" {
                continue;
            }
            for part in item["content"].as_array().into_iter().flatten() {
                match part["type"].as_str() {
                    Some("output_text") => text.push_str(part["text"].as_str().unwrap_or("")),
                    Some("refusal") => refused = true,
                    _ => {}
                }
            }
        }
        if text.trim().is_empty() {
            return Err(if refused { "OpenAI declined this request.".into() } else { "OpenAI sent back no text. Try again.".into() });
        }
        Ok(text)
    }

    /// One question to a Gemini model. Returns the reply text.
    pub fn gemini(&self, model: &str, system: &str, user: &str) -> Result<String, String> {
        if !valid_model(model) {
            return Err("That Gemini model name is not valid.".into());
        }
        let prompt = format!("{system}\n\n---\n\n{user}");
        let body = json!({ "contents": [{ "role": "user", "parts": [{ "text": prompt }] }] });
        let v = self.post("Gemini", &format!("/v1beta/models/{model}:generateContent"), ("x-goog-api-key", self.key.clone()), &body)?;
        if let Some(reason) = v["promptFeedback"]["blockReason"].as_str() {
            return Err(format!("Gemini declined to read this text ({}).", short(reason)));
        }
        let first = &v["candidates"][0];
        let text: String = first["content"]["parts"].as_array().into_iter().flatten().filter_map(|p| p["text"].as_str()).collect();
        if text.trim().is_empty() {
            return Err(match first["finishReason"].as_str() {
                Some(r) if r != "STOP" => format!("Gemini sent back no text ({}). Try again, or try a different model.", short(r)),
                _ => "Gemini sent back no text. Try again.".into(),
            });
        }
        Ok(text)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eleven::fake::*;

    #[test]
    fn model_names_are_checked_and_cannot_be_paths() {
        for ok in ["gpt-6.1-terra", "gemini-3.6-flash", "gpt-6_x", "A1"] {
            assert!(valid_model(ok), "{ok}");
        }
        for bad in ["", "../x", "a/b", "a:b", "a b", "-x", ".x", "a?b", "a%2fb", &"x".repeat(65), "gemini\u{0}"] {
            assert!(!valid_model(bad), "{bad:?}");
        }
        assert!(OPENAI_MODELS.iter().chain(GEMINI_MODELS.iter()).all(|m| valid_model(m)));
        assert!(OPENAI_MODELS.contains(&OPENAI_DEFAULT) && GEMINI_MODELS.contains(&GEMINI_DEFAULT));
    }

    #[test]
    fn openai_sends_the_documented_request_and_joins_the_text_parts() {
        let f = start(Box::new(|_| (200, json!({"status":"completed","output":[{"type":"reasoning","summary":[]},{"type":"message","role":"assistant","content":[{"type":"output_text","text":"Hello, "},{"type":"output_text","text":"Ada."}]}]}).to_string().into_bytes())));
        let out = Client::new(&f.base, "sk-TESTKEY").openai("gpt-6.1-terra", "be brief", "hi").unwrap();
        assert_eq!(out, "Hello, Ada.");
        let h = &f.hits.lock().unwrap()[0];
        assert_eq!((h.method.as_str(), h.path.as_str()), ("POST", "/v1/responses"));
        assert!(h.headers.contains("authorization: bearer sk-testkey"));
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        assert_eq!((b["model"].as_str(), b["instructions"].as_str(), b["input"].as_str()), (Some("gpt-6.1-terra"), Some("be brief"), Some("hi")));
        assert!(b.get("temperature").is_none() && b.get("max_output_tokens").is_none());
    }

    #[test]
    fn openai_problems_are_plain_and_never_repeat_the_key() {
        let f = start(Box::new(|_| (401, json!({"error":{"message":"Incorrect API key provided: sk-TEST...KEY"}}).to_string().into_bytes())));
        let e = Client::new(&f.base, "sk-TESTKEY").openai("gpt-6.1-terra", "s", "u").unwrap_err();
        assert!(e.contains("did not accept the key") && !e.to_lowercase().contains("sk-"), "{e}");
        let f = start(Box::new(|_| (429, b"{}".to_vec())));
        assert!(Client::new(&f.base, "k").openai("gpt-6.1-terra", "s", "u").unwrap_err().contains("busy"));
        let f = start(Box::new(|_| (200, json!({"output":[{"type":"message","content":[{"type":"refusal","refusal":"no"}]}]}).to_string().into_bytes())));
        assert!(Client::new(&f.base, "k").openai("gpt-6.1-terra", "s", "u").unwrap_err().contains("declined"));
        let f = start(Box::new(|_| (200, json!({"status":"completed","output":[]}).to_string().into_bytes())));
        assert!(Client::new(&f.base, "k").openai("gpt-6.1-terra", "s", "u").unwrap_err().contains("no text"));
        let f = start(Box::new(|_| (200, b"<html>not json</html>".to_vec())));
        assert!(Client::new(&f.base, "k").openai("gpt-6.1-terra", "s", "u").is_err());
        assert!(Client::new("http://127.0.0.1:9", "k").openai("../x", "s", "u").unwrap_err().contains("not valid"));
    }

    #[test]
    fn gemini_puts_the_model_in_the_path_the_key_in_a_header_and_reads_the_parts() {
        let f = start(Box::new(|_| (200, json!({"candidates":[{"content":{"role":"model","parts":[{"text":"Hi "},{"text":"there"}]},"finishReason":"STOP"}]}).to_string().into_bytes())));
        let out = Client::new(&f.base, "AIzaTESTKEY").gemini("gemini-3.6-flash", "be brief", "hello").unwrap();
        assert_eq!(out, "Hi there");
        let h = &f.hits.lock().unwrap()[0];
        assert_eq!((h.method.as_str(), h.path.as_str()), ("POST", "/v1beta/models/gemini-3.6-flash:generateContent"));
        assert!(h.headers.contains("x-goog-api-key: aizatestkey"));
        assert!(!h.path.to_lowercase().contains("key="), "the key must not be in the address");
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        let t = b["contents"][0]["parts"][0]["text"].as_str().unwrap();
        assert!(t.contains("be brief") && t.contains("hello"));
        assert_eq!(b["contents"][0]["role"], "user");
    }

    #[test]
    fn gemini_refusals_and_errors_are_plain() {
        let f = start(Box::new(|_| (200, json!({"promptFeedback":{"blockReason":"SAFETY"}}).to_string().into_bytes())));
        assert!(Client::new(&f.base, "k").gemini("gemini-3.6-flash", "s", "u").unwrap_err().contains("declined to read"));
        let f = start(Box::new(|_| (200, json!({"candidates":[{"finishReason":"MAX_TOKENS"}]}).to_string().into_bytes())));
        assert!(Client::new(&f.base, "k").gemini("gemini-3.6-flash", "s", "u").unwrap_err().contains("MAX_TOKENS"));
        let f = start(Box::new(|_| (400, json!({"error":{"code":400,"message":"API key not valid. Please pass a valid API key.","status":"INVALID_ARGUMENT"}}).to_string().into_bytes())));
        let e = Client::new(&f.base, "k").gemini("gemini-3.6-flash", "s", "u").unwrap_err();
        assert!(e.contains("Gemini returned an error (400)"), "{e}");
        let f = start(Box::new(|_| (403, b"{}".to_vec())));
        assert!(Client::new(&f.base, "k").gemini("gemini-3.6-flash", "s", "u").unwrap_err().contains("did not accept the key"));
        let f = start(Box::new(|_| (429, b"{}".to_vec())));
        assert!(Client::new(&f.base, "k").gemini("gemini-3.6-flash", "s", "u").unwrap_err().contains("busy"));
        assert!(Client::new("http://127.0.0.1:9", "k").gemini("a/b", "s", "u").unwrap_err().contains("not valid"));
        assert!(Client::new("http://127.0.0.1:9", "k").gemini("gemini-3.6-flash", "s", "u").unwrap_err().contains("Could not reach"));
    }
}
