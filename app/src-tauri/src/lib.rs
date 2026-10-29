//! Greenroom backend. Keys live only in the Windows Credential Manager and are never returned to the UI.
//! Every paid call is a command the UI makes only after the owner confirms the cost sheet.

mod eleven;
mod kie;
mod history;
mod local;
mod model_manager;
mod mux;
mod net;
mod store;
mod video;
mod voicekiller;

use base64::Engine;
use eleven::VoiceInfo;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Instant;
use tauri::Manager;

const SERVICE: &str = "Greenroom Local";

fn entry(name: &str) -> Result<keyring::Entry, String> {
    if !matches!(name, "elevenlabs" | "kie" | "voicekiller" | "voicekiller-userid" | "huggingface") {
        return Err("Unknown provider.".into());
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| format!("Could not reach the system credential store: {e}"))
}

fn get_key(name: &str) -> Result<String, String> {
    let who = match name {
        "kie" => "Kie",
        "voicekiller" | "voicekiller-userid" => "VoiceKiller",
        _ => "ElevenLabs",
    };
    match entry(name)?.get_password() {
        Ok(k) if !k.trim().is_empty() => Ok(k.trim().to_string()),
        Ok(_) | Err(keyring::Error::NoEntry) => Err(format!("Add your {who} key in Settings first.")),
        Err(e) => Err(format!("Could not read the system credential store: {e}")),
    }
}

fn eleven() -> Result<eleven::Client, String> {
    Ok(eleven::Client::new(eleven::BASE, &get_key("elevenlabs")?))
}

fn voicekiller_client() -> Result<voicekiller::Client, String> {
    Ok(voicekiller::Client::new(voicekiller::BASE, &get_key("voicekiller")?, &get_key("voicekiller-userid")?))
}

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().document_dir().map_err(|_| "Could not find your Documents folder.".to_string())?.join("Greenroom Local"))
}

fn b64(bytes: &[u8]) -> String {
    base64::engine::general_purpose::STANDARD.encode(bytes)
}

fn unb64(s: &str) -> Result<Vec<u8>, String> {
    base64::engine::general_purpose::STANDARD.decode(s).map_err(|_| "The audio data was not valid.".to_string())
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|_| "The request was interrupted.".to_string())?
}

// ---- keys -----------------------------------------------------------------------------------------------------

#[derive(Serialize)]
struct KeyStatus {
    elevenlabs: bool,
    kie: bool,
    voicekiller: bool,
    huggingface: bool,
}

#[tauri::command]
fn key_status() -> KeyStatus {
    let has = |n: &str| entry(n).ok().and_then(|e| e.get_password().ok()).map(|k| !k.trim().is_empty()).unwrap_or(false);
    KeyStatus { elevenlabs: has("elevenlabs"), kie: has("kie"), voicekiller: has("voicekiller") && has("voicekiller-userid"), huggingface: has("huggingface") }
}

#[tauri::command]
async fn huggingface_check() -> Result<String, String> {
    blocking(move || {
        let token = get_key("huggingface")?;
        let result = net::agent().get("https://huggingface.co/api/whoami-v2").set("Authorization", &format!("Bearer {token}")).call();
        match result {
            Ok(response) => {
                let data = net::read_json(response, 1 << 20)?;
                data["name"].as_str().filter(|s| !s.is_empty()).map(|s| s.chars().take(80).collect()).ok_or_else(|| "Hugging Face did not identify this account.".into())
            }
            Err(ureq::Error::Status(401 | 403, _)) => Err("Hugging Face did not accept this token. Check that it is active and has read access.".into()),
            Err(_) => Err("Could not reach Hugging Face. Check your internet connection.".into()),
        }
    }).await
}

#[tauri::command]
fn set_key(name: String, value: String) -> Result<(), String> {
    let v = value.trim();
    if v.is_empty() || v.len() > 512 || !v.bytes().all(|b| b.is_ascii_graphic()) {
        return Err("That does not look like an API key. Paste it again without spaces.".into());
    }
    entry(&name)?.set_password(v).map_err(|e| format!("Could not save to the system credential store: {e}"))
}

#[tauri::command]
fn clear_key(name: String) -> Result<(), String> {
    match entry(&name)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(format!("Could not remove the key: {e}")),
    }
}

// ---- generating audio -----------------------------------------------------------------------------------------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ClipReq {
    provider: String,
    text: String,
    voice: Option<String>,
    speed: Option<f64>,
    seconds: Option<f64>,
    instructions: Option<String>,
    quality: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ClipOut {
    audio_b64: String,
    mime: String,
    ms: u128,
}

