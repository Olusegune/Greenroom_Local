//! Inworld AI text-to-speech and voices (docs read 2026-11-08, https://docs.inworld.ai/).
//!   auth        `Authorization: Basic <credential>`; the credential is the Base64 value the Portal shows, used as is
//!   speech      `POST /tts/v1/voice` (text up to 2000 UTF-16 units, one JSON answer) and
//!               `POST /tts/v1/voice:stream` (up to 4000, newline-delimited JSON, each line `{"result":{"audioContent":<base64>}}`)
//!   voices      `GET /voices/v1/voices` with `filter`, `pageSize`, `pageToken`
//!   cloning     `POST /voices/v1/voices:clone` with `displayName`, `languageCode`, `voiceSamples[{audioData,transcription}]`
//! Steering (`[say it softly]`) works on `inworld-tts-2` only. `inworld-tts-2-flash` ignores instructions but still
//! plays non-verbal tags such as `[laugh]`. Prices are not published in the API docs, so none are built in.
//! Paid calls make one attempt, except a 429 (rate limit), which is refused before anything is generated.

use crate::net::{agent, read_all, short, MAX_AUDIO};
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::time::Duration;

pub const BASE: &str = "https://api.inworld.ai";
pub const MODELS: [&str; 2] = ["inworld-tts-2", "inworld-tts-2-flash"];
pub const DELIVERY: [&str; 3] = ["STABLE", "BALANCED", "CREATIVE"];
const MAX_TEXT: usize = 2000;
const MAX_STREAM_TEXT: usize = 4000;
const MAX_SAMPLE: usize = 12 << 20;
const PAGE: u32 = 200;
const MAX_PAGES: u32 = 20;

pub struct Client {
    base: String,
    key: String,
    agent: ureq::Agent,
    /// Pause before retrying a rate-limited call. Short in tests.
    retry_wait: Duration,
}

#[derive(Serialize, Debug, PartialEq, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct IwVoice {
    pub voice_id: String,
    pub display_name: String,
    pub language: String,
    pub description: String,
    pub tags: Vec<String>,
    /// SYSTEM, IVC (instant clone), TVD (designed), PVC (professional clone) or OTHER, as Inworld reports it.
    pub source: String,
    pub gender: String,
    pub age_group: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct VoicePage {
    pub voices: Vec<IwVoice>,
    pub total: u64,
    pub truncated: bool,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Speech {
    pub audio: Vec<u8>,
    /// Characters Inworld says it processed (UTF-16 units, steering tags included), when it reported them.
    pub chars: u64,
    pub model: String,
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Cloned {
    pub voice: IwVoice,
    pub warnings: Vec<String>,
}

/// Cloning is refused unless the owner confirmed permission and named the speaker. Checked in the backend so no other path can skip it.
pub fn consent_ok(permission: bool, speaker: &str) -> Result<(), String> {
    if permission && !speaker.trim().is_empty() {
        Ok(())
    } else {
        Err("Confirm that you have permission to clone this voice, and say whose voice it is.".into())
    }
}

pub fn units(s: &str) -> usize {
    s.encode_utf16().count()
}

/// Ids, model names and language codes are put in JSON or a filter: only plain characters are allowed.
fn plain(s: &str, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b':'))
}

pub fn valid_voice_id(s: &str) -> bool {
    plain(s, 160)
}

fn valid_lang(s: &str) -> bool {
    plain(s, 16) && !s.contains(':') && !s.contains('.')
}

pub fn valid_model(s: &str) -> bool {
    MODELS.contains(&s)
}

/// Inworld errors are `{"code":5,"message":"..."}` with gRPC codes; the HTTP status carries the plain meaning.
fn api_error(code: u16, body: &str) -> String {
    let detail = serde_json::from_str::<Value>(body).ok().and_then(|v| v["message"].as_str().map(short)).unwrap_or_default();
    let base = match code {
        401 | 403 => "Inworld did not accept the key. Paste the Base64 credential from the Inworld Portal again.".to_string(),
        402 => "Inworld says the account is out of credit or needs billing set up.".to_string(),
        404 => "Inworld could not find that voice or model.".to_string(),
        429 => "Inworld is rate-limiting this account. Wait a minute and try again.".to_string(),
        c => format!("Inworld returned an error ({c})."),
    };
    if detail.is_empty() { base } else { format!("{base} {detail}") }
}

