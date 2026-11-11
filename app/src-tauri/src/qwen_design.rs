//! Voices designed on this PC with Qwen3-TTS VoiceDesign: free, nothing sent anywhere.
//!
//! A preview is one VoiceDesign line made from the owner's description with its own seed. It is stored as `designed/<id>.wav` with a
//! `designed/<id>.json` (description, seed, the sentence it says, and whether the owner kept it). A kept voice speaks every later line by
//! copying its own preview clip (the Base model, see docs/QWEN_STABILITY.md); until the Base model is installed it is designed again from
//! the same description and seed, which can drift between lines. Ids are `qwen-design-` plus 8 hex digits, checked before any path is built.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const PREFIX: &str = "qwen-design-";

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct Designed {
    pub description: String,
    pub seed: u32,
    /// The sentence the preview says. It is also the reference text when the voice is cloned from the preview.
    pub text: String,
    pub saved: bool,
}

pub fn is_designed_id(id: &str) -> bool {
    id.strip_prefix(PREFIX).is_some_and(|h| h.len() == 8 && h.bytes().all(|b| matches!(b, b'0'..=b'9' | b'a'..=b'f')))
}

pub fn dir(qwen_dir: &Path) -> PathBuf { qwen_dir.join("designed") }
pub fn wav_path(qwen_dir: &Path, id: &str) -> PathBuf { dir(qwen_dir).join(format!("{id}.wav")) }
fn meta_path(qwen_dir: &Path, id: &str) -> PathBuf { dir(qwen_dir).join(format!("{id}.json")) }

pub fn check_inputs(description: &str, text: &str) -> Result<(), String> {
    let d = description.trim().chars().count();
    if !(20..=1000).contains(&d) { return Err("Describe the voice in 20 to 1000 characters.".into()); }
    let t = text.trim().chars().count();
    if !(20..=500).contains(&t) { return Err("The sentence the voice says must be 20 to 500 characters.".into()); }
    Ok(())
}

pub fn load(qwen_dir: &Path, id: &str) -> Option<Designed> {
    if !is_designed_id(id) || !wav_path(qwen_dir, id).is_file() { return None; }
    serde_json::from_slice(&std::fs::read(meta_path(qwen_dir, id)).ok()?).ok()
}

pub fn write(qwen_dir: &Path, id: &str, meta: &Designed, wav: &[u8]) -> Result<(), String> {
    if !is_designed_id(id) { return Err("That voice id is not valid.".into()); }
    std::fs::create_dir_all(dir(qwen_dir)).map_err(|_| "Could not create the folder for designed voices.".to_string())?;
    crate::store::atomic_write(&wav_path(qwen_dir, id), wav)?;
    crate::store::atomic_write(&meta_path(qwen_dir, id), &serde_json::to_vec_pretty(meta).map_err(|e| e.to_string())?)
}

/// The owner kept this preview: it becomes a voice in the library.
pub fn mark_saved(qwen_dir: &Path, id: &str) -> Result<(), String> {
    let mut m = load(qwen_dir, id).ok_or("That designed voice was not found. Make the previews again.")?;
    m.saved = true;
    crate::store::atomic_write(&meta_path(qwen_dir, id), &serde_json::to_vec_pretty(&m).map_err(|e| e.to_string())?)
}

/// Removes the oldest previews nobody kept, so trying many descriptions does not fill the disk. Kept voices are never removed.
pub fn prune_unsaved(qwen_dir: &Path, keep: usize) {
    let Ok(rd) = std::fs::read_dir(dir(qwen_dir)) else { return };
    let mut unsaved: Vec<(std::time::SystemTime, String)> = rd.filter_map(|e| e.ok()).filter_map(|e| {
        let name = e.file_name().to_string_lossy().to_string();
        let id = name.strip_suffix(".json")?.to_string();
        if !is_designed_id(&id) || load(qwen_dir, &id).is_none_or(|m| m.saved) { return None; }
        Some((e.metadata().ok()?.modified().ok()?, id))
    }).collect();
    unsaved.sort();
    let drop = unsaved.len().saturating_sub(keep);
    for (_, id) in unsaved.into_iter().take(drop) {
        let _ = std::fs::remove_file(wav_path(qwen_dir, &id));
        let _ = std::fs::remove_file(meta_path(qwen_dir, &id));
    }
}

