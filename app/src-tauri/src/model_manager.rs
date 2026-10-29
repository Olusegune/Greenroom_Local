//! Safe local-model storage and machine profiling. Model manifests remain application-owned:
//! the UI can request an id, but it can never supply an arbitrary download URL or checksum.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::{self, File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use sysinfo::System;
use tauri::{Emitter, Manager};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HardwareInfo {
    pub platform: String,
    pub architecture: String,
    pub memory_gb: u64,
    pub cpu: String,
    pub accelerator: String,
    pub vram_gb: u64,
    pub tier: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelState {
    pub id: String,
    pub state: String,
    pub progress: u8,
    pub version: Option<String>,
    pub path: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub downloaded: u64,
    pub total: u64,
    pub percent: u8,
}

#[derive(Debug, Clone)]
pub struct Artifact {
    pub url: &'static str,
    pub bytes: u64,
    pub sha256: &'static str,
    pub filename: &'static str,
}

#[derive(Debug, Clone)]
pub struct Manifest {
    pub id: &'static str,
    pub version: &'static str,
    pub artifacts: &'static [Artifact],
}

pub fn hardware() -> HardwareInfo {
    let mut system = System::new_all();
    system.refresh_all();
    let memory_gb = (system.total_memory() as f64 / 1_073_741_824.0).round() as u64;
    let cpu = system
        .cpus()
        .first()
        .map(|c| c.brand().trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Unknown CPU".into());
    let platform = if cfg!(target_os = "windows") {
        "windows"
    } else if cfg!(target_os = "macos") {
        "macos"
    } else if cfg!(target_os = "linux") {
        "linux"
    } else {
        "unknown"
    };
    let accelerator = if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "Apple Metal"
    } else {
        "GPU auto-detection pending"
    };
    let tier = if memory_gb >= 24 {
        "studio"
    } else if memory_gb >= 12 {
        "standard"
    } else {
        "compact"
    };
    HardwareInfo {
        platform: platform.into(),
        architecture: std::env::consts::ARCH.into(),
        memory_gb,
        cpu,
        accelerator: accelerator.into(),
        vram_gb: 0,
        tier: tier.into(),
    }
}

pub fn models_root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|_| "Could not find the local application-data folder.".to_string())?
        .join("models"))
}

pub fn states(app: &tauri::AppHandle, ids: &[String]) -> Result<Vec<ModelState>, String> {
    let root = models_root(app)?;
    Ok(ids.iter().map(|id| state(&root, id)).collect())
}