/// The optional controls of one speech request.
#[derive(Default, Clone, Copy)]
pub struct SpeechOpts<'a> {
    pub rate: Option<f64>,
    /// STABLE, BALANCED or CREATIVE. Documented for inworld-tts-2 only, so it is not sent to the flash model.
    pub delivery: Option<&'a str>,
    pub language: Option<&'a str>,
}

impl Client {
    pub fn new(base: &str, key: &str) -> Self {
        Client { base: base.trim_end_matches('/').to_string(), key: key.trim().into(), agent: agent(), retry_wait: Duration::from_secs(4) }
    }

    #[cfg(test)]
    fn quick(mut self) -> Self {
        self.retry_wait = Duration::from_millis(5);
        self
    }

    fn send(&self, req: ureq::Request, body: Option<&Value>) -> Result<ureq::Response, String> {
        let req = req.set("Authorization", &format!("Basic {}", self.key));
        let mut tries = 0;
        loop {
            let r = req.clone();
            let res = match body {
                Some(b) => r.set("content-type", "application/json").send_string(&b.to_string()),
                None => r.call(),
            };
            match res {
                Ok(r) => return Ok(r),
                Err(ureq::Error::Status(429, r)) if tries < 2 => {
                    tries += 1;
                    let wait = r.header("retry-after").and_then(|v| v.trim().parse::<u64>().ok()).map(|s| Duration::from_secs(s.min(10))).unwrap_or(self.retry_wait);
                    std::thread::sleep(wait.max(self.retry_wait));
                }
                Err(ureq::Error::Status(c, r)) => return Err(api_error(c, &r.into_string().unwrap_or_default())),
                Err(ureq::Error::Transport(_)) => return Err("Could not reach Inworld. Check your internet connection.".into()),
            }
        }
    }

    fn post(&self, path: &str, body: &Value) -> Result<ureq::Response, String> {
        self.send(self.agent.post(&format!("{}{path}", self.base)), Some(body))
    }

    /// One cheap listing call. Proves the credential is accepted and says how many voices the account can see.
    pub fn check(&self) -> Result<u64, String> {
        let r = self.send(self.agent.get(&format!("{}/voices/v1/voices", self.base)).query("pageSize", "1"), None)?;
        let v: Value = serde_json::from_slice(&read_all(r, 1 << 20)?).map_err(|_| "Inworld sent something unexpected.".to_string())?;
        Ok(v["totalSize"].as_u64().or_else(|| v["totalSize"].as_str().and_then(|s| s.parse().ok())).unwrap_or_else(|| v["voices"].as_array().map(|a| a.len() as u64).unwrap_or(0)))
    }

