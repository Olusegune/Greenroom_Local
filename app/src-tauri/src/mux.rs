//! Writing a copy of the owner's video with the Greenroom mix as its sound.
//!
//! This uses ffmpeg, a separate program. Greenroom looks for its own copy first (downloaded once from a pinned release
//! and refused unless its size and SHA-256 match what was checked on 2026-10-26), then for one the owner already has on
//! the PATH. The picture is copied, never re-encoded, so it is bit-for-bit the same video; only the sound changes. The
//! original file is never modified: the result is a new file in the project's exports folder.
//!
//! ffmpeg (https://ffmpeg.org) is licensed under the LGPL/GPL. The build used here is the "essentials" build from
//! gyan.dev, fetched from its GitHub releases. Greenroom does not redistribute it.

use std::fs;
use std::io::{Cursor, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

pub const FFMPEG_URL: &str = "https://github.com/GyanD/codexffmpeg/releases/download/9.0.2/ffmpeg-9.0.2-essentials_build.zip";
pub const FFMPEG_SHA256: &str = "60f467265b1e312373dbcd92200c2618a74850f98d3d078e94296bb3fa2047ba";
pub const FFMPEG_SIZE: usize = 114_768_076;
const MAX_EXE: u64 = 250 << 20;

fn dir(root: &Path) -> PathBuf {
    root.join("engines").join("ffmpeg")
}
fn own_exe(root: &Path) -> PathBuf {
    dir(root).join("ffmpeg.exe")
}

#[derive(serde::Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub installed: bool,
    /// "greenroom" for the downloaded copy, "system" for one found on the PATH.
    pub source: Option<String>,
}

/// Finds ffmpeg on the PATH without starting anything.
fn on_path() -> Option<PathBuf> {
    let names: &[&str] = if cfg!(windows) { &["ffmpeg.exe"] } else { &["ffmpeg"] };
    std::env::var_os("PATH").into_iter().flat_map(|p| std::env::split_paths(&p).collect::<Vec<_>>()).find_map(|d| names.iter().map(|n| d.join(n)).find(|f| f.is_file()))
}

pub fn locate(root: &Path) -> Option<(PathBuf, &'static str)> {
    let own = own_exe(root);
    if own.is_file() {
        return Some((own, "greenroom"));
    }
    on_path().map(|p| (p, "system"))
}

pub fn status(root: &Path) -> Status {
    let f = locate(root);
    Status { installed: f.is_some(), source: f.map(|(_, s)| s.to_string()) }
}

pub fn install(root: &Path, url: &str, size: usize, sha: &str, fetch: crate::local::Fetch) -> Result<(), String> {
    let bytes = fetch(url, size as u64 + 1024)?;
    if bytes.len() != size || crate::local::sha256_hex(&bytes) != sha {
        return Err("The ffmpeg download did not match the version Greenroom checked, so it was not installed.".into());
    }
    let mut zip = zip::ZipArchive::new(Cursor::new(&bytes)).map_err(|_| "The download was not a valid zip file.".to_string())?;
    let mut found: Option<Vec<u8>> = None;
    for i in 0..zip.len() {
        let mut f = zip.by_index(i).map_err(|_| "The zip file is damaged.".to_string())?;
        let Some(rel) = f.enclosed_name() else { return Err("The zip file contains an unsafe path.".into()) };
        let is_exe = rel.file_name().map(|n| n == "ffmpeg.exe").unwrap_or(false) && rel.parent().and_then(|p| p.file_name()).map(|n| n == "bin").unwrap_or(false);
        if !is_exe {
            continue;
        }
        if f.size() > MAX_EXE {
            return Err("The ffmpeg file is larger than expected.".into());
        }
        let mut data = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut data).map_err(|_| "The zip file is damaged.".to_string())?;
        found = Some(data);
        break;
    }
    let data = found.ok_or("The ffmpeg download did not contain ffmpeg.exe.")?;
    fs::create_dir_all(dir(root)).map_err(|_| "Could not create the ffmpeg folder.".to_string())?;
    let tmp = dir(root).join("ffmpeg.exe.part");
    fs::write(&tmp, data).map_err(|_| "Could not write ffmpeg.".to_string())?;
    fs::rename(&tmp, own_exe(root)).map_err(|_| "Could not finish installing ffmpeg.".to_string())
}

