//! Everything Greenroom keeps on disk, under Documents\Greenroom:
//!   projects\<id>\project.json, takes\<take>.mp3 (never overwritten), exports\*, plus voices.json for the library.
//! Saves are written to a temporary file and renamed, so a crash cannot leave half a project behind.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};

const MAX_PROJECT: usize = 8 << 20;

pub fn valid_id(s: &str) -> bool {
    !s.is_empty() && s.len() <= 48 && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
}

fn bad(what: &str) -> String {
    format!("That {what} is not valid.")
}

pub fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let dir = path.parent().ok_or("Bad path.")?;
    fs::create_dir_all(dir).map_err(|_| "Could not create the Greenroom folder.".to_string())?;
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|_| "Could not write to the Greenroom folder.".to_string())?;
    fs::rename(&tmp, path).map_err(|_| "Could not finish saving.".to_string())
}

pub(crate) fn project_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err(bad("project"));
    }
    Ok(root.join("projects").join(id))
}

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub id: String,
    pub name: String,
    pub updated_at: String,
}

pub fn project_save(root: &Path, id: &str, json: &str) -> Result<(), String> {
    if json.len() > MAX_PROJECT {
        return Err("The project is too large to save.".into());
    }
    serde_json::from_str::<Value>(json).map_err(|_| "The project data was not valid.".to_string())?;
    let dir = project_dir(root, id)?;
    // Keep the state about to be replaced as a version when the newest one is old enough.
    crate::history::auto_before_save(root, id, crate::history::AUTO_VERSION_EVERY, crate::history::now_secs());
    atomic_write(&dir.join("project.json"), json.as_bytes())
}

pub fn project_load(root: &Path, id: &str) -> Result<String, String> {
    fs::read_to_string(project_dir(root, id)?.join("project.json")).map_err(|_| "Could not open that project.".to_string())
}

pub fn project_list(root: &Path) -> Vec<ProjectInfo> {
    let mut out: Vec<ProjectInfo> = fs::read_dir(root.join("projects"))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let id = e.file_name().to_string_lossy().to_string();
            if !valid_id(&id) {
                return None;
            }
            let v: Value = serde_json::from_str(&fs::read_to_string(e.path().join("project.json")).ok()?).ok()?;
            Some(ProjectInfo { id, name: v["name"].as_str().unwrap_or("Untitled").chars().take(80).collect(), updated_at: v["updatedAt"].as_str().unwrap_or("").to_string() })
        })
        .collect();
    out.sort_by(|a, b| b.updated_at.cmp(&a.updated_at).then(a.name.cmp(&b.name)));
    out
}

fn ext_ok(ext: &str) -> bool {
    matches!(ext, "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac")
}

/// Audio file types the owner may bring in (music, effects). The player decodes all of them.
pub const IMPORT_EXTENSIONS: [&str; 6] = ["wav", "mp3", "m4a", "flac", "ogg", "aac"];

#[derive(Serialize, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Imported {
    pub id: String,
    pub ext: String,
    pub name: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Copies an audio file the owner chose into the project as a take that is never overwritten. The original stays where it is.
pub fn import_audio(root: &Path, project: &str, src: &Path, id: &str, max_bytes: u64) -> Result<Imported, String> {
    let ext = src.extension().and_then(|e| e.to_str()).map(|e| e.to_ascii_lowercase()).filter(|e| IMPORT_EXTENSIONS.contains(&e.as_str())).ok_or("That is not an audio type Greenroom can open (WAV, MP3, M4A, FLAC, OGG, AAC).")?;
    let meta = fs::metadata(src).map_err(|_| "That audio file could not be found.".to_string())?;
    if !meta.is_file() {
        return Err("That audio file could not be found.".into());
    }
    if meta.len() > max_bytes {
        return Err(format!("That audio file is larger than {} MB.", max_bytes >> 20));
    }
    let bytes = fs::read(src).map_err(|_| "Could not read that audio file.".to_string())?;
    if bytes.len() < 200 {
        return Err("That audio file is empty or too short.".into());
    }
    take_write(root, project, id, &ext, &bytes)?;
    use sha2::{Digest, Sha256};
    let sha256 = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
    let name = src.file_name().map(|n| n.to_string_lossy().chars().take(120).collect()).unwrap_or_default();
    Ok(Imported { id: id.into(), ext, name, bytes: bytes.len() as u64, sha256 })
}

