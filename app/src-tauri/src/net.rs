//! Small shared helpers for talking to cloud providers. Nothing here knows about keys.

use serde_json::Value;
use std::io::Read;
use std::time::Duration;

pub const MAX_AUDIO: u64 = 25 << 20;

pub fn agent() -> ureq::Agent {
    ureq::AgentBuilder::new()
        .timeout_connect(Duration::from_secs(10))
        .timeout_write(Duration::from_secs(60))
        .timeout_read(Duration::from_secs(120))
        .redirects(3)
        .build()
}

pub fn read_all(r: ureq::Response, max: u64) -> Result<Vec<u8>, String> {
    let mut v = Vec::new();
    r.into_reader().take(max).read_to_end(&mut v).map_err(|_| "The download was interrupted.".to_string())?;
    Ok(v)
}

pub fn read_json(r: ureq::Response, max: u64) -> Result<Value, String> {
    serde_json::from_slice(&read_all(r, max)?).map_err(|_| "The service sent something unexpected.".to_string())
}

pub fn short(s: &str) -> String {
    s.chars().filter(|c| !c.is_control()).take(180).collect()
}

pub fn http_error(who: &str, code: u16, r: ureq::Response) -> String {
    let body = r.into_string().unwrap_or_default();
    let detail = serde_json::from_str::<Value>(&body)
        .ok()
        .and_then(|v| {
            v["detail"]["message"]
                .as_str()
                .or(v["detail"].as_str())
                .or(v["detail"][0]["msg"].as_str())
                .or(v["msg"].as_str())
                .map(short)
        })
        .unwrap_or_default();
    let base = match code {
        401 | 403 => format!("{who} did not accept the key, or your plan does not include this feature."),
        402 => format!("{who} says the account is out of credit or plan allowance."),
        404 => format!("{who} could not find that voice or model."),
        429 => format!("{who} is busy or rate-limiting. Wait a minute and try again."),
        c => format!("{who} returned an error ({c})."),
    };
    if detail.is_empty() {
        base
    } else {
        format!("{base} {detail}")
    }
}

/// Only plain public https addresses may be downloaded: previews and results come from providers, never from a
/// local address or a numbered host.
pub fn safe_https(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else { return false };
    let host = rest.split(['/', '?', '#']).next().unwrap_or("");
    let host = host.rsplit('@').next().unwrap_or("");
    let name = host.split(':').next().unwrap_or("");
    !name.is_empty()
        && name.contains('.')
        && name != "localhost"
        && !name.ends_with(".local")
        && !name.ends_with(".internal")
        && !name.bytes().all(|b| b.is_ascii_digit() || b == b'.')
        && !host.contains('[')
        && url.len() < 2048
}

pub fn download(url: &str, max: u64) -> Result<Vec<u8>, String> {
    if !safe_https(url) {
        return Err("That address is not allowed.".into());
    }
    match agent().get(url).call() {
        Ok(r) => read_all(r, max),
        Err(_) => Err("Could not download the audio.".into()),
    }
}

pub fn mime_of(b: &[u8]) -> &'static str {
    if b.starts_with(b"RIFF") {
        "audio/wav"
    } else if b.starts_with(b"OggS") {
        "audio/ogg"
    } else {
        "audio/mpeg"
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_public_https_hosts_pass() {
        assert!(safe_https("https://storage.googleapis.com/a/b.mp3"));
        assert!(safe_https("https://static.aiquickdraw.com/x.mp3?y=1"));
        for bad in ["http://a.com/x", "https://localhost/x", "https://127.0.0.1/x", "https://10.0.0.5:8080/x", "https://[::1]/x", "https://printer.local/x", "https://user@evil.internal/x", "https://nodots/x", "file:///c:/x"] {
            assert!(!safe_https(bad), "{bad}");
        }
    }

    #[test]
    fn sniffs_audio_type() {
        assert_eq!(mime_of(b"RIFF....WAVE"), "audio/wav");
        assert_eq!(mime_of(b"OggS"), "audio/ogg");
        assert_eq!(mime_of(b"ID3\x03"), "audio/mpeg");
    }

    #[test]
    fn shortens_and_strips_control_characters() {
        assert_eq!(short("a\nb\tc"), "abc");
        assert_eq!(short(&"x".repeat(500)).len(), 180);
    }
}