fn state(root: &Path, id: &str) -> ModelState {
    if !valid_id(id) {
        return ModelState {
            id: id.into(),
            state: "error".into(),
            progress: 0,
            version: None,
            path: None,
            error: Some("Invalid model id".into()),
        };
    }
    let dir = root.join(id);
    let active = fs::read_to_string(dir.join("active"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| valid_version(s));
    if let Some(version) = active {
        let version_dir = dir.join(&version);
        if version_dir.join("installed.json").is_file() {
            return ModelState {
                id: id.into(),
                state: "installed".into(),
                progress: 100,
                version: Some(version),
                path: Some(version_dir.to_string_lossy().into()),
                error: None,
            };
        }
    }
    let partial = dir.join("download.part");
    ModelState {
        id: id.into(),
        state: if partial.exists() {
            "queued"
        } else {
            "available"
        }
        .into(),
        progress: 0,
        version: None,
        path: None,
        error: None,
    }
}

pub fn install(app: &tauri::AppHandle, manifest: &Manifest) -> Result<ModelState, String> {
    if !valid_id(manifest.id) || !valid_version(manifest.version) {
        return Err("The model manifest is invalid.".into());
    }
    let root = models_root(app)?;
    let model_dir = root.join(manifest.id);
    let stage = model_dir.join(format!("{}.staging", manifest.version));
    fs::create_dir_all(&stage).map_err(|_| "Could not create the model staging folder.")?;
    for artifact in manifest.artifacts {
        let complete = stage.join(artifact.filename);
        if complete.is_file() && fs::metadata(&complete).map(|m| m.len()).ok() == Some(artifact.bytes) && verify_sha256(&complete, artifact.sha256).is_ok() {
            continue;
        }
        download_artifact(app, manifest.id, artifact, &stage)?;
    }
    let installed = serde_json::json!({"id": manifest.id, "version": manifest.version, "artifacts": manifest.artifacts.len()});
    crate::store::atomic_write(
        &stage.join("installed.json"),
        installed.to_string().as_bytes(),
    )?;
    let target = model_dir.join(manifest.version);
    if target.exists() { return Err("This model version already exists. Its files were not replaced.".into()); }
    fs::rename(&stage, &target).map_err(|_| "Could not activate the downloaded model files.")?;
    crate::store::atomic_write(&model_dir.join("active"), manifest.version.as_bytes())?;
    Ok(state(&root, manifest.id))
}

pub fn import_files(app: &tauri::AppHandle, manifest: &Manifest, source: &Path) -> Result<ModelState, String> {
    if !valid_id(manifest.id) || !valid_version(manifest.version) { return Err("The model manifest is invalid.".into()); }
    for artifact in manifest.artifacts {
        let path = source.join(artifact.filename);
        if fs::metadata(&path).map(|m| m.len()).ok() != Some(artifact.bytes) || verify_sha256(&path, artifact.sha256).is_err() {
            return Err(format!("The downloaded {} is missing or does not match the verified model version.", artifact.filename));
        }
    }
    let root = models_root(app)?;
    let dir = root.join(manifest.id);
    let target = dir.join(manifest.version);
    if target.exists() { return Err("This model version already exists. Its files were not replaced.".into()); }
    let stage = dir.join(format!("{}.staging", manifest.version));
    fs::create_dir_all(&stage).map_err(|_| "Could not create the model staging folder.")?;
    for artifact in manifest.artifacts {
        let destination = stage.join(artifact.filename);
        if destination.exists() && fs::metadata(&destination).map(|m| m.len()).ok() == Some(artifact.bytes) && verify_sha256(&destination, artifact.sha256).is_ok() { continue; }
        let temp = stage.join(format!("{}.importing", artifact.filename));
        fs::copy(source.join(artifact.filename), &temp).map_err(|_| "Could not copy the model files. Check available disk space.")?;
        verify_sha256(&temp, artifact.sha256)?;
        fs::rename(&temp, &destination).map_err(|_| "Could not finish copying the model file.")?;
    }
    let installed = serde_json::json!({"id": manifest.id, "version": manifest.version, "artifacts": manifest.artifacts.len()});
    crate::store::atomic_write(&stage.join("installed.json"), installed.to_string().as_bytes())?;
    fs::rename(&stage, &target).map_err(|_| "Could not activate the downloaded model files.")?;
    crate::store::atomic_write(&dir.join("active"), manifest.version.as_bytes())?;
    Ok(state(&root, manifest.id))
}

/// Wazobia's public release currently provides a model weight, but no pinned, Greenroom-tested
/// inference bundle. Keep the selected weight in the same managed location as other models without
/// ever executing it. This is deliberately separate from `import_files`, which is checksum-pinned.
pub fn import_wazobia_weight(app: &tauri::AppHandle, source: &Path) -> Result<ModelState, String> {
    const ID: &str = "wazobia-voice";
    const VERSION: &str = "v2";
    const FILE: &str = "t3_mtl23ls_v2.safetensors";
    let name = source.file_name().and_then(|x| x.to_str()).unwrap_or("");
    let bytes = fs::metadata(source).map_err(|_| "Greenroom could not read the selected Wazobia file.")?.len();
    if name != FILE || bytes < 50 * 1024 * 1024 || bytes > 15 * 1024 * 1024 * 1024 {
        return Err("Choose the Wazobia file named t3_mtl23ls_v2.safetensors. The selected file was not copied.".into());
    }
    let root = models_root(app)?;
    let model_dir = root.join(ID);
    let target = model_dir.join(VERSION);
    if target.join("installed.json").is_file() { return Ok(state(&root, ID)); }
    let stage = model_dir.join(format!("{VERSION}.staging"));
    fs::create_dir_all(&stage).map_err(|_| "Could not create the Wazobia model folder.")?;
    let temp = stage.join(format!("{FILE}.importing"));
    fs::copy(source, &temp).map_err(|_| "Could not copy the Wazobia model file. Check available disk space.")?;
    fs::rename(&temp, stage.join(FILE)).map_err(|_| "Could not finish adding the Wazobia model file.")?;
    let installed = serde_json::json!({"id": ID, "version": VERSION, "artifacts": 1, "source": "user-selected", "verified": false});
    crate::store::atomic_write(&stage.join("installed.json"), installed.to_string().as_bytes())?;
    fs::rename(&stage, &target).map_err(|_| "Could not activate the Wazobia model file.")?;
    crate::store::atomic_write(&model_dir.join("active"), VERSION.as_bytes())?;
    Ok(state(&root, ID))
}

fn download_artifact(
    app: &tauri::AppHandle,
    id: &str,
    artifact: &Artifact,
    stage: &Path,
) -> Result<(), String> {
    if !crate::net::safe_https(artifact.url)
        || artifact.bytes == 0
        || artifact.bytes > 32 * 1024 * 1024 * 1024
        || artifact.sha256.len() != 64
        || !artifact.sha256.bytes().all(|b| b.is_ascii_hexdigit())
        || !valid_filename(artifact.filename)
    {
        return Err("The model artifact manifest is invalid.".into());
    }
    let part = stage.join(format!("{}.part", artifact.filename));
    let mut have = fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    if have > artifact.bytes {
        fs::remove_file(&part).map_err(|_| "Could not restart the model download.")?;
        have = 0;
    }
    if have == artifact.bytes {
        if verify_sha256(&part, artifact.sha256).is_ok() {
            return fs::rename(&part, stage.join(artifact.filename)).map_err(|_| "Could not finish the verified model artifact.".to_string());
        }
        fs::remove_file(&part).map_err(|_| "Could not restart the damaged model download.")?;
        have = 0;
    }
    let mut request = crate::net::agent().get(artifact.url);
    if have > 0 {
        request = request.set("Range", &format!("bytes={have}-"));
    }
    let response = request
        .call()
        .map_err(|_| "The model download could not be started.".to_string())?;
    if have > 0 && response.status() != 206 {
        fs::remove_file(&part).map_err(|_| "Could not restart the model download.")?;
        return download_artifact(app, id, artifact, stage);
    }
    let mut output = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&part)
        .map_err(|_| "Could not open the model download file.")?;
    let mut reader = response.into_reader();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let count = reader
            .read(&mut buffer)
            .map_err(|_| "The model download was interrupted.")?;
        if count == 0 {
            break;
        }
        have = have.saturating_add(count as u64);
        if have > artifact.bytes {
            return Err("The model download was larger than its signed manifest.".into());
        }
        output
            .write_all(&buffer[..count])
            .map_err(|_| "Could not save the model download.")?;
        let percent = ((have.saturating_mul(100) / artifact.bytes).min(100)) as u8;
        let _ = app.emit(
            "model-download-progress",
            DownloadProgress {
                id: id.into(),
                downloaded: have,
                total: artifact.bytes,
                percent,
            },
        );
    }
    output
        .sync_all()
        .map_err(|_| "Could not finish saving the model download.")?;
    if have != artifact.bytes {
        return Err("The model download ended before it was complete.".into());
    }
    if let Err(e) = verify_sha256(&part, artifact.sha256) {
        let _ = fs::remove_file(&part);
        return Err(e);
    }
    fs::rename(&part, stage.join(artifact.filename))
        .map_err(|_| "Could not finish the verified model artifact.".to_string())
}