fn make_clip(root: &std::path::Path, models: &std::path::Path, req: ClipReq) -> Result<Vec<u8>, String> {
    let text = req.text.trim();
    if text.is_empty() || text.len() > 9000 {
        return Err("The text is empty or too long.".into());
    }
    let voice = req.voice.clone().unwrap_or_default();
    match req.provider.as_str() {
        "eleven-v4" => eleven()?.speech(&voice, eleven::MODEL_V4, text, req.speed, eleven::format_or_standard(req.quality.as_deref())),
        "eleven-tts" => eleven()?.speech(&voice, eleven::MODEL_V3, text, req.speed, eleven::format_or_standard(req.quality.as_deref())),
        "eleven-sfx" => eleven()?.sound(text, req.seconds.unwrap_or(3.0), eleven::format_or_standard(req.quality.as_deref())),
        "piper" => local::piper_speak(root, &voice, text, req.speed.unwrap_or(1.0), &local::RealRunner),
        "local" => local::server_speak(&server_cfg(root), text, &voice, req.speed.unwrap_or(1.0)),
        "chatterbox" => chatterbox_speak(root, models, text, &voice),
        p @ ("voicekiller" | "voicekiller-clone") => voicekiller_client()?.speak(text, &voice, req.instructions.as_deref(), p == "voicekiller-clone"),
        p @ ("kie-tts" | "kie-dialogue" | "kie-sfx") => {
            let c = kie::Client::new(kie::BASE, &get_key("kie")?);
            let fetch = |u: &str| net::download(u, net::MAX_AUDIO);
            match p {
                "kie-tts" => {
                    let v = if voice.is_empty() { kie::DEFAULT_VOICE.to_string() } else { voice.clone() };
                    if !eleven::valid_id(&v) {
                        return Err("That Kie voice is not valid.".into());
                    }
                    let mut input = serde_json::json!({ "text": text, "voice": v });
                    if let Some(sp) = req.speed.filter(|x| (x - 1.0).abs() > 0.001) {
                        input["speed"] = serde_json::json!(sp.clamp(0.7, 1.2));
                    }
                    c.run("elevenlabs/text-to-speech-turbo-2-5", input, &fetch)
                }
                "kie-dialogue" => c.run("elevenlabs/text-to-dialogue-v3", serde_json::json!({ "dialogue": [{ "text": text, "voice": kie::DEFAULT_VOICE }] }), &fetch),
                _ => c.run("elevenlabs/sound-effect-v2", serde_json::json!({ "text": text }), &fetch),
            }
        }
        _ => Err("Unknown test type.".into()),
    }
}

#[tauri::command]
async fn run_clip(app: tauri::AppHandle, req: ClipReq) -> Result<ClipOut, String> {
    let dir = root(&app)?;
    let models = model_manager::models_root(&app)?;
    blocking(move || {
        let t = Instant::now();
        let bytes = make_clip(&dir, &models, req)?;
        if bytes.len() < 200 {
            return Err("The provider returned an empty clip.".to_string());
        }
        Ok(ClipOut { mime: net::mime_of(&bytes).into(), audio_b64: b64(&bytes), ms: t.elapsed().as_millis() })
    })
    .await
}

fn chatterbox_paths(root: &std::path::Path, models: &std::path::Path) -> Result<(PathBuf, PathBuf), String> {
    let python = root.join("runtime").join("chatterbox").join(if cfg!(windows) { "Scripts/python.exe" } else { "bin/python" });
    if !python.is_file() { return Err("Chatterbox runtime is not installed on this computer yet.".into()); }
    Ok((python, chatterbox_model_dir(root, models)?))
}

