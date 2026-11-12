//! Greenroom backend. Keys live only in the Windows Credential Manager and are never returned to the UI.
//! Every paid call is a command the UI makes only after the owner confirms the cost sheet.

mod eleven;
mod kie;
mod history;
mod inworld;
mod llm;
mod local;
mod model_manager;
mod managed_python;
mod mux;
mod net;
mod script_import;
mod qwen_design;
mod qwen_warm;
mod speaker;
mod setup_check;
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
    if !matches!(name, "elevenlabs" | "kie" | "voicekiller" | "voicekiller-userid" | "inworld" | "huggingface" | "openai" | "gemini") {
        return Err("Unknown provider.".into());
    }
    keyring::Entry::new(SERVICE, name).map_err(|e| format!("Could not reach the system credential store: {e}"))
}

fn get_key(name: &str) -> Result<String, String> {
    let who = match name {
        "kie" => "Kie",
        "inworld" => "Inworld",
        "openai" => "OpenAI",
        "gemini" => "Gemini",
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

fn inworld_client() -> Result<inworld::Client, String> {
    Ok(inworld::Client::new(inworld::BASE, &get_key("inworld")?))
}

fn voicekiller_client() -> Result<voicekiller::Client, String> {
    Ok(voicekiller::Client::new(voicekiller::BASE, &get_key("voicekiller")?, &get_key("voicekiller-userid")?))
}

static DOCS_ROOT: Mutex<Option<PathBuf>> = Mutex::new(None);

fn root(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let r = app.path().document_dir().map_err(|_| "Could not find your Documents folder.".to_string())?.join("Greenroom Local");
    if let Ok(mut g) = DOCS_ROOT.lock() {
        *g = Some(r.clone());
    }
    Ok(r)
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
    inworld: bool,
    huggingface: bool,
    openai: bool,
    gemini: bool,
}

#[tauri::command]
fn key_status() -> KeyStatus {
    let has = |n: &str| entry(n).ok().and_then(|e| e.get_password().ok()).map(|k| !k.trim().is_empty()).unwrap_or(false);
    KeyStatus { elevenlabs: has("elevenlabs"), kie: has("kie"), voicekiller: has("voicekiller") && has("voicekiller-userid"), inworld: has("inworld"), huggingface: has("huggingface"), openai: has("openai"), gemini: has("gemini") }
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
    #[serde(rename = "loop")]
    r#loop: Option<bool>,
    prompt_influence: Option<f64>,
    sfx_model: Option<String>,
    language: Option<String>,
    model: Option<String>,
    delivery: Option<String>,
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
        "eleven-sfx" => eleven()?.sound(text, req.seconds.unwrap_or(3.0), req.r#loop.unwrap_or(false), req.prompt_influence, req.sfx_model.as_deref(), eleven::format_or_standard(req.quality.as_deref())),
        "local-sfx" => sfx_bytes(root, models, text, req.seconds.unwrap_or(3.0).round().clamp(1.0, 11.0) as u32, None),
        "piper" => local::piper_speak(root, &voice, text, req.speed.unwrap_or(1.0), &local::RealRunner),
        "local" => local::server_speak(&server_cfg(root), text, &voice, req.speed.unwrap_or(1.0)),
        "chatterbox" => chatterbox_speak(root, models, text, &voice),
        "kokoro" => kokoro_speak(root, text, &voice, req.speed.unwrap_or(1.0)),
        "qwen" => qwen_speak(root, text, &voice),
        "wazobia" => wazobia_speak(root, models, text, &voice, req.language.as_deref().unwrap_or("en")),
        "inworld" => Ok(inworld_client()?.speak(text, &voice, req.model.as_deref().unwrap_or("inworld-tts-2"), inworld::SpeechOpts { rate: req.speed, delivery: req.delivery.as_deref(), language: req.language.as_deref() })?.audio),
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
    let python = chatterbox_python(root);
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
#[derive(Debug)]
struct LocalRuntimeStatus { installed: bool, model_ready: bool, detail: String }

fn managed_runtime_status(root: &std::path::Path, name: &str, import_check: &str) -> LocalRuntimeStatus {
    let dir = root.join("runtime").join(format!("{name}-managed"));
    let python = dir.join("python.exe");
    let installed = dir.join("complete").is_file() && python.is_file() && command_ok(&python, &["-c", import_check]);
    LocalRuntimeStatus { installed, model_ready: false, detail: if installed { format!("{name} runtime ready. Download or select model weights to enable speech.") } else { format!("Install the managed {name} runtime to enable local speech.") } }
}

fn setup_managed_runtime(root: &std::path::Path, name: &str, package: &str, import_check: &str) -> Result<LocalRuntimeStatus, String> {
    static SETUP: Mutex<()> = Mutex::new(());
    let _guard = SETUP.lock().map_err(|_| "Runtime setup is unavailable. Restart Greenroom and try again.")?;
    let dir = root.join("runtime").join(format!("{name}-managed"));
    if managed_runtime_status(root, name, import_check).installed { return Ok(managed_runtime_status(root, name, import_check)); }
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) { return Err("Managed runtimes currently support Windows x64. Use the Local Server preset on this platform.".into()); }
    let python = managed_python::bootstrap(&dir)?;
    let program = python.to_string_lossy();
    run_setup_command(&program, &["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cpu", "torch==2.6.0", "torchaudio==2.6.0"], "the CPU speech runtime installer")?;
    // Some dependencies (Qwen3-TTS has one) are built from source and need setuptools, which the embedded Python lacks. Found in a real run.
    run_setup_command(&program, &["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--only-binary=:all:", "setuptools<81", "wheel"], "the build tools installer")?;
    run_setup_command(&program, &["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--use-pep517", package], "the local speech package installer")?; // --use-pep517: Kokoro needs docopt, an old source-only package whose setup.py cannot be built the legacy way inside the embedded Python (found in a real run)
    if !command_ok(&python, &["-c", import_check]) { return Err(format!("{name} installed but could not be verified. Retry setup.")); }
    crate::store::atomic_write(&dir.join("complete"), package.as_bytes())?;
    Ok(managed_runtime_status(root, name, import_check))
}

#[tauri::command]
async fn kokoro_runtime_status(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> { let docs = root(&app)?; blocking(move || Ok(kokoro_status(&docs))).await }
#[tauri::command]
async fn kokoro_runtime_install(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> { let docs = root(&app)?; blocking(move || { setup_managed_runtime(&docs, "kokoro", "kokoro==0.9.4", "from kokoro import KPipeline; import torch")?; Ok(kokoro_status(&docs)) }).await }
#[tauri::command]
async fn qwen_runtime_status(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> { let docs = root(&app)?; blocking(move || Ok(qwen_status(&docs))).await }
#[tauri::command]
async fn qwen_runtime_install(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> { let docs = root(&app)?; blocking(move || { setup_managed_runtime(&docs, "qwen", QWEN_PACKAGE, QWEN_CHECK)?; Ok(qwen_status(&docs)) }).await }

/// Chatterbox needs its watermarker to load: this is the check that failed in real testing when setuptools was missing.
const CHATTERBOX_CHECK: &str = "import chatterbox, torch, torchaudio, perth; assert perth.PerthImplicitWatermarker is not None";
const CHATTERBOX_CHECK_FULL: &str = "from chatterbox.mtl_tts import ChatterboxMultilingualTTS; from chatterbox.vc import ChatterboxVC; import torch, torchaudio, perth; assert perth.PerthImplicitWatermarker is not None";

fn chatterbox_python(root: &std::path::Path) -> PathBuf {
    let managed = root.join("runtime/chatterbox-managed");
    if managed.join("complete").is_file() { return managed.join("python.exe"); }
    root.join("runtime").join("chatterbox").join(if cfg!(windows) { "Scripts/python.exe" } else { "bin/python" })
}

fn command_ok(program: &std::path::Path, args: &[&str]) -> bool {
    hidden_command(program).args(args).output().map(|x| x.status.success()).unwrap_or(false)
}

fn chatterbox_runtime_state(root: &std::path::Path, models: &std::path::Path) -> ChatterboxRuntimeStatus {
    let python = chatterbox_python(root);
    let installed = python.is_file() && command_ok(&python, &["-c", CHATTERBOX_CHECK]);
    let model_ready = chatterbox_model_dir(root, models).is_ok();
    let detail = match (installed, model_ready) {
        (true, true) => "Runtime and model files installed. Use Try voice to verify speech generation.".into(),
        (true, false) => "Runtime ready. Download Chatterbox model files to enable speech.".into(),
        (false, true) => "Model files are ready. Install the local runtime to enable speech.".into(),
        (false, false) => "Install the local runtime, then download the model files.".into(),
    };
    ChatterboxRuntimeStatus { installed, model_ready, detail }
}

fn hidden_command(program: impl AsRef<std::ffi::OsStr>) -> std::process::Command {
    let mut command = std::process::Command::new(program);
    #[cfg(windows)] { use std::os::windows::process::CommandExt; command.creation_flags(0x08000000); }
    command
}

fn run_setup_command(program: &str, args: &[&str], label: &str) -> Result<(), String> {
    let docs = DOCS_ROOT.lock().ok().and_then(|g| g.clone());
    let mut full: Vec<String> = args.iter().map(|a| a.to_string()).collect();
    // pip: more patience for slow connections, and the person's own proxy (pip --isolated would otherwise ignore it)
    if let Some(i) = full.iter().position(|a| a == "install") {
        if i > 0 && full[i - 1] == "pip" {
            let mut extra: Vec<String> = vec!["--retries".into(), "5".into(), "--timeout".into(), "60".into()];
            if let Some(p) = ["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"].iter().find_map(|k| std::env::var(k).ok().filter(|v| !v.trim().is_empty())) {
                extra.push("--proxy".into());
                extra.push(p);
            }
            for (n, e) in extra.into_iter().enumerate() {
                full.insert(i + 1 + n, e);
            }
        }
    }
    let mut last = String::new();
    for attempt in 1..=3u32 {
        let output = hidden_command(program).args(&full).output().map_err(|_| format!("Could not start {label}."))?;
        let text = format!("{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        if let Some(d) = &docs {
            let clipped: String = text.chars().rev().take(20_000).collect::<Vec<_>>().into_iter().rev().collect();
            let now = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|t| t.as_secs()).unwrap_or(0);
            setup_check::append_log(d, &format!("\n=== {label} (attempt {attempt}, {}, time {now}) ===\n{clipped}\n", if output.status.success() { "ok" } else { "FAILED" }));
        }
        if output.status.success() {
            return Ok(());
        }
        last = text;
        if attempt < 3 && setup_check::looks_temporary(&last) {
            std::thread::sleep(std::time::Duration::from_secs(4));
            continue;
        }
        break;
    }
    Err(format!("{label} did not finish. {} (Press \"Check my setup\" to see the likely cause.)", setup_check::why(&last)))
}

fn setup_chatterbox_runtime(root: &std::path::Path, models: &std::path::Path) -> Result<ChatterboxRuntimeStatus, String> {
    static SETUP: Mutex<()> = Mutex::new(());
    let _guard = SETUP.lock().map_err(|_| "Chatterbox setup is unavailable. Restart Greenroom and try again.")?;
    if chatterbox_runtime_state(root, models).installed { return Ok(chatterbox_runtime_state(root, models)); }
    if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        let managed = root.join("runtime/chatterbox-managed");
        let python = managed_python::bootstrap(&managed)?;
        let program = python.to_string_lossy();
        run_setup_command(&program, &["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cpu", "torch==2.6.0", "torchaudio==2.6.0"], "the CPU speech runtime installer")?;
        // The Perth watermarker imports pkg_resources, which needs setuptools. Without it speech fails with a missing-watermarker error.
        run_setup_command(&program, &["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--only-binary=:all:", "setuptools<81"], "the Chatterbox build tools installer")?;
        run_setup_command(&program, &["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--only-binary=:all:", "chatterbox-tts==0.1.7"], "the Chatterbox runtime installer")?;
        if !command_ok(&python, &["-c", CHATTERBOX_CHECK_FULL]) {
            return Err("The speech runtime could not load. Retry setup; the previous runtime has been preserved.".into());
        }
        crate::store::atomic_write(&managed.join("complete"), b"python-3.11.9;chatterbox-0.1.7;torch-2.6.0-cpu")?;
        return Ok(chatterbox_runtime_state(root, models));
    }
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
async fn chatterbox_runtime_status(app: tauri::AppHandle) -> Result<ChatterboxRuntimeStatus, String> {
    let docs = root(&app)?;
    let models = model_manager::models_root(&app)?;
    blocking(move || Ok(chatterbox_runtime_state(&docs, &models))).await
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

/// Built-in WazobiaVoice reference voices (file names in the pinned release, without `voice-` and `.wav`).
const WAZOBIA_VOICES: [&str; 13] = ["adaeze", "amara", "bolaji", "elder_deji", "emeka", "hauwa", "ife", "james", "john", "musa", "ngozi", "tunde", "wura"];
const WAZOBIA_LANGUAGES: [&str; 4] = ["en", "yo", "ha", "ig"];

fn wazobia_dir(models: &std::path::Path) -> Option<PathBuf> {
    let dir = models.join("wazobia-voice").join(wazobia_manifest().version);
    wazobia_manifest().files.iter().all(|f| dir.join(f.filename).is_file()).then_some(dir)
}

#[tauri::command]
fn wazobia_voices(app: tauri::AppHandle) -> Result<Vec<String>, String> {
    Ok(if wazobia_dir(&model_manager::models_root(&app)?).is_some() { WAZOBIA_VOICES.iter().map(|v| v.to_string()).collect() } else { Vec::new() })
}

fn wazobia_speak(root: &std::path::Path, models: &std::path::Path, text: &str, voice: &str, language: &str) -> Result<Vec<u8>, String> {
    // A library voice id looks like `ife@yo`: the reference voice and the language it should speak.
    let (voice, language) = voice.split_once('@').unwrap_or((voice, language));
    if !WAZOBIA_VOICES.contains(&voice) { return Err("That Wazobia voice is not available.".into()); }
    if !WAZOBIA_LANGUAGES.contains(&language) { return Err("Wazobia speaks English, Yoruba, Hausa and Igbo.".into()); }
    let dir = wazobia_dir(models).ok_or("WazobiaVoice is not installed. Install it in Model Center.")?;
    let prompt = dir.join(format!("voice-{voice}.wav"));
    chatterbox_run(root, text, &dir, serde_json::json!({"t3_model": "v2", "language": language, "prompt": prompt}))
}

fn chatterbox_speak(root: &std::path::Path, models: &std::path::Path, text: &str, voice: &str) -> Result<Vec<u8>, String> {
    if voice != "chatterbox-default" { return Err("That Chatterbox voice is not available.".into()); }
    let (_, model) = chatterbox_paths(root, models)?;
    chatterbox_run(root, text, &model, serde_json::json!({}))
}

fn chatterbox_run(root: &std::path::Path, text: &str, model: &std::path::Path, extra: serde_json::Value) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    static GENERATION: Mutex<()> = Mutex::new(());
    let _guard = GENERATION.lock().map_err(|_| "Chatterbox is unavailable. Restart Greenroom and try again.")?;
    if text.chars().count() > 1000 { return Err("Chatterbox supports up to 1,000 characters per line.".into()); }
    let python = chatterbox_python(root);
    if !python.is_file() { return Err("Chatterbox runtime is not installed on this computer yet. Install it in Model Center.".into()); }
    let mut cmd = Command::new(python);
    cmd.args(["-c", include_str!("../../../runtime/chatterbox_once.py")]).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    let mut child = cmd.spawn().map_err(|_| "Could not start the Chatterbox runtime.")?;
    let mut input = serde_json::json!({"text": text, "model_dir": model});
    if let (Some(o), Some(e)) = (input.as_object_mut(), extra.as_object()) { o.extend(e.clone()); }
    child.stdin.take().ok_or("Could not send text to Chatterbox.")?.write_all(input.to_string().as_bytes()).map_err(|_| "Could not send text to Chatterbox.")?;
    let output = child.wait_with_output().map_err(|_| "Chatterbox stopped unexpectedly.")?;
    if !output.status.success() || !output.stdout.starts_with(b"RIFF") {
        let why = setup_check::why(&String::from_utf8_lossy(&output.stderr));
        setup_check::append_log(root, &format!("chatterbox worker failed ({}): {}", output.status, why));
        return Err(format!("Chatterbox could not generate this line. Check that its runtime and model files are intact. Detail: {why}"));
    }
    Ok(output.stdout)
}

// ---- Kokoro (local speech) ---------------------------------------------------------------------------------------

/// Kokoro voice names are a language letter, a gender letter, an underscore and a lower-case name (af_heart, bm_george).
/// Anything else is refused before a process starts, because Kokoro would treat a path-like name as a file to load.
fn kokoro_voice_ok(v: &str) -> bool {
    let b = v.as_bytes();
    b.len() >= 4 && b.len() <= 24 && b[1] != b'_' && b[2] == b'_' && matches!(b[0], b'a' | b'b' | b'e' | b'f' | b'h' | b'i' | b'j' | b'p' | b'z') && matches!(b[1], b'f' | b'm') && b[3..].iter().all(|c| c.is_ascii_lowercase())
}

fn kokoro_dir(root: &std::path::Path) -> PathBuf { root.join("runtime").join("kokoro-managed") }
fn kokoro_python(root: &std::path::Path) -> PathBuf { kokoro_dir(root).join("python.exe") }
fn kokoro_weights_marker(root: &std::path::Path) -> PathBuf { kokoro_dir(root).join("weights-ok") }

fn kokoro_speak(root: &std::path::Path, text: &str, voice: &str, speed: f64) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    static GENERATION: Mutex<()> = Mutex::new(());
    if !kokoro_voice_ok(voice) { return Err("That Kokoro voice name is not valid.".into()); }
    if text.chars().count() > 2000 { return Err("Kokoro supports up to 2,000 characters per line.".into()); }
    let python = kokoro_python(root);
    if !python.is_file() { return Err("The Kokoro runtime is not installed on this computer yet. Install it in Model Center.".into()); }
    let _guard = GENERATION.lock().map_err(|_| "Kokoro is unavailable. Restart Greenroom and try again.")?;
    let mut cmd = Command::new(python);
    cmd.args(["-c", include_str!("../../../runtime/kokoro_once.py")]).env("HF_HOME", kokoro_dir(root).join("hf")).stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::null());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    let mut child = cmd.spawn().map_err(|_| "Could not start the Kokoro runtime.")?;
    let input = serde_json::json!({"text": text, "voice": voice, "speed": speed.clamp(0.5, 2.0)});
    child.stdin.take().ok_or("Could not send text to Kokoro.")?.write_all(input.to_string().as_bytes()).map_err(|_| "Could not send text to Kokoro.")?;
    let output = child.wait_with_output().map_err(|_| "Kokoro stopped unexpectedly.")?;
    if !output.status.success() || !output.stdout.starts_with(b"RIFF") { return Err("Kokoro could not generate this line. If this is the first run, check your internet connection (it downloads its model once) and try Set up again.".into()); }
    Ok(output.stdout)
}

/// One short line through Kokoro. The first run downloads the model weights and language data, so this is the download step
/// and also the proof that the whole chain works. It writes a marker only when real audio came back.
fn kokoro_prefetch_blocking(root: &std::path::Path) -> Result<LocalRuntimeStatus, String> {
    let installed = managed_runtime_status(root, "kokoro", "from kokoro import KPipeline; import torch").installed;
    if !installed { return Err("Install the Kokoro runtime first.".into()); }
    let audio = kokoro_speak(root, "Hello. This is a test of the local voice.", "af_heart", 1.0)?;
    if audio.len() < 2000 { return Err("Kokoro returned almost no audio. Try Set up again.".into()); }
    crate::store::atomic_write(&kokoro_weights_marker(root), b"af_heart")?;
    Ok(kokoro_status(root))
}

fn kokoro_status(root: &std::path::Path) -> LocalRuntimeStatus {
    let mut s = managed_runtime_status(root, "kokoro", "from kokoro import KPipeline; import torch");
    s.model_ready = s.installed && kokoro_weights_marker(root).is_file();
    s.detail = if s.model_ready { "Kokoro is ready: runtime installed and model downloaded.".into() } else if s.installed { "Runtime installed. Download the Kokoro model to enable speech.".into() } else { "Install the Kokoro runtime to enable local speech.".into() };
    s
}

#[tauri::command]
async fn kokoro_prefetch(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> { let docs = root(&app)?; blocking(move || kokoro_prefetch_blocking(&docs)).await }

// ---- Qwen3-TTS VoiceDesign (local speech, experimental) -----------------------------------------------------------

const QWEN_PACKAGE: &str = "qwen-tts==0.1.1";
const QWEN_CHECK: &str = "from qwen_tts import Qwen3TTSModel; import torch";
/// The VoiceDesign checkpoint named in the QwenLM/Qwen3-TTS README (Apache-2.0), checked 2026-11-09.
const QWEN_MODEL: &str = "Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign";
/// The Base checkpoint (same README, Apache-2.0). It copies the voice of a reference clip, which is what keeps one voice steady across lines.
const QWEN_BASE: &str = "Qwen/Qwen3-TTS-12Hz-1.7B-Base";
/// What every reference clip says. A fixed, ordinary sentence of about seven seconds.
const QWEN_REFERENCE_TEXT: &str = "Good evening. I do hope you are well, and I am glad that you could come.";

/// VoiceDesign has no fixed voices: each is a written description of one. These are the built-in ones. Greenroom's
/// ids are the keys; anything else is refused before a process starts.
fn qwen_voice_description(id: &str) -> Option<&'static str> {
    Some(match id {
        "qwen-warm-narrator" => "A warm, clear adult woman with a calm, steady storytelling voice.",
        "qwen-gravel-man" => "A deep, gravelly adult man who speaks slowly and seriously.",
        "qwen-bright-young-woman" => "A bright, energetic young woman, friendly and quick.",
        "qwen-gentle-older-man" => "An older man with a gentle, slightly husky, thoughtful voice.",
        _ => return None,
    })
}

/// A fixed seed for each built-in voice, so the same line in the same voice comes out the same. It does not make different lines sound
/// like one person: that needs a reference clip (docs/QWEN_STABILITY.md).
fn qwen_seed(voice: &str) -> u32 {
    let mut h: u32 = 2166136261;
    for b in voice.bytes() { h ^= b as u32; h = h.wrapping_mul(16777619); }
    (h % 2_000_000_000) + 1
}

fn qwen_dir(root: &std::path::Path) -> PathBuf { root.join("runtime").join("qwen-managed") }
fn qwen_python(root: &std::path::Path) -> PathBuf { qwen_dir(root).join("python.exe") }
fn qwen_weights_marker(root: &std::path::Path) -> PathBuf { qwen_dir(root).join("weights-ok") }
fn qwen_base_marker(root: &std::path::Path) -> PathBuf { qwen_dir(root).join("base-ok") }
fn qwen_ref_wav(root: &std::path::Path, voice: &str) -> PathBuf { qwen_dir(root).join("refs").join(format!("{voice}.wav")) }
/// A voice is locked when its reference clip exists and the Base model is on this PC: every line then copies that one clip's voice.
fn qwen_locked(root: &std::path::Path, voice: &str) -> bool {
    if qwen_design::is_designed_id(voice) { return qwen_design::load(&qwen_dir(root), voice).is_some() && qwen_base_marker(root).is_file(); }
    qwen_voice_description(voice).is_some() && qwen_base_marker(root).is_file() && qwen_ref_wav(root, voice).is_file()
}

fn qwen_speak(root: &std::path::Path, text: &str, voice: &str) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    static GENERATION: Mutex<()> = Mutex::new(());
    // A built-in voice, or a voice the owner designed on this PC (its own preview clip is its reference).
    let designed = qwen_design::load(&qwen_dir(root), voice);
    let instruct: String = match (&designed, qwen_voice_description(voice)) {
        (Some(d), _) => d.description.clone(),
        (None, Some(s)) => s.to_string(),
        _ => return Err("That Qwen voice is not available.".into()),
    };
    let instruct = instruct.as_str();
    let seed = designed.as_ref().map_or_else(|| qwen_seed(voice), |d| d.seed);
    let (ref_path, ref_text) = match &designed {
        Some(d) => (qwen_design::wav_path(&qwen_dir(root), voice), d.text.clone()),
        None => (qwen_ref_wav(root, voice), QWEN_REFERENCE_TEXT.to_string()),
    };
    if text.chars().count() > 600 { return Err("Qwen3-TTS supports up to 600 characters per line here.".into()); }
    let python = qwen_python(root);
    if !python.is_file() { return Err("The Qwen3-TTS runtime is not installed on this computer yet. Install it in Model Center.".into()); }
    // Once the model is on this PC the warm worker keeps it loaded between lines: only the first line pays the load. Before that
    // (the first download) the one-shot worker below does the downloading. If the warm worker cannot start, the one-shot still works.
    if qwen_weights_marker(root).is_file() {
        let request = if qwen_locked(root, voice) {
            serde_json::json!({"op": "clone", "text": text, "language": "English", "base_model": QWEN_BASE, "ref_path": ref_path, "ref_text": ref_text, "seed": seed})
        } else {
            serde_json::json!({"op": "design", "text": text, "instruct": instruct, "language": "English", "model": QWEN_MODEL, "seed": seed})
        };
        let log = setup_check::log_path(root).with_file_name("qwen-server.log");
        match qwen_warm::speak(&python, include_str!("../../../runtime/qwen_server.py"), &qwen_dir(root).join("hf"), &log, &request, std::time::Duration::from_secs(1500)) {
            Ok(done) => {
                setup_check::append_log(root, &format!("qwen warm line: {} in {:.1}s", done.device, done.seconds));
                return Ok(done.wav);
            }
            Err(e) if e.starts_with("Could not start") => setup_check::append_log(root, &format!("qwen warm worker unavailable, using the one-shot worker: {e}")),
            Err(e) => return Err(e),
        }
    }
    let _guard = GENERATION.lock().map_err(|_| "Qwen3-TTS is unavailable. Restart Greenroom and try again.")?;
    let mut cmd = Command::new(python);
    cmd.args(["-c", include_str!("../../../runtime/qwen_once.py")]).env("HF_HOME", qwen_dir(root).join("hf")).env("HF_HUB_DOWNLOAD_TIMEOUT", "60").stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    #[cfg(windows)] { use std::os::windows::process::CommandExt; cmd.creation_flags(0x08000000); }
    let mut child = cmd.spawn().map_err(|_| "Could not start the Qwen3-TTS runtime.")?;
    let input = serde_json::json!({"text": text, "instruct": instruct, "language": "English", "model": QWEN_MODEL});
    child.stdin.take().ok_or("Could not send text to Qwen3-TTS.")?.write_all(input.to_string().as_bytes()).map_err(|_| "Could not send text to Qwen3-TTS.")?;
    let output = child.wait_with_output().map_err(|_| "Qwen3-TTS stopped unexpectedly.")?;
    if !output.status.success() || !output.stdout.starts_with(b"RIFF") {
        let why = setup_check::why(&String::from_utf8_lossy(&output.stderr));
        setup_check::append_log(root, &format!("qwen worker failed ({}): {}", output.status, why));
        return Err(format!("Qwen3-TTS could not generate this line. If this is the first run, check your internet connection (it downloads its model once; it picks up where it stopped) and press Set up again. Detail: {why}"));
    }
    Ok(output.stdout)
}

fn qwen_status(root: &std::path::Path) -> LocalRuntimeStatus {
    let mut s = managed_runtime_status(root, "qwen", QWEN_CHECK);
    s.model_ready = s.installed && qwen_weights_marker(root).is_file();
    s.detail = if s.model_ready { if qwen_warm::running() { "Qwen3-TTS is ready and loaded in memory (later lines are fast; it frees itself after 15 idle minutes).".into() } else { "Qwen3-TTS is ready: runtime installed and model downloaded.".into() } } else if s.installed { "Runtime installed. Download the Qwen3-TTS model to enable speech.".into() } else { "Install the Qwen3-TTS runtime to enable local speech.".into() };
    s
}

/// One short line through Qwen3-TTS. The first run downloads the model, so this is the download step and the proof.
fn qwen_prefetch_blocking(root: &std::path::Path) -> Result<LocalRuntimeStatus, String> {
    if !managed_runtime_status(root, "qwen", QWEN_CHECK).installed { return Err("Install the Qwen3-TTS runtime first.".into()); }
    let audio = qwen_speak(root, "Hello. This is a test of the local voice.", "qwen-warm-narrator")?;
    if audio.len() < 2000 { return Err("Qwen3-TTS returned almost no audio. Try Set up again.".into()); }
    crate::store::atomic_write(&qwen_weights_marker(root), QWEN_MODEL.as_bytes())?;
    Ok(qwen_status(root))
}

// ---- Speaker similarity -------------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SpeakerStatus { ready: bool, detail: String }

fn speaker_status_of(root: &std::path::Path) -> SpeakerStatus {
    match speaker::find_python(root) {
        Some(_) => SpeakerStatus { ready: true, detail: "Ready: Greenroom can measure whether a character's takes sound like one speaker.".into() },
        None => SpeakerStatus { ready: false, detail: "Not installed. It is a small download (about 100 MB, plus PyTorch if no local voice runtime is installed yet).".into() },
    }
}

#[tauri::command]
async fn speaker_status(app: tauri::AppHandle) -> Result<SpeakerStatus, String> { let docs = root(&app)?; blocking(move || Ok(speaker_status_of(&docs))).await }

/// Installs the encoder into its own private runtime (only needed when neither the Kokoro nor the Qwen runtime already has it).
#[tauri::command]
async fn speaker_install(app: tauri::AppHandle) -> Result<SpeakerStatus, String> {
    let docs = root(&app)?;
    blocking(move || {
        static SETUP: Mutex<()> = Mutex::new(());
        let _guard = SETUP.lock().map_err(|_| "Setup is unavailable. Restart Greenroom and try again.")?;
        if speaker::find_python(&docs).is_some() { return Ok(speaker_status_of(&docs)); }
        if !cfg!(all(target_os = "windows", target_arch = "x86_64")) { return Err("The speaker tool currently supports Windows x64.".into()); }
        let dir = docs.join("runtime").join("speaker-managed");
        let python = managed_python::bootstrap(&dir)?;
        let program = python.to_string_lossy();
        let pip = |args: &[&str], label: &str| -> Result<(), String> { let mut a = vec!["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input"]; a.extend_from_slice(args); run_setup_command(&program, &a, label) };
        pip(&["--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cpu", "torch==2.6.0"], "the speaker tool's PyTorch installer")?;
        pip(&["--only-binary=:all:", "setuptools<81", "wheel"], "the build tools installer")?;
        pip(&["--only-binary=:all:", "webrtcvad-wheels", "librosa", "scipy", "numpy"], "the speaker tool's audio packages")?;
        pip(&["--no-deps", "resemblyzer"], "the speaker encoder installer")?;
        if !command_ok(&python, &["-c", speaker::CHECK]) { return Err("The speaker tool installed but could not be verified. Try again.".into()); }
        Ok(speaker_status_of(&docs))
    }).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TakeEmbedding { take: String, embedding: Option<Vec<f32>> }

/// One speaker vector per take of a project. Nothing is written and nothing leaves the computer.
#[tauri::command]
async fn speaker_embed(app: tauri::AppHandle, project: String, takes: Vec<String>) -> Result<Vec<TakeEmbedding>, String> {
    let docs = root(&app)?;
    blocking(move || {
        let python = speaker::find_python(&docs).ok_or("The speaker tool is not installed. Install it in Model Center.")?;
        let paths = takes.iter().map(|t| store::take_path(&docs, &project, t)).collect::<Result<Vec<_>, _>>()?;
        let out = speaker::embed(&python, &paths)?;
        Ok(takes.into_iter().zip(out).map(|(take, embedding)| TakeEmbedding { take, embedding }).collect())
    }).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QwenLockStatus { base_ready: bool, gpu: bool, gpu_name: String, voices: Vec<QwenVoiceLock> }
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct QwenVoiceLock { id: String, locked: bool }

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
struct QwenDesignPreview { generated_voice_id: String, audio_b64: String, seconds: f64 }

/// Is Qwen3-TTS set up on this PC? Looks only at the files the setup leaves behind, so it answers at once (the full self-check imports
/// PyTorch and can take many seconds, which left the Make previews button off while it ran).
fn qwen_files_ready(root: &std::path::Path) -> bool { qwen_python(root).is_file() && qwen_weights_marker(root).is_file() }

#[tauri::command]
async fn qwen_design_ready(app: tauri::AppHandle) -> Result<bool, String> { let docs = root(&app)?; Ok(qwen_files_ready(&docs)) }

/// Three previews of a voice designed from a description, made on this PC with Qwen3-TTS VoiceDesign. Free, and nothing is sent anywhere.
fn qwen_design_preview_blocking(root: &std::path::Path, description: &str, sample: &str) -> Result<Vec<QwenDesignPreview>, String> {
    qwen_design::check_inputs(description, sample)?;
    if !qwen_files_ready(root) { return Err("Qwen3-TTS is not set up on this PC yet. Set it up in Model Center first (it is free).".into()); }
    let qd = qwen_dir(root);
    qwen_design::prune_unsaved(&qd, 6);
    let log = setup_check::log_path(root).with_file_name("qwen-server.log");
    let mut out = Vec::new();
    for i in 0..3u32 {
        let id = (0..20).map(|k| qwen_design::new_id(i * 31 + k)).find(|id| !qwen_design::wav_path(&qd, id).exists()).ok_or("Could not make a new voice id.")?;
        let seed = (qwen_seed(&id).wrapping_add(i * 7919)) % 2_000_000_000 + 1;
        let request = serde_json::json!({"op": "design", "text": sample.trim(), "instruct": description.trim(), "language": "English", "model": QWEN_MODEL, "seed": seed});
        let done = qwen_warm::speak(&qwen_python(root), include_str!("../../../runtime/qwen_server.py"), &qd.join("hf"), &log, &request, std::time::Duration::from_secs(1500))?;
        qwen_design::write(&qd, &id, &qwen_design::Designed { description: description.trim().to_string(), seed, text: sample.trim().to_string(), saved: false }, &done.wav)?;
        out.push(QwenDesignPreview { generated_voice_id: id, seconds: qwen_design::wav_seconds(&done.wav), audio_b64: b64(&done.wav) });
    }
    Ok(out)
}

#[tauri::command]
async fn qwen_design_preview(app: tauri::AppHandle, description: String, sample: String) -> Result<Vec<QwenDesignPreview>, String> { let docs = root(&app)?; blocking(move || qwen_design_preview_blocking(&docs, &description, &sample)).await }

/// Keeps one preview as a voice. Returns its id, which is the voice id in the library.
#[tauri::command]
async fn qwen_design_save(app: tauri::AppHandle, generated: String) -> Result<String, String> {
    let docs = root(&app)?;
    blocking(move || { qwen_design::mark_saved(&qwen_dir(&docs), &generated)?; Ok(generated) }).await
}

const QWEN_VOICE_IDS: [&str; 4] = ["qwen-warm-narrator", "qwen-gravel-man", "qwen-bright-young-woman", "qwen-gentle-older-man"];

/// Whether PyTorch inside the Qwen runtime can see a graphics card, and its name.
fn qwen_gpu_probe(root: &std::path::Path) -> (bool, String) {
    let python = qwen_python(root);
    if !python.is_file() { return (false, String::new()); }
    let out = hidden_command(&python).args(["-c", "import torch; print(torch.cuda.is_available()); print(torch.cuda.get_device_name(0) if torch.cuda.is_available() else '')"]).output();
    match out {
        Ok(o) if o.status.success() => { let t = String::from_utf8_lossy(&o.stdout).to_string(); let mut l = t.lines(); (l.next() == Some("True"), l.next().unwrap_or("").trim().to_string()) }
        _ => (false, String::new()),
    }
}

fn qwen_lock_status_of(root: &std::path::Path) -> QwenLockStatus {
    let (gpu, gpu_name) = qwen_gpu_probe(root);
    QwenLockStatus { base_ready: qwen_base_marker(root).is_file(), gpu, gpu_name, voices: QWEN_VOICE_IDS.iter().map(|v| QwenVoiceLock { id: (*v).to_string(), locked: qwen_locked(root, v) }).collect() }
}

#[tauri::command]
async fn qwen_lock_status(app: tauri::AppHandle) -> Result<QwenLockStatus, String> { let docs = root(&app)?; blocking(move || Ok(qwen_lock_status_of(&docs))).await }

/// Downloads the Base model (about 4 GB) so a voice can be locked to a reference clip. Survives stalls and resumes.
fn qwen_base_download_blocking(docs: &std::path::Path) -> Result<QwenLockStatus, String> {
        static SETUP: Mutex<()> = Mutex::new(());
        let _guard = SETUP.lock().map_err(|_| "Setup is unavailable. Restart Greenroom and try again.")?;
        let python = qwen_python(docs);
        if !python.is_file() { return Err("Install the Qwen3-TTS runtime first.".into()); }
        let out = hidden_command(&python).args(["-c", include_str!("../../../runtime/qwen_fetch.py"), QWEN_BASE]).env("HF_HOME", qwen_dir(docs).join("hf")).env("HF_HUB_DOWNLOAD_TIMEOUT", "60").output().map_err(|_| "Could not start the model download.")?;
        if !out.status.success() {
            let why = setup_check::why(&String::from_utf8_lossy(&out.stderr));
            setup_check::append_log(docs, &format!("qwen base download failed: {why}"));
            return Err(format!("The Base model did not finish downloading. It picks up where it stopped when you try again. {why}"));
        }
        store::atomic_write(&qwen_base_marker(docs), QWEN_BASE.as_bytes())?;
        Ok(qwen_lock_status_of(docs))
}

#[tauri::command]
async fn qwen_base_download(app: tauri::AppHandle) -> Result<QwenLockStatus, String> { let docs = root(&app)?; blocking(move || qwen_base_download_blocking(&docs)).await }

/// Makes the reference clip for one built-in voice (VoiceDesign speaks the fixed sentence once) and keeps it. From then on the voice
/// copies this one clip for every line. Needs the Base model on this PC.
fn qwen_lock_voice_blocking(docs: &std::path::Path, voice: &str) -> Result<QwenLockStatus, String> {
        let instruct = qwen_voice_description(voice).ok_or("That Qwen voice is not available.")?;
        if !qwen_base_marker(docs).is_file() { return Err("Download the Base model first.".into()); }
        let python = qwen_python(docs);
        let request = serde_json::json!({"op": "reference", "text": QWEN_REFERENCE_TEXT, "instruct": instruct, "language": "English", "model": QWEN_MODEL, "seed": qwen_seed(voice)});
        let log = setup_check::log_path(docs).with_file_name("qwen-server.log");
        let done = qwen_warm::speak(&python, include_str!("../../../runtime/qwen_server.py"), &qwen_dir(docs).join("hf"), &log, &request, std::time::Duration::from_secs(1500))?;
        if done.wav.len() < 20_000 { return Err("The reference clip came back almost empty. Try again.".into()); }
        store::atomic_write(&qwen_ref_wav(docs, voice), &done.wav)?;
        setup_check::append_log(docs, &format!("qwen reference clip made for {voice} on {} in {:.1}s", done.device, done.seconds));
        Ok(qwen_lock_status_of(docs))
}

#[tauri::command]
async fn qwen_lock_voice(app: tauri::AppHandle, voice: String) -> Result<QwenLockStatus, String> { let docs = root(&app)?; blocking(move || qwen_lock_voice_blocking(&docs, &voice)).await }

/// Takes the lock off one voice: it returns to being designed from its description on every line.
fn qwen_unlock_voice_blocking(docs: &std::path::Path, voice: &str) -> Result<QwenLockStatus, String> {
        qwen_voice_description(voice).ok_or("That Qwen voice is not available.")?;
        let _ = std::fs::remove_file(qwen_ref_wav(docs, voice));
        Ok(qwen_lock_status_of(docs))
}

#[tauri::command]
async fn qwen_unlock_voice(app: tauri::AppHandle, voice: String) -> Result<QwenLockStatus, String> { let docs = root(&app)?; blocking(move || qwen_unlock_voice_blocking(&docs, &voice)).await }

/// Replaces the CPU build of PyTorch inside the Qwen runtime with a CUDA build so a graphics card can run Qwen3-TTS.
fn qwen_gpu_install_blocking(docs: &std::path::Path) -> Result<QwenLockStatus, String> {
        static SETUP: Mutex<()> = Mutex::new(());
        let _guard = SETUP.lock().map_err(|_| "Setup is unavailable. Restart Greenroom and try again.")?;
        let python = qwen_python(docs);
        if !python.is_file() { return Err("Install the Qwen3-TTS runtime first.".into()); }
        qwen_warm::stop();
        let program = python.to_string_lossy();
        run_setup_command(&program, &["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input", "--only-binary=:all:", "--force-reinstall", "--no-deps", "--index-url", "https://download.pytorch.org/whl/cu124", "torch==2.6.0", "torchaudio==2.6.0"], "the graphics-card PyTorch installer")?;
        let st = qwen_lock_status_of(docs);
        setup_check::append_log(docs, &format!("qwen gpu install finished: cuda available = {} {}", st.gpu, st.gpu_name));
        if !st.gpu { return Err("The graphics-card PyTorch installed but cannot see a graphics card. Qwen3-TTS keeps running on the processor.".into()); }
        Ok(st)
}

#[tauri::command]
async fn qwen_gpu_install(app: tauri::AppHandle) -> Result<QwenLockStatus, String> { let docs = root(&app)?; blocking(move || qwen_gpu_install_blocking(&docs)).await }

/// Frees the warm Qwen3-TTS worker's memory. The next line starts it again.
#[tauri::command]
async fn qwen_unload() -> Result<bool, String> { blocking(|| Ok(qwen_warm::stop())).await }

#[tauri::command]
async fn qwen_prefetch(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> { let docs = root(&app)?; blocking(move || qwen_prefetch_blocking(&docs)).await }

// ---- Portraits ------------------------------------------------------------------------------------------------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AvatarOut {
    image_b64: String,
    mime: String,
}

/// A character portrait from a text description, through the owner's Kie key. Paid: the UI asks first.
#[tauri::command]
async fn avatar_generate(prompt: String) -> Result<AvatarOut, String> {
    blocking(move || {
        let c = kie::Client::new(kie::BASE, &get_key("kie")?);
        let (bytes, kind) = c.image(&prompt, &|u| net::download(u, 12 << 20))?;
        Ok(AvatarOut { image_b64: b64(&bytes), mime: kind.into() })
    })
    .await
}

// ---- Inworld --------------------------------------------------------------------------------------------------

/// Proves the saved credential works. Returns how many voices the account can see.
#[tauri::command]
async fn inworld_check() -> Result<u64, String> {
    blocking(|| inworld_client()?.check()).await
}

#[tauri::command]
async fn voices_inworld(language: Option<String>, source: Option<String>) -> Result<inworld::VoicePage, String> {
    blocking(move || inworld_client()?.voices(language.as_deref(), source.as_deref())).await
}

/// A short listening copy through the streaming endpoint. It is billed like any other speech, so the UI asks first.
#[tauri::command]
async fn inworld_preview(text: String, voice: String, model: String) -> Result<Audio, String> {
    blocking(move || {
        let s = inworld_client()?.speak_stream_mp3(&text, &voice, &model, inworld::SpeechOpts::default())?;
        Ok(Audio { mime: net::mime_of(&s.audio).into(), audio_b64: b64(&s.audio) })
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InworldCloneReq {
    name: String,
    language: Option<String>,
    description: String,
    audio_b64: String,
    transcription: Option<String>,
    remove_noise: bool,
    permission: bool,
    speaker: String,
}

/// Cloning needs the owner's confirmation that the speaker agreed; it is checked here as well as in the UI.
#[tauri::command]
async fn inworld_clone(req: InworldCloneReq) -> Result<inworld::Cloned, String> {
    inworld::consent_ok(req.permission, &req.speaker)?;
    blocking(move || inworld_client()?.clone_voice(&req.name, req.language.as_deref(), &req.description, &unb64(&req.audio_b64)?, req.transcription.as_deref(), req.remove_noise)).await
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
fn avatars_load(app: tauri::AppHandle) -> Result<String, String> {
    Ok(store::avatars_load(&root(&app)?))
}

#[tauri::command]
fn avatars_save(app: tauri::AppHandle, json: String) -> Result<(), String> {
    store::avatars_save(&root(&app)?, &json)
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ScriptFile {
    name: String,
    format: String,
    text: String,
    truncated: bool,
}

/// Reads a script file the owner chose (text, Markdown, Fountain, Word or PDF) and returns its text. Nothing is written to disk.
#[tauri::command]
async fn script_open(path: String) -> Result<ScriptFile, String> {
    if path.len() > 1024 || path.contains(' ') {
        return Err("That file name is not valid.".into());
    }
    blocking(move || {
        let p = PathBuf::from(&path);
        let got = script_import::read_script(&p)?;
        let name: String = p.file_name().and_then(|n| n.to_str()).unwrap_or("script").chars().filter(|c| !c.is_control()).take(120).collect();
        Ok(ScriptFile { name, format: got.format.to_string(), text: got.text, truncated: got.truncated })
    })
    .await
}

/// Looks for the usual reasons an engine does not install: space, the internet addresses the installers use, and (for gated models) the Hugging Face account.
#[tauri::command]
async fn setup_check(app: tauri::AppHandle, engine: String) -> Result<Vec<setup_check::CheckItem>, String> {
    let docs = root(&app)?;
    blocking(move || {
        let need = match engine.as_str() {
            "wazobia" => 9,
            "acestep" => 10,
            "qwen" | "chatterbox" | "sfx" => 7,
            "kokoro" => 4,
            _ => 3,
        };
        let runtime = matches!(engine.as_str(), "wazobia" | "chatterbox" | "kokoro" | "qwen" | "acestep" | "sfx" | "all");
        let net_fix = "Check your internet connection. A firewall, antivirus or work network can block it: allow Greenroom, or try another network.";
        let mut targets: Vec<(&str, &str)> = vec![("Hugging Face (models)", "https://huggingface.co/")];
        if runtime {
            targets.extend([("python.org (the private Python)", "https://www.python.org/ftp/python/3.11.9/python-3.11.9-embed-amd64.zip"), ("pypi.org (Python packages)", "https://pypi.org/simple/pip/"), ("files.pythonhosted.org (package files)", "https://files.pythonhosted.org/"), ("download.pytorch.org (PyTorch)", "https://download.pytorch.org/whl/cpu/")]);
        }
        let mut out = vec![setup_check::path_check(&docs), setup_check::disk_check(&docs, need)];
        let nets: Vec<setup_check::CheckItem> = std::thread::scope(|sc| {
            let hs: Vec<_> = targets.iter().map(|(n, u)| sc.spawn(move || setup_check::reach(n, u, net_fix))).collect();
            hs.into_iter().filter_map(|h| h.join().ok()).collect()
        });
        out.extend(nets);
        if engine == "wazobia" {
            match get_key("huggingface") {
                Err(_) => out.push(setup_check::CheckItem { name: "Hugging Face token".into(), ok: false, detail: "no token saved".into(), fix: "Paste a Hugging Face read token (huggingface.co/settings/tokens) in the WazobiaVoice card.".into() }),
                Ok(token) => {
                    let m = wazobia_manifest();
                    let agent = net::agent();
                    let tree = format!("https://huggingface.co/api/models/{}/tree/{}?recursive=true", m.repo, m.revision);
                    let who = agent.get("https://huggingface.co/api/whoami-v2").set("Authorization", &format!("Bearer {token}")).call();
                    out.push(match who {
                        Ok(_) => setup_check::CheckItem { name: "Hugging Face token".into(), ok: true, detail: "accepted".into(), fix: String::new() },
                        Err(ureq::Error::Status(c, _)) => setup_check::CheckItem { name: "Hugging Face token".into(), ok: false, detail: format!("Hugging Face answered {c}"), fix: "The saved token was not accepted. Make a new READ token at huggingface.co/settings/tokens and paste it again.".into() },
                        Err(_) => setup_check::CheckItem { name: "Hugging Face token".into(), ok: false, detail: "could not check".into(), fix: net_fix.into() },
                    });
                    let gate = agent.get(&tree).set("Authorization", &format!("Bearer {token}")).call();
                    out.push(match gate {
                        Ok(r) => {
                            let listed = net::read_json(r, 4 << 20).ok().and_then(|v| v.as_array().map(|a| a.iter().any(|x| x["path"].as_str() == m.files.first().map(|f| f.path)))).unwrap_or(false);
                            let first = m.files.first().map(|f| format!("https://huggingface.co/{}/resolve/{}/{}", m.repo, m.revision, f.path));
                            let access = first.map(|u| agent.head(&u).set("Authorization", &format!("Bearer {token}")).call().is_ok()).unwrap_or(false);
                            if listed && access {
                                setup_check::CheckItem { name: "WazobiaVoice terms".into(), ok: true, detail: "this account can download the model".into(), fix: String::new() }
                            } else {
                                setup_check::CheckItem { name: "WazobiaVoice terms".into(), ok: false, detail: "this account cannot download the files yet".into(), fix: "Open huggingface.co/Axiveri/WazobiaVoice signed in to the SAME account as the token, press Agree and access repository, then try again.".into() }
                            }
                        }
                        Err(ureq::Error::Status(c, _)) => setup_check::CheckItem { name: "WazobiaVoice terms".into(), ok: false, detail: format!("Hugging Face answered {c}"), fix: "Open huggingface.co/Axiveri/WazobiaVoice signed in to the SAME account as the token, press Agree and access repository, then try again.".into() },
                        Err(_) => setup_check::CheckItem { name: "WazobiaVoice terms".into(), ok: false, detail: "could not check".into(), fix: net_fix.into() },
                    });
                }
            }
        }
        Ok(out)
    })
    .await
}

/// Text to copy and send when an install fails: the machine, the checks, and the end of the setup log. It never contains a key.
#[tauri::command]
async fn setup_report(app: tauri::AppHandle) -> Result<String, String> {
    let docs = root(&app)?;
    blocking(move || {
        let checks = vec![setup_check::path_check(&docs), setup_check::disk_check(&docs, 9), setup_check::reach("pypi.org", "https://pypi.org/simple/pip/", "Check your internet connection."), setup_check::reach("Hugging Face", "https://huggingface.co/", "Check your internet connection.")];
        Ok(setup_check::report(env!("CARGO_PKG_VERSION"), &docs, &checks))
    })
    .await
}

/// The model ids the app offers for OpenAI and Gemini (and each default), so the screen shows one list and the check stays here.
#[tauri::command]
fn llm_models() -> serde_json::Value {
    serde_json::json!({
        "openai": { "models": llm::OPENAI_MODELS, "default": llm::OPENAI_DEFAULT },
        "gemini": { "models": llm::GEMINI_MODELS, "default": llm::GEMINI_DEFAULT },
    })
}

/// The AI Director and script reading: one question to a cloud text model (Kie by default, or OpenAI or Gemini). The prompt is
/// built in the app; this only carries it. The model name is checked here, whatever the screen sent.
#[tauri::command]
async fn director_complete(system: String, user: String, provider: Option<String>, model: Option<String>) -> Result<String, String> {
    if system.len() > 20_000 || user.len() > 200_000 {
        return Err("That is too long to send in one go. Try one scene at a time.".into());
    }
    let model = model.unwrap_or_default();
    if !model.is_empty() && !llm::valid_model(&model) {
        return Err("That model name is not valid.".into());
    }
    match provider.as_deref().unwrap_or("kie") {
        "openai" => blocking(move || llm::Client::new(llm::OPENAI_BASE, &get_key("openai")?).openai(if model.is_empty() { llm::OPENAI_DEFAULT } else { &model }, &system, &user)).await,
        "gemini" => blocking(move || llm::Client::new(llm::GEMINI_BASE, &get_key("gemini")?).gemini(if model.is_empty() { llm::GEMINI_DEFAULT } else { &model }, &system, &user)).await,
        "kie" => {
            if user.len() > 60_000 {
                return Err("That scene is too long to send in one go. Try one scene at a time.".into());
            }
            blocking(move || kie::Client::new(kie::BASE, &get_key("kie")?).chat(kie::DIRECTOR_MODEL, &system, &user)).await
        }
        _ => Err("Unknown AI provider.".into()),
    }
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
        let (key, speaker) = local::split_speaker(&key).map(|(k, n)| (k.to_string(), n.unwrap_or(0))).ok_or("That voice is not valid.")?;
        let voice = catalog()?.into_iter().find(|v| v.key == key).ok_or("That voice is not in the catalogue.")?;
        let parent = voice.onnx.0.rsplit_once('/').ok_or("No sample is listed for this voice.")?.0;
        let bytes = net::download(&format!("{}{parent}/samples/speaker_{speaker}.mp3", local::VOICES_BASE), 6 << 20)
            .map_err(|_| "This voice has no available online sample. Add it to generate one locally.".to_string())?;
        if bytes.len() < 100 { return Err("This voice has no available online sample. Add it to generate one locally.".into()); }
        Ok(Audio { mime: "audio/mpeg".into(), audio_b64: b64(&bytes) })
    }).await
}

#[tauri::command]
async fn piper_install_voice(app: tauri::AppHandle, key: String) -> Result<(), String> {
    let r = root(&app)?;
    let key = local::split_speaker(&key).map(|(k, _)| k.to_string()).ok_or("That voice is not valid.")?;
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

/// WazobiaVoice (Axiveri) is gated on Hugging Face: the person must accept its terms with their own account and
/// save a read token in Settings. Files are pinned to one commit; sizes are fixed here, checksums come from that
/// commit through the person's token and every byte is verified. Licence: non-commercial research (see model card).
fn wazobia_manifest() -> &'static model_manager::GatedManifest {
    use model_manager::{GatedFile, GatedManifest};
    const FILES: &[GatedFile] = &[
        GatedFile { path: "merged_model/t3_mtl23ls_v2.safetensors", filename: "t3_mtl23ls_v2.safetensors", bytes: 2_143_989_752, git_oid: None },
        GatedFile { path: "merged_model/s3gen.pt", filename: "s3gen.pt", bytes: 1_057_167_837, git_oid: None },
        GatedFile { path: "merged_model/ve.pt", filename: "ve.pt", bytes: 5_697_762, git_oid: None },
        GatedFile { path: "merged_model/conds.pt", filename: "conds.pt", bytes: 107_767, git_oid: None },
        GatedFile { path: "merged_model/grapheme_mtl_merged_expanded_v1.json", filename: "grapheme_mtl_merged_expanded_v1.json", bytes: 69_989, git_oid: Some("d27fb3f2fd38ca39b7bbfbf83a13b3c617e551df") },
        GatedFile { path: "voices.json", filename: "voices.json", bytes: 4_120, git_oid: Some("2899bffc08da42994b400221daa1b1489f3686b5") },
        GatedFile { path: "inbuilt_voices/adaeze.wav", filename: "voice-adaeze.wav", bytes: 449324, git_oid: None },
        GatedFile { path: "inbuilt_voices/amara.wav", filename: "voice-amara.wav", bytes: 737324, git_oid: None },
        GatedFile { path: "inbuilt_voices/bolaji.wav", filename: "voice-bolaji.wav", bytes: 483884, git_oid: None },
        GatedFile { path: "inbuilt_voices/elder_deji.wav", filename: "voice-elder_deji.wav", bytes: 529244, git_oid: None },
        GatedFile { path: "inbuilt_voices/emeka.wav", filename: "voice-emeka.wav", bytes: 444716, git_oid: None },
        GatedFile { path: "inbuilt_voices/hauwa.wav", filename: "voice-hauwa.wav", bytes: 368684, git_oid: None },
        GatedFile { path: "inbuilt_voices/ife.wav", filename: "voice-ife.wav", bytes: 529244, git_oid: None },
        GatedFile { path: "inbuilt_voices/james.wav", filename: "voice-james.wav", bytes: 557100, git_oid: None },
        GatedFile { path: "inbuilt_voices/john.wav", filename: "voice-john.wav", bytes: 529244, git_oid: None },
        GatedFile { path: "inbuilt_voices/musa.wav", filename: "voice-musa.wav", bytes: 338988, git_oid: None },
        GatedFile { path: "inbuilt_voices/ngozi.wav", filename: "voice-ngozi.wav", bytes: 196790, git_oid: None },
        GatedFile { path: "inbuilt_voices/tunde.wav", filename: "voice-tunde.wav", bytes: 174284, git_oid: None },
        GatedFile { path: "inbuilt_voices/wura.wav", filename: "voice-wura.wav", bytes: 465452, git_oid: None },
    ];
    static WAZOBIA: GatedManifest = GatedManifest { id: "wazobia-voice", version: "8ca840df", repo: "Axiveri/WazobiaVoice", revision: "8ca840df03f738e56086a0f501819bdedd59e516", files: FILES };
    &WAZOBIA
}

#[tauri::command]
async fn wazobia_install_download(app: tauri::AppHandle) -> Result<model_manager::ModelState, String> {
    blocking(move || {
        let token = get_key("huggingface")?;
        let _guard = MODEL_INSTALL_LOCK.try_lock().map_err(|_| "Another model download or install is already in progress.")?;
        model_manager::install_gated(&app, wazobia_manifest(), &token)
    }).await
}

#[tauri::command]
async fn wazobia_install_automatic(app: tauri::AppHandle) -> Result<model_manager::ModelState, String> {
    let home = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME")).ok_or("Could not find your home folder.")?;
    let home = std::path::PathBuf::from(home);
    let filename = "t3_mtl23ls_v2.safetensors";
    let source = [home.join("Desktop").join(filename), home.join("Downloads").join(filename)]
        .into_iter().find(|p| p.is_file())
        .ok_or("Greenroom could not find t3_mtl23ls_v2.safetensors on your Desktop or in Downloads. Use Choose model file to select it.")?;
    blocking(move || {
        let _guard = MODEL_INSTALL_LOCK.try_lock().map_err(|_| "Another model download or install is already in progress.")?;
        model_manager::import_wazobia_weight(&app, &source)
    }).await
}

#[tauri::command]
async fn wazobia_import_file(app: tauri::AppHandle, path: String) -> Result<model_manager::ModelState, String> {
    let source = std::path::PathBuf::from(path);
    blocking(move || {
        let _guard = MODEL_INSTALL_LOCK.try_lock().map_err(|_| "Another model download or install is already in progress.")?;
        model_manager::import_wazobia_weight(&app, &source)
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
    // ACE-Step v1 3.5B (Apache-2.0, not gated). Pinned to one Hugging Face commit; every size and SHA-256 below was read on 2026-11-02.
    const ACE_FILES: &[Artifact] = &[
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/ace_step_transformer/config.json", bytes: 639, sha256: "4d78beb6afb4c7f3705256b44faaf60f3e1e2d78f4015ca87740f3695d7f5447", filename: "ace_step_transformer/config.json" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/ace_step_transformer/diffusion_pytorch_model.safetensors", bytes: 6611422728, sha256: "e810f16728d8a2e0d1b9c3a907aac8c9a427ce38edbd890cb3dce5ff92da5aad", filename: "ace_step_transformer/diffusion_pytorch_model.safetensors" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/config.json", bytes: 639, sha256: "4d78beb6afb4c7f3705256b44faaf60f3e1e2d78f4015ca87740f3695d7f5447", filename: "config.json" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/music_dcae_f8c8/config.json", bytes: 1034, sha256: "b14a49a8c52a52c2c8050098af1a946810a8a1a0b6e50abc75ba81371383cf04", filename: "music_dcae_f8c8/config.json" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/music_dcae_f8c8/diffusion_pytorch_model.safetensors", bytes: 313646516, sha256: "2b0cb469307ac50659d1880db2a99bae47d0df335cbb36853964662d4b80e8ee", filename: "music_dcae_f8c8/diffusion_pytorch_model.safetensors" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/music_vocoder/config.json", bytes: 940, sha256: "39ddc4c417e01dc3be1862fcf315887358dd61b7f91c3cc8227f65072984bb55", filename: "music_vocoder/config.json" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/music_vocoder/diffusion_pytorch_model.safetensors", bytes: 206350988, sha256: "c92c9b46e28ab7b37b777780cf4308ad7ddac869636bb77aa61599358c4bc1c0", filename: "music_vocoder/diffusion_pytorch_model.safetensors" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/umt5-base/config.json", bytes: 848, sha256: "afae5da9a35e2b293cee66536f03fc2581cfc3f3d5707d3a262b552748de1572", filename: "umt5-base/config.json" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/umt5-base/model.safetensors", bytes: 1127460248, sha256: "779cec0d210b2123e21d0a9cd8128f02b4d412627355028965a8be0b241cc3b6", filename: "umt5-base/model.safetensors" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/umt5-base/special_tokens_map.json", bytes: 7079, sha256: "456b58fd240a06c743a7c2cf8008bec501240d68ebd1fc4018ea569505fea270", filename: "umt5-base/special_tokens_map.json" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/umt5-base/tokenizer.json", bytes: 16837459, sha256: "20a46ac256746594ed7e1e3ef733b83fbc5a6f0922aa7480eda961743de080ef", filename: "umt5-base/tokenizer.json" },
        Artifact { url: "https://huggingface.co/ACE-Step/ACE-Step-v1-3.5B/resolve/82cd0d7b6322bd28cd4e830fe675ddb6180ce36c/umt5-base/tokenizer_config.json", bytes: 61728, sha256: "ed9a3a8b0faa71a70a32847e0435fe036e6e112d4df4edb7bb48a921e344dc05", filename: "umt5-base/tokenizer_config.json" },
    ];
    static ACESTEP: Manifest = Manifest { id: "ace-step-v1", version: "82cd0d7b", artifacts: ACE_FILES };
    // T5-base text encoder used by Stable Audio Open Small (Apache-2.0, not gated). Pinned to one commit, read 2026-11-02.
    const T5_FILES: &[Artifact] = &[
        Artifact { url: "https://huggingface.co/google-t5/t5-base/resolve/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1/model.safetensors", bytes: 891646390, sha256: "a90903540cc02cbeb7ff9f823f1a80eb778c7e22426a0e620b01c77a5ec8f5b4", filename: "model.safetensors" },
        Artifact { url: "https://huggingface.co/google-t5/t5-base/resolve/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1/config.json", bytes: 1208, sha256: "46dd7cb62d29c81fb551e0ef1ea274c24a46ba441eeb948897706252933df033", filename: "config.json" },
        Artifact { url: "https://huggingface.co/google-t5/t5-base/resolve/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1/spiece.model", bytes: 791656, sha256: "d60acb128cf7b7f2536e8f38a5b18a05535c9e14c7a355904270e15b0945ea86", filename: "spiece.model" },
        Artifact { url: "https://huggingface.co/google-t5/t5-base/resolve/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1/tokenizer.json", bytes: 1389353, sha256: "d2acde0d8d71dd30a711834b07781b9c89feaac33fd332f60507699282740066", filename: "tokenizer.json" },
        Artifact { url: "https://huggingface.co/google-t5/t5-base/resolve/a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1/generation_config.json", bytes: 147, sha256: "f5a1c7e2be8092018d8835128987edf0111637dd98e90599cc80310fef75d95a", filename: "generation_config.json" },
    ];
    static T5: Manifest = Manifest { id: "sfx-text-encoder", version: "a9723ea7", artifacts: T5_FILES };
    // Qwen3-4B-Instruct-2507, Q4_K_M (Apache-2.0, not gated), for the local AI Director. Pinned, read 2026-11-02.
    const DIRECTOR_FILES: &[Artifact] = &[
        Artifact { url: "https://huggingface.co/unsloth/Qwen3-4B-Instruct-2507-GGUF/resolve/a06e946bb6b655725eafa393f4a9745d460374c9/Qwen3-4B-Instruct-2507-Q4_K_M.gguf", bytes: 2_497_281_120, sha256: "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597", filename: "Qwen3-4B-Instruct-2507-Q4_K_M.gguf" },
    ];
    static DIRECTOR: Manifest = Manifest { id: "director-qwen3-4b", version: "a06e946b", artifacts: DIRECTOR_FILES };
    if id == DIRECTOR.id { return Some(&DIRECTOR); }
    if id == CHATTERBOX.id { Some(&CHATTERBOX) } else if id == ACESTEP.id { Some(&ACESTEP) } else if id == T5.id { Some(&T5) } else { None }
}


// ---- local music: ACE-Step -------------------------------------------------------------------------------------

/// The ACE-Step source at one commit (Apache-2.0). The PyPI package cannot be installed on Windows, so the pinned GitHub archive is used.
const ACESTEP_SOURCE: &str = "https://github.com/ace-step/ACE-Step/archive/1bee4c9f5b43e30995f8d4d33b3919197ce1bd68.zip";
const ACESTEP_IMPORT_CHECK: &str = "import acestep, torch; assert torch.cuda.is_available()";

fn has_nvidia_gpu() -> bool { command_ok(std::path::Path::new("nvidia-smi"), &["-L"]) }

fn acestep_dir(models: &std::path::Path) -> Option<PathBuf> {
    let m = managed_manifest("ace-step-v1")?;
    let dir = models.join(m.id).join(m.version);
    m.artifacts.iter().all(|a| dir.join(a.filename).is_file()).then_some(dir)
}

fn acestep_status(root: &std::path::Path, models: &std::path::Path) -> LocalRuntimeStatus {
    let dir = root.join("runtime").join("acestep-managed");
    let python = dir.join("python.exe");
    let installed = dir.join("complete").is_file() && python.is_file() && command_ok(&python, &["-c", ACESTEP_IMPORT_CHECK]);
    let model_ready = acestep_dir(models).is_some();
    let detail = match (installed, model_ready) {
        (true, true) => "Ready. Music is made on this computer.".to_string(),
        (true, false) => "Engine ready. Download the ACE-Step music model (8.3 GB).".to_string(),
        (false, true) => "Model downloaded. Install the music engine.".to_string(),
        _ if !has_nvidia_gpu() => "ACE-Step needs an NVIDIA graphics card with at least 8 GB of video memory. None was found.".to_string(),
        _ => "Install the music engine and download the model (about 11 GB in total).".to_string(),
    };
    LocalRuntimeStatus { installed, model_ready, detail }
}

fn setup_acestep_runtime(root: &std::path::Path, models: &std::path::Path) -> Result<LocalRuntimeStatus, String> {
    static SETUP: Mutex<()> = Mutex::new(());
    let _guard = SETUP.lock().map_err(|_| "Setup is unavailable. Restart Greenroom and try again.")?;
    if acestep_status(root, models).installed { return Ok(acestep_status(root, models)); }
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) { return Err("The music engine currently supports Windows x64 with an NVIDIA graphics card.".into()); }
    if !has_nvidia_gpu() { return Err("ACE-Step needs an NVIDIA graphics card with at least 8 GB of video memory. None was found on this computer.".into()); }
    let dir = root.join("runtime").join("acestep-managed");
    let python = managed_python::bootstrap(&dir)?;
    let program = python.to_string_lossy();
    let pip = |args: &[&str], label: &str| -> Result<(), String> {
        let mut all = vec!["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input"];
        all.extend_from_slice(args);
        let output = hidden_command(python.as_os_str()).args(&all).env("PYTHONUTF8", "1").output().map_err(|_| format!("Could not start {label}."))?;
        if output.status.success() { return Ok(()); }
        let detail = String::from_utf8_lossy(&output.stderr).replace(['\r', '\n'], " ");
        Err(format!("{label} did not finish. {}", detail.chars().rev().take(240).collect::<String>().chars().rev().collect::<String>()))
    };
    let _ = &program;
    pip(&["setuptools", "wheel"], "the build tools installer")?;
    pip(&["--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cu124", "torch==2.6.0", "torchaudio==2.6.0", "torchvision==0.21.0"], "the GPU runtime installer")?;
    pip(&["--no-build-isolation", ACESTEP_SOURCE], "the music engine installer")?;
    if !command_ok(&python, &["-c", ACESTEP_IMPORT_CHECK]) { return Err("The music engine installed but could not use your graphics card. Retry setup.".into()); }
    crate::store::atomic_write(&dir.join("complete"), b"python-3.11.9;torch-2.6.0-cu124;ace-step-1bee4c9")?;
    Ok(acestep_status(root, models))
}

#[tauri::command]
async fn acestep_status_cmd(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || Ok(acestep_status(&r, &m))).await
}

#[tauri::command]
async fn acestep_runtime_install(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || setup_acestep_runtime(&r, &m)).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalMusicReq { title: String, style: String, lyrics: String, seconds: u32, seed: Option<u32> }

fn check_local_music(req: &LocalMusicReq) -> Result<(), String> {
    if req.style.trim().is_empty() || req.style.chars().count() > 1000 { return Err("Describe the music in 1 to 1000 characters.".into()); }
    if req.lyrics.chars().count() > 2000 { return Err("Lyrics can be up to 2000 characters.".into()); }
    if !(10..=90).contains(&req.seconds) { return Err("Choose a length between 10 and 90 seconds.".into()); }
    Ok(())
}

/// Makes one track on this computer. The result is kept in the project as a take that is never overwritten.
#[tauri::command]
async fn music_local_generate(app: tauri::AppHandle, project: String, req: LocalMusicReq) -> Result<Vec<MadeMusic>, String> {
    check_local_music(&req)?;
    let (r, models) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || {
        use std::io::Write;
        use std::process::Stdio;
        static GENERATION: Mutex<()> = Mutex::new(());
        let _guard = GENERATION.lock().map_err(|_| "Music is unavailable. Restart Greenroom and try again.")?;
        let status = acestep_status(&r, &models);
        if !status.installed || !status.model_ready { return Err(status.detail); }
        let model = acestep_dir(&models).ok_or("The ACE-Step model files are missing. Download them in Model Center.")?;
        let python = r.join("runtime").join("acestep-managed").join("python.exe");
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let out = std::env::temp_dir().join(format!("greenroom-music-{nanos:x}.wav"));
        let seed = req.seed.unwrap_or((nanos % 1_000_000) as u32);
        let input = serde_json::json!({"model_dir": model, "prompt": req.style.trim(), "lyrics": req.lyrics.trim(), "seconds": req.seconds, "seed": seed, "out": out});
        let mut cmd = hidden_command(&python);
        cmd.args(["-c", include_str!("../../../runtime/acestep_once.py")]).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|_| "Could not start the music engine.")?;
        child.stdin.take().ok_or("Could not send the request to the music engine.")?.write_all(input.to_string().as_bytes()).map_err(|_| "Could not send the request to the music engine.")?;
        let done = child.wait().map_err(|_| "The music engine stopped unexpectedly.")?;
        let bytes = std::fs::read(&out).ok();
        let _ = std::fs::remove_file(&out);
        let bytes = match (done.success(), bytes) { (true, Some(b)) if b.starts_with(b"RIFF") => b, _ => return Err("The music engine could not make this track. Try a shorter length, or check that no other program is using the graphics card.".into()) };
        let id = format!("m-{nanos:x}0");
        store::take_write(&r, &project, &id, "wav", &bytes)?;
        use sha2::{Digest, Sha256};
        let sha256 = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        let name = if req.title.trim().is_empty() { "ACE-Step track".to_string() } else { req.title.trim().chars().take(80).collect() };
        Ok(vec![MadeMusic { id, ext: "wav".into(), name, bytes: bytes.len() as u64, sha256, seconds: req.seconds as f64 }])
    })
    .await
}

#[cfg(test)]
mod local_music_tests {
    use super::*;
    fn req(style: &str, secs: u32) -> LocalMusicReq { LocalMusicReq { title: "t".into(), style: style.into(), lyrics: String::new(), seconds: secs, seed: None } }
    #[test]
    fn request_limits_are_enforced_before_anything_starts() {
        assert!(check_local_music(&req("calm piano", 20)).is_ok());
        assert!(check_local_music(&req("  ", 20)).is_err());
        assert!(check_local_music(&req(&"x".repeat(1001), 20)).is_err());
        assert!(check_local_music(&req("ok", 9)).is_err());
        assert!(check_local_music(&req("ok", 91)).is_err());
        let mut long = req("ok", 20); long.lyrics = "y".repeat(2001);
        assert!(check_local_music(&long).is_err());
    }
    #[test]
    fn acestep_manifest_is_pinned_and_complete() {
        let m = managed_manifest("ace-step-v1").unwrap();
        assert_eq!(m.artifacts.len(), 12);
        assert!(m.artifacts.iter().all(|a| a.sha256.len() == 64 && a.url.contains("82cd0d7b6322bd28cd4e830fe675ddb6180ce36c")));
        let total: u64 = m.artifacts.iter().map(|a| a.bytes).sum();
        assert!((8_200_000_000..8_400_000_000).contains(&total), "{total}");
        assert!(m.artifacts.iter().any(|a| a.filename == "umt5-base/model.safetensors"));
    }
    #[test]
    fn missing_runtime_is_reported_without_starting_a_process() {
        let tmp = std::env::temp_dir().join("greenroom-no-acestep");
        let s = acestep_status(&tmp, &tmp);
        assert!(!s.installed && !s.model_ready);
        assert!(acestep_dir(&tmp).is_none());
    }
}


// ---- local sound effects: Stable Audio Open Small --------------------------------------------------------------

/// Imports everything the worker needs, including the parts that failed when NumPy 2 met the pinned PyWavelets.
const SFX_RUNTIME_CHECK: &str = "import numpy, torch, pywt, pytorch_lightning, stable_audio_tools; from stable_audio_tools.inference.generation import generate_diffusion_cond; from stable_audio_tools.models.diffusion import create_diffusion_cond_from_config; from stable_audio_tools.models.conditioners import T5Conditioner; assert int(numpy.__version__.split(chr(46))[0]) < 2";

/// Stable Audio Open Small (Stability AI Community Licence) is gated: the person accepts its terms on Hugging Face and saves a read token.
fn sfx_manifest() -> &'static model_manager::GatedManifest {
    use model_manager::{GatedFile, GatedManifest};
    const FILES: &[GatedFile] = &[
        GatedFile { path: "model.safetensors", filename: "model.safetensors", bytes: 1_676_829_212, git_oid: None },
        GatedFile { path: "model_config.json", filename: "model_config.json", bytes: 5_622, git_oid: Some("95e134813a163a3d6a697127eb38ce3583f01090") },
    ];
    static SFX: GatedManifest = GatedManifest { id: "stable-audio-open-small", version: "dc620d91", repo: "stabilityai/stable-audio-open-small", revision: "dc620d91535857b72ebb59b4ca45978db6d417f5", files: FILES };
    &SFX
}

fn sfx_dirs(models: &std::path::Path) -> Option<(PathBuf, PathBuf)> {
    let g = sfx_manifest();
    let t = managed_manifest("sfx-text-encoder")?;
    let model = models.join(g.id).join(g.version);
    let t5 = models.join(t.id).join(t.version);
    (g.files.iter().all(|f| model.join(f.filename).is_file()) && t.artifacts.iter().all(|a| t5.join(a.filename).is_file())).then_some((model, t5))
}

fn sfx_status(root: &std::path::Path, models: &std::path::Path) -> LocalRuntimeStatus {
    let dir = root.join("runtime").join("sfx-managed");
    let python = dir.join("python.exe");
    let installed = dir.join("complete").is_file() && python.is_file() && command_ok(&python, &["-c", SFX_RUNTIME_CHECK]);
    let model_ready = sfx_dirs(models).is_some();
    let detail = match (installed, model_ready) {
        (true, true) => "Ready. Sound effects are made on this computer.".to_string(),
        (true, false) => "Engine ready. Download the sound-effects model (about 2.6 GB).".to_string(),
        (false, true) => "Model downloaded. Install the sound-effects engine.".to_string(),
        _ => "Install the sound-effects engine and model (about 6 GB in total).".to_string(),
    };
    LocalRuntimeStatus { installed, model_ready, detail }
}

fn setup_sfx_runtime(root: &std::path::Path, models: &std::path::Path) -> Result<LocalRuntimeStatus, String> {
    static SETUP: Mutex<()> = Mutex::new(());
    let _guard = SETUP.lock().map_err(|_| "Setup is unavailable. Restart Greenroom and try again.")?;
    if sfx_status(root, models).installed { return Ok(sfx_status(root, models)); }
    let dir = root.join("runtime").join("sfx-managed");
    let python = managed_python::bootstrap_with(&dir, &managed_python::PY310)?;
    let pip = |args: &[&str], label: &str| -> Result<(), String> {
        let mut all = vec!["-m", "pip", "--isolated", "install", "--disable-pip-version-check", "--no-input"];
        all.extend_from_slice(args);
        let output = hidden_command(python.as_os_str()).args(&all).env("PYTHONUTF8", "1").output().map_err(|_| format!("Could not start {label}."))?;
        if output.status.success() { return Ok(()); }
        let detail = String::from_utf8_lossy(&output.stderr).replace(['\r', '\n'], " ");
        Err(format!("{label} did not finish. {}", detail.chars().rev().take(240).collect::<String>().chars().rev().collect::<String>()))
    };
    pip(&["setuptools<81", "wheel"], "the build tools installer")?;
    pip(&["--only-binary=:all:", "--index-url", "https://download.pytorch.org/whl/cu126", "torch==2.7.1", "torchaudio==2.7.1"], "the sound engine installer")?;
    // stable-audio-tools pins PyWavelets 1.4.1, which is built for NumPy 1.x: NumPy 2 breaks it at import.
    // The package needs pytorch_lightning at model creation even though it lists it only as an optional extra.
    pip(&["--no-build-isolation", "stable-audio-tools==0.0.20", "numpy<2", "pytorch_lightning==2.5.5"], "the sound-effects package installer")?;
    if !command_ok(&python, &["-c", SFX_RUNTIME_CHECK]) { return Err("The sound-effects engine installed but could not start. Retry setup.".into()); }
    crate::store::atomic_write(&dir.join("complete"), b"python-3.10.11;torch-2.7.1-cu126;stable-audio-tools-0.0.20")?;
    Ok(sfx_status(root, models))
}

#[tauri::command]
async fn sfx_status_cmd(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || Ok(sfx_status(&r, &m))).await
}

#[tauri::command]
async fn sfx_runtime_install(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || setup_sfx_runtime(&r, &m)).await
}

/// Downloads the text encoder (no account needed), then the gated sound model with the saved Hugging Face token.
#[tauri::command]
async fn sfx_install_models(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || {
        let token = get_key("huggingface")?;
        let _guard = MODEL_INSTALL_LOCK.try_lock().map_err(|_| "Another model download or install is already in progress.")?;
        model_manager::install(&app, managed_manifest("sfx-text-encoder").ok_or("The text encoder manifest is missing.")?)?;
        model_manager::install_gated(&app, sfx_manifest(), &token)?;
        Ok(sfx_status(&r, &m))
    }).await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalSfxReq { prompt: String, seconds: u32, seed: Option<u32> }

fn check_local_sfx(req: &LocalSfxReq) -> Result<(), String> {
    if req.prompt.trim().is_empty() || req.prompt.chars().count() > 300 { return Err("Describe the sound in 1 to 300 characters.".into()); }
    if !(1..=11).contains(&req.seconds) { return Err("Choose a length between 1 and 11 seconds.".into()); }
    Ok(())
}

/// Runs the offline worker and returns the finished WAV bytes. Shared by SFX Studio, sound clips and the atmosphere.
fn sfx_bytes(root: &std::path::Path, models: &std::path::Path, prompt: &str, seconds: u32, seed: Option<u32>) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use std::process::Stdio;
    static GENERATION: Mutex<()> = Mutex::new(());
    check_local_sfx(&LocalSfxReq { prompt: prompt.to_string(), seconds, seed })?;
    let _guard = GENERATION.lock().map_err(|_| "Sound effects are unavailable. Restart Greenroom and try again.")?;
    let status = sfx_status(root, models);
    if !status.installed || !status.model_ready { return Err(status.detail); }
    let (model, t5) = sfx_dirs(models).ok_or("The sound-effects model files are missing. Download them in Model Center.")?;
    let python = root.join("runtime").join("sfx-managed").join("python.exe");
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let out = std::env::temp_dir().join(format!("greenroom-sfx-{nanos:x}.wav"));
    let seed = seed.unwrap_or((nanos % 1_000_000) as u32);
    let input = serde_json::json!({"weights": model.join("model.safetensors"), "config": model.join("model_config.json"), "t5_dir": t5, "prompt": prompt.trim(), "seconds": seconds, "seed": seed, "out": out});
    let mut cmd = hidden_command(&python);
    cmd.args(["-c", include_str!("../../../runtime/sfx_once.py")]).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = cmd.spawn().map_err(|_| "Could not start the sound-effects engine.")?;
    child.stdin.take().ok_or("Could not send the request to the sound-effects engine.")?.write_all(input.to_string().as_bytes()).map_err(|_| "Could not send the request to the sound-effects engine.")?;
    let done = child.wait().map_err(|_| "The sound-effects engine stopped unexpectedly.")?;
    let bytes = std::fs::read(&out).ok();
    let _ = std::fs::remove_file(&out);
    match (done.success(), bytes) { (true, Some(b)) if b.starts_with(b"RIFF") => Ok(b), _ => Err("The sound-effects engine could not make this sound. Try again, or check that no other program is using the graphics card.".into()) }
}

/// Makes one sound effect on this computer and keeps it in the project as a take that is never overwritten.
#[tauri::command]
async fn sfx_local_generate(app: tauri::AppHandle, project: String, req: LocalSfxReq) -> Result<Vec<MadeMusic>, String> {
    check_local_sfx(&req)?;
    let (r, models) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || {
        let bytes = sfx_bytes(&r, &models, &req.prompt, req.seconds, req.seed)?;
        let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
        let id = format!("s-{nanos:x}0");
        store::take_write(&r, &project, &id, "wav", &bytes)?;
        use sha2::{Digest, Sha256};
        let sha256 = Sha256::digest(&bytes).iter().map(|b| format!("{b:02x}")).collect();
        let name: String = req.prompt.trim().chars().take(60).collect();
        Ok(vec![MadeMusic { id, ext: "wav".into(), name, bytes: bytes.len() as u64, sha256, seconds: req.seconds as f64 }])
    })
    .await
}

#[cfg(test)]
mod local_sfx_tests {
    use super::*;
    fn req(p: &str, s: u32) -> LocalSfxReq { LocalSfxReq { prompt: p.into(), seconds: s, seed: None } }
    #[test]
    fn request_limits_are_enforced_before_anything_starts() {
        assert!(check_local_sfx(&req("door slam", 3)).is_ok());
        assert!(check_local_sfx(&req(" ", 3)).is_err());
        assert!(check_local_sfx(&req(&"x".repeat(301), 3)).is_err());
        assert!(check_local_sfx(&req("ok", 0)).is_err());
        assert!(check_local_sfx(&req("ok", 12)).is_err());
    }
    #[test]
    fn manifests_are_pinned_and_complete() {
        let g = sfx_manifest();
        assert_eq!(g.revision.len(), 40);
        assert!(g.files.iter().any(|f| f.filename == "model.safetensors" && f.bytes == 1_676_829_212));
        let t = managed_manifest("sfx-text-encoder").unwrap();
        assert!(t.artifacts.iter().all(|a| a.sha256.len() == 64 && a.url.contains("a9723ea7f1b39c1eae772870f3b547bf6ef7e6c1")));
        assert!(t.artifacts.iter().any(|a| a.filename == "model.safetensors"));
    }
    #[test]
    fn runtime_check_covers_the_imports_that_failed_in_real_testing() {
        for needed in ["pywt", "pytorch_lightning", "create_diffusion_cond_from_config", "T5Conditioner", "< 2"] { assert!(SFX_RUNTIME_CHECK.contains(needed), "{needed}"); }
    }
    #[test]
    fn missing_runtime_is_reported_without_starting_a_process() {
        let tmp = std::env::temp_dir().join("greenroom-no-sfx");
        let s = sfx_status(&tmp, &tmp);
        assert!(!s.installed && !s.model_ready);
        assert!(sfx_dirs(&tmp).is_none());
    }
}


// ---- local acting director: llama.cpp + Qwen3 4B ---------------------------------------------------------------

/// llama.cpp release b12052, Windows Vulkan build (MIT). Vulkan runs on NVIDIA, AMD and Intel graphics and falls back to the processor.
const LLAMA_URL: &str = "https://github.com/ggml-org/llama.cpp/releases/download/b12052/llama-b12052-bin-win-vulkan-x64.zip";
const LLAMA_SIZE: usize = 37_528_522;
const LLAMA_SHA: &str = "9806d110501576d9aa4a58de996209a89ffca3c0634e4bda54b0019dfafc3be5";
const DIRECTOR_MAX_USER: usize = 20_000;

fn director_exe(root: &std::path::Path) -> PathBuf { root.join("runtime").join("director-llama").join("llama-server.exe") }

fn director_model(models: &std::path::Path) -> Option<PathBuf> {
    let m = managed_manifest("director-qwen3-4b")?;
    let file = models.join(m.id).join(m.version).join(m.artifacts[0].filename);
    file.is_file().then_some(file)
}

fn director_status(root: &std::path::Path, models: &std::path::Path) -> LocalRuntimeStatus {
    let installed = director_exe(root).is_file();
    let model_ready = director_model(models).is_some();
    let detail = match (installed, model_ready) {
        (true, true) => "Ready. The Director runs on this computer.".to_string(),
        (true, false) => "Engine ready. Download the director model (2.5 GB).".to_string(),
        (false, true) => "Model downloaded. Install the engine (38 MB).".to_string(),
        _ => "Install the local director: a 38 MB engine and a 2.5 GB model.".to_string(),
    };
    LocalRuntimeStatus { installed, model_ready, detail }
}

fn install_director_engine(root: &std::path::Path) -> Result<(), String> {
    if !cfg!(all(target_os = "windows", target_arch = "x86_64")) { return Err("The local director currently supports Windows x64.".into()); }
    if director_exe(root).is_file() { return Ok(()); }
    let bytes = net::download(LLAMA_URL, LLAMA_SIZE as u64 + 1024)?;
    if bytes.len() != LLAMA_SIZE || local::sha256_hex(&bytes) != LLAMA_SHA {
        return Err("The director engine download did not match the version Greenroom checked, so it was not installed.".into());
    }
    let live = root.join("runtime").join("director-llama");
    let tmp = root.join("runtime").join("director-llama.installing");
    let _ = std::fs::remove_dir_all(&tmp);
    local::extract_zip(&bytes, &tmp)?;
    if !tmp.join("llama-server.exe").is_file() { let _ = std::fs::remove_dir_all(&tmp); return Err("The director engine download did not contain llama-server.exe.".into()); }
    let _ = std::fs::remove_dir_all(&live);
    std::fs::rename(&tmp, &live).map_err(|_| "Could not finish installing the director engine.".to_string())
}

struct DirectorServer { child: std::process::Child, port: u16, key: String, last_used: std::time::Instant }
static DIRECTOR_SERVER: Mutex<Option<DirectorServer>> = Mutex::new(None);

/// 32 hex characters unique to this launch. The server only listens on loopback and rejects calls without it.
fn session_key() -> String {
    use std::hash::{BuildHasher, Hasher};
    let a = std::collections::hash_map::RandomState::new().build_hasher().finish();
    let b = std::collections::hash_map::RandomState::new().build_hasher().finish();
    format!("{a:016x}{b:016x}")
}

fn director_args(model: &std::path::Path, port: u16, key: &str) -> Vec<String> {
    ["-m", &model.to_string_lossy(), "--host", "127.0.0.1", "--port", &port.to_string(), "--api-key", key, "-ngl", "99", "-c", "12288", "-np", "1", "--no-webui"].iter().map(|s| s.to_string()).collect()
}

/// Stops the local director's engine. Called when Greenroom exits and after a few idle minutes, so it never keeps the graphics card.
fn director_shutdown() {
    if let Ok(mut guard) = DIRECTOR_SERVER.lock() {
        if let Some(mut s) = guard.take() { let _ = s.child.kill(); let _ = s.child.wait(); }
    }
}

fn start_idle_reaper() {
    static ONCE: std::sync::Once = std::sync::Once::new();
    ONCE.call_once(|| { std::thread::spawn(|| loop {
        std::thread::sleep(std::time::Duration::from_secs(30));
        let idle = DIRECTOR_SERVER.lock().ok().and_then(|g| g.as_ref().map(|s| s.last_used.elapsed() > std::time::Duration::from_secs(300))).unwrap_or(false);
        if idle { director_shutdown(); }
    }); });
}

fn director_ensure(root: &std::path::Path, models: &std::path::Path) -> Result<(u16, String), String> {
    let mut guard = DIRECTOR_SERVER.lock().map_err(|_| "The director is unavailable. Restart Greenroom and try again.")?;
    if let Some(s) = guard.as_mut() {
        if s.child.try_wait().map(|x| x.is_none()).unwrap_or(false) { s.last_used = std::time::Instant::now(); return Ok((s.port, s.key.clone())); }
        *guard = None;
    }
    let st = director_status(root, models);
    if !st.installed || !st.model_ready { return Err(st.detail); }
    let model = director_model(models).ok_or("The director model is missing. Download it in Model Center.")?;
    let port = std::net::TcpListener::bind("127.0.0.1:0").and_then(|l| l.local_addr()).map(|a| a.port()).map_err(|_| "Could not find a free local port for the director.")?;
    let key = session_key();
    let mut cmd = hidden_command(director_exe(root));
    cmd.args(director_args(&model, port, &key)).stdin(std::process::Stdio::null()).stdout(std::process::Stdio::null()).stderr(std::process::Stdio::null());
    let mut child = cmd.spawn().map_err(|_| "Could not start the director engine.")?;
    // Loading the model takes a few seconds (longer the first time while Windows reads it from disk).
    let started = std::time::Instant::now();
    loop {
        if child.try_wait().map(|x| x.is_some()).unwrap_or(true) { return Err("The director engine stopped while starting. Try again, or close other programs that use the graphics card.".into()); }
        let ok = net::agent().get(&format!("http://127.0.0.1:{port}/health")).set("Authorization", &format!("Bearer {key}")).call().is_ok();
        if ok { break; }
        if started.elapsed() > std::time::Duration::from_secs(180) { let _ = child.kill(); return Err("The director engine took too long to start.".into()); }
        std::thread::sleep(std::time::Duration::from_millis(500));
    }
    start_idle_reaper();
    *guard = Some(DirectorServer { child, port, key: key.clone(), last_used: std::time::Instant::now() });
    Ok((port, key))
}

fn check_director_request(system: &str, user: &str) -> Result<(), String> {
    if system.len() > 20_000 || user.len() > DIRECTOR_MAX_USER { return Err("That scene is too long for the local director. Try one scene at a time.".into()); }
    Ok(())
}

fn director_chat(root: &std::path::Path, models: &std::path::Path, system: &str, user: &str) -> Result<String, String> {
    check_director_request(system, user)?;
    let (port, key) = director_ensure(root, models)?;
    let body = serde_json::json!({"temperature": 0.4, "max_tokens": 2000, "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]});
    let response = net::agent().post(&format!("http://127.0.0.1:{port}/v1/chat/completions")).set("Authorization", &format!("Bearer {key}")).set("content-type", "application/json").send_string(&body.to_string())
        .map_err(|_| "The local director did not answer. Try again.".to_string())?;
    let v = net::read_json(response, 4 << 20)?;
    let text = v["choices"][0]["message"]["content"].as_str().ok_or("The local director sent an empty answer. Try again.")?;
    if let Ok(mut g) = DIRECTOR_SERVER.lock() { if let Some(s) = g.as_mut() { s.last_used = std::time::Instant::now(); } }
    Ok(text.to_string())
}

#[tauri::command]
async fn director_local_status(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || Ok(director_status(&r, &m))).await
}

/// Installs the 38 MB engine, then downloads the 2.5 GB model. No account is needed.
#[tauri::command]
async fn director_local_install(app: tauri::AppHandle) -> Result<LocalRuntimeStatus, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || {
        let _guard = MODEL_INSTALL_LOCK.try_lock().map_err(|_| "Another model download or install is already in progress.")?;
        install_director_engine(&r)?;
        model_manager::install(&app, managed_manifest("director-qwen3-4b").ok_or("The director manifest is missing.")?)?;
        Ok(director_status(&r, &m))
    }).await
}

