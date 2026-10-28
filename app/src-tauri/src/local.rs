//! Local engines. Nothing here sends text off the computer except to a loopback address the owner chose.
//!
//! Piper (https://github.com/rhasspy/piper, MIT): a fast neural voice engine that runs on the CPU. Greenroom downloads
//! the Windows build once, from a pinned release, and refuses it unless its size and SHA-256 match what was checked on
//! 2026-10-26. Voices come from the public `rhasspy/piper-voices` catalogue and are verified against its MD5 digests.
//! Piper reads plain text only: no emotion or sound tags. Each voice has its own licence, shown in its model card.
//!
//! Local server: any program on this PC that speaks the OpenAI-style `/v1/audio/speech` API (several Kokoro and
//! Chatterbox servers do). Only loopback addresses (127.0.0.1, localhost, ::1) are accepted.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{Cursor, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const PIPER_URL: &str = "https://github.com/rhasspy/piper/releases/download/2023.11.14-2/piper_windows_amd64.zip";
pub const PIPER_SHA256: &str = "f3c58906402b24f3a96d92145f58acba6d86c9b5db896d207f78dc80811efcea";
pub const PIPER_SIZE: usize = 22_477_236;
pub const CATALOG_URL: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json";
pub const VOICES_BASE: &str = "https://huggingface.co/rhasspy/piper-voices/resolve/main/";
const MAX_UNPACKED: u64 = 200 << 20;
const MAX_VOICE_BYTES: u64 = 320 << 20;

pub type Fetch<'a> = &'a dyn Fn(&str, u64) -> Result<Vec<u8>, String>;

pub fn sha256_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

pub fn md5_hex(b: &[u8]) -> String {
    md5::Md5::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn piper_dir(root: &Path) -> PathBuf {
    root.join("engines").join("piper")
}
fn piper_exe(root: &Path) -> PathBuf {
    piper_dir(root).join("piper").join("piper.exe")
}
fn voices_dir(root: &Path) -> PathBuf {
    piper_dir(root).join("voices")
}

pub fn piper_installed(root: &Path) -> bool {
    piper_exe(root).is_file()
}

/// A voice key such as `en_US-lessac-medium`.
pub fn valid_key(k: &str) -> bool {
    !k.is_empty() && k.len() <= 80 && k.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
}

fn valid_rel_path(p: &str) -> bool {
    !p.is_empty() && p.len() <= 200 && !p.contains("..") && !p.starts_with('/') && p.bytes().all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'/' | b'.'))
}

pub fn extract_zip(bytes: &[u8], dest: &Path) -> Result<(), String> {
    let mut zip = zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "The download was not a valid zip file.".to_string())?;
    let mut total = 0u64;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|_| "The zip file is damaged.".to_string())?;
        // `enclosed_name` is None for any path that would escape the destination.
        let Some(rel) = f.enclosed_name() else { return Err("The zip file contains an unsafe path.".into()) };
        let out = dest.join(rel);
        if f.is_dir() {
            fs::create_dir_all(&out).map_err(|_| "Could not create a folder.".to_string())?;
            continue;
        }
        total += f.size();
        if total > MAX_UNPACKED {
            return Err("The zip file is larger than expected.".into());
        }
        if let Some(p) = out.parent() {
            fs::create_dir_all(p).map_err(|_| "Could not create a folder.".to_string())?;
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut data).map_err(|_| "The zip file is damaged.".to_string())?;
        fs::write(&out, data).map_err(|_| "Could not write a file.".to_string())?;
    }
    Ok(())
}

pub fn install_piper(root: &Path, url: &str, size: usize, sha: &str, fetch: Fetch) -> Result<(), String> {
    let bytes = fetch(url, size as u64 + 1024)?;
    if bytes.len() != size || sha256_hex(&bytes) != sha {
        return Err("The Piper download did not match the version Greenroom checked, so it was not installed.".into());
    }
    let tmp = piper_dir(root).join("installing");
    let _ = fs::remove_dir_all(&tmp);
    extract_zip(&bytes, &tmp)?;
    if !tmp.join("piper").join("piper.exe").is_file() {
        let _ = fs::remove_dir_all(&tmp);
        return Err("The Piper download did not contain piper.exe.".into());
    }
    let live = piper_dir(root).join("piper");
    let _ = fs::remove_dir_all(&live);
    fs::rename(tmp.join("piper"), &live).map_err(|_| "Could not finish installing Piper.".to_string())?;
    let _ = fs::remove_dir_all(&tmp);
    Ok(())
}

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PiperVoice {
    pub key: String,
    pub name: String,
    pub code: String,
    pub family: String,
    pub language: String,
    pub country: String,
    pub quality: String,
    pub speakers: u32,
    pub size_mb: f64,
    #[serde(skip)]
    pub onnx: (String, String),
    #[serde(skip)]
    pub json: (String, String),
}

