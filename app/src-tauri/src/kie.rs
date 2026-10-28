//! Kie.ai: `POST /api/v1/jobs/createTask` with `{model, input}`, then poll `GET /api/v1/jobs/recordInfo?taskId=`
//! until `state` is `success` or `fail`. Kie answers HTTP 200 even for errors, so the numeric `code` is what counts.

use crate::net::{agent, http_error, read_json, short};
use serde_json::{json, Value};
use std::time::Duration;

pub const BASE: &str = "https://api.kie.ai";
pub const DEFAULT_VOICE: &str = "EkK5I93UQWFDigLMpZcX";
/// Kie text model used by the AI Director (OpenAI-style chat endpoint, from docs.kie.ai on 2026-10-26).
pub const DIRECTOR_MODEL: &str = "gemini-3-8-flash-openai";

pub struct Client {
    base: String,
    key: String,
    agent: ureq::Agent,
    poll: Duration,
    max_polls: u32,
    music_polls: u32,
}

impl Client {
    pub fn new(base: &str, key: &str) -> Self {
        Client { base: base.trim_end_matches('/').to_string(), key: key.to_string(), agent: agent(), poll: Duration::from_secs(3), max_polls: 60, music_polls: 100 }
    }

    #[cfg(test)]
    fn quick(base: &str) -> Self {
        Client { poll: Duration::ZERO, max_polls: 3, music_polls: 3, ..Client::new(base, "KIEKEY") }
    }

    fn call(&self, method: &str, path: &str, body: Option<&Value>) -> Result<Value, String> {
        self.call_with(method, path, body, true)
    }

    /// `envelope`: Kie's job API always wraps answers in `{code, data}`; its chat API answers in OpenAI shape and only
    /// uses `code` for errors.
    fn call_with(&self, method: &str, path: &str, body: Option<&Value>, envelope: bool) -> Result<Value, String> {
        let req = self.agent.request(method, &format!("{}{path}", self.base)).set("Authorization", &format!("Bearer {}", self.key));
        let res = match body {
            Some(b) => req.set("content-type", "application/json").send_string(&b.to_string()),
            None => req.call(),
        };
        let v = match res {
            Ok(r) => read_json(r, 4 << 20)?,
            Err(ureq::Error::Status(c, r)) => return Err(http_error("Kie", c, r)),
            Err(ureq::Error::Transport(_)) => return Err("Could not reach Kie. Check your internet connection.".into()),
        };
        match v["code"].as_i64() {
            None if !envelope && v["choices"].is_array() => Ok(v),
            Some(200) => Ok(v),
            Some(401) | Some(403) => Err("Kie did not accept the key. Check it in Settings.".into()),
            Some(402) => Err("Kie says the account is out of credits.".into()),
            Some(429) => Err("Kie is busy. Wait a minute and try again.".into()),
            Some(c) => Err(format!("Kie reported code {c}. {}", short(v["msg"].as_str().unwrap_or("")))),
            None => Err("Kie sent something unexpected.".into()),
        }
    }