/// The same question the cloud Director gets, answered on this computer. Nothing leaves it.
#[tauri::command]
async fn director_local_complete(app: tauri::AppHandle, system: String, user: String) -> Result<String, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || director_chat(&r, &m, &system, &user)).await
}

#[cfg(test)]
mod local_director_tests {
    use super::*;
    #[test]
    fn engine_and_model_are_pinned() {
        assert_eq!(LLAMA_SHA.len(), 64);
        assert!(LLAMA_URL.contains("b12052") && LLAMA_URL.starts_with("https://github.com/ggml-org/llama.cpp/releases/download/"));
        let m = managed_manifest("director-qwen3-4b").unwrap();
        assert_eq!(m.artifacts[0].bytes, 2_497_281_120);
        assert_eq!(m.artifacts[0].sha256.len(), 64);
        assert!(m.artifacts[0].url.contains("a06e946bb6b655725eafa393f4a9745d460374c9"));
    }
    #[test]
    fn server_only_listens_on_loopback_with_a_secret() {
        let args = director_args(std::path::Path::new("m.gguf"), 4321, "secretkey");
        let at = |flag: &str| args.iter().position(|a| a == flag).map(|i| args[i + 1].clone());
        assert_eq!(at("--host").as_deref(), Some("127.0.0.1"));
        assert_eq!(at("--api-key").as_deref(), Some("secretkey"));
        assert_eq!(at("--port").as_deref(), Some("4321"));
        assert!(args.contains(&"--no-webui".to_string()));
    }
    #[test]
    fn session_keys_are_long_hex_and_differ() {
        let (a, b) = (session_key(), session_key());
        assert_eq!(a.len(), 32);
        assert!(a.bytes().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }
    #[test]
    fn oversized_scenes_are_refused_before_anything_starts() {
        assert!(check_director_request("s", &"x".repeat(DIRECTOR_MAX_USER)).is_ok());
        assert!(check_director_request("s", &"x".repeat(DIRECTOR_MAX_USER + 1)).is_err());
        assert!(check_director_request(&"s".repeat(20_001), "u").is_err());
    }
    #[test]
    fn missing_engine_is_reported_without_starting_a_process() {
        let tmp = std::env::temp_dir().join("greenroom-no-director");
        let s = director_status(&tmp, &tmp);
        assert!(!s.installed && !s.model_ready);
        assert!(director_chat(&tmp, &tmp, "s", "u").unwrap_err().contains("Install the local director"));
    }
    #[test]
    fn shutdown_with_nothing_running_is_harmless() { director_shutdown(); director_shutdown(); }
}


// ---- speech to speech: Chatterbox voice conversion --------------------------------------------------------------

const CONVERT_MAX_SOURCE: usize = 30 << 20;
const CONVERT_MAX_TARGET: usize = 15 << 20;

/// A safe file extension for audio sent from the screen (the worker decodes it by content, the extension only helps).
fn convert_ext(ext: &str) -> Result<&'static str, String> {
    match ext.to_ascii_lowercase().as_str() { "wav" => Ok("wav"), "mp3" => Ok("mp3"), "flac" => Ok("flac"), "ogg" => Ok("ogg"), _ => Err("Use a WAV, MP3, FLAC or OGG recording.".into()) }
}