    /// Every voice the account can use, up to a safe limit. `language` is a code such as `en`; `source` is one of
    /// SYSTEM, IVC, TVD, PVC. Neither is passed through as free text: both are checked and quoted here.
    pub fn voices(&self, language: Option<&str>, source: Option<&str>) -> Result<VoicePage, String> {
        let mut parts = Vec::new();
        if let Some(l) = language.filter(|l| !l.is_empty()) {
            if !valid_lang(l) {
                return Err("That language code is not valid.".into());
            }
            // The documented example is `lang_code = "en"`; only the base language is used, and the app filters locales itself.
            parts.push(format!("lang_code = \"{}\"", l.split(['-', '_']).next().unwrap_or(l).to_lowercase()));
        }
        if let Some(s) = source.filter(|s| !s.is_empty()) {
            if !["SYSTEM", "IVC", "TVD", "PVC"].contains(&s) {
                return Err("That voice kind is not valid.".into());
            }
            parts.push(format!("source = \"{s}\""));
        }
        let filter = parts.join(" AND ");
        let (mut out, mut token, mut total, mut pages) = (Vec::new(), String::new(), 0u64, 0);
        loop {
            let mut req = self.agent.get(&format!("{}/voices/v1/voices", self.base)).query("pageSize", &PAGE.to_string());
            if !filter.is_empty() {
                req = req.query("filter", &filter);
            }
            if !token.is_empty() {
                req = req.query("pageToken", &token);
            }
            let v: Value = serde_json::from_slice(&read_all(self.send(req, None)?, 8 << 20)?).map_err(|_| "Inworld sent something unexpected.".to_string())?;
            total = v["totalSize"].as_u64().or_else(|| v["totalSize"].as_str().and_then(|s| s.parse().ok())).unwrap_or(total);
            if let Some(list) = v["voices"].as_array() {
                out.extend(list.iter().filter_map(parse_voice));
            }
            pages += 1;
            token = v["nextPageToken"].as_str().unwrap_or("").to_string();
            if token.is_empty() || pages >= MAX_PAGES {
                break;
            }
        }
        let mut seen = std::collections::BTreeSet::new();
        out.retain(|v| seen.insert(v.voice_id.clone()));
        Ok(VoicePage { truncated: !token.is_empty(), total: total.max(out.len() as u64), voices: out })
    }

    /// A finished line as 48 kHz WAV. Inworld bills the characters, so there is no blind retry.
    pub fn speak(&self, text: &str, voice: &str, model: &str, o: SpeechOpts) -> Result<Speech, String> {
        let body = speech_body(text, voice, model, o, "WAV", 48000, MAX_TEXT)?;
        let v: Value = serde_json::from_slice(&read_all(self.post("/tts/v1/voice", &body)?, 40 << 20)?).map_err(|_| "Inworld sent something unexpected.".to_string())?;
        let audio = decode_audio(v["audioContent"].as_str())?;
        if !audio.starts_with(b"RIFF") {
            return Err("Inworld did not return a WAV file.".into());
        }
        Ok(Speech { audio, chars: v["usage"]["processedCharactersCount"].as_u64().unwrap_or(0), model: v["usage"]["modelId"].as_str().unwrap_or(model).to_string() })
    }

    /// A quicker MP3 for listening, through the streaming endpoint. MP3 frames join end to end, so the chunks are simply kept in order.
    pub fn speak_stream_mp3(&self, text: &str, voice: &str, model: &str, o: SpeechOpts) -> Result<Speech, String> {
        let mut body = speech_body(text, voice, model, o, "MP3", 48000, MAX_STREAM_TEXT)?;
        body["audioConfig"]["bitRate"] = json!(128000);
        let bytes = read_all(self.post("/tts/v1/voice:stream", &body)?, MAX_AUDIO)?;
        let (audio, chars) = decode_stream(&bytes)?;
        Ok(Speech { audio, chars, model: model.to_string() })
    }

    /// Instant voice cloning. The caller must already have the speaker's permission; this only checks the audio.
    pub fn clone_voice(&self, name: &str, language: Option<&str>, description: &str, sample: &[u8], transcription: Option<&str>, remove_noise: bool) -> Result<Cloned, String> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 80 || name.chars().any(|c| c.is_control()) {
            return Err("Give the voice a name of up to 80 characters.".into());
        }
        if sample.len() < 2000 || sample.len() > MAX_SAMPLE {
            return Err("The recording is empty or larger than 12 MB.".into());
        }
        let wav = sample.starts_with(b"RIFF");
        let mp3 = sample.starts_with(b"ID3") || (sample.len() > 2 && sample[0] == 0xFF && sample[1] & 0xE0 == 0xE0);
        if !wav && !mp3 {
            return Err("Inworld cloning takes a WAV or MP3 recording.".into());
        }
        let mut s = json!({ "audioData": base64::engine::general_purpose::STANDARD.encode(sample) });
        if let Some(t) = transcription.map(str::trim).filter(|t| !t.is_empty()) {
            s["transcription"] = json!(t.chars().take(2000).collect::<String>());
        }
        let mut body = json!({ "displayName": name, "voiceSamples": [s], "audioProcessingConfig": { "removeBackgroundNoise": remove_noise } });
        if !description.trim().is_empty() {
            body["description"] = json!(description.trim().chars().take(400).collect::<String>());
        }
        if let Some(l) = language.filter(|l| !l.is_empty() && *l != "auto") {
            if !valid_lang(l) {
                return Err("That language code is not valid.".into());
            }
            body["languageCode"] = json!(l);
        }
        let v: Value = serde_json::from_slice(&read_all(self.post("/voices/v1/voices:clone", &body)?, 8 << 20)?).map_err(|_| "Inworld sent something unexpected.".to_string())?;
        let voice = parse_voice(&v["voice"]).ok_or("Inworld did not return the new voice.")?;
        let mut warnings = Vec::new();
        for a in v["audioSamplesValidated"].as_array().into_iter().flatten() {
            for k in ["warnings", "errors"] {
                warnings.extend(a[k].as_array().into_iter().flatten().filter_map(|w| w.as_str()).map(short));
            }
        }
        Ok(Cloned { voice, warnings })
    }
}

