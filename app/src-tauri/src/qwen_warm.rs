//! A warm Qwen3-TTS worker. The model takes tens of seconds to load, so the old route (a new process for every line) paid that on
//! every line. This keeps one `runtime/qwen_server.py` process alive, sends it one JSON line per request and reads one framed WAV
//! back. The worker exits by itself after 15 minutes idle and when the app closes (its stdin closes), so it never holds several GB
//! of memory for nothing, and `stop()` frees it on demand.

use std::io::{BufRead, BufReader, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::mpsc::{channel, Receiver};
use std::sync::Mutex;
use std::time::Duration;

/// One finished line of speech.
#[derive(Debug, PartialEq)]
pub struct Spoken {
    pub wav: Vec<u8>,
    /// "cuda:0" or "cpu".
    pub device: String,
    pub seconds: f32,
}

#[derive(Debug, PartialEq)]
enum Reply {
    Ok(Spoken),
    /// The worker answered with an error for this request and is still serving.
    Err(String),
}

const MAX_WAV: usize = 64 << 20;

/// Reads one reply: `OK <bytes> <device> <seconds>\n<bytes>` or `ERR <message>\n`. An `Err` from here means the stream is broken.
fn read_reply<R: BufRead>(r: &mut R) -> Result<Reply, String> {
    let mut header = String::new();
    if r.read_line(&mut header).map_err(|e| e.to_string())? == 0 {
        return Err("the Qwen3-TTS worker closed".into());
    }
    let header = header.trim_end();
    if let Some(msg) = header.strip_prefix("ERR ") {
        return Ok(Reply::Err(msg.to_string()));
    }
    let mut parts = header.strip_prefix("OK ").ok_or("the Qwen3-TTS worker sent something unexpected")?.split(' ');
    let n: usize = parts.next().and_then(|x| x.parse().ok()).ok_or("the Qwen3-TTS worker sent a bad length")?;
    if n == 0 || n > MAX_WAV {
        return Err("the Qwen3-TTS worker sent an impossible length".into());
    }
    let device = parts.next().unwrap_or("cpu").to_string();
    let seconds = parts.next().and_then(|x| x.parse().ok()).unwrap_or(0.0);
    let mut wav = vec![0u8; n];
    r.read_exact(&mut wav).map_err(|e| e.to_string())?;
    if !wav.starts_with(b"RIFF") {
        return Err("the Qwen3-TTS worker sent audio that is not a WAV".into());
    }
    Ok(Reply::Ok(Spoken { wav, device, seconds }))
}

struct Warm {
    child: Child,
    stdin: ChildStdin,
    rx: Receiver<Result<Reply, String>>,
}

static SERVER: Mutex<Option<Warm>> = Mutex::new(None);

fn spawn(python: &Path, script: &str, hf_home: &Path, log: &Path) -> Result<Warm, String> {
    if let Some(dir) = log.parent() {
        let _ = std::fs::create_dir_all(dir);
    }
    let stderr = std::fs::OpenOptions::new().create(true).append(true).open(log).map(Stdio::from).unwrap_or_else(|_| Stdio::null());
    let mut cmd = Command::new(python);
    cmd.args(["-u", "-c", script]).env("HF_HOME", hf_home).env("HF_HUB_OFFLINE", "1").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(stderr);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn().map_err(|_| "Could not start the Qwen3-TTS worker.".to_string())?;
    let stdin = child.stdin.take().ok_or("Could not talk to the Qwen3-TTS worker.")?;
    let stdout = child.stdout.take().ok_or("Could not hear from the Qwen3-TTS worker.")?;
    let (tx, rx) = channel();
    std::thread::spawn(move || {
        let mut r = BufReader::new(stdout);
        loop {
            let got = read_reply(&mut r);
            let fatal = got.is_err();
            if tx.send(got).is_err() || fatal {
                break;
            }
        }
    });
    Ok(Warm { child, stdin, rx })
}

/// Speaks one line on the warm worker, starting it if it is not running. `request` is the JSON for the worker.
pub fn speak(python: &Path, script: &str, hf_home: &Path, log: &Path, request: &serde_json::Value, timeout: Duration) -> Result<Spoken, String> {
    let mut guard = SERVER.lock().map_err(|_| "Qwen3-TTS is unavailable. Restart Greenroom and try again.".to_string())?;
    // A worker that exited (idle, crashed, killed) is replaced.
    if let Some(w) = guard.as_mut() {
        if matches!(w.child.try_wait(), Ok(Some(_)) | Err(_)) {
            *guard = None;
        }
    }
    if guard.is_none() {
        *guard = Some(spawn(python, script, hf_home, log)?);
    }
    let w = guard.as_mut().expect("just started");
    let line = format!("{}\n", request);
    let sent = w.stdin.write_all(line.as_bytes()).and_then(|_| w.stdin.flush());
    if sent.is_err() {
        kill(&mut guard);
        return Err("The Qwen3-TTS worker stopped. Try again.".into());
    }
    match w.rx.recv_timeout(timeout) {
        Ok(Ok(Reply::Ok(s))) => Ok(s),
        Ok(Ok(Reply::Err(m))) => Err(m),
        Ok(Err(m)) => {
            kill(&mut guard);
            Err(m)
        }
        Err(_) => {
            // No answer in time: a stalled worker would block every later line, so it is stopped and the next line starts a fresh one.
            kill(&mut guard);
            Err("Qwen3-TTS did not answer in time and was stopped. Try the line again.".into())
        }
    }
}

fn kill(guard: &mut Option<Warm>) {
    if let Some(mut w) = guard.take() {
        let _ = w.child.kill();
        let _ = w.child.wait();
    }
}

/// Stops the worker and frees its memory. The next line starts a new one.
pub fn stop() -> bool {
    match SERVER.lock() {
        Ok(mut g) => {
            let was = g.is_some();
            kill(&mut g);
            was
        }
        Err(_) => false,
    }
}

pub fn running() -> bool {
    SERVER.lock().map(|mut g| g.as_mut().map(|w| matches!(w.child.try_wait(), Ok(None))).unwrap_or(false)).unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    fn frame(header: &str, body: &[u8]) -> Vec<u8> {
        let mut v = header.as_bytes().to_vec();
        v.push(b'\n');
        v.extend_from_slice(body);
        v
    }

    #[test]
    fn reads_an_ok_frame_and_then_the_next_one_on_the_same_stream() {
        let wav = b"RIFFxxxxWAVE-data-1".to_vec();
        let mut bytes = frame(&format!("OK {} cuda:0 1.5", wav.len()), &wav);
        bytes.extend(frame("ERR the model returned no audio", b""));
        let mut r = BufReader::new(Cursor::new(bytes));
        assert_eq!(read_reply(&mut r).unwrap(), Reply::Ok(Spoken { wav, device: "cuda:0".into(), seconds: 1.5 }));
        assert_eq!(read_reply(&mut r).unwrap(), Reply::Err("the model returned no audio".into()));
        assert!(read_reply(&mut r).is_err(), "end of stream is fatal");
    }

    #[test]
    fn refuses_a_broken_stream_instead_of_guessing() {
        for bad in [frame("HELLO", b""), frame("OK abc cpu 1", b"RIFF"), frame("OK 0 cpu 1", b""), frame(&format!("OK {} cpu 1", MAX_WAV + 1), b""), frame("OK 8 cpu 1", b"NOTAWAVE"), frame("OK 100 cpu 1", b"RIFFshort")] {
            let mut r = BufReader::new(Cursor::new(bad));
            assert!(read_reply(&mut r).is_err());
        }
    }

    #[test]
    fn stopping_with_nothing_running_is_harmless() {
        assert!(!running() || stop());
        let _ = stop();
        assert!(!running());
    }
}