fn check_convert(source: &[u8], target: &[u8]) -> Result<(), String> {
    if source.len() < 2_000 { return Err("The recording is empty or too short.".into()); }
    if source.len() > CONVERT_MAX_SOURCE { return Err("That recording is too long. Re-voice one line at a time (up to about 5 minutes).".into()); }
    if target.len() < 2_000 { return Err("The target voice sample is empty. Make a sample of the voice first.".into()); }
    if target.len() > CONVERT_MAX_TARGET { return Err("The target voice sample is too large.".into()); }
    Ok(())
}

/// Re-voices a recording: the timing, pauses and emotion of the performance are kept, and the voice becomes the target voice.
/// Runs on this computer with the Chatterbox files already installed. Nothing is sent anywhere.
fn convert_voice(root: &std::path::Path, models: &std::path::Path, source: &[u8], source_ext: &str, target: &[u8], target_ext: &str) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use std::process::Stdio;
    static CONVERT: Mutex<()> = Mutex::new(());
    check_convert(source, target)?;
    let (se, te) = (convert_ext(source_ext)?, convert_ext(target_ext)?);
    let _guard = CONVERT.lock().map_err(|_| "Voice conversion is unavailable. Restart Greenroom and try again.")?;
    let (python, model) = chatterbox_paths(root, models)?;
    let nanos = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos()).unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("greenroom-convert-{nanos:x}"));
    std::fs::create_dir_all(&dir).map_err(|_| "Could not prepare the conversion.")?;
    let (src, tgt, out) = (dir.join(format!("source.{se}")), dir.join(format!("target.{te}")), dir.join("out.wav"));
    let run = || -> Result<Vec<u8>, String> {
        std::fs::write(&src, source).map_err(|_| "Could not prepare the recording.")?;
        std::fs::write(&tgt, target).map_err(|_| "Could not prepare the voice sample.")?;
        let input = serde_json::json!({"model_dir": model, "source": src, "target": tgt, "out": out});
        let mut cmd = hidden_command(&python);
        cmd.args(["-c", include_str!("../../../runtime/chatterbox_vc_once.py")]).stdin(Stdio::piped()).stdout(Stdio::null()).stderr(Stdio::null());
        let mut child = cmd.spawn().map_err(|_| "Could not start the voice converter.")?;
        child.stdin.take().ok_or("Could not send the recording to the voice converter.")?.write_all(input.to_string().as_bytes()).map_err(|_| "Could not send the recording to the voice converter.")?;
        let done = child.wait().map_err(|_| "The voice converter stopped unexpectedly.")?;
        match (done.success(), std::fs::read(&out).ok()) {
            (true, Some(b)) if b.starts_with(b"RIFF") => Ok(b),
            _ => Err("The voice converter could not re-voice this recording. Check that the Chatterbox engine and model are installed in Model Center, and try a shorter recording.".into()),
        }
    };
    let result = run();
    let _ = std::fs::remove_dir_all(&dir);
    result
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ConvertReq { source_b64: String, source_ext: String, target_b64: String, target_ext: String }

