//! VoiceKiller (https://voicekiller.com/api-docs, as read for Soundstage on 2026-10-23). All endpoints are POST and
//! authenticated by the `api-key` and `userid` headers:
//!   `/api/generate-speech/voicelist`  no body, plain text, one voice name per line
//!   `/api/generate-speech`            JSON `{script (max 6000), voice_name, instructions (max 2000, optional)}`, returns MP3
//!   `/api/generate-speech/clone`      JSON `{script, voice_name}` for a voice already cloned on their website
//! There are no inline sound tags. Delivery and pace go in `instructions`, which is a request, not a guarantee.
//! One attempt per call: characters are billed, so a blind retry could pay twice.

use crate::net::{agent, http_error, read_all, MAX_AUDIO};
use serde::Serialize;
use serde_json::{json, Value};

pub const BASE: &str = "https://voicekiller.com";
const MAX_SCRIPT: usize = 6000;
const MAX_INSTRUCTIONS: usize = 2000;

pub struct Client {
    base: String,
    key: String,
    user: String,
    agent: ureq::Agent,
}

#[derive(Serialize, Debug, PartialEq)]
pub struct VkVoice {
    pub name: String,
    pub language: String,
}

/// `Authoritative Advisor 1 (en-GB)` is British English; a name with no locale is taken as English.
pub fn language_of(name: &str) -> String {
    let Some(open) = name.rfind('(') else { return "en".into() };
    let inner = name[open + 1..].trim_end_matches(')');
    let mut it = inner.split('-');
    let (lang, region) = (it.next().unwrap_or(""), it.next().unwrap_or(""));
    let ok = (2..=3).contains(&lang.len()) && lang.bytes().all(|b| b.is_ascii_lowercase()) && region.len() <= 4 && region.bytes().all(|b| b.is_ascii_alphanumeric());
    if ok && inner.len() <= 8 { inner.to_string() } else { "en".into() }
}

fn valid_name(n: &str) -> bool {
    let t = n.trim();
    !t.is_empty() && t.chars().count() <= 80 && !t.chars().any(|c| c.is_control())
}

impl Client {
    pub fn new(base: &str, key: &str, user: &str) -> Self {
        Client { base: base.trim_end_matches('/').to_string(), key: key.into(), user: user.into(), agent: agent() }
    }

    fn post(&self, path: &str, body: Option<&Value>) -> Result<ureq::Response, String> {
        let req = self.agent.post(&format!("{}{path}", self.base)).set("api-key", &self.key).set("userid", &self.user);
        let res = match body {
            Some(b) => req.set("content-type", "application/json").send_string(&b.to_string()),
            None => req.call(),
        };
        match res {
            Ok(r) => Ok(r),
            Err(ureq::Error::Status(c, r)) => Err(http_error("VoiceKiller", c, r)),
            Err(ureq::Error::Transport(_)) => Err("Could not reach VoiceKiller. Check your internet connection.".into()),
        }
    }

    pub fn voices(&self) -> Result<Vec<VkVoice>, String> {
        let bytes = read_all(self.post("/api/generate-speech/voicelist", None)?, 2 << 20)?;
        let mut seen = std::collections::BTreeSet::new();
        let out: Vec<VkVoice> = String::from_utf8_lossy(&bytes)
            .lines()
            .map(str::trim)
            .filter(|n| valid_name(n) && seen.insert(n.to_string()))
            .take(4000)
            .map(|n| VkVoice { name: n.to_string(), language: language_of(n) })
            .collect();
        if out.is_empty() {
            return Err("VoiceKiller returned an empty voice list. Check the key and user id in Settings.".into());
        }
        Ok(out)
    }

    /// `clone` selects the endpoint for voices cloned on their website; it documents only script and voice_name.
    pub fn speak(&self, script: &str, voice: &str, instructions: Option<&str>, clone: bool) -> Result<Vec<u8>, String> {
        let script = script.trim();
        if script.is_empty() || script.chars().count() > MAX_SCRIPT {
            return Err("That line is empty or too long for VoiceKiller (6000 characters).".into());
        }
        if !valid_name(voice) {
            return Err("Pick a VoiceKiller voice first.".into());
        }
        let mut body = json!({ "script": script, "voice_name": voice.trim() });
        let path = if clone {
            "/api/generate-speech/clone"
        } else {
            if let Some(i) = instructions.map(str::trim).filter(|i| !i.is_empty()) {
                body["instructions"] = json!(i.chars().take(MAX_INSTRUCTIONS).collect::<String>());
            }
            "/api/generate-speech"
        };
        let bytes = read_all(self.post(path, Some(&body))?, MAX_AUDIO)?;
        if bytes.len() < 200 || bytes.starts_with(b"{") || bytes.starts_with(b"<") {
            return Err("VoiceKiller did not return audio.".into());
        }
        Ok(bytes)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eleven::fake::*;

    fn mp3() -> Vec<u8> {
        let mut v = b"ID3".to_vec();
        v.extend(vec![2u8; 400]);
        v
    }

    #[test]
    fn lists_voices_with_languages_and_drops_repeats_and_blanks() {
        let f = start(Box::new(|_| (200, b"Bella\nAuthoritative Advisor 1 (en-GB)\nBella\n\nLucia (es-MX)\n".to_vec())));
        let v = Client::new(&f.base, "VKKEY", "user-42").voices().unwrap();
        assert_eq!(v.iter().map(|x| (x.name.as_str(), x.language.as_str())).collect::<Vec<_>>(), [("Bella", "en"), ("Authoritative Advisor 1 (en-GB)", "en-GB"), ("Lucia (es-MX)", "es-MX")]);
        let h = f.hits.lock().unwrap()[0].clone();
        assert_eq!(h.path, "/api/generate-speech/voicelist");
        assert!(h.headers.contains("api-key: vkkey") && h.headers.contains("userid: user-42"));
    }

    #[test]
    fn style_goes_in_instructions_and_the_clone_endpoint_gets_only_two_fields() {
        let f = start(Box::new(|_| (200, mp3())));
        let c = Client::new(&f.base, "K", "U");
        c.speak("Hello there", "Bella", Some("Speak in a tone that is excited and energetic."), false).unwrap();
        c.speak("Hello there", "My Clone", Some("ignored"), true).unwrap();
        let hits = f.hits.lock().unwrap();
        let a: Value = serde_json::from_slice(&hits[0].body).unwrap();
        assert_eq!(hits[0].path, "/api/generate-speech");
        assert_eq!(a["voice_name"], "Bella");
        assert!(a["instructions"].as_str().unwrap().contains("excited"));
        let b: Value = serde_json::from_slice(&hits[1].body).unwrap();
        assert_eq!(hits[1].path, "/api/generate-speech/clone");
        assert_eq!(b.as_object().unwrap().len(), 2);
    }

    #[test]
    fn empty_long_and_non_audio_answers_are_errors() {
        let f = start(Box::new(|_| (200, br#"{"error":"nope"}"#.to_vec())));
        let c = Client::new(&f.base, "K", "U");
        assert!(c.speak("hi", "Bella", None, false).unwrap_err().contains("did not return audio"));
        assert!(c.speak("   ", "Bella", None, false).is_err());
        assert!(c.speak(&"x".repeat(6001), "Bella", None, false).is_err());
        assert!(c.speak("hi", "bad\nname", None, false).is_err());
        let f2 = start(Box::new(|_| (401, b"{}".to_vec())));
        assert!(Client::new(&f2.base, "K", "U").voices().unwrap_err().contains("did not accept the key"));
    }
}
