//! Versions and backups of a project, so a mistake or a crash never costs a scene.
//!
//! Versions are small copies of `project.json` (the script, directions, timeline and notes) kept in
//! `projects\<id>\versions`. Takes are never overwritten and never deleted, so a version is enough to bring a project
//! back as it was. Backups are whole-project zip files in `backups` (project.json plus every take, each with its
//! SHA-256 in a manifest). Restoring a backup always makes a new project; it never overwrites one.

use crate::store::{self, atomic_write, valid_id};
use serde::Serialize;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const KEEP_VERSIONS: usize = 60;
/// A version is made automatically when saving, if the newest one is older than this.
pub const AUTO_VERSION_EVERY: Duration = Duration::from_secs(10 * 60);
const MAX_ENTRY: u64 = 400 << 20;
const MAX_MANIFEST: u64 = 1 << 20;

pub fn now_secs() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

/// `20261027T153000Z`: sorts in time order, safe in a file name.
pub fn stamp(secs: u64) -> String {
    let days = (secs / 86400) as i64;
    let rem = secs % 86400;
    // Civil date from days since 1970-01-01 (Howard Hinnant's algorithm).
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}{m:02}{d:02}T{:02}{:02}{:02}Z", rem / 3600, rem / 60 % 60, rem % 60)
}

/// `2026-10-27T15:30:00Z` from a stamp, or empty if it is not one.
pub fn iso_of(stamp: &str) -> String {
    let b = stamp.as_bytes();
    if b.len() < 16 || b[8] != b'T' || b[15] != b'Z' || !b[..8].iter().chain(&b[9..15]).all(u8::is_ascii_digit) {
        return String::new();
    }
    format!("{}-{}-{}T{}:{}:{}Z", &stamp[0..4], &stamp[4..6], &stamp[6..8], &stamp[9..11], &stamp[11..13], &stamp[13..15])
}

fn clean_label(l: &str) -> String {
    l.to_ascii_lowercase().chars().map(|c| if c.is_ascii_alphanumeric() { c } else { '-' }).collect::<String>().trim_matches('-').chars().take(20).collect()
}

fn project_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    if !valid_id(id) {
        return Err("That project is not valid.".into());
    }
    Ok(root.join("projects").join(id))
}

fn versions_dir(root: &Path, id: &str) -> Result<PathBuf, String> {
    Ok(project_dir(root, id)?.join("versions"))
}

fn valid_version(id: &str) -> bool {
    !id.is_empty() && id.len() <= 40 && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    pub id: String,
    pub at: String,
    pub label: String,
    pub bytes: u64,
}

pub fn version_list(root: &Path, project: &str) -> Result<Vec<VersionInfo>, String> {
    let dir = versions_dir(root, project)?;
    let mut out: Vec<VersionInfo> = fs::read_dir(&dir)
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let name = e.file_name().to_string_lossy().to_string();
            let id = name.strip_suffix(".json")?.to_string();
            let at = iso_of(&id);
            if !valid_version(&id) || at.is_empty() {
                return None;
            }
            let label = id.get(17..).unwrap_or("").to_string();
            Some(VersionInfo { id, at, label, bytes: e.metadata().map(|m| m.len()).unwrap_or(0) })
        })
        .collect();
    out.sort_by(|a, b| b.id.cmp(&a.id));
    Ok(out)
}

fn prune_versions(root: &Path, project: &str) {
    if let Ok(list) = version_list(root, project) {
        for v in list.into_iter().skip(KEEP_VERSIONS) {
            let _ = fs::remove_file(versions_dir(root, project).unwrap_or_default().join(format!("{}.json", v.id)));
        }
    }
}

/// Keeps the project as it is now. Returns the new version's id, or None when nothing changed since the newest one.
pub fn version_save(root: &Path, project: &str, label: &str, at: u64) -> Result<Option<String>, String> {
    let current = fs::read(project_dir(root, project)?.join("project.json")).map_err(|_| "Could not read the project.".to_string())?;
    copy_version(root, project, &current, label, at)
}