    /// Ask a Kie text model one question. Returns the reply text.
    pub fn chat(&self, model: &str, system: &str, user: &str) -> Result<String, String> {
        if model.is_empty() || !model.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'.' || b == b'_') {
            return Err("That text model is not valid.".into());
        }
        let part = |t: &str| json!([{ "type": "text", "text": t }]);
        let body = json!({ "messages": [{ "role": "system", "content": part(system) }, { "role": "user", "content": part(user) }], "stream": false, "reasoning_effort": "low" });
        let v = self.call_with("POST", &format!("/{model}/v1/chat/completions"), Some(&body), false)?;
        let c = &v["choices"][0]["message"]["content"];
        let text = match c {
            Value::String(s) => s.clone(),
            Value::Array(a) => a.iter().filter_map(|p| p["text"].as_str()).collect::<Vec<_>>().join(""),
            _ => String::new(),
        };
        if text.trim().is_empty() {
            return Err("The text model sent back nothing. Try again.".into());
        }
        Ok(text)
    }

    /// `fetch` downloads a result URL; it is a parameter so tests need no internet.
    pub fn run(&self, model: &str, input: Value, fetch: &dyn Fn(&str) -> Result<Vec<u8>, String>) -> Result<Vec<u8>, String> {
        let created = self.call("POST", "/api/v1/jobs/createTask", Some(&json!({ "model": model, "input": input })))?;
        let task = created["data"]["taskId"]
            .as_str()
            .filter(|t| !t.is_empty() && t.len() <= 100 && t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
            .ok_or("Kie did not accept the job. The model name may have changed.")?
            .to_string();
        for _ in 0..self.max_polls {
            std::thread::sleep(self.poll);
            let v = self.call("GET", &format!("/api/v1/jobs/recordInfo?taskId={task}"), None)?;
            let d = &v["data"];
            match d["state"].as_str().unwrap_or("") {
                "success" => {
                    let mut found = Vec::new();
                    if let Some(p) = d["resultJson"].as_str().and_then(|s| serde_json::from_str::<Value>(s).ok()) {
                        urls(&p, &mut found);
                    }
                    urls(&d["response"], &mut found);
                    let url = found.into_iter().next().ok_or("Kie finished but returned no audio file.")?;
                    return fetch(&url);
                }
                "fail" => return Err(format!("Kie could not make this clip. {}", short(d["failMsg"].as_str().unwrap_or("")))),
                _ => {}
            }
        }
        Err("Kie took too long. The clip may still appear in your Kie account.".into())
    }
}

pub const MUSIC_MODEL: &str = "ai-music-api/generate";
pub const MUSIC_VERSIONS: [&str; 3] = ["V6", "V6_MINI", "V6_WILD"];

/// What the owner asks for. Always sent in Kie's "custom mode", where the style text drives the music.
#[derive(serde::Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MusicReq {
    pub title: String,
    pub style: String,
    #[serde(default)]
    pub lyrics: String,
    pub instrumental: bool,
    pub version: String,
    #[serde(default)]
    pub negative_tags: String,
    /// "m", "f" or empty. Only a hint to the model.
    #[serde(default)]
    pub vocal_gender: String,
    /// Seconds, 10 to 360. 0 leaves the length to the model.
    #[serde(default)]
    pub duration: u32,
}

/// Checks a request against Kie's documented limits (docs.kie.ai, Suno "Generate Music", read 2026-10-26) and builds the
/// `input` object. Rejecting here means a mistake costs nothing.
pub fn music_input(r: &MusicReq) -> Result<Value, String> {
    let n = |s: &str| s.chars().count();
    if r.title.trim().is_empty() || n(&r.title) > 80 {
        return Err("Give the music a title of up to 80 characters.".into());
    }
    if r.style.trim().is_empty() || n(&r.style) > 1000 {
        return Err("Describe the style of the music in up to 1000 characters.".into());
    }
    if n(&r.lyrics) > 5000 {
        return Err("The lyrics can be at most 5000 characters.".into());
    }
    if n(&r.negative_tags) > 200 {
        return Err("The list of things to avoid is too long.".into());
    }
    if !MUSIC_VERSIONS.contains(&r.version.as_str()) {
        return Err("That Suno version is not one Greenroom offers.".into());
    }
    if r.duration != 0 && !(10..=360).contains(&r.duration) {
        return Err("The length must be between 10 and 360 seconds.".into());
    }
    let mut input = json!({ "custom_mode": true, "instrumental": r.instrumental, "model": r.version, "title": r.title.trim(), "style": r.style.trim() });
    if !r.instrumental && !r.lyrics.trim().is_empty() {
        input["lyrics"] = json!(r.lyrics.trim());
    }
    if !r.negative_tags.trim().is_empty() {
        input["negative_tags"] = json!(r.negative_tags.trim());
    }
    if !r.instrumental && matches!(r.vocal_gender.as_str(), "m" | "f") {
        input["vocal_gender"] = json!(r.vocal_gender);
    }
    if r.duration != 0 {
        input["duration"] = json!(r.duration);
    }
    Ok(input)
}