pub fn parse_catalog(v: &Value) -> Vec<PiperVoice> {
    let mut out: Vec<PiperVoice> = Vec::new();
    for (key, e) in v.as_object().into_iter().flatten() {
        if !valid_key(key) {
            continue;
        }
        let (mut onnx, mut cfg, mut size) = (None, None, 0u64);
        for (path, meta) in e["files"].as_object().into_iter().flatten() {
            let md5 = meta["md5_digest"].as_str().unwrap_or("").to_string();
            if !valid_rel_path(path) || md5.len() != 32 {
                continue;
            }
            if path.ends_with(".onnx.json") {
                cfg = Some((path.clone(), md5));
            } else if path.ends_with(".onnx") {
                size = meta["size_bytes"].as_u64().unwrap_or(0);
                onnx = Some((path.clone(), md5));
            }
        }
        let (Some(onnx), Some(json)) = (onnx, cfg) else { continue };
        let l = &e["language"];
        out.push(PiperVoice {
            key: key.clone(),
            name: e["name"].as_str().unwrap_or("").chars().take(40).collect(),
            code: l["code"].as_str().unwrap_or("").chars().take(12).collect(),
            family: l["family"].as_str().unwrap_or("").chars().take(8).collect(),
            language: l["name_english"].as_str().unwrap_or("").chars().take(40).collect(),
            country: l["country_english"].as_str().unwrap_or("").chars().take(40).collect(),
            quality: e["quality"].as_str().unwrap_or("").chars().take(16).collect(),
            speakers: e["num_speakers"].as_u64().unwrap_or(1).min(10_000) as u32,
            size_mb: (size as f64 / 1_048_576.0 * 10.0).round() / 10.0,
            onnx,
            json,
        });
    }
    out.sort_by(|a, b| (&a.language, &a.country, &a.name, &a.quality).cmp(&(&b.language, &b.country, &b.name, &b.quality)));
    out
}

pub fn install_voice(root: &Path, v: &PiperVoice, base: &str, fetch: Fetch) -> Result<(), String> {
    for ((path, md5), cap, name) in [(&v.json, 1 << 20, format!("{}.onnx.json", v.key)), (&v.onnx, MAX_VOICE_BYTES, format!("{}.onnx", v.key))] {
        let bytes = fetch(&format!("{base}{path}"), cap)?;
        if md5_hex(&bytes) != *md5 {
            return Err("A voice file did not match its published checksum, so it was not installed.".into());
        }
        crate::store::atomic_write(&voices_dir(root).join(name), &bytes)?;
    }
    Ok(())
}

pub fn installed_voices(root: &Path) -> Vec<String> {
    let mut out: Vec<String> = fs::read_dir(voices_dir(root))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let n = e.file_name().to_string_lossy().to_string();
            let key = n.strip_suffix(".onnx")?.to_string();
            (valid_key(&key) && voices_dir(root).join(format!("{key}.onnx.json")).is_file()).then_some(key)
        })
        .collect();
    out.sort();
    out
}

pub fn remove_voice(root: &Path, key: &str) -> Result<(), String> {
    if !valid_key(key) {
        return Err("That voice is not valid.".into());
    }
    for ext in ["onnx", "onnx.json"] {
        let _ = fs::remove_file(voices_dir(root).join(format!("{key}.{ext}")));
    }
    Ok(())
}

pub trait Runner: Send + Sync {
    fn run(&self, exe: &Path, cwd: &Path, args: &[String], stdin: &[u8], timeout: Duration) -> Result<(), String>;
}

pub struct RealRunner;