#[tauri::command]
async fn voice_convert(app: tauri::AppHandle, req: ConvertReq) -> Result<ClipOut, String> {
    let (r, m) = (root(&app)?, model_manager::models_root(&app)?);
    blocking(move || {
        let t = Instant::now();
        let dec = |s: &str| base64::engine::general_purpose::STANDARD.decode(s).map_err(|_| "The audio was not valid.".to_string());
        let bytes = convert_voice(&r, &m, &dec(&req.source_b64)?, &req.source_ext, &dec(&req.target_b64)?, &req.target_ext)?;
        Ok(ClipOut { mime: "audio/wav".into(), audio_b64: b64(&bytes), ms: t.elapsed().as_millis() })
    }).await
}

#[cfg(test)]
mod convert_tests {
    use super::*;
    #[test]
    fn extensions_are_an_allow_list() {
        assert_eq!(convert_ext("WAV").unwrap(), "wav");
        assert!(convert_ext("exe").is_err() && convert_ext("../x").is_err() && convert_ext("").is_err());
    }
    #[test]
    fn sizes_are_checked_before_any_process_starts() {
        let ok = vec![0u8; 5_000];
        assert!(check_convert(&ok, &ok).is_ok());
        assert!(check_convert(&[0u8; 10], &ok).is_err());
        assert!(check_convert(&ok, &[0u8; 10]).is_err());
        assert!(check_convert(&vec![0u8; CONVERT_MAX_SOURCE + 1], &ok).is_err());
        assert!(check_convert(&ok, &vec![0u8; CONVERT_MAX_TARGET + 1]).is_err());
    }
    #[test]
    fn missing_chatterbox_is_reported_without_starting_a_process() {
        let tmp = std::env::temp_dir().join("greenroom-no-chatterbox-vc");
        let ok = vec![0u8; 5_000];
        assert!(convert_voice(&tmp, &tmp, &ok, "wav", &ok, "wav").unwrap_err().contains("Chatterbox"));
        assert!(convert_voice(&tmp, &tmp, &ok, "exe", &ok, "wav").is_err());
    }
    #[test]
    fn the_chatterbox_worker_trims_the_silence_wazobia_leaves_and_caps_its_generation_length() {
        // Real run 2026-11-12: every WazobiaVoice line came back 40 s long (3 s of speech, then silence) and took 75 s, because those
        // weights never signal the end of speech. The worker cuts the silent tail and caps the speech tokens by the text's length.
        let script = include_str!("../../../runtime/chatterbox_once.py");
        assert!(script.contains("def trim_tail"));
        assert!(script.contains("trim_tail(audio.cpu(), model.sr)"));
        assert!(script.contains("max_new_tokens"));
        assert!(script.contains("4 * len(request[\"text\"]) + 50"));
    }
    #[test]
    fn the_health_check_requires_the_watermarker_that_failed_in_real_testing() {
        assert!(CHATTERBOX_CHECK.contains("perth.PerthImplicitWatermarker is not None"));
        assert!(CHATTERBOX_CHECK_FULL.contains("ChatterboxVC") && CHATTERBOX_CHECK_FULL.contains("perth"));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .invoke_handler(tauri::generate_handler![
            key_status, set_key, clear_key, huggingface_check, run_clip, voices_mine, voices_voicekiller, avatar_generate, inworld_check, voices_inworld, inworld_preview, inworld_clone, voices_shared, voice_add_shared, voice_design, voice_design_save, voice_clone,
            voice_delete, preview_fetch, project_list, project_load, project_save, take_write, take_read, export_write, library_load, library_save, avatars_load, avatars_save, casts_load, casts_save, version_save, version_list, version_load, backup_now, backup_auto, backup_list, backup_restore, sheet_load, sheet_save, sheet_audio_write, sheet_audio_read, sheet_export,
            save_report, audio_import, music_generate, ffmpeg_status, ffmpeg_install, video_mux, video_probe, video_allow, director_complete, llm_models, script_open, setup_check, setup_report, engines_load, engines_save, piper_status, piper_install, piper_catalog, piper_preview, piper_install_voice, piper_remove_voice, local_voices,
            model_hardware, model_states, model_install, chatterbox_import_downloads, wazobia_install_download, wazobia_voices, wazobia_install_automatic, wazobia_import_file, chatterbox_ready, chatterbox_runtime_status, chatterbox_runtime_install, kokoro_runtime_status, kokoro_runtime_install, kokoro_prefetch, qwen_prefetch, qwen_unload, qwen_lock_status, qwen_design_preview, qwen_design_save, qwen_design_ready, qwen_base_download, qwen_lock_voice, qwen_design_preview, qwen_design_save, qwen_unlock_voice, qwen_gpu_install, speaker_status, speaker_install, speaker_embed, qwen_runtime_status, qwen_runtime_install, acestep_status_cmd, acestep_runtime_install, music_local_generate, sfx_status_cmd, sfx_runtime_install, sfx_install_models, sfx_local_generate, director_local_status, director_local_install, director_local_complete, voice_convert
        ])
        .build(tauri::generate_context!())
        .expect("error while building Greenroom")
        .run(|_app, event| { if let tauri::RunEvent::Exit = event { director_shutdown(); } });
}

#[cfg(test)]
mod kokoro_tests {
    use super::*;
    #[test]
    fn voice_names_are_checked_before_any_process_starts() {
        for ok in ["af_heart", "am_michael", "bf_emma", "bm_george", "ef_dora"] { assert!(kokoro_voice_ok(ok), "{ok}"); }
        for bad in ["", "af", "../evil", "af_heart.pt", "AF_heart", "xf_heart", "af-heart", "a_f_heart", "af_he art", "C:\\x\\af_a", "af_"] { assert!(!kokoro_voice_ok(bad), "{bad}"); }
        let tmp = std::env::temp_dir();
        assert!(kokoro_speak(&tmp, "hello", "../evil", 1.0).unwrap_err().contains("not valid"));
        assert!(kokoro_speak(&tmp, "hello", "af_heart", 1.0).unwrap_err().contains("not installed"));
        assert!(kokoro_speak(&tmp, &"x".repeat(2001), "af_heart", 1.0).unwrap_err().contains("2,000"));
    }
    /// A real install and a real spoken line. Downloads about 2 GB, so it only runs when asked:
    /// GREENROOM_REAL_ROOT=<data folder> GREENROOM_REAL_OUT=<folder for the wavs> cargo test real_kokoro -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_kokoro_install_and_speak() {
        let root = PathBuf::from(std::env::var("GREENROOM_REAL_ROOT").expect("GREENROOM_REAL_ROOT"));
        let out = PathBuf::from(std::env::var("GREENROOM_REAL_OUT").expect("GREENROOM_REAL_OUT"));
        std::fs::create_dir_all(&out).unwrap();
        let t = std::time::Instant::now();
        setup_managed_runtime(&root, "kokoro", "kokoro==0.9.4", "from kokoro import KPipeline; import torch").expect("runtime install");
        println!("runtime installed in {:?}", t.elapsed());
        let s = kokoro_prefetch_blocking(&root).expect("prefetch");
        println!("prefetch done in {:?}: {s:?}", t.elapsed());
        assert!(s.model_ready);
        for v in ["af_heart", "am_michael", "bf_emma", "bm_george"] {
            let wav = kokoro_speak(&root, "Good evening. I do hope you are well. Your soul is overdue.", v, 1.0).expect(v);
            assert!(wav.starts_with(b"RIFF"));
            std::fs::write(out.join(format!("kokoro-{v}.wav")), &wav).unwrap();
            println!("{v}: {} bytes", wav.len());
        }
    }