#[derive(Debug, Clone, PartialEq)]
pub struct MusicTrack {
    pub title: String,
    pub url: String,
    pub seconds: f64,
}

fn tracks_of(d: &Value) -> Vec<MusicTrack> {
    let mut list: Vec<Value> = d["response"]["data"].as_array().cloned().unwrap_or_default();
    if list.is_empty() {
        if let Some(p) = d["resultJson"].as_str().and_then(|s| serde_json::from_str::<Value>(s).ok()) {
            list = p["data"].as_array().cloned().unwrap_or_default();
        }
    }
    list.iter()
        .filter_map(|t| {
            let url = t["audio_url"].as_str().or(t["audioUrl"].as_str())?;
            url.starts_with("https://").then(|| MusicTrack { title: short(t["title"].as_str().unwrap_or("")), url: url.to_string(), seconds: t["duration"].as_f64().unwrap_or(0.0) })
        })
        .collect()
}

impl Client {
    /// Makes music with Suno through Kie. One request usually returns two tracks. Takes a few minutes.
    pub fn music(&self, input: Value) -> Result<Vec<MusicTrack>, String> {
        let created = self.call("POST", "/api/v1/jobs/createTask", Some(&json!({ "model": MUSIC_MODEL, "input": input })))?;
        let task = created["data"]["taskId"]
            .as_str()
            .filter(|t| !t.is_empty() && t.len() <= 100 && t.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-'))
            .ok_or("Kie did not accept the music job. The model name may have changed.")?
            .to_string();
        for _ in 0..self.music_polls {
            std::thread::sleep(self.poll);
            let v = self.call("GET", &format!("/api/v1/jobs/recordInfo?taskId={task}"), None)?;
            let d = &v["data"];
            match d["state"].as_str().unwrap_or("") {
                "success" => {
                    let t = tracks_of(d);
                    return if t.is_empty() { Err("Kie finished but returned no music.".into()) } else { Ok(t) };
                }
                "fail" => return Err(format!("Kie could not make this music. {}", short(d["failMsg"].as_str().unwrap_or("")))),
                _ => {}
            }
        }
        Err("Kie is taking a long time. The music may still appear in your Kie account.".into())
    }
}

fn urls(v: &Value, out: &mut Vec<String>) {
    match v {
        Value::String(s) if s.starts_with("https://") => out.push(s.clone()),
        Value::Array(a) => a.iter().for_each(|x| urls(x, out)),
        Value::Object(o) => o.values().for_each(|x| urls(x, out)),
        _ => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eleven::fake::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;

    #[test]
    fn creates_a_task_polls_and_downloads_the_first_result_url() {
        let polls = Arc::new(AtomicUsize::new(0));
        let p2 = polls.clone();
        let f = start(Box::new(move |h| {
            if h.method == "POST" {
                (200, json!({"code":200,"data":{"taskId":"task_1"}}).to_string().into_bytes())
            } else if p2.fetch_add(1, Ordering::SeqCst) == 0 {
                (200, json!({"code":200,"data":{"state":"waiting"}}).to_string().into_bytes())
            } else {
                (200, json!({"code":200,"data":{"state":"success","resultJson":"{\"resultUrls\":[\"https://files.example.com/a.mp3\"]}"}}).to_string().into_bytes())
            }
        }));
        let c = Client::quick(&f.base);
        let out = c.run("elevenlabs/text-to-speech-turbo-2-5", json!({"text":"hi","voice":DEFAULT_VOICE}), &|u| {
            assert_eq!(u, "https://files.example.com/a.mp3");
            Ok(vec![1, 2, 3])
        })
        .unwrap();
        assert_eq!(out, vec![1, 2, 3]);
        let hits = f.hits.lock().unwrap();
        assert!(hits[0].headers.contains("authorization: bearer kiekey"));
        let b: Value = serde_json::from_slice(&hits[0].body).unwrap();
        assert_eq!(b["model"], "elevenlabs/text-to-speech-turbo-2-5");
        assert_eq!(b["input"]["voice"], DEFAULT_VOICE);
    }

    fn req() -> MusicReq {
        MusicReq { title: "Night Market".into(), style: "warm afrobeat, light percussion".into(), lyrics: "la la".into(), instrumental: true, version: "V6".into(), negative_tags: String::new(), vocal_gender: "f".into(), duration: 0 }
    }

    #[test]
    fn music_requests_follow_the_documented_limits_and_drop_what_does_not_apply() {
        let i = music_input(&req()).unwrap();
        assert_eq!(i["custom_mode"], true);
        assert_eq!(i["model"], "V6");
        assert_eq!(i["instrumental"], true);
        assert!(i.get("lyrics").is_none() && i.get("vocal_gender").is_none() && i.get("duration").is_none());
        let v = music_input(&MusicReq { instrumental: false, duration: 90, negative_tags: " drums ".into(), ..req() }).unwrap();
        assert_eq!((v["lyrics"].as_str(), v["vocal_gender"].as_str(), v["duration"].as_u64(), v["negative_tags"].as_str()), (Some("la la"), Some("f"), Some(90), Some("drums")));
        assert!(music_input(&MusicReq { title: " ".into(), ..req() }).is_err());
        assert!(music_input(&MusicReq { title: "x".repeat(81), ..req() }).is_err());
        assert!(music_input(&MusicReq { style: String::new(), ..req() }).is_err());
        assert!(music_input(&MusicReq { style: "x".repeat(1001), ..req() }).is_err());
        assert!(music_input(&MusicReq { version: "V3".into(), ..req() }).is_err());
        assert!(music_input(&MusicReq { duration: 9, ..req() }).is_err());
        assert!(music_input(&MusicReq { duration: 361, ..req() }).is_err());
    }

    #[test]
    fn music_polls_until_success_and_reads_every_secure_track() {
        let polls = Arc::new(AtomicUsize::new(0));
        let p2 = polls.clone();
        let f = start(Box::new(move |h| {
            if h.method == "POST" {
                (200, json!({"code":200,"data":{"taskId":"m1"}}).to_string().into_bytes())
            } else if p2.fetch_add(1, Ordering::SeqCst) == 0 {
                (200, json!({"code":200,"data":{"state":"generating"}}).to_string().into_bytes())
            } else {
                (200, json!({"code":200,"data":{"state":"success","response":{"data":[{"id":"a","audio_url":"https://f.example.com/a.mp3","title":"Take A","duration":61.5},{"id":"b","audio_url":"http://insecure.example.com/b.mp3","title":"Bad"},{"id":"c","audio_url":"https://f.example.com/c.mp3","title":"Take C","duration":58}]}}}).to_string().into_bytes())
            }
        }));
        let t = Client::quick(&f.base).music(music_input(&req()).unwrap()).unwrap();
        assert_eq!(t, vec![MusicTrack { title: "Take A".into(), url: "https://f.example.com/a.mp3".into(), seconds: 61.5 }, MusicTrack { title: "Take C".into(), url: "https://f.example.com/c.mp3".into(), seconds: 58.0 }]);
        let h = f.hits.lock().unwrap()[0].clone();
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        assert_eq!(b["model"], MUSIC_MODEL);
        assert_eq!(b["input"]["title"], "Night Market");
    }

    #[test]
    fn music_failures_and_empty_results_are_explained() {
        let post = || (200, json!({"code":200,"data":{"taskId":"m2"}}).to_string().into_bytes());
        let f = start(Box::new(move |h| if h.method == "POST" { post() } else { (200, json!({"code":200,"data":{"state":"fail","failMsg":"Sensitive word"}}).to_string().into_bytes()) }));
        assert!(Client::quick(&f.base).music(json!({})).unwrap_err().contains("Sensitive word"));
        let g = start(Box::new(move |h| if h.method == "POST" { post() } else { (200, json!({"code":200,"data":{"state":"success","response":{"data":[]}}}).to_string().into_bytes()) }));
        assert!(Client::quick(&g.base).music(json!({})).unwrap_err().contains("no music"));
        let r = start(Box::new(move |h| if h.method == "POST" { post() } else { (200, json!({"code":200,"data":{"state":"generating"}}).to_string().into_bytes()) }));
        assert!(Client::quick(&r.base).music(json!({})).unwrap_err().contains("long time"));
    }

    #[test]
    fn http_200_with_an_error_code_is_an_error() {
        let f = start(Box::new(|_| (200, json!({"code":422,"msg":"voiceId cannot be empty"}).to_string().into_bytes())));
        let e = Client::quick(&f.base).run("m", json!({}), &|_| Ok(vec![])).unwrap_err();
        assert!(e.contains("422") && e.contains("voiceId cannot be empty"));
        let f2 = start(Box::new(|_| (200, json!({"code":402}).to_string().into_bytes())));
        assert!(Client::quick(&f2.base).run("m", json!({}), &|_| Ok(vec![])).unwrap_err().contains("out of credits"));
    }

    #[test]
    fn chat_reads_openai_shaped_replies_and_errors() {
        let f = start(Box::new(|_| (200, json!({"choices":[{"message":{"content":"[{\"id\":\"l1\"}]"}}],"usage":{}}).to_string().into_bytes())));
        let out = Client::quick(&f.base).chat(DIRECTOR_MODEL, "be brief", "hello").unwrap();
        assert_eq!(out, "[{\"id\":\"l1\"}]");
        let h = f.hits.lock().unwrap()[0].clone();
        assert_eq!(h.path, "/gemini-3-8-flash-openai/v1/chat/completions");
        assert!(h.headers.contains("authorization: bearer kiekey"));
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        assert_eq!(b["messages"][0]["role"], "system");
        assert_eq!(b["messages"][1]["content"][0]["text"], "hello");
        assert_eq!(b["stream"], false);
        let parts = start(Box::new(|_| (200, json!({"choices":[{"message":{"content":[{"type":"text","text":"a"},{"type":"text","text":"b"}]}}]}).to_string().into_bytes())));
        assert_eq!(Client::quick(&parts.base).chat("m", "s", "u").unwrap(), "ab");
        let credits = start(Box::new(|_| (200, json!({"code":402,"msg":"no credits"}).to_string().into_bytes())));
        assert!(Client::quick(&credits.base).chat("m", "s", "u").unwrap_err().contains("out of credits"));
        let empty = start(Box::new(|_| (200, json!({"choices":[{"message":{"content":""}}]}).to_string().into_bytes())));
        assert!(Client::quick(&empty.base).chat("m", "s", "u").unwrap_err().contains("nothing"));
        assert!(Client::quick(&f.base).chat("../x", "s", "u").is_err());
    }

    #[test]
    fn a_failed_task_reports_its_message_and_a_stuck_one_times_out() {
        let f = start(Box::new(|h| {
            if h.method == "POST" {
                (200, json!({"code":200,"data":{"taskId":"t2"}}).to_string().into_bytes())
            } else {
                (200, json!({"code":200,"data":{"state":"fail","failMsg":"Internal Error"}}).to_string().into_bytes())
            }
        }));
        assert!(Client::quick(&f.base).run("m", json!({}), &|_| Ok(vec![])).unwrap_err().contains("Internal Error"));
        let g = start(Box::new(|h| {
            if h.method == "POST" {
                (200, json!({"code":200,"data":{"taskId":"t3"}}).to_string().into_bytes())
            } else {
                (200, json!({"code":200,"data":{"state":"generating"}}).to_string().into_bytes())
            }
        }));
        assert!(Client::quick(&g.base).run("m", json!({}), &|_| Ok(vec![])).unwrap_err().contains("took too long"));
    }
}