fn chatterbox_model_dir(root: &std::path::Path, models: &std::path::Path) -> Result<PathBuf, String> {
    let installed = models.join("chatterbox-multilingual-v3").join("5bb1f6ee");
    let downloaded = root.join("Model Downloads").join("Chatterbox");
    let files = ["t3_mtl23ls_v3.safetensors", "s3gen.pt", "ve.pt", "conds.pt", "grapheme_mtl_merged_expanded_v1.json", "Cangjie5_TC.json"];
    let model = [installed, downloaded].into_iter().find(|p| files.iter().all(|f| p.join(f).is_file()))
        .ok_or("Chatterbox model files are missing. Download them in Model Center.")?;
    Ok(model)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ChatterboxRuntimeStatus {
    installed: bool,
    model_ready: bool,
    detail: String,
}

fn chatterbox_python(root: &std::path::Path) -> PathBuf {
    root.join("runtime").join("chatterbox").join(if cfg!(windows) { "Scripts/python.exe" } else { "bin/python" })
}

fn command_ok(program: &std::path::Path, args: &[&str]) -> bool {
    std::process::Command::new(program).args(args).output().map(|x| x.status.success()).unwrap_or(false)
}

fn chatterbox_runtime_state(root: &std::path::Path, models: &std::path::Path) -> ChatterboxRuntimeStatus {
    let python = chatterbox_python(root);
    let installed = python.is_file() && command_ok(&python, &["-c", "import chatterbox, torch, torchaudio"]);
    let model_ready = chatterbox_model_dir(root, models).is_ok();
    let detail = match (installed, model_ready) {
        (true, true) => "Chatterbox is ready for its default local voice.".into(),
        (true, false) => "Runtime ready. Download Chatterbox model files to enable speech.".into(),
        (false, true) => "Model files are ready. Install the local runtime to enable speech.".into(),
        (false, false) => "Install the local runtime, then download the model files.".into(),
    };
    ChatterboxRuntimeStatus { installed, model_ready, detail }
}

fn hidden_command(program: &str) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command
}

fn run_setup_command(program: &str, args: &[&str], label: &str) -> Result<(), String> {
    let output = hidden_command(program).args(args).output().map_err(|_| format!("Could not start {label}."))?;
    if output.status.success() { return Ok(()); }
    let detail = String::from_utf8_lossy(&output.stderr).replace(['\r', '\n'], " ");
    Err(format!("{label} did not finish. {}", detail.chars().take(240).collect::<String>()))
}