fn copy_version(root: &Path, project: &str, bytes: &[u8], label: &str, at: u64) -> Result<Option<String>, String> {
    let dir = versions_dir(root, project)?;
    if let Some(newest) = version_list(root, project)?.first() {
        if fs::read(dir.join(format!("{}.json", newest.id))).map(|b| b == bytes).unwrap_or(false) {
            return Ok(None);
        }
    }
    // Ids sort in time order, so two versions in the same second move on a second rather than sharing it.
    let taken = |t: u64| version_list(root, project).map(|l| l.iter().any(|v| v.id.starts_with(&stamp(t)))).unwrap_or(false);
    let mut t = at;
    while taken(t) {
        t += 1;
    }
    let l = clean_label(label);
    let id = if l.is_empty() { stamp(t) } else { format!("{}-{l}", stamp(t)) };
    atomic_write(&dir.join(format!("{id}.json")), bytes)?;
    prune_versions(root, project);
    Ok(Some(id))
}

/// Called just before `project.json` is overwritten: keeps the old state if the newest version is old enough.
pub fn auto_before_save(root: &Path, project: &str, every: Duration, at: u64) {
    let Ok(dir) = versions_dir(root, project) else { return };
    let Ok(old) = fs::read(project_dir(root, project).unwrap_or_default().join("project.json")) else { return };
    let newest_age = fs::read_dir(&dir).into_iter().flatten().flatten().filter_map(|e| e.metadata().ok()?.modified().ok()).max().and_then(|m| SystemTime::now().duration_since(m).ok());
    if newest_age.map(|a| a >= every).unwrap_or(true) {
        let _ = copy_version(root, project, &old, "auto", at);
    }
}

pub fn version_load(root: &Path, project: &str, id: &str) -> Result<String, String> {
    if !valid_version(id) {
        return Err("That version is not valid.".into());
    }
    let text = fs::read_to_string(versions_dir(root, project)?.join(format!("{id}.json"))).map_err(|_| "That version is missing.".to_string())?;
    serde_json::from_str::<Value>(&text).map_err(|_| "That version is damaged.".to_string())?;
    Ok(text)
}

// ---- backups ---------------------------------------------------------------------------------------------------------

fn backups_dir(root: &Path) -> PathBuf {
    root.join("backups")
}

#[derive(Serialize, Debug, PartialEq, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackupInfo {
    pub file: String,
    pub project_id: String,
    pub name: String,
    pub at: String,
    pub bytes: u64,
    pub takes: u64,
}

fn sha_hex(b: &[u8]) -> String {
    Sha256::digest(b).iter().map(|x| format!("{x:02x}")).collect()
}

fn stored(name: &str) -> bool {
    matches!(name.rsplit('.').next(), Some("mp3" | "ogg" | "m4a" | "flac" | "aac"))
}

fn take_entry_ok(path: &str) -> bool {
    let Some(rest) = path.strip_prefix("takes/") else { return false };
    let Some((id, ext)) = rest.rsplit_once('.') else { return false };
    valid_id(id) && matches!(ext, "mp3" | "wav" | "ogg" | "m4a" | "flac" | "aac")
}