impl Runner for RealRunner {
    fn run(&self, exe: &Path, cwd: &Path, args: &[String], stdin: &[u8], timeout: Duration) -> Result<(), String> {
        let mut cmd = Command::new(exe);
        cmd.args(args).current_dir(cwd).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x0800_0000); // no console window
        }
        let mut child = cmd.spawn().map_err(|_| "Could not start Piper.".to_string())?;
        if let Some(mut s) = child.stdin.take() {
            let _ = s.write_all(stdin);
        }
        let start = Instant::now();
        loop {
            match child.try_wait() {
                Ok(Some(st)) if st.success() => return Ok(()),
                Ok(Some(_)) => return Err("Piper could not make that audio.".into()),
                Ok(None) if start.elapsed() > timeout => {
                    let _ = child.kill();
                    return Err("Piper took too long.".into());
                }
                Ok(None) => std::thread::sleep(Duration::from_millis(40)),
                Err(_) => return Err("Piper stopped unexpectedly.".into()),
            }
        }
    }
}

pub fn piper_args(model: &Path, config: &Path, out: &Path, speed: f64) -> Vec<String> {
    let length = (1.0 / speed.clamp(0.6, 1.6)).clamp(0.6, 1.7);
    vec![
        "--model".into(),
        model.to_string_lossy().into_owned(),
        "--config".into(),
        config.to_string_lossy().into_owned(),
        "--output_file".into(),
        out.to_string_lossy().into_owned(),
        "--length_scale".into(),
        format!("{length:.2}"),
        "--sentence_silence".into(),
        "0.25".into(),
    ]
}

pub fn piper_speak(root: &Path, key: &str, text: &str, speed: f64, runner: &dyn Runner) -> Result<Vec<u8>, String> {
    if !valid_key(key) {
        return Err("Pick a Piper voice first.".into());
    }
    if !piper_installed(root) {
        return Err("Piper is not installed yet. Install it on the Engines page.".into());
    }
    let model = voices_dir(root).join(format!("{key}.onnx"));
    let config = voices_dir(root).join(format!("{key}.onnx.json"));
    if !model.is_file() || !config.is_file() {
        return Err("That Piper voice is not downloaded yet.".into());
    }
    let clean: String = text.chars().map(|c| if c.is_control() { ' ' } else { c }).collect::<String>().split_whitespace().collect::<Vec<_>>().join(" ");
    if clean.is_empty() || clean.chars().count() > 5000 {
        return Err("The text is empty or too long for Piper.".into());
    }
    let tmp = piper_dir(root).join("tmp");
    fs::create_dir_all(&tmp).map_err(|_| "Could not create a working folder.".to_string())?;
    let out = tmp.join(format!("out-{}-{}.wav", std::process::id(), Instant::now().elapsed().as_nanos() ^ clean.len() as u128));
    let args = piper_args(&model, &config, &out, speed);
    let res = runner.run(&piper_exe(root), &piper_dir(root).join("piper"), &args, clean.as_bytes(), Duration::from_secs(90));
    let bytes = res.and_then(|_| fs::read(&out).map_err(|_| "Piper produced no audio.".to_string()));
    let _ = fs::remove_file(&out);
    let bytes = bytes?;
    if !bytes.starts_with(b"RIFF") || bytes.len() < 200 {
        return Err("Piper produced no audio.".into());
    }
    Ok(bytes)
}

// ---- local server -------------------------------------------------------------------------------------------------

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
pub struct ServerCfg {
    pub url: String,
    pub model: String,
}

/// Only this computer. A numbered or named host elsewhere is refused, so text never leaves through this door.
pub fn loopback_url(url: &str) -> Option<String> {
    let u = url.trim().trim_end_matches('/');
    let rest = u.strip_prefix("http://").or_else(|| u.strip_prefix("https://"))?;
    let host_port = rest.split('/').next()?;
    let host = if let Some(h) = host_port.strip_prefix('[') { h.split(']').next()? } else { host_port.split(':').next()? };
    (matches!(host, "127.0.0.1" | "localhost" | "::1") && u.len() < 200 && !u.contains('@')).then(|| u.to_string())
}

pub fn server_speak(cfg: &ServerCfg, text: &str, voice: &str, speed: f64) -> Result<Vec<u8>, String> {
    let base = loopback_url(&cfg.url).ok_or("The local server address must be on this computer (127.0.0.1 or localhost).")?;
    let body = json!({ "model": cfg.model, "input": text, "voice": voice, "response_format": "mp3", "speed": speed.clamp(0.25, 4.0) });
    let res = crate::net::agent().post(&format!("{base}/v1/audio/speech")).set("content-type", "application/json").send_string(&body.to_string());
    match res {
        Ok(r) => crate::net::read_all(r, crate::net::MAX_AUDIO),
        Err(ureq::Error::Status(c, _)) => Err(format!("The local server returned an error ({c}). Check the model and voice names.")),
        Err(ureq::Error::Transport(_)) => Err("Could not reach the local server. Is it running?".into()),
    }
}