/// How the new sound is stored, chosen from the video's own container so editors and players accept it.
#[derive(Debug, PartialEq, Clone, Copy)]
pub struct Container {
    pub ext: &'static str,
    pub codec: &'static str,
    pub label: &'static str,
}

pub fn container_for(video_ext: &str) -> Container {
    match video_ext {
        "mp4" | "m4v" => Container { ext: "mp4", codec: "aac", label: "AAC 320 kbps" },
        "mov" => Container { ext: "mov", codec: "pcm_s24le", label: "24-bit PCM" },
        _ => Container { ext: "mkv", codec: "flac", label: "FLAC (lossless)" },
    }
}

pub fn args(video: &Path, audio: &Path, out: &Path, c: Container, keep_original: bool) -> Vec<String> {
    let s = |p: &Path| p.to_string_lossy().into_owned();
    let mut a: Vec<String> = ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i"].iter().map(|x| x.to_string()).collect();
    a.extend([s(video), "-i".into(), s(audio), "-map".into(), "0:v".into(), "-map".into(), "1:a:0".into()]);
    if keep_original {
        a.extend(["-map".into(), "0:a?".into()]);
    }
    a.extend(["-map_metadata".into(), "0".into(), "-c:v".into(), "copy".into(), "-c:a".into(), "copy".into(), "-c:a:0".into(), c.codec.into()]);
    if c.codec == "aac" {
        a.extend(["-b:a:0".into(), "320k".into()]);
    }
    a.extend(["-metadata:s:a:0".into(), "title=Greenroom mix".into(), "-metadata:s:a:0".into(), "handler_name=Greenroom mix".into(), "-disposition:a:0".into(), "default".into()]);
    if c.ext == "mp4" || c.ext == "mov" {
        a.extend(["-movflags".into(), "+faststart".into()]);
    }
    a.push(s(out));
    a
}

pub fn run(exe: &Path, args: &[String], timeout: Duration) -> Result<(), String> {
    let mut cmd = Command::new(exe);
    cmd.args(args).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::piped());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x0800_0000); // no console window
    }
    let mut child = cmd.spawn().map_err(|_| "Could not start ffmpeg.".to_string())?;
    let mut err = child.stderr.take();
    // Read stderr on its own thread so a chatty ffmpeg can never fill the pipe and stall.
    let reader = std::thread::spawn(move || {
        let mut s = String::new();
        if let Some(e) = err.as_mut() {
            let _ = e.read_to_string(&mut s);
        }
        s
    });
    let start = Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(st)) => break st,
            Ok(None) if start.elapsed() > timeout => {
                let _ = child.kill();
                return Err("ffmpeg took too long, so it was stopped.".into());
            }
            Ok(None) => std::thread::sleep(Duration::from_millis(50)),
            Err(_) => return Err("ffmpeg stopped unexpectedly.".into()),
        }
    };
    let text = reader.join().unwrap_or_default();
    if status.success() {
        return Ok(());
    }
    let tail: String = text.trim().chars().rev().take(400).collect::<Vec<_>>().into_iter().rev().collect();
    Err(format!("ffmpeg could not write the video. {}", tail.trim()).trim().to_string())
}