fn speech_body(text: &str, voice: &str, model: &str, o: SpeechOpts, encoding: &str, hz: u32, limit: usize) -> Result<Value, String> {
        let text = text.trim();
        if text.is_empty() {
            return Err("There is nothing to say on that line.".into());
        }
        if units(text) > limit {
            return Err(format!("That line is too long for Inworld ({limit} characters). Split it into two lines."));
        }
        if !valid_voice_id(voice) {
            return Err("Pick an Inworld voice first.".into());
        }
        if !valid_model(model) {
            return Err("That Inworld model is not one Greenroom knows.".into());
        }
        let mut audio = json!({ "audioEncoding": encoding, "sampleRateHertz": hz });
        if let Some(r) = o.rate.filter(|r| (r - 1.0).abs() > 0.001) {
            audio["speakingRate"] = json!((r.clamp(0.5, 1.5) * 100.0).round() / 100.0);
        }
        let mut body = json!({ "text": text, "voiceId": voice, "modelId": model, "audioConfig": audio });
        // deliveryMode is documented for inworld-tts-2 only, so it is not sent to the flash model.
        if let Some(d) = o.delivery.filter(|d| model == "inworld-tts-2" && DELIVERY.contains(d)) {
            body["deliveryMode"] = json!(d);
        }
        if let Some(l) = o.language.filter(|l| !l.is_empty()) {
            if !valid_lang(l) {
                return Err("That language code is not valid.".into());
            }
            body["language"] = json!(l);
        }
        Ok(body)
    }

fn parse_voice(v: &Value) -> Option<IwVoice> {
    let id = v["voiceId"].as_str()?.to_string();
    if !valid_voice_id(&id) {
        return None;
    }
    let s = |k: &str| v[k].as_str().map(short).unwrap_or_default();
    let language = [s("languageCode"), s("langCode")].into_iter().find(|x| !x.is_empty()).unwrap_or_default();
    Some(IwVoice {
        display_name: [s("displayName"), id.clone()].into_iter().find(|x| !x.is_empty()).unwrap_or_default(),
        voice_id: id,
        language,
        description: s("description"),
        tags: v["tags"].as_array().into_iter().flatten().filter_map(|t| t.as_str()).map(short).take(12).collect(),
        source: s("source"),
        gender: s("gender"),
        age_group: s("ageGroup"),
    })
}

fn decode_audio(b64: Option<&str>) -> Result<Vec<u8>, String> {
    let b = b64.filter(|s| !s.is_empty()).ok_or("Inworld did not return audio.")?;
    let bytes = base64::engine::general_purpose::STANDARD.decode(b).map_err(|_| "Inworld sent audio that could not be read.".to_string())?;
    if bytes.len() < 200 {
        return Err("Inworld did not return audio.".into());
    }
    Ok(bytes)
}