/// Writes the whole project into one zip in `backups`. Returns the file's path.
pub fn backup_now(root: &Path, project: &str, app_version: &str, at: u64) -> Result<PathBuf, String> {
    let dir = project_dir(root, project)?;
    let pj = fs::read(dir.join("project.json")).map_err(|_| "Could not read the project.".to_string())?;
    let name = serde_json::from_slice::<Value>(&pj).ok().and_then(|v| v["name"].as_str().map(str::to_string)).unwrap_or_default();
    let mut files: Vec<(String, Vec<u8>)> = vec![("project.json".into(), pj)];
    let mut takes: Vec<_> = fs::read_dir(dir.join("takes")).into_iter().flatten().flatten().collect();
    takes.sort_by_key(|e| e.file_name());
    for e in takes {
        let fname = e.file_name().to_string_lossy().to_string();
        let path = format!("takes/{fname}");
        if take_entry_ok(&path) && e.metadata().map(|m| m.is_file() && m.len() <= MAX_ENTRY).unwrap_or(false) {
            if let Ok(b) = fs::read(e.path()) {
                files.push((path, b));
            }
        }
    }
    let manifest = json!({
        "format": 1, "app": format!("Greenroom {app_version}"), "projectId": project, "name": name, "createdAt": iso_of(&stamp(at)),
        "files": files.iter().map(|(p, b)| json!({ "path": p, "bytes": b.len(), "sha256": sha_hex(b) })).collect::<Vec<_>>(),
    });
    fs::create_dir_all(backups_dir(root)).map_err(|_| "Could not create the backups folder.".to_string())?;
    let final_path = backups_dir(root).join(format!("{project}__{}.zip", stamp(at)));
    let part = final_path.with_extension("zip.part");
    let result = (|| -> Result<(), String> {
        let mut w = zip::ZipWriter::new(File::create(&part).map_err(|_| "Could not create the backup file.".to_string())?);
        fn bad<E>(_: E) -> String {
            "Could not write the backup.".to_string()
        }
        w.start_file("manifest.json", zip::write::SimpleFileOptions::default()).map_err(bad)?;
        w.write_all(manifest.to_string().as_bytes()).map_err(bad)?;
        for (p, b) in &files {
            let method = if stored(p) { zip::CompressionMethod::Stored } else { zip::CompressionMethod::Deflated };
            w.start_file(p.as_str(), zip::write::SimpleFileOptions::default().compression_method(method).large_file(b.len() as u64 > (3 << 30))).map_err(bad)?;
            w.write_all(b).map_err(bad)?;
        }
        w.finish().map_err(bad)?;
        Ok(())
    })();
    if let Err(e) = result {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    fs::rename(&part, &final_path).map_err(|_| "Could not finish the backup.".to_string())?;
    Ok(final_path)
}

fn read_manifest(path: &Path) -> Result<Value, String> {
    let mut zip = zip::ZipArchive::new(File::open(path).map_err(|_| "Could not open that backup.".to_string())?).map_err(|_| "That is not a Greenroom backup.".to_string())?;
    let mut f = zip.by_name("manifest.json").map_err(|_| "That is not a Greenroom backup.".to_string())?;
    if f.size() > MAX_MANIFEST {
        return Err("That backup's manifest is too large.".into());
    }
    let mut s = String::new();
    f.read_to_string(&mut s).map_err(|_| "That backup is damaged.".to_string())?;
    let v: Value = serde_json::from_str(&s).map_err(|_| "That backup is damaged.".to_string())?;
    if v["format"] != 1 {
        return Err("That backup was made by a newer Greenroom.".into());
    }
    Ok(v)
}

pub fn backup_list(root: &Path) -> Vec<BackupInfo> {
    let mut out: Vec<BackupInfo> = fs::read_dir(backups_dir(root))
        .into_iter()
        .flatten()
        .flatten()
        .filter_map(|e| {
            let file = e.file_name().to_string_lossy().to_string();
            let base = file.strip_suffix(".zip")?.to_string();
            let (pid, st) = base.rsplit_once("__")?;
            let at = iso_of(st);
            if !valid_id(pid) || at.is_empty() {
                return None;
            }
            let m = read_manifest(&e.path()).ok()?;
            let takes = m["files"].as_array().map(|a| a.iter().filter(|f| f["path"].as_str().map(|p| p.starts_with("takes/")).unwrap_or(false)).count() as u64).unwrap_or(0);
            Some(BackupInfo { file, project_id: pid.to_string(), name: m["name"].as_str().unwrap_or("Untitled").chars().take(80).collect(), at, bytes: e.metadata().map(|x| x.len()).unwrap_or(0), takes })
        })
        .collect();
    out.sort_by(|a, b| b.at.cmp(&a.at));
    out
}

/// Makes a backup if the newest one for this project is older than `every`, and keeps only the newest `keep`.
pub fn backup_auto(root: &Path, project: &str, app_version: &str, at: u64, every: Duration, keep: usize) -> Result<Option<PathBuf>, String> {
    let mine: Vec<BackupInfo> = backup_list(root).into_iter().filter(|b| b.project_id == project).collect();
    let fresh = mine.first().map(|b| {
        let t = b.at.replace(['-', ':'], "");
        let dt = at.saturating_sub(parse_stamp(&t).unwrap_or(0));
        dt < every.as_secs()
    });
    if fresh == Some(true) {
        return Ok(None);
    }
    let made = backup_now(root, project, app_version, at)?;
    let mut all: Vec<BackupInfo> = backup_list(root).into_iter().filter(|b| b.project_id == project).collect();
    all.sort_by(|a, b| b.at.cmp(&a.at));
    for old in all.into_iter().skip(keep) {
        let _ = fs::remove_file(backups_dir(root).join(old.file));
    }
    Ok(Some(made))
}

/// Seconds since 1970 for a stamp like `20261027T153000Z`.
pub fn parse_stamp(s: &str) -> Option<u64> {
    let iso = iso_of(s);
    if iso.is_empty() {
        return None;
    }
    let n = |a: usize, b: usize| s[a..b].parse::<i64>().ok();
    let (y, m, d) = (n(0, 4)?, n(4, 6)?, n(6, 8)?);
    let y2 = if m <= 2 { y - 1 } else { y };
    let era = y2.div_euclid(400);
    let yoe = y2.rem_euclid(400);
    let mp = if m > 2 { m - 3 } else { m + 9 };
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some((days * 86400 + n(9, 11)? * 3600 + n(11, 13)? * 60 + n(13, 15)?) as u64)
}

/// Brings a backup back as a NEW project. Every file is checked against the manifest's size and SHA-256 first.
pub fn backup_restore(root: &Path, file: &str, new_id: &str, now_iso: &str) -> Result<String, String> {
    if !valid_id(new_id) || file.is_empty() || file.len() > 120 || !file.ends_with(".zip") || file.contains(['/', '\\']) || file.contains("..") {
        return Err("That backup is not valid.".into());
    }
    let path = backups_dir(root).join(file);
    let manifest = read_manifest(&path)?;
    let mut zip = zip::ZipArchive::new(File::open(&path).map_err(|_| "Could not open that backup.".to_string())?).map_err(|_| "That is not a Greenroom backup.".to_string())?;
    let dest = project_dir(root, new_id)?;
    if dest.exists() {
        return Err("A project with that id already exists.".into());
    }
    let entries = manifest["files"].as_array().ok_or("That backup is damaged.")?;
    // Check everything before writing anything.
    let mut loaded: Vec<(String, Vec<u8>)> = Vec::new();
    for e in entries {
        let p = e["path"].as_str().ok_or("That backup is damaged.")?;
        if p != "project.json" && !take_entry_ok(p) {
            return Err("That backup contains a file Greenroom does not expect.".into());
        }
        let mut f = zip.by_name(p).map_err(|_| "That backup is missing a file.".to_string())?;
        if f.size() > MAX_ENTRY {
            return Err("That backup contains a file that is too large.".into());
        }
        let mut b = Vec::with_capacity(f.size() as usize);
        f.read_to_end(&mut b).map_err(|_| "That backup is damaged.".to_string())?;
        if b.len() as u64 != e["bytes"].as_u64().unwrap_or(u64::MAX) || sha_hex(&b) != e["sha256"].as_str().unwrap_or("") {
            return Err(format!("{p} does not match the backup's checksum, so nothing was restored."));
        }
        loaded.push((p.to_string(), b));
    }
    let pj = loaded.iter().find(|(p, _)| p == "project.json").ok_or("That backup has no project.")?;
    let mut v: Value = serde_json::from_slice(&pj.1).map_err(|_| "That backup's project is damaged.".to_string())?;
    let old = v["name"].as_str().unwrap_or("Untitled").chars().take(60).collect::<String>();
    v["id"] = json!(new_id);
    v["name"] = json!(format!("{old} (restored)"));
    v["updatedAt"] = json!(now_iso);
    for (p, b) in &loaded {
        if p == "project.json" {
            store::project_save(root, new_id, &v.to_string())?;
        } else {
            atomic_write(&dest.join(p), b)?;
        }
    }
    Ok(new_id.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let p = std::env::temp_dir().join(format!("greenroom-history-{tag}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&p);
        p
    }
    fn project(root: &Path, id: &str, name: &str) {
        store::project_save(root, id, &json!({"version":1,"id":id,"name":name,"updatedAt":"2026-10-27T10:00:00Z"}).to_string()).unwrap();
    }

    #[test]
    fn stamps_round_trip_and_sort_in_time_order() {
        assert_eq!(stamp(0), "19700101T000000Z");
        assert_eq!(stamp(1_793_100_000), "20261027T112000Z");
        for s in [0u64, 86_399, 951_782_400, 1_709_164_800, 1_793_100_000, 4_102_444_800] {
            assert_eq!(parse_stamp(&stamp(s)), Some(s), "{s}");
        }
        assert!(stamp(1_000_000_000) < stamp(1_000_000_001));
        assert_eq!(iso_of("20261027T153005Z"), "2026-10-27T15:30:05Z");
        assert_eq!(iso_of("nonsense"), "");
        assert!(parse_stamp("20261301T000000Z").is_some());
    }

    #[test]
    fn versions_keep_a_label_skip_unchanged_state_and_list_newest_first() {
        let r = tmp("ver");
        project(&r, "p1", "One");
        let a = version_save(&r, "p1", "Before the big edit!", 1_793_100_000).unwrap().unwrap();
        assert_eq!(a, "20261027T112000Z-before-the-big-edit");
        assert_eq!(version_save(&r, "p1", "again", 1_793_100_060).unwrap(), None);
        project(&r, "p1", "Two");
        let b = version_save(&r, "p1", "", 1_793_100_120).unwrap().unwrap();
        let list = version_list(&r, "p1").unwrap();
        assert_eq!(list.iter().map(|v| v.id.clone()).collect::<Vec<_>>(), vec![b.clone(), a.clone()]);
        assert_eq!((list[1].label.as_str(), list[0].label.as_str(), list[0].at.as_str()), ("before-the-big-edit", "", "2026-10-27T11:22:00Z"));
        assert!(version_load(&r, "p1", &a).unwrap().contains("\"One\""));
        assert!(version_load(&r, "p1", "../x").is_err());
        assert!(version_load(&r, "p1", "20260101T000000Z").is_err());
        assert!(version_list(&r, "../x").is_err());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn versions_made_in_the_same_second_still_list_in_the_order_they_were_made() {
        let r = tmp("same-second");
        project(&r, "p1", "One");
        let a = version_save(&r, "p1", "zebra", 1_793_100_000).unwrap().unwrap();
        project(&r, "p1", "Two");
        let b = version_save(&r, "p1", "apple", 1_793_100_000).unwrap().unwrap();
        assert!(b > a, "{a} {b}");
        assert_eq!(version_list(&r, "p1").unwrap()[0].id, b);
        assert_eq!(version_save(&r, "p1", "again", 1_793_100_000).unwrap(), None, "unchanged since the newest");
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn saving_keeps_the_old_state_automatically_but_not_more_often_than_asked() {
        let r = tmp("auto");
        project(&r, "p1", "One");
        auto_before_save(&r, "p1", Duration::from_secs(600), 1_793_100_000);
        assert_eq!(version_list(&r, "p1").unwrap().len(), 1);
        project(&r, "p1", "Two");
        auto_before_save(&r, "p1", Duration::from_secs(600), 1_793_100_010);
        assert_eq!(version_list(&r, "p1").unwrap().len(), 1, "too soon after the last one");
        auto_before_save(&r, "p1", Duration::ZERO, 1_793_100_020);
        assert_eq!(version_list(&r, "p1").unwrap().len(), 2);
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn only_the_newest_versions_are_kept() {
        let r = tmp("prune");
        project(&r, "p1", "x");
        for i in 0..(KEEP_VERSIONS as u64 + 5) {
            fs::write(project_dir(&r, "p1").unwrap().join("project.json"), json!({"name": format!("n{i}")}).to_string()).unwrap();
            version_save(&r, "p1", "", 1_793_100_000 + i).unwrap();
        }
        let l = version_list(&r, "p1").unwrap();
        assert_eq!(l.len(), KEEP_VERSIONS);
        assert_eq!(l[0].id, stamp(1_793_100_000 + KEEP_VERSIONS as u64 + 4));
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn a_backup_restores_as_a_new_project_with_every_take_checked() {
        let r = tmp("bak");
        project(&r, "p1", "Late Delivery");
        store::take_write(&r, "p1", "t1", "mp3", b"ID3-audio-one").unwrap();
        store::take_write(&r, "p1", "t2", "wav", &vec![7u8; 5000]).unwrap();
        let path = backup_now(&r, "p1", "0.14.0", 1_793_100_000).unwrap();
        assert!(path.ends_with("p1__20261027T112000Z.zip"));
        let list = backup_list(&r);
        assert_eq!((list.len(), list[0].name.as_str(), list[0].takes, list[0].project_id.as_str()), (1, "Late Delivery", 2, "p1"));
        let id = backup_restore(&r, &list[0].file, "p-new", "2026-10-27T11:00:00Z").unwrap();
        assert_eq!(id, "p-new");
        assert_eq!(store::take_read(&r, "p-new", "t1").unwrap(), b"ID3-audio-one");
        assert_eq!(store::take_read(&r, "p-new", "t2").unwrap().len(), 5000);
        let v: Value = serde_json::from_str(&store::project_load(&r, "p-new").unwrap()).unwrap();
        assert_eq!((v["id"].as_str(), v["name"].as_str(), v["updatedAt"].as_str()), (Some("p-new"), Some("Late Delivery (restored)"), Some("2026-10-27T11:00:00Z")));
        assert!(store::project_load(&r, "p1").unwrap().contains("Late Delivery\""), "the original is untouched");
        assert!(backup_restore(&r, &list[0].file, "p-new", "x").is_err(), "never overwrites");
        for bad in ["../x.zip", "a/b.zip", "nothere.zip", "p1.txt"] {
            assert!(backup_restore(&r, bad, "p-other", "x").is_err(), "{bad}");
        }
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn a_tampered_or_unexpected_backup_restores_nothing() {
        let r = tmp("tamper");
        project(&r, "p1", "X");
        store::take_write(&r, "p1", "t1", "mp3", b"ID3-audio-one").unwrap();
        let path = backup_now(&r, "p1", "0.14.0", 1_793_100_000).unwrap();
        // Rewrite the zip with one take's bytes changed but the manifest unchanged.
        let mut zin = zip::ZipArchive::new(File::open(&path).unwrap()).unwrap();
        let mut out = zip::ZipWriter::new(File::create(backups_dir(&r).join("p1__20261028T100000Z.zip")).unwrap());
        for i in 0..zin.len() {
            let mut f = zin.by_index(i).unwrap();
            let name = f.name().unwrap().to_string();
            let mut b = Vec::new();
            f.read_to_end(&mut b).unwrap();
            if name == "takes/t1.mp3" {
                b[0] ^= 1;
            }
            out.start_file(name, zip::write::SimpleFileOptions::default()).unwrap();
            out.write_all(&b).unwrap();
        }
        out.finish().unwrap();
        let e = backup_restore(&r, "p1__20261028T100000Z.zip", "p-x", "now").unwrap_err();
        assert!(e.contains("checksum"), "{e}");
        assert!(!r.join("projects").join("p-x").exists());
        // A manifest that points outside the takes folder is refused before anything is written.
        let mut out = zip::ZipWriter::new(File::create(backups_dir(&r).join("p1__20261029T100000Z.zip")).unwrap());
        out.start_file("manifest.json", zip::write::SimpleFileOptions::default()).unwrap();
        out.write_all(json!({"format":1,"name":"x","files":[{"path":"../evil.txt","bytes":1,"sha256":"00"}]}).to_string().as_bytes()).unwrap();
        out.finish().unwrap();
        assert!(backup_restore(&r, "p1__20261029T100000Z.zip", "p-y", "now").unwrap_err().contains("does not expect"));
        assert!(!r.join("projects").join("p-y").exists());
        let _ = fs::remove_dir_all(&r);
    }

    #[test]
    fn automatic_backups_run_once_a_day_and_keep_only_the_newest() {
        let r = tmp("auto-bak");
        project(&r, "p1", "X");
        let day = Duration::from_secs(86_400);
        assert!(backup_auto(&r, "p1", "0.14.0", 1_793_100_000, day, 2).unwrap().is_some());
        assert!(backup_auto(&r, "p1", "0.14.0", 1_793_100_000 + 3600, day, 2).unwrap().is_none(), "made an hour ago");
        assert!(backup_auto(&r, "p1", "0.14.0", 1_793_100_000 + 2 * 86_400, day, 2).unwrap().is_some());
        assert!(backup_auto(&r, "p1", "0.14.0", 1_793_100_000 + 4 * 86_400, day, 2).unwrap().is_some());
        let l = backup_list(&r);
        assert_eq!(l.len(), 2);
        assert_eq!(l[0].at, "2026-10-31T11:20:00Z");
        let _ = fs::remove_dir_all(&r);
    }
}