/// Writes `<video name> with Greenroom mix.<ext>` into `out_dir` and returns its path.
pub fn mux(root: &Path, video: &Path, audio: &Path, out_dir: &Path, keep_original: bool, timeout: Duration) -> Result<(PathBuf, Container), String> {
    let (exe, _) = locate(root).ok_or("ffmpeg is not installed yet.")?;
    let ext = crate::video::ext_of(video).ok_or("That is not a video file Greenroom can use.")?;
    if !video.is_absolute() || !video.is_file() {
        return Err("The video file could not be found. Move it back or choose it again on the Picture screen.".into());
    }
    if !audio.is_file() {
        return Err("The mix file could not be found.".into());
    }
    let c = container_for(&ext);
    let stem = video.file_stem().and_then(|s| s.to_str()).unwrap_or("video");
    let name = crate::store::safe_filename(&format!("{stem} with Greenroom mix.{}", c.ext)).ok_or("The video name could not be used.")?;
    fs::create_dir_all(out_dir).map_err(|_| "Could not create the exports folder.".to_string())?;
    let out = out_dir.join(name);
    if out == video {
        return Err("The new video would overwrite the original.".into());
    }
    // Write beside the final name first, so a failed or stopped run never leaves a half-written file under the real name.
    let part = out.with_extension(format!("{}.part", c.ext));
    let mut a = args(video, audio, &part, c, keep_original);
    a.splice(a.len() - 1..a.len() - 1, ["-f".to_string(), if c.ext == "mkv" { "matroska".into() } else { c.ext.to_string() }]);
    let r = run(&exe, &a, timeout);
    if let Err(e) = r {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    fs::rename(&part, &out).map_err(|_| "Could not save the finished video.".to_string())?;
    Ok((out, c))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("greenroom-mux-{tag}-{}", std::process::id()));
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
    fn picks_a_container_the_video_player_or_editor_accepts() {
        assert_eq!(container_for("mp4").codec, "aac");
        assert_eq!(container_for("m4v").ext, "mp4");
        assert_eq!((container_for("mov").ext, container_for("mov").codec), ("mov", "pcm_s24le"));
        assert_eq!((container_for("webm").ext, container_for("avi").codec), ("mkv", "flac"));
    }

    #[test]
    fn copies_the_picture_and_puts_the_mix_first() {
        let c = container_for("mp4");
        let a = args(Path::new("C:/v/a.mp4"), Path::new("C:/m/mix.wav"), Path::new("C:/o/out.mp4"), c, false);
        let joined = a.join(" ");
        assert!(joined.contains("-i C:/v/a.mp4 -i C:/m/mix.wav -map 0:v -map 1:a:0"));
        assert!(joined.contains("-c:v copy"));
        assert!(joined.contains("-c:a:0 aac -b:a:0 320k"));
        assert!(!joined.contains("0:a?"));
        assert_eq!(a.last().unwrap(), "C:/o/out.mp4");
        let keep = args(Path::new("a.mov"), Path::new("m.wav"), Path::new("o.mov"), container_for("mov"), true).join(" ");
        assert!(keep.contains("-map 0:a?"));
        assert!(keep.contains("-c:a:0 pcm_s24le"));
        assert!(!keep.contains("-b:a:0"));
    }

    #[test]
    fn installs_only_the_matching_download_and_only_ffmpeg_exe() {
        let r = tmp("inst");
        let z = zip_of(&[("ffmpeg-9/bin/ffmpeg.exe", b"MZfake"), ("ffmpeg-9/bin/ffplay.exe", b"other"), ("ffmpeg-9/LICENSE", b"x")]);
        let sha = crate::local::sha256_hex(&z);
        install(&r, "u", z.len(), &sha, &|_, _| Ok(z.clone())).unwrap();
        assert_eq!(fs::read(own_exe(&r)).unwrap(), b"MZfake");
        assert!(!dir(&r).join("ffplay.exe").exists());
        assert_eq!(status(&r), Status { installed: true, source: Some("greenroom".into()) });
        let r2 = tmp("inst2");
        assert!(install(&r2, "u", z.len(), "00", &|_, _| Ok(z.clone())).unwrap_err().contains("did not match"));
        let none = zip_of(&[("x/readme.txt", b"x")]);
        assert!(install(&r2, "u", none.len(), &crate::local::sha256_hex(&none), &|_, _| Ok(none.clone())).unwrap_err().contains("ffmpeg.exe"));
        assert!(!own_exe(&r2).exists());
        let _ = (fs::remove_dir_all(&r), fs::remove_dir_all(&r2));
    }

    #[test]
    fn refuses_a_missing_video_or_an_overwrite_before_running_anything() {
        let r = tmp("refuse");
        fs::create_dir_all(dir(&r)).unwrap();
        fs::write(own_exe(&r), b"not a real exe").unwrap();
        let e = mux(&r, &r.join("none.mp4"), &r.join("m.wav"), &r.join("out"), false, Duration::from_secs(1)).unwrap_err();
        assert!(e.contains("could not be found"));
        let txt = r.join("clip.txt");
        fs::write(&txt, b"x").unwrap();
        assert!(mux(&r, &txt, &r.join("m.wav"), &r.join("out"), false, Duration::from_secs(1)).unwrap_err().contains("not a video"));
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn a_failed_run_leaves_no_partial_file() {
        let r = tmp("fail");
        fs::create_dir_all(dir(&r)).unwrap();
        fs::write(own_exe(&r), b"not a real exe").unwrap();
        let v = r.join("a.mp4");
        let w = r.join("m.wav");
        fs::write(&v, b"x").unwrap();
        fs::write(&w, b"x").unwrap();
        assert!(mux(&r, &v, &w, &r.join("out"), false, Duration::from_secs(5)).is_err());
        let left: Vec<_> = fs::read_dir(r.join("out")).map(|d| d.flatten().collect()).unwrap_or_default();
        assert!(left.is_empty());
        let _ = fs::remove_dir_all(&r);
    }

    /// Runs the real ffmpeg when one is installed on this machine; skipped otherwise.
    #[test]
    fn writes_a_real_video_with_the_new_sound_and_keeps_the_picture() {
        let Some(exe) = on_path() else { return };
        let r = tmp("real");
        fs::create_dir_all(&r).unwrap();
        let go = |a: &[&str]| {
            let args: Vec<String> = a.iter().map(|x| x.to_string()).collect();
            run(&exe, &args, Duration::from_secs(60)).unwrap();
        };
        let src = |ext: &str| r.join(format!("in.{ext}"));
        let wav = r.join("mix.wav");
        go(&["-y", "-f", "lavfi", "-i", "testsrc=size=160x90:rate=24000/1001:duration=2", "-f", "lavfi", "-i", "sine=frequency=300:duration=2", "-c:v", "libx264", "-c:a", "aac", "-shortest", src("mp4").to_str().unwrap()]);
        go(&["-y", "-f", "lavfi", "-i", "sine=frequency=1000:duration=2", "-ar", "48000", wav.to_str().unwrap()]);
        let (out, c) = mux(&r, &src("mp4"), &wav, &r.join("out"), true, Duration::from_secs(60)).unwrap();
        assert_eq!(c.codec, "aac");
        assert!(out.is_file() && !out.with_extension("mp4.part").exists());
        let info = crate::video::probe(&out).unwrap();
        assert_eq!((info.fps_num, info.fps_den), (24000, 1001));
        let kept = out.parent().unwrap().join("check.txt");
        // Two audio tracks: the new mix first, the original second.
        let probe = Command::new(exe.with_file_name("ffprobe.exe")).args(["-v", "error", "-show_entries", "stream=codec_type:stream_tags=handler_name", "-of", "csv=p=0"]).arg(&out).output();
        if let Ok(o) = probe {
            let t = String::from_utf8_lossy(&o.stdout).to_string();
            fs::write(&kept, &t).unwrap();
            assert_eq!(t.matches("audio").count(), 2, "{t}");
            assert!(t.contains("Greenroom mix"), "{t}");
        }
        let _ = fs::remove_dir_all(&r);
    }

    /// Downloads the real pinned build (about 115 MB) and runs it. Run with `cargo test -- --ignored`.
    #[test]
    #[ignore]
    fn the_pinned_download_installs_and_runs() {
        let r = tmp("pinned");
        install(&r, FFMPEG_URL, FFMPEG_SIZE, FFMPEG_SHA256, &|u, m| crate::net::download(u, m)).unwrap();
        let out = Command::new(own_exe(&r)).arg("-version").output().unwrap();
        assert!(String::from_utf8_lossy(&out.stdout).contains("ffmpeg version 9.0.2"));
        let _ = fs::remove_dir_all(&r);
    }
}