pub fn take_write(root: &Path, project: &str, take: &str, ext: &str, bytes: &[u8]) -> Result<(), String> {
    if !valid_id(take) || !ext_ok(ext) {
        return Err(bad("take"));
    }
    let path = project_dir(root, project)?.join("takes").join(format!("{take}.{ext}"));
    if path.exists() {
        return Err("That take already exists and is never overwritten.".into());
    }
    atomic_write(&path, bytes)
}

pub fn take_read(root: &Path, project: &str, take: &str) -> Result<Vec<u8>, String> {
    if !valid_id(take) {
        return Err(bad("take"));
    }
    let dir = project_dir(root, project)?.join("takes");
    for ext in ["mp3", "wav", "ogg", "m4a", "flac", "aac"] {
        if let Ok(b) = fs::read(dir.join(format!("{take}.{ext}"))) {
            return Ok(b);
        }
    }
    Err("That take is missing from the project folder.".into())
}

pub fn safe_filename(name: &str) -> Option<String> {
    if name.contains("..") {
        return None;
    }
    let n: String = name.chars().map(|c| if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ') { c } else { '_' }).collect();
    let n = n.trim().trim_matches('.').to_string();
    (!n.is_empty() && n.len() <= 120 && !n.contains("..")).then_some(n)
}

pub fn export_dir(root: &Path, project: &str) -> Result<PathBuf, String> {
    Ok(project_dir(root, project)?.join("exports"))
}

pub fn export_write(root: &Path, project: &str, subfolder: &str, filename: &str, bytes: &[u8]) -> Result<PathBuf, String> {
    let name = safe_filename(filename).ok_or_else(|| bad("file name"))?;
    let sub = if subfolder.is_empty() { None } else { Some(safe_filename(subfolder).ok_or_else(|| bad("folder name"))?) };
    let mut dir = project_dir(root, project)?.join("exports");
    if let Some(s) = sub {
        dir = dir.join(s);
    }
    let path = dir.join(name);
    atomic_write(&path, bytes)?;
    Ok(path)
}

pub fn library_load(root: &Path) -> String {
    fs::read_to_string(root.join("voices.json")).unwrap_or_else(|_| "[]".into())
}

fn sheet_dir(root: &Path) -> PathBuf {
    root.join("accent-sheet")
}

pub fn sheet_load(root: &Path) -> String {
    fs::read_to_string(sheet_dir(root).join("sheet.json")).unwrap_or_else(|_| "{}".into())
}

pub fn sheet_save(root: &Path, json: &str) -> Result<(), String> {
    if json.len() > 4 << 20 || !serde_json::from_str::<Value>(json).map(|v| v.is_object()).unwrap_or(false) {
        return Err("The listening sheet data was not valid.".into());
    }
    atomic_write(&sheet_dir(root).join("sheet.json"), json.as_bytes())
}

/// One sample's audio, kept so it can be heard and rated later. The id is the sample's own, never a path.
pub fn sheet_audio_write(root: &Path, id: &str, bytes: &[u8]) -> Result<(), String> {
    if !valid_id(id) || bytes.is_empty() || bytes.len() > 16 << 20 {
        return Err(bad("sample"));
    }
    atomic_write(&sheet_dir(root).join(format!("{id}.mp3")), bytes)
}

pub fn sheet_audio_read(root: &Path, id: &str) -> Result<Vec<u8>, String> {
    if !valid_id(id) {
        return Err(bad("sample"));
    }
    fs::read(sheet_dir(root).join(format!("{id}.mp3"))).map_err(|_| "That sample is missing from the listening sheet folder.".to_string())
}

/// A report the owner exports from the sheet (Markdown or CSV), saved beside the samples.
pub fn sheet_export(root: &Path, filename: &str, text: &str) -> Result<PathBuf, String> {
    let name = safe_filename(filename).ok_or_else(|| bad("file name"))?;
    if !(name.ends_with(".md") || name.ends_with(".csv")) || text.len() > 1 << 20 {
        return Err(bad("report"));
    }
    let path = sheet_dir(root).join("reports").join(name);
    atomic_write(&path, text.as_bytes())?;
    Ok(path)
}

pub fn casts_load(root: &Path) -> String {
    fs::read_to_string(root.join("casts.json")).unwrap_or_else(|_| "[]".into())
}

pub fn casts_save(root: &Path, json: &str) -> Result<(), String> {
    if json.len() > 2 << 20 || !serde_json::from_str::<Value>(json).map(|v| v.is_array()).unwrap_or(false) {
        return Err("The saved casts were not valid.".into());
    }
    atomic_write(&root.join("casts.json"), json.as_bytes())
}

pub fn library_save(root: &Path, json: &str) -> Result<(), String> {
    if json.len() > 2 << 20 || !serde_json::from_str::<Value>(json).map(|v| v.is_array()).unwrap_or(false) {
        return Err("The voice library data was not valid.".into());
    }
    atomic_write(&root.join("voices.json"), json.as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("greenroom-test-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        p
    }

    #[test]
    fn the_listening_sheet_keeps_data_audio_and_reports_without_trusting_names() {
        let r = std::env::temp_dir().join(format!("greenroom-sheet-{}", std::process::id()));
        let _ = fs::remove_dir_all(&r);
        assert_eq!(sheet_load(&r), "{}");
        sheet_save(&r, r#"{"samples":[]}"#).unwrap();
        assert_eq!(sheet_load(&r), r#"{"samples":[]}"#);
        assert!(sheet_save(&r, "[]").is_err());
        sheet_audio_write(&r, "as-abc1", b"ID3audio").unwrap();
        assert_eq!(sheet_audio_read(&r, "as-abc1").unwrap(), b"ID3audio");
        assert!(sheet_audio_write(&r, "../x", b"a").is_err());
        assert!(sheet_audio_write(&r, "ok", b"").is_err());
        assert!(sheet_audio_read(&r, "a/b").is_err());
        assert!(sheet_audio_read(&r, "nothere").is_err());
        let p = sheet_export(&r, "Accent sheet.csv", "a,b").unwrap();
        assert_eq!(fs::read_to_string(p).unwrap(), "a,b");
        assert!(sheet_export(&r, "evil.exe", "x").is_err());
        assert!(sheet_export(&r, "../evil.md", "x").is_err());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn saved_casts_round_trip_and_refuse_non_lists() {
        let r = std::env::temp_dir().join(format!("greenroom-casts-{}", std::process::id()));
        let _ = fs::remove_dir_all(&r);
        assert_eq!(casts_load(&r), "[]");
        casts_save(&r, r#"[{"id":"c1"}]"#).unwrap();
        assert_eq!(casts_load(&r), r#"[{"id":"c1"}]"#);
        assert!(casts_save(&r, "{}").is_err());
        assert!(casts_save(&r, "nope").is_err());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn project_round_trip_and_listing_newest_first() {
        let r = tmp("proj");
        project_save(&r, "a1", r#"{"name":"Old","updatedAt":"2026-01-01"}"#).unwrap();
        project_save(&r, "b2", r#"{"name":"New","updatedAt":"2026-06-01"}"#).unwrap();
        assert_eq!(project_load(&r, "a1").unwrap(), r#"{"name":"Old","updatedAt":"2026-01-01"}"#);
        let l = project_list(&r);
        assert_eq!(l.iter().map(|p| p.name.as_str()).collect::<Vec<_>>(), ["New", "Old"]);
        assert!(!r.join("projects/a1/project.tmp").exists());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn rejects_bad_ids_bad_json_and_path_tricks() {
        let r = tmp("bad");
        assert!(project_save(&r, "../x", "{}").is_err());
        assert!(project_save(&r, "ok", "not json").is_err());
        assert!(project_load(&r, "a/b").is_err());
        assert!(take_write(&r, "ok", "..", "mp3", b"x").is_err());
        assert!(take_write(&r, "ok", "t1", "exe", b"x").is_err());
        assert!(export_write(&r, "ok", "", "..", b"x").is_err());
        assert!(export_write(&r, "ok", "../..", "a.wav", b"x").is_err());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn takes_are_immutable() {
        let r = tmp("take");
        take_write(&r, "p1", "t1", "mp3", b"first").unwrap();
        assert!(take_write(&r, "p1", "t1", "mp3", b"second").is_err());
        assert_eq!(take_read(&r, "p1", "t1").unwrap(), b"first");
        assert!(take_read(&r, "p1", "nope").is_err());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn imports_an_audio_file_as_an_immutable_take_and_refuses_other_files() {
        let r = tmp("import");
        let src = r.join("Theme Music.MP3");
        fs::create_dir_all(&r).unwrap();
        fs::write(&src, vec![7u8; 5000]).unwrap();
        let info = import_audio(&r, "p1", &src, "m-abc", 1 << 20).unwrap();
        assert_eq!((info.ext.as_str(), info.bytes, info.name.as_str()), ("mp3", 5000, "Theme Music.MP3"));
        assert_eq!(info.sha256.len(), 64);
        assert_eq!(take_read(&r, "p1", "m-abc").unwrap().len(), 5000);
        assert!(import_audio(&r, "p1", &src, "m-abc", 1 << 20).unwrap_err().contains("never overwritten"));
        let exe = r.join("evil.exe");
        fs::write(&exe, vec![1u8; 500]).unwrap();
        assert!(import_audio(&r, "p1", &exe, "m-x", 1 << 20).unwrap_err().contains("not an audio type"));
        assert!(import_audio(&r, "p1", &r.join("missing.wav"), "m-y", 1 << 20).unwrap_err().contains("could not be found"));
        let big = r.join("big.wav");
        fs::write(&big, vec![0u8; 3000]).unwrap();
        assert!(import_audio(&r, "p1", &big, "m-z", 1000).unwrap_err().contains("larger than"));
        let tiny = r.join("tiny.flac");
        fs::write(&tiny, b"abc").unwrap();
        assert!(import_audio(&r, "p1", &tiny, "m-t", 1 << 20).unwrap_err().contains("empty or too short"));
        assert!(import_audio(&r, "p1", &src, "../x", 1 << 20).is_err());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn exports_are_sanitised_and_land_in_the_project() {
        let r = tmp("exp");
        let p = export_write(&r, "p1", "Lines", "Ada: hello/world?.wav", b"RIFF").unwrap();
        assert!(p.starts_with(r.join("projects/p1/exports/Lines")));
        assert_eq!(p.file_name().unwrap().to_string_lossy(), "Ada_ hello_world_.wav");
        assert_eq!(safe_filename("   "), None);
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn library_must_be_an_array_and_defaults_to_empty() {
        let r = tmp("lib");
        assert_eq!(library_load(&r), "[]");
        assert!(library_save(&r, "{}").is_err());
        library_save(&r, r#"[{"id":"v1"}]"#).unwrap();
        assert_eq!(library_load(&r), r#"[{"id":"v1"}]"#);
        let _ = fs::remove_dir_all(&r);
    }
}