fn setup_chatterbox_runtime(root: &std::path::Path, models: &std::path::Path) -> Result<ChatterboxRuntimeStatus, String> {
    static SETUP: Mutex<()> = Mutex::new(());
    let _guard = SETUP.lock().map_err(|_| "Chatterbox setup is unavailable. Restart Greenroom and try again.")?;
    if chatterbox_runtime_state(root, models).installed { return Ok(chatterbox_runtime_state(root, models)); }
    let runtime = root.join("runtime").join("chatterbox");
    std::fs::create_dir_all(runtime.parent().ok_or("Could not prepare the runtime folder.")?).map_err(|_| "Could not prepare Greenroom's runtime folder.")?;
    // The Python launcher selects the tested 3.11 interpreter. A normal python.exe is the fallback for macOS/Linux.
    let made = if cfg!(windows) {
        run_setup_command("py", &["-3.11", "-m", "venv", runtime.to_string_lossy().as_ref()], "Python 3.11")
    } else {
        run_setup_command("python3", &["-m", "venv", runtime.to_string_lossy().as_ref()], "Python")
    };
    if let Err(error) = made {
        return Err(format!("Greenroom needs Python 3.11 to set up Chatterbox. Install it from python.org, then press Install local runtime again. {error}"));
    }
    let python = chatterbox_python(root);
    run_setup_command(python.to_string_lossy().as_ref(), &["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "--upgrade", "pip"], "the Chatterbox installer")?;
    run_setup_command(python.to_string_lossy().as_ref(), &["-m", "pip", "install", "--disable-pip-version-check", "--no-input", "chatterbox-tts==0.1.7"], "the Chatterbox runtime installer")?;
    let status = chatterbox_runtime_state(root, models);
    if !status.installed { return Err("Chatterbox installed but could not be verified. Try Install local runtime again.".into()); }
    Ok(status)
}

#[tauri::command]
fn chatterbox_runtime_status(app: tauri::AppHandle) -> Result<ChatterboxRuntimeStatus, String> {
    Ok(chatterbox_runtime_state(&root(&app)?, &model_manager::models_root(&app)?))
}

#[tauri::command]
async fn chatterbox_runtime_install(app: tauri::AppHandle) -> Result<ChatterboxRuntimeStatus, String> {
    let docs = root(&app)?;
    let models = model_manager::models_root(&app)?;
    blocking(move || setup_chatterbox_runtime(&docs, &models)).await
}

#[tauri::command]
fn chatterbox_ready(app: tauri::AppHandle) -> Result<bool, String> {
    Ok(chatterbox_paths(&root(&app)?, &model_manager::models_root(&app)?).is_ok())
}

fn chatterbox_speak(root: &std::path::Path, models: &std::path::Path, text: &str, voice: &str) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    static GENERATION: Mutex<()> = Mutex::new(());
    let _guard = GENERATION.lock().map_err(|_| "Chatterbox is unavailable. Restart Greenroom and try again.")?;
    if voice != "chatterbox-default" { return Err("That Chatterbox voice is not available.".into()); }
    if text.chars().count() > 1000 { return Err("Chatterbox supports up to 1,000 characters per line.".into()); }
    let (python, model) = chatterbox_paths(root, models)?;
    let mut cmd = Command::new(python);
    cmd.args(["-c", include_str!("../../../runtime/chatterbox_once.py")]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    let mut child = cmd.spawn().map_err(|_| "Could not start the Chatterbox runtime.")?;
    let input = serde_json::json!({"text": text, "model_dir": model});
    child.stdin.take().ok_or("Could not send text to Chatterbox.")?.write_all(input.to_string().as_bytes()).map_err(|_| "Could not send text to Chatterbox.")?;
    let output = child.wait_with_output().map_err(|_| "Chatterbox stopped unexpectedly.")?;
    if !output.status.success() || !output.stdout.starts_with(b"RIFF") { return Err("Chatterbox could not generate this line. Check that its runtime and model files are intact.".into()); }
    Ok(output.stdout)
}

// ---- voices ---------------------------------------------------------------------------------------------------

#[tauri::command]
async fn voices_voicekiller() -> Result<Vec<voicekiller::VkVoice>, String> {
    blocking(|| voicekiller_client()?.voices()).await
}

#[tauri::command]
async fn voices_mine() -> Result<Vec<VoiceInfo>, String> {
    blocking(|| eleven()?.my_voices()).await
}

#[derive(Serialize)]
struct SharedPage {
    voices: Vec<VoiceInfo>,
    more: bool,
}

#[tauri::command]
async fn voices_shared(search: String, language: String, accent: String, gender: String, page: u32) -> Result<SharedPage, String> {
    blocking(move || eleven()?.shared_voices(&search, &language, &accent, &gender, page).map(|(voices, more)| SharedPage { voices, more })).await
}

#[tauri::command]
async fn voice_add_shared(owner: String, voice: String, name: String) -> Result<String, String> {
    blocking(move || eleven()?.add_shared(&owner, &voice, &name)).await
}

#[tauri::command]
async fn voice_design(description: String, sample: Option<String>) -> Result<Vec<eleven::DesignPreview>, String> {
    blocking(move || eleven()?.design(&description, sample.as_deref())).await
}

#[tauri::command]
async fn voice_design_save(generated: String, name: String, description: String) -> Result<String, String> {
    blocking(move || eleven()?.save_design(&generated, &name, &description)).await
}

/// Cloning needs the owner's confirmation that they have the speaker's permission; the UI sends it, and it is checked
/// again here so no other path can skip it.
#[tauri::command]
async fn voice_clone(name: String, filename: String, mime: String, audio_b64: String, permission: bool) -> Result<String, String> {
    if !permission {
        return Err("Confirm that you have permission to clone this voice first.".into());
    }
    blocking(move || eleven()?.clone_voice(&name, &filename, &mime, &unb64(&audio_b64)?)).await
}

#[tauri::command]
async fn voice_delete(id: String) -> Result<(), String> {
    blocking(move || eleven()?.delete_voice(&id)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Audio {
    audio_b64: String,
    mime: String,
}

#[tauri::command]
async fn preview_fetch(url: String) -> Result<Audio, String> {
    blocking(move || {
        let bytes = net::download(&url, 6 << 20)?;
        Ok(Audio { mime: net::mime_of(&bytes).into(), audio_b64: b64(&bytes) })
    })
    .await
}

// ---- projects, takes, library, exports ------------------------------------------------------------------------

#[tauri::command]
async fn video_probe(path: String) -> Result<video::VideoInfo, String> {
    blocking(move || video::probe(std::path::Path::new(&path))).await
}

/// Lets the player read one video the owner chose, and nothing else on the disk.
#[tauri::command]
fn video_allow(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    if video::ext_of(&p).is_none() || !p.is_file() {
        return Err("That video file could not be found.".into());
    }
    app.asset_protocol_scope().allow_file(&p).map_err(|_| "Could not open that video for playback.".to_string())
}

/// Brings an audio file the owner chose (for example a piece of music) into the project. The original is not touched.
#[tauri::command]
async fn audio_import(app: tauri::AppHandle, project: String, path: String) -> Result<store::Imported, String> {
    let r = root(&app)?;
    blocking(move || {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        store::import_audio(&r, &project, std::path::Path::new(&path), &format!("m-{nanos:x}"), 120 << 20)
    })
    .await
}

#[tauri::command]
fn project_list(app: tauri::AppHandle) -> Result<Vec<store::ProjectInfo>, String> {
    Ok(store::project_list(&root(&app)?))
}

#[tauri::command]
fn project_load(app: tauri::AppHandle, id: String) -> Result<String, String> {
    store::project_load(&root(&app)?, &id)
}

#[tauri::command]
fn project_save(app: tauri::AppHandle, id: String, json: String) -> Result<(), String> {
    store::project_save(&root(&app)?, &id, &json)
}

#[tauri::command]
fn take_write(app: tauri::AppHandle, project: String, take: String, ext: String, audio_b64: String) -> Result<(), String> {
    store::take_write(&root(&app)?, &project, &take, &ext, &unb64(&audio_b64)?)
}

#[tauri::command]
fn take_read(app: tauri::AppHandle, project: String, take: String) -> Result<Audio, String> {
    let bytes = store::take_read(&root(&app)?, &project, &take)?;
    Ok(Audio { mime: net::mime_of(&bytes).into(), audio_b64: b64(&bytes) })
}

#[tauri::command]
fn export_write(app: tauri::AppHandle, project: String, folder: String, filename: String, audio_b64: String) -> Result<String, String> {
    Ok(store::export_write(&root(&app)?, &project, &folder, &filename, &unb64(&audio_b64)?)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn ffmpeg_status(app: tauri::AppHandle) -> Result<mux::Status, String> {
    Ok(mux::status(&root(&app)?))
}

#[tauri::command]
async fn ffmpeg_install(app: tauri::AppHandle) -> Result<(), String> {
    let r = root(&app)?;
    blocking(move || mux::install(&r, mux::FFMPEG_URL, mux::FFMPEG_SIZE, mux::FFMPEG_SHA256, &fetcher)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MuxResult {
    path: String,
    codec: String,
}

/// Writes a copy of the project's picture with a mix (already written into its exports folder) as the sound.
#[tauri::command]
async fn video_mux(app: tauri::AppHandle, project: String, video: String, mix: String, keep_original: bool) -> Result<MuxResult, String> {
    let r = root(&app)?;
    blocking(move || {
        let exports = store::export_dir(&r, &project)?;
        let name = store::safe_filename(&mix).ok_or("The mix file name was not valid.")?;
        let (path, c) = mux::mux(&r, std::path::Path::new(&video), &exports.join(name), &exports.join("Video"), keep_original, std::time::Duration::from_secs(20 * 60))?;
        Ok(MuxResult { path: path.to_string_lossy().into_owned(), codec: c.label.into() })
    })
    .await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MadeMusic {
    id: String,
    ext: String,
    name: String,
    bytes: u64,
    sha256: String,
    seconds: f64,
}

/// Makes music with Suno through Kie and keeps every returned track in the project as a take that is never overwritten.
#[tauri::command]
async fn music_generate(app: tauri::AppHandle, project: String, req: kie::MusicReq) -> Result<Vec<MadeMusic>, String> {
    let r = root(&app)?;
    let input = kie::music_input(&req)?;
    let key = get_key("kie")?;
    blocking(move || {
        let tracks = kie::Client::new(kie::BASE, &key).music(input)?;
        let mut out = Vec::new();
        for (i, t) in tracks.iter().enumerate() {
            let bytes = net::download(&t.url, 40 << 20)?;
            let ext = if bytes.starts_with(b"RIFF") { "wav" } else if bytes.starts_with(b"ID3") || (bytes.len() > 2 && bytes[0] == 0xFF && bytes[1] & 0xE0 == 0xE0) { "mp3" } else { return Err("Kie sent a file that is not audio Greenroom can use.".into()) };
            let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
            let id = format!("m-{nanos:x}{i}");
            store::take_write(&r, &project, &id, ext, &bytes)?;
            use sha2::{Digest, Sha256};
            let sha256 = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
            let name = if t.title.is_empty() { format!("Suno {}", i + 1) } else { t.title.clone() };
            out.push(MadeMusic { id, ext: ext.into(), name, bytes: bytes.len() as u64, sha256, seconds: t.seconds });
        }
        Ok(out)
    })
    .await
}

#[tauri::command]
fn version_save(app: tauri::AppHandle, project: String, label: String) -> Result<Option<String>, String> {
    history::version_save(&root(&app)?, &project, &label, history::now_secs())
}

#[tauri::command]
fn version_list(app: tauri::AppHandle, project: String) -> Result<Vec<history::VersionInfo>, String> {
    history::version_list(&root(&app)?, &project)
}

#[tauri::command]
fn version_load(app: tauri::AppHandle, project: String, id: String) -> Result<String, String> {
    history::version_load(&root(&app)?, &project, &id)
}

#[tauri::command]
async fn backup_now(app: tauri::AppHandle, project: String) -> Result<String, String> {
    let r = root(&app)?;
    let v = app.package_info().version.to_string();
    blocking(move || Ok(history::backup_now(&r, &project, &v, history::now_secs())?.to_string_lossy().into_owned())).await
}

/// Runs when a project is opened: makes a backup if the last one is over a day old and keeps the newest five.
#[tauri::command]
async fn backup_auto(app: tauri::AppHandle, project: String) -> Result<Option<String>, String> {
    let r = root(&app)?;
    let v = app.package_info().version.to_string();
    blocking(move || Ok(history::backup_auto(&r, &project, &v, history::now_secs(), std::time::Duration::from_secs(86_400), 5)?.map(|p| p.to_string_lossy().into_owned()))).await
}

#[tauri::command]
fn backup_list(app: tauri::AppHandle) -> Result<Vec<history::BackupInfo>, String> {
    Ok(history::backup_list(&root(&app)?))
}

#[tauri::command]
async fn backup_restore(app: tauri::AppHandle, file: String) -> Result<String, String> {
    let r = root(&app)?;
    blocking(move || {
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        history::backup_restore(&r, &file, &format!("p-{nanos:x}"), &history::iso_of(&history::stamp(history::now_secs())))
    })
    .await
}

#[tauri::command]
fn sheet_load(app: tauri::AppHandle) -> Result<String, String> {
    Ok(store::sheet_load(&root(&app)?))
}

#[tauri::command]
fn sheet_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    store::sheet_save(&root(&app)?, &json)
}

#[tauri::command]
fn sheet_audio_write(app: tauri::AppHandle, id: String, audio_b64: String) -> Result<(), String> {
    store::sheet_audio_write(&root(&app)?, &id, &unb64(&audio_b64)?)
}

#[tauri::command]
fn sheet_audio_read(app: tauri::AppHandle, id: String) -> Result<Audio, String> {
    let bytes = store::sheet_audio_read(&root(&app)?, &id)?;
    Ok(Audio { mime: net::mime_of(&bytes).into(), audio_b64: b64(&bytes) })
}

#[tauri::command]
fn sheet_export(app: tauri::AppHandle, filename: String, text: String) -> Result<String, String> {
    Ok(store::sheet_export(&root(&app)?, &filename, &text)?.to_string_lossy().into_owned())
}

#[tauri::command]
fn casts_load(app: tauri::AppHandle) -> Result<String, String> {
    Ok(store::casts_load(&root(&app)?))
}

#[tauri::command]
fn casts_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    store::casts_save(&root(&app)?, &json)
}

#[tauri::command]
fn library_load(app: tauri::AppHandle) -> Result<String, String> {
    Ok(store::library_load(&root(&app)?))
}

#[tauri::command]
fn library_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    store::library_save(&root(&app)?, &json)
}

/// Saves the Listening Lab ratings as a Markdown report in Documents\Greenroom.
#[tauri::command]
fn save_report(app: tauri::AppHandle, text: String) -> Result<String, String> {
    if text.len() > 200_000 {
        return Err("The report is too large.".into());
    }
    let file = root(&app)?.join("listening-report.md");
    store::atomic_write(&file, text.as_bytes())?;
    Ok(file.to_string_lossy().into_owned())
}

/// The AI Director: one question to a Kie text model. The prompt is built in the app; this only carries it.
#[tauri::command]
async fn director_complete(system: String, user: String) -> Result<String, String> {
    if system.len() > 20_000 || user.len() > 60_000 {
        return Err("That scene is too long to send in one go. Try one scene at a time.".into());
    }
    blocking(move || kie::Client::new(kie::BASE, &get_key("kie")?).chat(kie::DIRECTOR_MODEL, &system, &user)).await
}

// ---- engines: local server settings, Piper ---------------------------------------------------------------------

fn server_cfg(root: &std::path::Path) -> local::ServerCfg {
    std::fs::read_to_string(root.join("engines.json"))
        .ok()
        .and_then(|t| serde_json::from_str::<serde_json::Value>(&t).ok())
        .and_then(|v| serde_json::from_value(v["localServer"].clone()).ok())
        .unwrap_or_default()
}

#[tauri::command]
fn engines_load(app: tauri::AppHandle) -> Result<String, String> {
    Ok(std::fs::read_to_string(root(&app)?.join("engines.json")).unwrap_or_else(|_| "{}".into()))
}

#[tauri::command]
fn engines_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    if json.len() > 64 * 1024 || !serde_json::from_str::<serde_json::Value>(&json).map(|v| v.is_object()).unwrap_or(false) {
        return Err("The engine settings were not valid.".into());
    }
    store::atomic_write(&root(&app)?.join("engines.json"), json.as_bytes())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PiperStatus {
    installed: bool,
    voices: Vec<String>,
}

#[tauri::command]
fn piper_status(app: tauri::AppHandle) -> Result<PiperStatus, String> {
    let r = root(&app)?;
    Ok(PiperStatus { installed: local::piper_installed(&r), voices: local::installed_voices(&r) })
}

fn fetcher(url: &str, max: u64) -> Result<Vec<u8>, String> {
    net::download(url, max)
}

#[tauri::command]
async fn piper_install(app: tauri::AppHandle) -> Result<(), String> {
    let r = root(&app)?;
    blocking(move || local::install_piper(&r, local::PIPER_URL, local::PIPER_SIZE, local::PIPER_SHA256, &fetcher)).await
}

static CATALOG: Mutex<Option<Vec<local::PiperVoice>>> = Mutex::new(None);

fn catalog() -> Result<Vec<local::PiperVoice>, String> {
    if let Some(c) = CATALOG.lock().map_err(|_| "busy")?.clone() {
        return Ok(c);
    }
    let bytes = net::download(local::CATALOG_URL, 8 << 20)?;
    let v: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "The voice catalogue was not understood.".to_string())?;
    let list = local::parse_catalog(&v);
    if list.is_empty() {
        return Err("The voice catalogue was empty.".into());
    }
    *CATALOG.lock().map_err(|_| "busy")? = Some(list.clone());
    Ok(list)
}

#[tauri::command]
async fn piper_catalog() -> Result<Vec<local::PiperVoice>, String> {
    blocking(catalog).await
}

#[tauri::command]
async fn piper_preview(key: String) -> Result<Audio, String> {
    blocking(move || {
        let voice = catalog()?.into_iter().find(|v| v.key == key).ok_or("That voice is not in the catalogue.")?;
        let parent = voice.onnx.0.rsplit_once('/').ok_or("No sample is listed for this voice.")?.0;
        let bytes = net::download(&format!("{}{parent}/samples/speaker_0.mp3", local::VOICES_BASE), 6 << 20)
            .map_err(|_| "This voice has no available online sample. Add it to generate one locally.".to_string())?;
        if bytes.len() < 100 { return Err("This voice has no available online sample. Add it to generate one locally.".into()); }
        Ok(Audio { mime: "audio/mpeg".into(), audio_b64: b64(&bytes) })
    }).await
}

#[tauri::command]
async fn piper_install_voice(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let r = root(&app)?;
    blocking(move || {
        let v = catalog()?.into_iter().find(|v| v.key == key).ok_or("That voice is not in the catalogue.")?;
        local::install_voice(&r, &v, local::VOICES_BASE, &fetcher)
    })
    .await
}

#[tauri::command]
fn piper_remove_voice(app: tauri::AppHandle, key: String) -> Result<(), String> {
    local::remove_voice(&root(&app)?, &key)
}

#[tauri::command]
async fn local_voices(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    let cfg = server_cfg(&root(&app)?);
    blocking(move || local::server_voices(&cfg)).await
}

// ---- managed local AI -----------------------------------------------------------------------------------------

#[tauri::command]
fn model_hardware() -> model_manager::HardwareInfo {
    model_manager::hardware()
}

#[tauri::command]
fn model_states(app: tauri::AppHandle, ids: Vec<String>) -> Result<Vec<model_manager::ModelState>, String> {
    if ids.len() > 100 { return Err("Too many model ids were requested.".into()); }
    model_manager::states(&app, &ids)
}

/// Only application-owned manifests may be installed. URLs and checksums are deliberately never accepted from the UI.
static MODEL_INSTALL_LOCK: Mutex<()> = Mutex::new(());

#[tauri::command]
async fn model_install(app: tauri::AppHandle, id: String) -> Result<model_manager::ModelState, String> {
    let manifest = managed_manifest(&id).ok_or_else(|| "This model's verified installation manifest is not included in this development build yet.".to_string())?;
    blocking(move || {
        let _guard = MODEL_INSTALL_LOCK.try_lock().map_err(|_| "Another model download is already in progress.")?;
        model_manager::install(&app, manifest)
    }).await
}

#[tauri::command]
async fn chatterbox_import_downloads(app: tauri::AppHandle) -> Result<model_manager::ModelState, String> {
    let source = root(&app)?.join("Model Downloads").join("Chatterbox");
    let manifest = managed_manifest("chatterbox-multilingual-v3").ok_or("The Chatterbox manifest is missing.")?;
    blocking(move || {
        let _guard = MODEL_INSTALL_LOCK.try_lock().map_err(|_| "Another model download is already in progress.")?;
        model_manager::import_files(&app, manifest, &source)
    }).await
}

fn managed_manifest(id: &str) -> Option<&'static model_manager::Manifest> {
    use model_manager::{Artifact, Manifest};
    const FILES: &[Artifact] = &[
        Artifact { url: "https://huggingface.co/ResembleAI/chatterbox/resolve/5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18/ve.pt", bytes: 5_698_626, sha256: "4b16d836bc598509860f6fa068165a8bb5e9ac84f05582dfcf278a5a372879f1", filename: "ve.pt" },
        Artifact { url: "https://huggingface.co/ResembleAI/chatterbox/resolve/5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18/t3_mtl23ls_v3.safetensors", bytes: 2_143_989_928, sha256: "5abca8321ede76f8e61f1cc0d19aea6c946b28871017ce8726f8a69203f05953", filename: "t3_mtl23ls_v3.safetensors" },
        Artifact { url: "https://huggingface.co/ResembleAI/chatterbox/resolve/5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18/s3gen.pt", bytes: 1_057_165_844, sha256: "9b9ff07e60b20c136e2b1b3d7563a24604e8d2c4c267888d1ee929dd0151d2a3", filename: "s3gen.pt" },
        Artifact { url: "https://huggingface.co/ResembleAI/chatterbox/resolve/5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18/grapheme_mtl_merged_expanded_v1.json", bytes: 69_989, sha256: "69632f47220a788a52ce2661d096453c5655e9bf25289d89a8d832c46ee07dbf", filename: "grapheme_mtl_merged_expanded_v1.json" },
        Artifact { url: "https://huggingface.co/ResembleAI/chatterbox/resolve/5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18/conds.pt", bytes: 107_374, sha256: "6552d70568833628ba019c6b03459e77fe71ca197d5c560cef9411bee9d87f4e", filename: "conds.pt" },
        Artifact { url: "https://huggingface.co/ResembleAI/chatterbox/resolve/5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18/Cangjie5_TC.json", bytes: 1_920_163, sha256: "7073fd9de919443ae88e0bd2449917a65fe54898a4413ed1edcc4b67f28bce8c", filename: "Cangjie5_TC.json" },
    ];
    static CHATTERBOX: Manifest = Manifest { id: "chatterbox-multilingual-v3", version: "5bb1f6ee", artifacts: FILES };
    if id == CHATTERBOX.id { Some(&CHATTERBOX) } else { None }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            key_status, set_key, clear_key, huggingface_check, run_clip, voices_mine, voices_voicekiller, voices_shared, voice_add_shared, voice_design, voice_design_save, voice_clone,
            voice_delete, preview_fetch, project_list, project_load, project_save, take_write, take_read, export_write, library_load, library_save, casts_load, casts_save, version_save, version_list, version_load, backup_now, backup_auto, backup_list, backup_restore, sheet_load, sheet_save, sheet_audio_write, sheet_audio_read, sheet_export,
            save_report, audio_import, music_generate, ffmpeg_status, ffmpeg_install, video_mux, video_probe, video_allow, director_complete, engines_load, engines_save, piper_status, piper_install, piper_catalog, piper_preview, piper_install_voice, piper_remove_voice, local_voices,
            model_hardware, model_states, model_install, chatterbox_import_downloads, chatterbox_ready, chatterbox_runtime_status, chatterbox_runtime_install
        ])
        .run(tauri::generate_context!())
        .expect("error while running Greenroom");
}