/// An id from 32 bits of the clock and the preview number. Collisions are checked by the caller.
pub fn new_id(salt: u32) -> String {
    let n = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.subsec_nanos() ^ (d.as_secs() as u32).rotate_left(11)).unwrap_or(0);
    format!("{PREFIX}{:08x}", n.wrapping_mul(2654435761).wrapping_add(salt.wrapping_mul(40503)))
}

/// Length of a PCM WAV in seconds, from its header; 0 when it cannot be read.
pub fn wav_seconds(wav: &[u8]) -> f64 {
    if wav.len() < 44 { return 0.0; }
    let byte_rate = u32::from_le_bytes([wav[28], wav[29], wav[30], wav[31]]) as f64;
    if byte_rate <= 0.0 { 0.0 } else { (wav.len() - 44) as f64 / byte_rate }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(name: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("gr-qd-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }
    fn meta(saved: bool) -> Designed { Designed { description: "A 500 year old robot with a calm, slow voice".into(), seed: 7, text: "Good evening, I am glad that you could come.".into(), saved } }

    #[test]
    fn only_well_formed_ids_are_designed_voices() {
        assert!(is_designed_id("qwen-design-0a1b2c3d"));
        for bad in ["", "qwen-design-", "qwen-design-0A1B2C3D", "qwen-design-0a1b2c3", "qwen-design-0a1b2c3d4", "qwen-design-../../ab", "qwen-warm-narrator", "../qwen-design-0a1b2c3d"] { assert!(!is_designed_id(bad), "{bad}"); }
        assert!(is_designed_id(&new_id(1)));
        assert_ne!(new_id(1), new_id(2));
    }

    #[test]
    fn a_description_and_sentence_have_to_be_a_sensible_length() {
        assert!(check_inputs("short", "Good evening, I am glad that you could come.").is_err());
        assert!(check_inputs(&"x".repeat(1001), "Good evening, I am glad that you could come.").is_err());
        assert!(check_inputs("A 500 year old robot with a calm, slow voice", "too short").is_err());
        assert!(check_inputs("A 500 year old robot with a calm, slow voice", "Good evening, I am glad that you could come.").is_ok());
    }

    #[test]
    fn a_preview_round_trips_and_a_bad_id_never_touches_the_disk() {
        let d = tmp("rt");
        let id = "qwen-design-0a1b2c3d";
        write(&d, id, &meta(false), b"RIFFdata").unwrap();
        assert_eq!(load(&d, id), Some(meta(false)));
        mark_saved(&d, id).unwrap();
        assert!(load(&d, id).unwrap().saved);
        assert!(write(&d, "../evil", &meta(false), b"x").is_err());
        assert!(load(&d, "../evil").is_none());
        assert!(mark_saved(&d, "qwen-design-ffffffff").is_err());
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn pruning_removes_only_old_unkept_previews() {
        let d = tmp("prune");
        write(&d, "qwen-design-00000001", &meta(true), b"kept").unwrap();
        for i in 2..=6u32 { write(&d, &format!("qwen-design-{i:08x}"), &meta(false), b"w").unwrap(); std::thread::sleep(std::time::Duration::from_millis(15)); }
        prune_unsaved(&d, 2);
        assert!(load(&d, "qwen-design-00000001").is_some(), "a kept voice is never pruned");
        let left: Vec<u32> = (2..=6u32).filter(|i| load(&d, &format!("qwen-design-{i:08x}")).is_some()).collect();
        assert_eq!(left, vec![5, 6], "the two newest previews stay");
        let _ = std::fs::remove_dir_all(&d);
    }

    #[test]
    fn wav_length_comes_from_the_header() {
        let mut w = vec![0u8; 44 + 48000];
        w[28..32].copy_from_slice(&48000u32.to_le_bytes());
        assert!((wav_seconds(&w) - 1.0).abs() < 1e-9);
        assert_eq!(wav_seconds(b"short"), 0.0);
    }
}