fn verify_sha256(path: &Path, wanted: &str) -> Result<(), String> {
    let mut file = File::open(path).map_err(|_| "Could not verify the model download.")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 128 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|_| "Could not verify the model download.")?;
        if count == 0 {
            break;
        }
        hash.update(&buffer[..count]);
    }
    let got = format!("{:x}", hash.finalize());
    if !got.eq_ignore_ascii_case(wanted) {
        return Err(
            "The model download did not match its signed checksum and was not installed.".into(),
        );
    }
    Ok(())
}

fn valid_id(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 80
        && s.bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
}
fn valid_version(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 48
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}
fn valid_filename(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 120
        && !s.starts_with('.')
        && s.bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'-' | b'_'))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn identifiers_cannot_escape_storage() {
        for bad in ["../x", "A", "a/b", "", ".hidden"] {
            assert!(!valid_id(bad), "{bad}");
        }
        assert!(valid_id("qwen3-tts-17b"));
    }
    #[test]
    fn filenames_are_single_safe_components() {
        assert!(valid_filename("model-01.safetensors"));
        for bad in ["../x", "a/b", ".part", ""] {
            assert!(!valid_filename(bad));
        }
    }
    #[test]
    fn checksum_rejects_changed_content() {
        let dir = std::env::temp_dir().join(format!("greenroom-model-test-{}", std::process::id()));
        let _ = fs::create_dir_all(&dir);
        let file = dir.join("x");
        fs::write(&file, b"greenroom").unwrap();
        assert!(verify_sha256(
            &file,
            "92f8b7393e403b5a1d957605b5f7187790e606db77f10d5532d5e7d6d4c319f2"
        )
        .is_err());
        let _ = fs::remove_dir_all(dir);
    }
}
