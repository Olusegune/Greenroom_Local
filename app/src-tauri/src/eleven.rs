//! ElevenLabs: speech, sound effects, the voice library, voice design and cloning.
//! Facts come from the public docs (checked 2026-10-26): speech `POST /v1/text-to-speech/{voice}`, sound effects
//! `POST /v1/sound-generation`, shared library `GET /v1/shared-voices`, add shared `POST /v1/voices/add/{owner}/{voice}`,
//! design `POST /v1/text-to-voice/design` then `POST /v1/text-to-voice`, clone `POST /v1/voices/add` (multipart).

use crate::net::{agent, http_error, read_all, read_json, short, MAX_AUDIO};
use serde::Serialize;
use serde_json::{json, Value};

pub const BASE: &str = "https://api.elevenlabs.io";
pub const MODEL_V4: &str = "eleven_v4";
pub const MODEL_V3: &str = "eleven_v3";
/// Output formats Greenroom will request. 192 kbps MP3 needs the Creator plan and 44.1 kHz WAV the Pro plan
/// (ElevenLabs docs, 2026-10-26); the plan for 48 kHz WAV is not stated.
pub const FORMATS: [&str; 4] = ["mp3_44100_128", "mp3_44100_192", "wav_44100", "wav_48000"];
pub const STANDARD_FORMAT: &str = "mp3_44100_128";

pub fn format_or_standard(f: Option<&str>) -> &'static str {
    FORMATS.iter().copied().find(|x| Some(*x) == f).unwrap_or(STANDARD_FORMAT)
}

fn quality_hint(msg: String, format: &str) -> String {
    if format == STANDARD_FORMAT {
        msg
    } else {
        format!("{msg} The audio quality is set to {format}, which your ElevenLabs plan may not include. You can change it on the Engines page.")
    }
}

