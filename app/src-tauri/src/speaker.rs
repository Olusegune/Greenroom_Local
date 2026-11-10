//! Speaker similarity for takes. A small speaker encoder (Resemblyzer) turns each take into a vector; takes of one speaker sit close
//! together. Greenroom uses it to flag a take that does not sound like the rest of a character's takes (for example a Qwen3-TTS voice
//! that drifted). It measures similarity of voices only: it says nothing about acting quality or about anyone's age, gender or ethnicity.

use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub const CHECK: &str = "from resemblyzer import VoiceEncoder, preprocess_wav; import torch";
pub const MAX_TAKES: usize = 200;

/// The managed Python that can run the encoder, in order of preference: a dedicated one, then the Kokoro or Qwen runtime if it has it.
pub fn find_python(root: &Path) -> Option<PathBuf> {
    ["speaker-managed", "kokoro-managed", "qwen-managed"].iter().map(|n| root.join("runtime").join(n).join("python.exe")).find(|p| p.is_file() && crate::command_ok(p, &["-c", CHECK]))
}

/// Runs the encoder on audio files. Returns one vector (256 numbers) per file, or None for a file that could not be read.
pub fn embed(python: &Path, files: &[PathBuf]) -> Result<Vec<Option<Vec<f32>>>, String> {
    use std::io::Write;
    if files.is_empty() {
        return Ok(vec![]);
    }
    if files.len() > MAX_TAKES {
        return Err(format!("At most {MAX_TAKES} takes can be compared at once."));
    }
    let request = serde_json::json!({ "paths": files.iter().map(|p| p.to_string_lossy()).collect::<Vec<_>>() });
    let mut cmd = Command::new(python);
    cmd.args(["-c", include_str!("../../../runtime/speaker_embed.py")]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000);
    }
    let mut child = cmd.spawn().map_err(|_| "Could not start the speaker-similarity tool.".to_string())?;
    child.stdin.take().ok_or("Could not talk to the speaker-similarity tool.")?.write_all(request.to_string().as_bytes()).map_err(|_| "Could not talk to the speaker-similarity tool.")?;
    let out = child.wait_with_output().map_err(|_| "The speaker-similarity tool stopped unexpectedly.")?;
    if !out.status.success() {
        return Err("The speaker-similarity tool could not run. Check that it is installed in Model Center.".into());
    }
    parse(&out.stdout, files.len())
}

fn parse(stdout: &[u8], expected: usize) -> Result<Vec<Option<Vec<f32>>>, String> {
    let v: serde_json::Value = serde_json::from_slice(stdout).map_err(|_| "The speaker-similarity tool sent something unreadable.".to_string())?;
    let list = v["embeddings"].as_array().ok_or("The speaker-similarity tool sent no results.")?;
    if list.len() != expected {
        return Err("The speaker-similarity tool answered for the wrong number of takes.".into());
    }
    list.iter()
        .map(|e| match e {
            serde_json::Value::Null => Ok(None),
            serde_json::Value::Array(a) if a.len() == 256 && a.iter().all(|x| x.is_number()) => Ok(Some(a.iter().map(|x| x.as_f64().unwrap_or(0.0) as f32).collect())),
            _ => Err("The speaker-similarity tool sent a malformed result.".to_string()),
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_good_results_and_refuses_malformed_ones() {
        let good = serde_json::json!({"embeddings": [vec![0.1f64; 256], null], "failed": [1]}).to_string();
        let r = parse(good.as_bytes(), 2).unwrap();
        assert_eq!(r[0].as_ref().unwrap().len(), 256);
        assert!(r[1].is_none());
        assert!(parse(good.as_bytes(), 3).is_err(), "wrong count");
        assert!(parse(br#"{"embeddings":[[1,2,3]]}"#, 1).is_err(), "wrong length");
        assert!(parse(br#"{"embeddings":["x"]}"#, 1).is_err());
        assert!(parse(b"not json", 1).is_err());
        assert!(parse(br#"{}"#, 0).is_err());
    }

    #[test]
    fn nothing_to_embed_is_empty_and_too_many_is_refused() {
        assert_eq!(embed(Path::new("nope"), &[]).unwrap(), vec![]);
        let many: Vec<PathBuf> = (0..MAX_TAKES + 1).map(|i| PathBuf::from(format!("{i}.wav"))).collect();
        assert!(embed(Path::new("nope"), &many).unwrap_err().contains("At most"));
    }
}