    #[test]
    fn prefetch_needs_the_runtime_and_status_is_honest_without_it() {
        let tmp = std::env::temp_dir().join("greenroom-kokoro-test-none");
        assert!(kokoro_prefetch_blocking(&tmp).unwrap_err().contains("runtime"));
        let s = kokoro_status(&tmp);
        assert!(!s.installed && !s.model_ready);
    }
}

#[cfg(test)]
mod qwen_tests {
    use super::*;
    #[test]
    fn only_built_in_voices_are_accepted_before_any_process_starts() {
        assert!(qwen_voice_description("qwen-warm-narrator").is_some());
        for bad in ["", "../evil", "qwen-", "af_heart", "qwen-warm-narrator.pt"] { assert!(qwen_voice_description(bad).is_none(), "{bad}"); }
        let tmp = std::env::temp_dir();
        assert!(qwen_speak(&tmp, "hi", "../evil").unwrap_err().contains("not available"));
        assert!(qwen_speak(&tmp, "hi", "qwen-warm-narrator").unwrap_err().contains("not installed"));
        assert!(qwen_speak(&tmp, &"x".repeat(601), "qwen-warm-narrator").unwrap_err().contains("600"));
    }
    /// Real: GPU check, Base model download, reference clips, locked lines. Downloads several GB, so it only runs when asked.
    #[test]
    #[ignore]
    fn real_qwen_gpu_and_lock() {
        let root = PathBuf::from(std::env::var("GREENROOM_REAL_ROOT").expect("GREENROOM_REAL_ROOT"));
        let out = PathBuf::from(std::env::var("GREENROOM_REAL_OUT").expect("GREENROOM_REAL_OUT"));
        std::fs::create_dir_all(&out).unwrap();
        let step = std::env::var("GREENROOM_STEP").unwrap_or_default();
        if step == "gpu" {
            let t = std::time::Instant::now();
            let st = qwen_gpu_install_blocking(&root).expect("gpu install");
            println!("gpu install {:?}: gpu={} {}", t.elapsed(), st.gpu, st.gpu_name);
        }
        if step == "base" {
            let t = std::time::Instant::now();
            let st = qwen_base_download_blocking(&root).expect("base download");
            println!("base download {:?}: ready={}", t.elapsed(), st.base_ready);
        }
        if step == "lock" {
            for v in ["qwen-warm-narrator", "qwen-gravel-man"] {
                let t = std::time::Instant::now();
                let st = qwen_lock_voice_blocking(&root, v).expect("lock");
                println!("locked {v} in {:?}: {:?}", t.elapsed(), st.voices.iter().map(|x| (x.id.clone(), x.locked)).collect::<Vec<_>>());
            }
        }
        if step == "design" {
            let t = std::time::Instant::now();
            let previews = qwen_design_preview_blocking(&root, "A 500 year old male robot powered by nuclear fusion energy, calm and slow, with a faint metallic resonance", "A robot! A real, actual robot, and he is stuck in the mud! Four hundred years? You must be starving.").expect("design");
            println!("design: {} previews in {:?}", previews.len(), t.elapsed());
            for (i, p) in previews.iter().enumerate() {
                std::fs::write(out.join(format!("designed_{i}.wav")), unb64(&p.audio_b64).unwrap()).unwrap();
                println!("preview {i}: {} {:.1}s locked={}", p.generated_voice_id, p.seconds, qwen_locked(&root, &p.generated_voice_id));
            }
            let first = &previews[0].generated_voice_id;
            let line = qwen_speak(&root, "Good evening. I do hope you are well.", first).expect("speak with designed voice");
            std::fs::write(out.join("designed_spoken.wav"), &line).unwrap();
            println!("spoke a new line with the designed voice: {} bytes", line.len());
            qwen_warm::stop();
        }
        if step == "speak" {
            let texts = ["Good evening. I do hope you are well.", "Your soul is overdue.", "Nobody leaves this room until I say so.", "It was a quiet morning in the harbour town.", "Please state your name and your purpose here.", "I have seen this before, and it never ends well."];
            let tag = std::env::var("GREENROOM_TAG").unwrap_or("locked".into());
            for (name, v) in [("warm", "qwen-warm-narrator"), ("gravel", "qwen-gravel-man")] {
                for (i, t) in texts.iter().enumerate() {
                    let t0 = std::time::Instant::now();
                    let wav = qwen_speak(&root, t, v).expect(v);
                    std::fs::write(out.join(format!("qwen{tag}_{name}_{i}.wav")), &wav).unwrap();
                    println!("{v} line {i}: {:?} (locked: {})", t0.elapsed(), qwen_locked(&root, v));
                }
            }
            qwen_warm::stop();
        }
    }