pub struct Client {
    base: String,
    key: String,
    agent: ureq::Agent,
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoiceInfo {
    pub id: String,
    pub name: String,
    pub owner: Option<String>,
    pub accent: String,
    pub language: String,
    pub gender: String,
    pub description: String,
    pub category: String,
    pub preview_url: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DesignPreview {
    pub generated_voice_id: String,
    pub audio_b64: String,
    pub seconds: f64,
}

pub fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 64 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn finish(res: Result<ureq::Response, ureq::Error>) -> Result<ureq::Response, String> {
    match res {
        Ok(r) => Ok(r),
        Err(ureq::Error::Status(c, r)) => Err(http_error("ElevenLabs", c, r)),
        Err(ureq::Error::Transport(_)) => Err("Could not reach ElevenLabs. Check your internet connection.".into()),
    }
}

fn s(v: &Value) -> String {
    short(v.as_str().unwrap_or(""))
}

impl Client {
    pub fn new(base: &str, key: &str) -> Self {
        Client { base: base.trim_end_matches('/').to_string(), key: key.to_string(), agent: agent() }
    }

    fn get(&self, path: &str) -> Result<Value, String> {
        read_json(finish(self.agent.get(&format!("{}{path}", self.base)).set("xi-api-key", &self.key).call())?, 8 << 20)
    }

    fn post(&self, path: &str, body: &Value) -> Result<ureq::Response, String> {
        finish(self.agent.post(&format!("{}{path}", self.base)).set("xi-api-key", &self.key).set("content-type", "application/json").send_string(&body.to_string()))
    }

    pub fn speech(&self, voice: &str, model: &str, text: &str, speed: Option<f64>, format: &str) -> Result<Vec<u8>, String> {
        let format = format_or_standard(Some(format));
        if !valid_id(voice) {
            return Err("Pick a voice first.".into());
        }
        let mut body = json!({ "text": text, "model_id": model });
        if let Some(sp) = speed.filter(|x| (x - 1.0).abs() > 0.001) {
            body["voice_settings"] = json!({ "speed": sp.clamp(0.7, 1.2) });
        }
        read_all(self.post(&format!("/v1/text-to-speech/{voice}?output_format={format}"), &body).map_err(|m| quality_hint(m, format))?, MAX_AUDIO)
    }

    pub fn sound(&self, text: &str, seconds: f64, format: &str) -> Result<Vec<u8>, String> {
        let format = format_or_standard(Some(format));
        read_all(self.post(&format!("/v1/sound-generation?output_format={format}"), &json!({ "text": text, "duration_seconds": seconds.clamp(0.5, 22.0) })).map_err(|m| quality_hint(m, format))?, MAX_AUDIO)
    }

    pub fn my_voices(&self) -> Result<Vec<VoiceInfo>, String> {
        let v = self.get("/v2/voices?page_size=100")?;
        Ok(v["voices"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|x| {
                let id = x["voice_id"].as_str().filter(|i| valid_id(i))?.to_string();
                let l = &x["labels"];
                let language = if l["language"].is_string() { s(&l["language"]) } else { s(&x["verified_languages"][0]["language"]) };
                Some(VoiceInfo {
                    id,
                    name: s(&x["name"]),
                    owner: None,
                    accent: s(&l["accent"]),
                    language,
                    gender: s(&l["gender"]),
                    description: if x["description"].is_string() { s(&x["description"]) } else { s(&l["descriptive"]) },
                    category: s(&x["category"]),
                    preview_url: x["preview_url"].as_str().map(str::to_string),
                })
            })
            .collect())
    }

    pub fn shared_voices(&self, search: &str, language: &str, accent: &str, gender: &str, page: u32) -> Result<(Vec<VoiceInfo>, bool), String> {
        let mut q = format!("/v1/shared-voices?page_size=30&page={}", page.min(200));
        for (k, val) in [("search", search), ("language", language), ("accent", accent), ("gender", gender)] {
            if !val.trim().is_empty() {
                q.push_str(&format!("&{k}={}", enc(val.trim())));
            }
        }
        let v = self.get(&q)?;
        let list = v["voices"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|x| {
                let id = x["voice_id"].as_str().filter(|i| valid_id(i))?.to_string();
                Some(VoiceInfo {
                    id,
                    name: s(&x["name"]),
                    owner: x["public_owner_id"].as_str().filter(|o| valid_id(o)).map(str::to_string),
                    accent: s(&x["accent"]),
                    language: s(&x["language"]),
                    gender: s(&x["gender"]),
                    description: [s(&x["descriptive"]), s(&x["use_case"])].into_iter().filter(|p| !p.is_empty()).collect::<Vec<_>>().join(", "),
                    category: s(&x["category"]),
                    preview_url: x["preview_url"].as_str().map(str::to_string),
                })
            })
            .collect();
        Ok((list, v["has_more"].as_bool().unwrap_or(false)))
    }

    pub fn add_shared(&self, owner: &str, voice: &str, name: &str) -> Result<String, String> {
        if !valid_id(owner) || !valid_id(voice) || clean_name(name).is_none() {
            return Err("That voice or name is not valid.".into());
        }
        let v = read_json(self.post(&format!("/v1/voices/add/{owner}/{voice}"), &json!({ "new_name": clean_name(name) })).map_err(plan_hint)?, 1 << 20)?;
        v["voice_id"].as_str().filter(|i| valid_id(i)).map(str::to_string).ok_or_else(|| "ElevenLabs did not confirm the voice.".into())
    }

    pub fn design(&self, description: &str, sample: Option<&str>) -> Result<Vec<DesignPreview>, String> {
        let d = description.split_whitespace().collect::<Vec<_>>().join(" ");
        if !(20..=1000).contains(&d.chars().count()) {
            return Err("Describe the voice in 20 to 1000 characters.".into());
        }
        let mut body = json!({ "voice_description": d, "model_id": "eleven_multilingual_ttv_v2" });
        match sample.map(str::trim).filter(|t| !t.is_empty()) {
            Some(t) if (100..=1000).contains(&t.chars().count()) => body["text"] = json!(t),
            Some(_) => return Err("A sample line must be 100 to 1000 characters, or leave it empty.".into()),
            None => body["auto_generate_text"] = json!(true),
        }
        let v = read_json(self.post("/v1/text-to-voice/design?output_format=mp3_44100_128", &body)?, 48 << 20)?;
        let out: Vec<DesignPreview> = v["previews"]
            .as_array()
            .into_iter()
            .flatten()
            .take(5)
            .filter_map(|p| {
                Some(DesignPreview {
                    generated_voice_id: p["generated_voice_id"].as_str().filter(|i| valid_id(i))?.to_string(),
                    audio_b64: p["audio_base_64"].as_str().filter(|a| !a.is_empty() && a.len() < 16 << 20)?.to_string(),
                    seconds: p["duration_secs"].as_f64().unwrap_or(0.0),
                })
            })
            .collect();
        if out.is_empty() {
            return Err("ElevenLabs returned no previews. Try rewording the description.".into());
        }
        Ok(out)
    }

    pub fn save_design(&self, generated: &str, name: &str, description: &str) -> Result<String, String> {
        let d = description.split_whitespace().collect::<Vec<_>>().join(" ");
        if !valid_id(generated) || clean_name(name).is_none() || !(20..=1000).contains(&d.chars().count()) {
            return Err("The name or description is not valid.".into());
        }
        let v = read_json(self.post("/v1/text-to-voice", &json!({ "voice_name": clean_name(name), "voice_description": d, "generated_voice_id": generated })).map_err(plan_hint)?, 1 << 20)?;
        v["voice_id"].as_str().filter(|i| valid_id(i)).map(str::to_string).ok_or_else(|| "ElevenLabs did not confirm the voice.".into())
    }

    /// One attempt only: retrying after a timeout could create the voice twice.
    pub fn clone_voice(&self, name: &str, filename: &str, mime: &str, audio: &[u8]) -> Result<String, String> {
        let Some(name) = clean_name(name) else { return Err("The voice name is not valid.".into()) };
        if audio.len() < 1000 || audio.len() > 30 << 20 {
            return Err("The recording is too short or too large (up to 30 MB).".into());
        }
        let boundary = format!("----greenroom{:x}", audio.len() ^ 0x5bd1e995);
        let mut body: Vec<u8> = Vec::new();
        for (k, val) in [("name", name.as_str()), ("description", "Created in Greenroom"), ("remove_background_noise", "false")] {
            body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{val}\r\n").as_bytes());
        }
        let fname: String = filename.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_')).take(80).collect();
        let mime: String = mime.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '/' | '-' | '.' | '+')).take(60).collect();
        body.extend(format!("--{boundary}\r\nContent-Disposition: form-data; name=\"files\"; filename=\"{fname}\"\r\nContent-Type: {mime}\r\n\r\n").as_bytes());
        body.extend(audio);
        body.extend(format!("\r\n--{boundary}--\r\n").as_bytes());
        let r = finish(self.agent.post(&format!("{}/v1/voices/add", self.base)).set("xi-api-key", &self.key).set("content-type", &format!("multipart/form-data; boundary={boundary}")).send_bytes(&body)).map_err(plan_hint)?;
        let v = read_json(r, 1 << 20)?;
        v["voice_id"].as_str().filter(|i| valid_id(i)).map(str::to_string).ok_or_else(|| "ElevenLabs did not confirm the voice.".into())
    }