/// Joins a streamed answer. Each line is one JSON object; an error line can follow a 200 status, so it is checked.
pub fn decode_stream(body: &[u8]) -> Result<(Vec<u8>, u64), String> {
    let (mut audio, mut chars) = (Vec::new(), 0u64);
    for line in String::from_utf8_lossy(body).lines().map(str::trim).filter(|l| !l.is_empty()) {
        let v: Value = serde_json::from_str(line).map_err(|_| "Inworld sent something unexpected.".to_string())?;
        if v.get("error").is_some() {
            return Err(format!("Inworld stopped part way. {}", v["error"]["message"].as_str().map(short).unwrap_or_default()).trim().to_string());
        }
        if let Some(a) = v["result"]["audioContent"].as_str().filter(|a| !a.is_empty()) {
            audio.extend(base64::engine::general_purpose::STANDARD.decode(a).map_err(|_| "Inworld sent audio that could not be read.".to_string())?);
        }
        // The full count is reported on the first message; later ones may repeat or omit it.
        chars = chars.max(v["result"]["usage"]["processedCharactersCount"].as_u64().unwrap_or(0));
    }
    if audio.len() < 200 {
        return Err("Inworld did not return audio.".into());
    }
    Ok((audio, chars))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eleven::fake::*;

    fn wav() -> Vec<u8> {
        let mut v = b"RIFF\x24\x01\0\0WAVEfmt ".to_vec();
        v.extend(vec![1u8; 400]);
        v
    }
    fn b64(b: &[u8]) -> String {
        base64::engine::general_purpose::STANDARD.encode(b)
    }
    fn voice_json(id: &str, name: &str) -> Value {
        json!({ "voiceId": id, "displayName": name, "languageCode": "en-US", "source": "SYSTEM", "tags": ["warm"], "gender": "FEMALE" })
    }

    #[test]
    fn credential_is_sent_as_basic_and_check_counts_voices() {
        let f = start(Box::new(|_| (200, json!({ "voices": [voice_json("Alex", "Alex")], "totalSize": 41 }).to_string().into_bytes())));
        assert_eq!(Client::new(&f.base, "QUJD").check().unwrap(), 41);
        let h = f.hits.lock().unwrap()[0].clone();
        assert!(h.headers.contains("authorization: basic qujd"), "{}", h.headers);
        assert!(h.path.contains("pageSize=1"));
    }

    #[test]
    fn a_rejected_key_says_so_without_echoing_it() {
        let f = start(Box::new(|_| (401, br#"{"code":16,"message":"bad credential SECRETKEY"}"#.to_vec())));
        let e = Client::new(&f.base, "SECRETKEY").check().unwrap_err();
        assert!(e.contains("did not accept the key"));
    }

    #[test]
    fn voice_listing_follows_pages_and_drops_repeats() {
        let f = start(Box::new(|h| {
            if h.path.contains("pageToken=p2") {
                (200, json!({ "voices": [voice_json("Bea", "Bea"), voice_json("Alex", "Alex")], "totalSize": 3 }).to_string().into_bytes())
            } else {
                (200, json!({ "voices": [voice_json("Alex", "Alex"), json!({ "voiceId": "bad id!" })], "totalSize": 3, "nextPageToken": "p2" }).to_string().into_bytes())
            }
        }));
        let p = Client::new(&f.base, "K").voices(Some("en-US"), Some("SYSTEM")).unwrap();
        assert_eq!(p.voices.iter().map(|v| v.voice_id.as_str()).collect::<Vec<_>>(), ["Alex", "Bea"]);
        assert_eq!(p.total, 3);
        assert!(!p.truncated);
        let first = f.hits.lock().unwrap()[0].path.clone();
        assert!(first.contains("filter=") && first.contains("lang_code") && first.contains("%22en%22") && first.contains("SYSTEM"), "{first}");
        assert_eq!(p.voices[0].language, "en-US");
    }

    #[test]
    fn cloning_needs_permission_and_a_named_speaker() {
        assert!(consent_ok(true, "A. Person").is_ok());
        assert!(consent_ok(false, "A. Person").unwrap_err().contains("permission"));
        assert!(consent_ok(true, "   ").is_err());
    }

    #[test]
    fn filters_are_checked_not_passed_through() {
        let c = Client::new("http://127.0.0.1:1", "K");
        assert!(c.voices(Some("en\" OR 1=1"), None).is_err());
        assert!(c.voices(None, Some("ALL")).is_err());
    }

    #[test]
    fn speech_request_uses_documented_fields_and_returns_wav() {
        let f = start(Box::new(|_| (200, json!({ "audioContent": b64(&wav()), "usage": { "processedCharactersCount": 11, "modelId": "inworld-tts-2" } }).to_string().into_bytes())));
        let s = Client::new(&f.base, "K").speak("[say it dryly] Hello there", "Alex", "inworld-tts-2", SpeechOpts { rate: Some(0.9), delivery: Some("CREATIVE"), language: Some("en-GB") }).unwrap();
        assert!(s.audio.starts_with(b"RIFF"));
        assert_eq!(s.chars, 11);
        let h = f.hits.lock().unwrap()[0].clone();
        assert_eq!(h.path, "/tts/v1/voice");
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        assert_eq!(b["voiceId"], "Alex");
        assert_eq!(b["modelId"], "inworld-tts-2");
        assert_eq!(b["audioConfig"]["audioEncoding"], "WAV");
        assert_eq!(b["audioConfig"]["sampleRateHertz"], 48000);
        assert_eq!(b["audioConfig"]["speakingRate"], 0.9);
        assert_eq!(b["deliveryMode"], "CREATIVE");
        assert_eq!(b["language"], "en-GB");
    }

    #[test]
    fn the_flash_model_gets_no_delivery_mode() {
        let f = start(Box::new(|_| (200, json!({ "audioContent": b64(&wav()) }).to_string().into_bytes())));
        Client::new(&f.base, "K").speak("Hi", "Alex", "inworld-tts-2-flash", SpeechOpts { delivery: Some("CREATIVE"), ..Default::default() }).unwrap();
        let b: Value = serde_json::from_slice(&f.hits.lock().unwrap()[0].body).unwrap();
        assert!(b.get("deliveryMode").is_none() && b["audioConfig"].get("speakingRate").is_none());
    }

    #[test]
    fn bad_input_never_reaches_the_network() {
        let c = Client::new("http://127.0.0.1:1", "K");
        assert!(c.speak("   ", "Alex", "inworld-tts-2", SpeechOpts::default()).is_err());
        assert!(c.speak(&"x".repeat(2001), "Alex", "inworld-tts-2", SpeechOpts::default()).unwrap_err().contains("too long"));
        assert!(c.speak("hi", "Al\"ex", "inworld-tts-2", SpeechOpts::default()).is_err());
        assert!(c.speak("hi", "Alex", "gpt-9", SpeechOpts::default()).is_err());
        assert!(c.speak("hi", "Alex", "inworld-tts-2", SpeechOpts { language: Some("en\"x"), ..Default::default() }).is_err());
    }

    #[test]
    fn a_non_wav_or_empty_answer_is_an_error() {
        let f = start(Box::new(|_| (200, json!({ "audioContent": b64(&vec![9u8; 400]) }).to_string().into_bytes())));
        assert!(Client::new(&f.base, "K").speak("hi", "Alex", "inworld-tts-2", SpeechOpts::default()).unwrap_err().contains("WAV"));
        let g = start(Box::new(|_| (200, br#"{"audioContent":""}"#.to_vec())));
        assert!(Client::new(&g.base, "K").speak("hi", "Alex", "inworld-tts-2", SpeechOpts::default()).unwrap_err().contains("did not return audio"));
    }

    #[test]
    fn streamed_lines_are_joined_in_order_and_errors_are_caught() {
        let a = vec![1u8; 150];
        let b = vec![2u8; 150];
        let body = format!("{}\n\n{}\n", json!({ "result": { "audioContent": b64(&a), "usage": { "processedCharactersCount": 20 } } }), json!({ "result": { "audioContent": b64(&b) } }));
        let (audio, chars) = decode_stream(body.as_bytes()).unwrap();
        assert_eq!(audio.len(), 300);
        assert_eq!(&audio[..150], &a[..]);
        assert_eq!(chars, 20);
        let bad = format!("{}\n{}\n", json!({ "result": { "audioContent": b64(&a) } }), json!({ "error": { "code": 3, "message": "too long" } }));
        assert!(decode_stream(bad.as_bytes()).unwrap_err().contains("stopped part way"));
        assert!(decode_stream(b"not json").is_err());
    }

    #[test]
    fn streaming_preview_posts_to_the_stream_endpoint() {
        let line = json!({ "result": { "audioContent": b64(&vec![3u8; 300]), "usage": { "processedCharactersCount": 5 } } }).to_string();
        let f = start(Box::new(move |_| (200, format!("{line}\n").into_bytes())));
        let s = Client::new(&f.base, "K").speak_stream_mp3("Hello", "Alex", "inworld-tts-2", SpeechOpts::default()).unwrap();
        assert_eq!(s.audio.len(), 300);
        let h = f.hits.lock().unwrap()[0].clone();
        assert_eq!(h.path, "/tts/v1/voice:stream");
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        assert_eq!(b["audioConfig"]["audioEncoding"], "MP3");
    }

    #[test]
    fn a_rate_limit_is_retried_then_succeeds_and_a_hard_limit_is_reported() {
        let n = std::sync::Arc::new(std::sync::atomic::AtomicU32::new(0));
        let n2 = n.clone();
        let f = start(Box::new(move |_| if n2.fetch_add(1, std::sync::atomic::Ordering::SeqCst) < 2 { (429, b"{}".to_vec()) } else { (200, json!({ "voices": [], "totalSize": 0 }).to_string().into_bytes()) }));
        assert_eq!(Client::new(&f.base, "K").quick().check().unwrap(), 0);
        assert_eq!(f.hits.lock().unwrap().len(), 3);
        let g = start(Box::new(|_| (429, b"{}".to_vec())));
        let e = Client::new(&g.base, "K").quick().check().unwrap_err();
        assert!(e.contains("rate-limiting"));
        assert_eq!(g.hits.lock().unwrap().len(), 3, "one try and two retries, then stop");
    }

    #[test]
    fn a_server_error_is_not_retried_because_it_may_have_been_billed() {
        let f = start(Box::new(|_| (500, b"{}".to_vec())));
        assert!(Client::new(&f.base, "K").quick().speak("hi", "Alex", "inworld-tts-2", SpeechOpts::default()).is_err());
        assert_eq!(f.hits.lock().unwrap().len(), 1);
    }

    #[test]
    fn cloning_checks_the_recording_and_sends_the_documented_fields() {
        let f = start(Box::new(|_| (200, json!({ "voice": voice_json("clone-1", "Mum"), "audioSamplesValidated": [{ "warnings": ["noisy"] }] }).to_string().into_bytes())));
        let c = Client::new(&f.base, "K");
        let mut sample = b"RIFF\0\0\0\0WAVE".to_vec();
        sample.extend(vec![0u8; 3000]);
        let out = c.clone_voice("Mum", Some("en-US"), "Warm", &sample, Some("Hello."), true).unwrap();
        assert_eq!(out.voice.voice_id, "clone-1");
        assert_eq!(out.warnings, ["noisy"]);
        let h = f.hits.lock().unwrap()[0].clone();
        assert_eq!(h.path, "/voices/v1/voices:clone");
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        assert_eq!(b["displayName"], "Mum");
        assert_eq!(b["languageCode"], "en-US");
        assert_eq!(b["voiceSamples"][0]["transcription"], "Hello.");
        assert_eq!(b["audioProcessingConfig"]["removeBackgroundNoise"], true);
        assert!(c.clone_voice("Mum", None, "", b"short", None, false).is_err());
        assert!(c.clone_voice("Mum", None, "", &vec![5u8; 5000], None, false).unwrap_err().contains("WAV or MP3"));
        assert!(c.clone_voice("  ", None, "", &sample, None, false).is_err());
        assert_eq!(f.hits.lock().unwrap().len(), 1, "rejected recordings are never uploaded");
    }
}