    #[test]
    fn a_voice_designed_on_this_pc_is_accepted_only_when_it_exists_and_is_locked_by_its_own_clip() {
        let tmp = std::env::temp_dir().join(format!("gr-qwen-design-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        let qd = qwen_dir(&tmp);
        std::fs::create_dir_all(&qd).unwrap();
        let id = "qwen-design-0a1b2c3d";
        // Not made yet: not a voice.
        assert!(qwen_speak(&tmp, "hi", id).unwrap_err().contains("not available"));
        assert!(!qwen_locked(&tmp, id));
        let meta = qwen_design::Designed { description: "A 500 year old robot with a calm, slow voice".into(), seed: 5, text: "Good evening, I am glad that you could come.".into(), saved: true };
        qwen_design::write(&qd, id, &meta, b"RIFF").unwrap();
        // Made, but no runtime yet: it gets as far as the runtime check.
        assert!(qwen_speak(&tmp, "hi", id).unwrap_err().contains("not installed"));
        // Locked to its own clip once the Base model is on this PC.
        assert!(!qwen_locked(&tmp, id));
        std::fs::write(qwen_base_marker(&tmp), b"x").unwrap();
        assert!(qwen_locked(&tmp, id));
        // Previews need the runtime and a sensible description, and never spend or send anything.
        assert!(qwen_design_preview_blocking(&tmp, "short", "Good evening, I am glad that you could come.").unwrap_err().contains("20 to 1000"));
        assert!(qwen_design_preview_blocking(&tmp, "A 500 year old robot with a calm, slow voice", "Good evening, I am glad that you could come.").unwrap_err().contains("Model Center"));
        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn a_voice_is_locked_only_with_the_base_model_and_its_reference_clip() {
        let tmp = std::env::temp_dir().join(format!("gr-qwen-lock-{}", std::process::id()));
        std::fs::create_dir_all(qwen_dir(&tmp).join("refs")).unwrap();
        assert!(!qwen_locked(&tmp, "qwen-gravel-man"));
        std::fs::write(qwen_ref_wav(&tmp, "qwen-gravel-man"), b"RIFF").unwrap();
        assert!(!qwen_locked(&tmp, "qwen-gravel-man"), "no Base model yet");
        std::fs::write(qwen_base_marker(&tmp), b"x").unwrap();
        assert!(qwen_locked(&tmp, "qwen-gravel-man"));
        assert!(!qwen_locked(&tmp, "qwen-warm-narrator"), "another voice has no clip");
        assert!(!qwen_locked(&tmp, "../evil"), "only built-in voices can be locked");
        std::fs::remove_dir_all(&tmp).ok();
    }

    #[test]
    fn every_built_in_voice_can_be_listed_and_locked() {
        for v in QWEN_VOICE_IDS { assert!(qwen_voice_description(v).is_some(), "{v}"); }
    }

    #[test]
    fn each_voice_has_its_own_fixed_seed() {
        assert_eq!(qwen_seed("qwen-warm-narrator"), qwen_seed("qwen-warm-narrator"));
        assert_ne!(qwen_seed("qwen-warm-narrator"), qwen_seed("qwen-gravel-man"));
        assert!(qwen_seed("") >= 1);
    }

    /// The warm worker against the real model: the second line must not pay the load again. Only runs when asked.
    #[test]
    #[ignore]
    fn real_qwen_warm_second_line_is_faster() {
        let root = PathBuf::from(std::env::var("GREENROOM_REAL_ROOT").expect("GREENROOM_REAL_ROOT"));
        let t1 = std::time::Instant::now();
        let a = qwen_speak(&root, "Good evening. I do hope you are well.", "qwen-gravel-man").expect("first");
        let first = t1.elapsed();
        let t2 = std::time::Instant::now();
        let b = qwen_speak(&root, "Good evening. I do hope you are well.", "qwen-gravel-man").expect("second");
        let second = t2.elapsed();
        println!("first {first:?}, second {second:?}, same bytes with the same seed: {}", a == b);
        assert!(qwen_warm::running());
        assert!(qwen_warm::stop());
        assert!(second < first, "the second line should be faster than the first");
    }

    #[test]
    fn the_runtime_check_uses_the_documented_class_name() {
        assert!(QWEN_CHECK.contains("Qwen3TTSModel"));
        let tmp = std::env::temp_dir().join("greenroom-qwen-test-none");
        assert!(qwen_prefetch_blocking(&tmp).unwrap_err().contains("runtime"));
        let s = qwen_status(&tmp);
        assert!(!s.installed && !s.model_ready);
    }
    /// A real install and a real spoken line on the CPU. Downloads several GB, so it only runs when asked:
    /// GREENROOM_REAL_ROOT=<data folder> GREENROOM_REAL_OUT=<folder> cargo test real_qwen -- --ignored --nocapture
    #[test]
    #[ignore]
    fn real_qwen_install_and_speak() {
        let root = PathBuf::from(std::env::var("GREENROOM_REAL_ROOT").expect("GREENROOM_REAL_ROOT"));
        let out = PathBuf::from(std::env::var("GREENROOM_REAL_OUT").expect("GREENROOM_REAL_OUT"));
        std::fs::create_dir_all(&out).unwrap();
        let t = std::time::Instant::now();
        setup_managed_runtime(&root, "qwen", QWEN_PACKAGE, QWEN_CHECK).expect("runtime install");
        println!("runtime installed in {:?}", t.elapsed());
        let s = qwen_prefetch_blocking(&root).expect("prefetch");
        println!("prefetch done in {:?}: {s:?}", t.elapsed());
        assert!(s.model_ready);
        for v in ["qwen-warm-narrator", "qwen-gravel-man"] {
            let t1 = std::time::Instant::now();
            let wav = qwen_speak(&root, "Good evening. I do hope you are well. Your soul is overdue.", v).expect(v);
            assert!(wav.starts_with(b"RIFF"));
            std::fs::write(out.join(format!("{v}.wav")), &wav).unwrap();
            println!("{v}: {} bytes in {:?}", wav.len(), t1.elapsed());
        }
    }
}

#[cfg(test)]
mod wazobia_tests {
    use super::*;
    #[test]
    fn manifest_is_pinned_and_complete() {
        let m = wazobia_manifest();
        assert_eq!(m.revision.len(), 40);
        assert!(m.files.iter().any(|f| f.filename == "t3_mtl23ls_v2.safetensors"));
        for v in WAZOBIA_VOICES { assert!(m.files.iter().any(|f| f.filename == format!("voice-{v}.wav")), "{v}"); }
        // every file name is a single safe component and total size is ~3.2 GB
        assert!(m.files.iter().all(|f| !f.filename.contains('/') && !f.filename.contains('\\') &&!f.filename.starts_with('.')));
        let total: u64 = m.files.iter().map(|f| f.bytes).sum();
        assert!((3_200_000_000..3_300_000_000).contains(&total), "{total}");
    }
    #[test]
    fn speech_rejects_unknown_voices_and_languages_before_any_process_starts() {
        let tmp = std::env::temp_dir();
        assert!(wazobia_speak(&tmp, &tmp, "hello", "../evil", "en").unwrap_err().contains("voice"));
        assert!(wazobia_speak(&tmp, &tmp, "hello", "ife", "xx").unwrap_err().contains("Yoruba"));
        assert!(wazobia_speak(&tmp, &tmp, "hello", "ife", "yo").unwrap_err().contains("not installed"));
        assert!(wazobia_speak(&tmp, &tmp, "hello", "ife@ha", "en").unwrap_err().contains("not installed"));
        assert!(wazobia_speak(&tmp, &tmp, "hello", "ife@xx", "en").unwrap_err().contains("Yoruba"));
    }
}