    pub fn delete_voice(&self, id: &str) -> Result<(), String> {
        if !valid_id(id) {
            return Err("That voice id is not valid.".into());
        }
        finish(self.agent.delete(&format!("{}/v1/voices/{id}", self.base)).set("xi-api-key", &self.key).call()).map(|_| ())
    }
}

/// ElevenLabs refuses saving, adding or cloning voices on plans that do not include them, and each plan caps custom
/// voices. Their reply is terse, so say plainly what it means and what still works.
pub fn plan_hint(msg: String) -> String {
    let m = msg.to_lowercase();
    let limited = ["upgrade", "subscription", "plan", "tier", "quota", "limit", "payment", "not accept the key", "can_not", "not_allowed"].iter().any(|k| m.contains(k));
    if !limited {
        return msg;
    }
    format!("Your ElevenLabs plan does not allow this. Saving, adding or cloning voices usually needs a paid plan, and each plan caps how many custom voices you can keep. You can upgrade at elevenlabs.io, or use a premade voice, a VoiceKiller or Kie voice, or an offline Piper voice instead. ElevenLabs said: {}", msg.chars().take(200).collect::<String>())
}

pub fn clean_name(n: &str) -> Option<String> {
    let n: String = n.split_whitespace().collect::<Vec<_>>().join(" ");
    (!n.is_empty() && n.chars().count() <= 60 && !n.chars().any(|c| c.is_control())).then_some(n)
}