pub fn server_voices(cfg: &ServerCfg) -> Result<Vec<String>, String> {
    let base = loopback_url(&cfg.url).ok_or("The local server address must be on this computer (127.0.0.1 or localhost).")?;
    let r = crate::net::agent().get(&format!("{base}/v1/audio/voices")).call().map_err(|_| "Could not read voices from the local server. You can type a voice name instead.".to_string())?;
    let v = crate::net::read_json(r, 1 << 20)?;
    let list = v["voices"].as_array().or(v.as_array()).ok_or("The local server did not list voices.")?;
    Ok(list.iter().filter_map(|x| x.as_str().or(x["id"].as_str()).or(x["name"].as_str())).map(|s| s.chars().take(80).collect::<String>()).take(500).collect())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::eleven::fake::*;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("greenroom-local-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        p
    }

    fn zip_of(files: &[(&str, &[u8])]) -> Vec<u8> {
        let mut w = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (n, b) in files {
            w.start_file(*n, zip::write::SimpleFileOptions::default()).unwrap();
            w.write_all(b).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn hashes_match_known_values() {
        assert_eq!(sha256_hex(b"abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
        assert_eq!(md5_hex(b"abc"), "900150983cd24fb0d6963f7d28e17f72");
    }

    #[test]
    fn installs_piper_only_when_size_and_hash_match() {
        let r = tmp("inst");
        let z = zip_of(&[("piper/piper.exe", b"MZfake"), ("piper/espeak-ng-data/en_dict", b"x")]);
        let sha = sha256_hex(&z);
        install_piper(&r, "u", z.len(), &sha, &|_, _| Ok(z.clone())).unwrap();
        assert!(piper_installed(&r));
        assert!(piper_dir(&r).join("piper/espeak-ng-data/en_dict").is_file());
        assert!(!piper_dir(&r).join("installing").exists());
        let r2 = tmp("inst2");
        assert!(install_piper(&r2, "u", z.len(), "00", &|_, _| Ok(z.clone())).unwrap_err().contains("did not match"));
        assert!(install_piper(&r2, "u", z.len() + 1, &sha, &|_, _| Ok(z.clone())).is_err());
        assert!(!piper_installed(&r2));
        let none = zip_of(&[("other/file.txt", b"x")]);
        assert!(install_piper(&r2, "u", none.len(), &sha256_hex(&none), &|_, _| Ok(none.clone())).unwrap_err().contains("piper.exe"));
        let _ = (fs::remove_dir_all(&r), fs::remove_dir_all(&r2));
    }

    #[test]
    fn a_zip_cannot_write_outside_its_folder() {
        let r = tmp("slip");
        let z = zip_of(&[("../evil.txt", b"x")]);
        assert!(extract_zip(&z, &r.join("dest")).is_err());
        assert!(!r.join("evil.txt").exists());
        let _ = fs::remove_dir_all(&r);
    }

    fn catalog() -> Value {
        json!({
            "en_US-lessac-medium": {"name":"lessac","quality":"medium","num_speakers":1,"language":{"code":"en_US","family":"en","name_english":"English","country_english":"United States"},
                "files":{"en/en_US/lessac/medium/en_US-lessac-medium.onnx":{"size_bytes":63201294,"md5_digest":md5_hex(b"MODEL")},
                         "en/en_US/lessac/medium/en_US-lessac-medium.onnx.json":{"size_bytes":5,"md5_digest":md5_hex(b"CONFIG")},
                         "en/en_US/lessac/medium/MODEL_CARD":{"size_bytes":2,"md5_digest":"00000000000000000000000000000000"}}},
            "bad key!": {"files":{}},
            "evil-x-low": {"name":"x","files":{"../../etc/passwd.onnx":{"size_bytes":1,"md5_digest":md5_hex(b"x")},"a/evil.onnx.json":{"size_bytes":1,"md5_digest":md5_hex(b"x")}}}
        })
    }

    #[test]
    fn reads_the_catalogue_and_drops_unsafe_entries() {
        let c = parse_catalog(&catalog());
        assert_eq!(c.len(), 1);
        assert_eq!((c[0].key.as_str(), c[0].family.as_str(), c[0].country.as_str(), c[0].quality.as_str()), ("en_US-lessac-medium", "en", "United States", "medium"));
        assert_eq!(c[0].size_mb, 60.3);
    }

    #[test]
    fn voices_are_verified_before_they_are_kept() {
        let r = tmp("voice");
        let v = parse_catalog(&catalog()).remove(0);
        install_voice(&r, &v, "https://x/", &|u, _| Ok(if u.ends_with(".onnx.json") { b"CONFIG".to_vec() } else { b"MODEL".to_vec() })).unwrap();
        assert_eq!(installed_voices(&r), ["en_US-lessac-medium"]);
        let r2 = tmp("voice2");
        assert!(install_voice(&r2, &v, "https://x/", &|_, _| Ok(b"TAMPERED".to_vec())).unwrap_err().contains("checksum"));
        assert!(installed_voices(&r2).is_empty());
        remove_voice(&r, "en_US-lessac-medium").unwrap();
        assert!(installed_voices(&r).is_empty());
        assert!(remove_voice(&r, "../x").is_err());
        let _ = (fs::remove_dir_all(&r), fs::remove_dir_all(&r2));
    }

    struct Fake;
    impl Runner for Fake {
        fn run(&self, _e: &Path, _c: &Path, args: &[String], stdin: &[u8], _t: Duration) -> Result<(), String> {
            assert_eq!(String::from_utf8_lossy(stdin), "Hello there friend");
            let out = &args[args.iter().position(|a| a == "--output_file").unwrap() + 1];
            let mut w = b"RIFF".to_vec();
            w.extend(vec![0u8; 400]);
            fs::write(out, w).map_err(|e| e.to_string())
        }
    }

    #[test]
    fn speaks_through_the_runner_with_plain_text_and_the_right_arguments() {
        let r = tmp("speak");
        fs::create_dir_all(piper_dir(&r).join("piper")).unwrap();
        fs::write(piper_exe(&r), b"x").unwrap();
        fs::create_dir_all(voices_dir(&r)).unwrap();
        fs::write(voices_dir(&r).join("en_US-a-low.onnx"), b"m").unwrap();
        fs::write(voices_dir(&r).join("en_US-a-low.onnx.json"), b"c").unwrap();
        let b = piper_speak(&r, "en_US-a-low", "Hello\n  there\tfriend", 1.25, &Fake).unwrap();
        assert!(b.starts_with(b"RIFF"));
        assert!(fs::read_dir(piper_dir(&r).join("tmp")).unwrap().next().is_none(), "temporary audio is cleaned up");
        assert!(piper_speak(&r, "nope", "x", 1.0, &Fake).unwrap_err().contains("not downloaded"));
        assert!(piper_speak(&r, "../x", "x", 1.0, &Fake).is_err());
        let args = piper_args(Path::new("m"), Path::new("c"), Path::new("o"), 1.25);
        assert_eq!(args[args.iter().position(|a| a == "--length_scale").unwrap() + 1], "0.80");
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn only_this_computer_counts_as_a_local_server() {
        for ok in ["http://127.0.0.1:8880", "http://localhost:5000/", "http://[::1]:8000"] {
            assert!(loopback_url(ok).is_some(), "{ok}");
        }
        for bad in ["http://192.168.1.5:8000", "http://example.com", "https://evil.com/localhost", "http://localhost@evil.com", "ftp://localhost", "http://127.0.0.1.evil.com"] {
            assert!(loopback_url(bad).is_none(), "{bad}");
        }
    }

    #[test]
    fn a_local_server_gets_an_openai_style_request_and_lists_voices() {
        let f = start(Box::new(|h| if h.method == "GET" { (200, br#"{"voices":["af_bella","am_adam"]}"#.to_vec()) } else { (200, vec![b'I', b'D', b'3', 0, 1, 2]) }));
        let cfg = ServerCfg { url: f.base.clone(), model: "kokoro".into() };
        let audio = server_speak(&cfg, "Hi", "af_bella", 1.1).unwrap();
        assert!(audio.starts_with(b"ID3"));
        let h = f.hits.lock().unwrap()[0].clone();
        assert_eq!(h.path, "/v1/audio/speech");
        let b: Value = serde_json::from_slice(&h.body).unwrap();
        assert_eq!((b["model"].as_str(), b["voice"].as_str(), b["input"].as_str()), (Some("kokoro"), Some("af_bella"), Some("Hi")));
        assert_eq!(server_voices(&cfg).unwrap(), ["af_bella", "am_adam"]);
        assert!(server_speak(&ServerCfg { url: "http://10.0.0.2:1".into(), model: String::new() }, "x", "v", 1.0).is_err());
    }
}