fn enc(s: &str) -> String {
    s.bytes().map(|b| if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.') { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

#[cfg(test)]
pub mod fake {
    //! A tiny local HTTP server so the real client code runs end to end without spending anything.
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    #[derive(Clone, Debug)]
    pub struct Hit {
        pub method: String,
        pub path: String,
        pub headers: String,
        pub body: Vec<u8>,
    }

    pub type Handler = Box<dyn Fn(&Hit) -> (u16, Vec<u8>) + Send + Sync>;

    pub struct Server {
        pub base: String,
        pub hits: Arc<Mutex<Vec<Hit>>>,
    }

    pub fn start(h: Handler) -> Server {
        let l = TcpListener::bind("127.0.0.1:0").unwrap();
        let base = format!("http://{}", l.local_addr().unwrap());
        let hits = Arc::new(Mutex::new(Vec::new()));
        let hits2 = hits.clone();
        std::thread::spawn(move || {
            for stream in l.incoming() {
                let Ok(mut st) = stream else { continue };
                let mut buf = Vec::new();
                let mut chunk = [0u8; 8192];
                let (head_end, len) = loop {
                    let n = st.read(&mut chunk).unwrap_or(0);
                    if n == 0 {
                        break (0, 0);
                    }
                    buf.extend_from_slice(&chunk[..n]);
                    if let Some(p) = buf.windows(4).position(|w| w == b"\r\n\r\n") {
                        let head = String::from_utf8_lossy(&buf[..p]).to_lowercase();
                        let len = head.lines().find_map(|l| l.strip_prefix("content-length:")).and_then(|v| v.trim().parse::<usize>().ok()).unwrap_or(0);
                        break (p + 4, len);
                    }
                };
                while buf.len() < head_end + len {
                    let n = st.read(&mut chunk).unwrap_or(0);
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&chunk[..n]);
                }
                let head = String::from_utf8_lossy(&buf[..head_end.saturating_sub(4)]).to_string();
                let mut first = head.lines().next().unwrap_or("").split(' ');
                let hit = Hit { method: first.next().unwrap_or("").into(), path: first.next().unwrap_or("").into(), headers: head.to_lowercase(), body: buf[head_end.min(buf.len())..].to_vec() };
                let (code, out) = h(&hit);
                hits2.lock().unwrap().push(hit);
                let _ = write!(st, "HTTP/1.1 {code} X\r\ncontent-length: {}\r\nconnection: close\r\n\r\n", out.len());
                let _ = st.write_all(&out);
            }
        });
        Server { base, hits }
    }
}

#[cfg(test)]
mod tests {
    use super::fake::*;
    use super::*;

    fn audio() -> Vec<u8> {
        let mut v = b"ID3".to_vec();
        v.extend(vec![1u8; 400]);
        v
    }

    #[test]
    fn speech_uses_the_requested_model_key_and_speed() {
        let f = start(Box::new(|_| (200, audio())));
        let c = Client::new(&f.base, "KEY123");
        let out = c.speech("Voice1", MODEL_V4, "[laughs] hi", Some(0.9), STANDARD_FORMAT).unwrap();
        assert_eq!(out.len(), 403);
        let h = f.hits.lock().unwrap()[0].clone();
        assert!(h.path.starts_with("/v1/text-to-speech/Voice1?"));
        assert!(h.headers.contains("xi-api-key: key123"));
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        assert_eq!(b["model_id"], "eleven_v4");
        assert_eq!(b["text"], "[laughs] hi");
        assert_eq!(b["voice_settings"]["speed"], 0.9);
    }

    #[test]
    fn audio_quality_is_an_allow_list_and_failures_explain_the_plan() {
        assert_eq!(format_or_standard(Some("wav_48000")), "wav_48000");
        assert_eq!(format_or_standard(Some("pcm_44100;rm -rf")), STANDARD_FORMAT);
        assert_eq!(format_or_standard(None), STANDARD_FORMAT);
        let f = start(Box::new(|h| if h.path.contains("wav_48000") { (402, br#"{"detail":{"message":"needs a higher tier"}}"#.to_vec()) } else { (200, vec![b'I', b'D', b'3', 1, 2, 3]) }));
        let c = Client::new(&f.base, "K");
        let e = c.speech("V1", MODEL_V4, "x", None, "wav_48000").unwrap_err();
        assert!(e.contains("may not include") && e.contains("Engines page"));
        assert!(c.speech("V1", MODEL_V4, "x", None, "../bad").is_ok());
        let hits = f.hits.lock().unwrap().clone();
        assert!(hits[0].path.contains("output_format=wav_48000"));
        assert!(hits[1].path.contains("output_format=mp3_44100_128"));
        assert!(c.sound("rain", 3.0, "mp3_44100_192").is_ok());
        assert!(f.hits.lock().unwrap().last().unwrap().path.contains("output_format=mp3_44100_192"));
    }

    #[test]
    fn normal_speed_sends_no_voice_settings_and_bad_voice_ids_never_leave() {
        let f = start(Box::new(|_| (200, audio())));
        let c = Client::new(&f.base, "K");
        c.speech("V1", MODEL_V3, "x", Some(1.0), STANDARD_FORMAT).unwrap();
        let b: Value = serde_json::from_slice(&f.hits.lock().unwrap()[0].body).unwrap();
        assert!(b.get("voice_settings").is_none());
        assert!(c.speech("../etc", MODEL_V3, "x", None, STANDARD_FORMAT).is_err());
        assert_eq!(f.hits.lock().unwrap().len(), 1);
    }

    #[test]
    fn maps_http_errors_to_plain_messages() {
        let f = start(Box::new(|h| if h.path.contains("A401") { (401, br#"{"detail":{"message":"bad key"}}"#.to_vec()) } else { (402, b"{}".to_vec()) }));
        let c = Client::new(&f.base, "K");
        let e = c.speech("A401", MODEL_V4, "x", None, STANDARD_FORMAT).unwrap_err();
        assert!(e.contains("did not accept the key") && e.contains("bad key"));
        assert!(c.speech("B", MODEL_V4, "x", None, STANDARD_FORMAT).unwrap_err().contains("out of credit"));
    }

    #[test]
    fn lists_my_voices_and_the_shared_library() {
        let f = start(Box::new(|h| {
            if h.path.starts_with("/v2/voices") {
                (200, json!({"voices":[{"voice_id":"abc","name":"Ada","category":"cloned","labels":{"accent":"nigerian","gender":"female","language":"en"},"preview_url":"https://x.example.com/a.mp3"},{"voice_id":"bad id!","name":"x"}]}).to_string().into_bytes())
            } else {
                (200, json!({"has_more":true,"voices":[{"voice_id":"v9","public_owner_id":"own1","name":"Tunde","accent":"nigerian","language":"en","gender":"male","descriptive":"calm","use_case":"narration","category":"professional","preview_url":null}]}).to_string().into_bytes())
            }
        }));
        let c = Client::new(&f.base, "K");
        let mine = c.my_voices().unwrap();
        assert_eq!(mine.len(), 1);
        assert_eq!((mine[0].name.as_str(), mine[0].accent.as_str(), mine[0].language.as_str()), ("Ada", "nigerian", "en"));
        let (shared, more) = c.shared_voices("deep voice", "en", "nigerian", "", 2).unwrap();
        assert!(more);
        assert_eq!(shared[0].owner.as_deref(), Some("own1"));
        assert_eq!(shared[0].description, "calm, narration");
        let path = f.hits.lock().unwrap()[1].path.clone();
        assert!(path.contains("search=deep%20voice") && path.contains("language=en") && path.contains("accent=nigerian") && path.contains("page=2") && !path.contains("gender"));
    }

    #[test]
    fn design_then_save_creates_a_voice() {
        let f = start(Box::new(|h| {
            if h.path.starts_with("/v1/text-to-voice/design") {
                (200, json!({"previews":[{"generated_voice_id":"gen1","audio_base_64":"SUQz","duration_secs":3.2}]}).to_string().into_bytes())
            } else {
                (200, json!({"voice_id":"newvoice"}).to_string().into_bytes())
            }
        }));
        let c = Client::new(&f.base, "K");
        let desc = "An older Nigerian man, warm and gravelly, calm and slow";
        let p = c.design(desc, None).unwrap();
        assert_eq!(p[0].generated_voice_id, "gen1");
        let b: Value = serde_json::from_slice(&f.hits.lock().unwrap()[0].body).unwrap();
        assert_eq!(b["auto_generate_text"], true);
        assert_eq!(c.save_design("gen1", "Elder  Chidi", desc).unwrap(), "newvoice");
        let b2: Value = serde_json::from_slice(&f.hits.lock().unwrap()[1].body).unwrap();
        assert_eq!(b2["voice_name"], "Elder Chidi");
        assert!(c.design("too short", None).is_err());
        assert!(c.design(desc, Some("short sample")).is_err());
    }

    #[test]
    fn cloning_sends_the_file_once_as_multipart() {
        let f = start(Box::new(|_| (200, br#"{"voice_id":"clone1"}"#.to_vec())));
        let c = Client::new(&f.base, "K");
        let id = c.clone_voice("Mum", "my voice.wav", "audio/wav", &vec![7u8; 2000]).unwrap();
        assert_eq!(id, "clone1");
        let hits = f.hits.lock().unwrap();
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "/v1/voices/add");
        assert!(hits[0].headers.contains("multipart/form-data; boundary="));
        let text = String::from_utf8_lossy(&hits[0].body);
        assert!(text.contains("name=\"name\"\r\n\r\nMum") && text.contains("filename=\"myvoice.wav\""));
        drop(hits);
        assert!(c.clone_voice("Mum", "a.wav", "audio/wav", &[0u8; 10]).is_err());
        assert!(c.clone_voice("   ", "a.wav", "audio/wav", &vec![0u8; 2000]).is_err());
    }

    #[test]
    fn plan_limits_are_explained_in_plain_words() {
        let f = start(Box::new(|_| (402, br#"{"detail":{"status":"payment_required","message":"Please upgrade your subscription to use this."}}"#.to_vec())));
        let c = Client::new(&f.base, "K");
        let e = c.save_design("gen1", "Elder", "An older Nigerian man, warm and gravelly, calm and slow").unwrap_err();
        assert!(e.contains("plan does not allow this") && e.contains("Piper") && e.contains("upgrade your subscription"));
        let e2 = c.add_shared("own1", "v9", "Tunde").unwrap_err();
        assert!(e2.contains("plan does not allow this"));
        // an unrelated failure is passed through untouched
        let g = start(Box::new(|_| (500, b"{}".to_vec())));
        assert!(!Client::new(&g.base, "K").add_shared("own1", "v9", "T").unwrap_err().contains("plan does not allow"));
    }

    #[test]
    fn adds_a_shared_voice_by_owner_and_voice_id() {
        let f = start(Box::new(|_| (200, br#"{"voice_id":"mine1"}"#.to_vec())));
        let c = Client::new(&f.base, "K");
        assert_eq!(c.add_shared("own1", "v9", "Tunde").unwrap(), "mine1");
        let h = f.hits.lock().unwrap()[0].clone();
        assert_eq!(h.path, "/v1/voices/add/own1/v9");
        assert!(c.add_shared("own/1", "v9", "x").is_err());
    }
}
