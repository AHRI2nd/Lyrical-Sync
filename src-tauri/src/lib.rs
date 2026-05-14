use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};

// Python scripts embedded at compile time
const ALIGN_SCRIPT: &str = include_str!("align.py");
const SEPARATE_SCRIPT: &str = include_str!("separate.py");

// ─── Download state ───────────────────────────────────────────────────────────

pub struct DownloadState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self { cancels: Mutex::new(HashMap::new()) }
    }
}

/// 사용자가 지정한 커스텀 모델 저장 경로. None이면 앱 기본 경로를 사용합니다.
pub struct ModelsDirState {
    custom_path: Mutex<Option<PathBuf>>,
}

/// Cancel flag for the currently running alignment process.
pub struct AlignmentState {
    cancel_flag: Mutex<Arc<AtomicBool>>,
}

impl Default for AlignmentState {
    fn default() -> Self {
        Self { cancel_flag: Mutex::new(Arc::new(AtomicBool::new(false))) }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AlignmentProgressEvent {
    status: String,
    message: String,
    percent: f32,
}

impl Default for ModelsDirState {
    fn default() -> Self {
        Self { custom_path: Mutex::new(None) }
    }
}

#[derive(Deserialize)]
struct FileSpec {
    url: String,
    filename: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct DownloadProgressEvent {
    model_id: String,
    file_index: usize,
    file_count: usize,
    downloaded: u64,
    total: u64,
    done: bool,
    error: Option<String>,
}

fn models_dir(app: &AppHandle, dir_state: &ModelsDirState) -> Result<PathBuf, String> {
    let custom = dir_state.custom_path.lock().unwrap();
    if let Some(ref p) = *custom {
        return Ok(p.clone());
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join("models"))
        .map_err(|e| e.to_string())
}

// ─── LRC / audio commands (unchanged) ────────────────────────────────────────

#[tauri::command]
async fn read_lrc_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_lrc_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// AIFF 등 WebView2 미지원 포맷을 WAV로 트랜스코딩해 임시 파일 경로를 반환합니다.
#[tauri::command]
async fn decode_audio_to_wav(path: String) -> Result<String, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(&path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("지원하지 않는 포맷: {e}"))?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("오디오 트랙 없음")?;
    let codec_params = track.codec_params.clone();
    let track_id = track.id;

    let sample_rate = codec_params.sample_rate.ok_or("샘플레이트 없음")?;
    let channels = codec_params.channels.ok_or("채널 정보 없음")?.count();

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("디코더 오류: {e}"))?;

    let mut samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let mut buf =
                    SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                buf.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buf.samples());
            }
            Err(_) => continue,
        }
    }

    let spec = hound::WavSpec {
        channels: channels as u16,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let temp_path = std::env::temp_dir().join("lyrical_sync_transcoded.wav");
    {
        let mut writer =
            hound::WavWriter::create(&temp_path, spec).map_err(|e| format!("WAV 생성 오류: {e}"))?;
        for &s in &samples {
            writer.write_sample(s).map_err(|e| format!("WAV 쓰기 오류: {e}"))?;
        }
        writer.finalize().map_err(|e| format!("WAV 완료 오류: {e}"))?;
    }

    Ok(temp_path.to_string_lossy().into_owned())
}

// ─── Model management commands ────────────────────────────────────────────────

/// 커스텀 모델 저장 경로를 설정합니다. None이면 앱 기본 경로로 초기화합니다.
#[tauri::command]
fn set_models_dir_override(
    dir_state: tauri::State<'_, ModelsDirState>,
    path: Option<String>,
) -> Result<(), String> {
    let mut custom = dir_state.custom_path.lock().unwrap();
    *custom = path.filter(|p| !p.is_empty()).map(PathBuf::from);
    Ok(())
}

#[tauri::command]
async fn get_models_dir(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
) -> Result<String, String> {
    let dir = models_dir(&app, &dir_state)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 각 파일이 models 디렉터리에 존재하는지 확인합니다.
#[tauri::command]
async fn check_model_files(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    filenames: Vec<String>,
) -> Result<Vec<bool>, String> {
    let base = models_dir(&app, &dir_state)?;
    Ok(filenames.iter().map(|f| base.join(f).exists()).collect())
}

/// 모델 파일 목록을 다운로드합니다. 진행 상황은 `model-download-progress` 이벤트로 전달됩니다.
#[tauri::command]
async fn download_model(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    dl_state: tauri::State<'_, DownloadState>,
    model_id: String,
    files: Vec<FileSpec>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    dl_state.cancels.lock().unwrap().insert(model_id.clone(), cancel.clone());

    let base = models_dir(&app, &dir_state)?;
    let file_count = files.len();
    let client = reqwest::Client::new();

    for (i, spec) in files.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            dl_state.cancels.lock().unwrap().remove(&model_id);
            return Err("cancelled".into());
        }

        let dest = base.join(&spec.filename);
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        let mut resp = client
            .get(&spec.url)
            .send()
            .await
            .map_err(|e| format!("요청 실패: {e}"))?;

        if !resp.status().is_success() {
            let status = resp.status();
            dl_state.cancels.lock().unwrap().remove(&model_id);
            return Err(format!("HTTP {status}"));
        }

        let total = resp.content_length().unwrap_or(0);
        let mut downloaded: u64 = 0;

        use tokio::io::AsyncWriteExt;
        let mut file = tokio::fs::File::create(&dest).await.map_err(|e| e.to_string())?;

        loop {
            if cancel.load(Ordering::Relaxed) {
                drop(file);
                let _ = tokio::fs::remove_file(&dest).await;
                dl_state.cancels.lock().unwrap().remove(&model_id);
                return Err("cancelled".into());
            }

            match resp.chunk().await {
                Ok(Some(chunk)) => {
                    file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                    downloaded += chunk.len() as u64;
                    let _ = app.emit(
                        "model-download-progress",
                        DownloadProgressEvent {
                            model_id: model_id.clone(),
                            file_index: i,
                            file_count,
                            downloaded,
                            total,
                            done: false,
                            error: None,
                        },
                    );
                }
                Ok(None) => {
                    file.flush().await.map_err(|e| e.to_string())?;
                    break;
                }
                Err(e) => {
                    drop(file);
                    let _ = tokio::fs::remove_file(&dest).await;
                    let _ = app.emit(
                        "model-download-progress",
                        DownloadProgressEvent {
                            model_id: model_id.clone(),
                            file_index: i,
                            file_count,
                            downloaded,
                            total,
                            done: true,
                            error: Some(e.to_string()),
                        },
                    );
                    dl_state.cancels.lock().unwrap().remove(&model_id);
                    return Err(e.to_string());
                }
            }
        }
    }

    let _ = app.emit(
        "model-download-progress",
        DownloadProgressEvent {
            model_id: model_id.clone(),
            file_index: file_count,
            file_count,
            downloaded: 0,
            total: 0,
            done: true,
            error: None,
        },
    );

    dl_state.cancels.lock().unwrap().remove(&model_id);
    Ok(())
}

#[tauri::command]
fn cancel_model_download(dl_state: tauri::State<'_, DownloadState>, model_id: String) {
    if let Ok(cancels) = dl_state.cancels.lock() {
        if let Some(flag) = cancels.get(&model_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
async fn delete_model_files(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    filenames: Vec<String>,
) -> Result<(), String> {
    let base = models_dir(&app, &dir_state)?;
    for f in &filenames {
        let path = base.join(f);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ─── Embedded Python (python-build-standalone) ────────────────────────────────
// A self-contained Python 3.11 is downloaded once into the app data directory.
// This removes any dependency on the user's system Python / conda / pyenv.

fn embedded_python_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("embedded_python"))
        .map_err(|e| e.to_string())
}

fn embedded_python_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = embedded_python_dir(app)?;
    Ok(if cfg!(target_os = "windows") {
        dir.join("python").join("python.exe")
    } else {
        dir.join("python").join("bin").join("python3")
    })
}


fn python_standalone_url() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-aarch64-apple-darwin-install_only.tar.gz"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-x86_64-apple-darwin-install_only.tar.gz"
    } else if cfg!(target_os = "windows") {
        "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-x86_64-pc-windows-msvc-install_only.tar.gz"
    } else {
        "unsupported"
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PythonDownloadProgress {
    percent: u32,
    done: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PipInstallProgress {
    line: String,
    done: bool,
    success: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PythonEnvInfo {
    python_ready: bool,
    packages_ready: bool,
    pip_install_cmd: String,
    python_path: String,
}

#[tauri::command]
async fn get_python_env_info(app: AppHandle) -> Result<PythonEnvInfo, String> {
    let python = embedded_python_exe(&app)?;

    let python_ready = python.exists();
    let packages_ready = if python_ready {
        tokio::process::Command::new(&python)
            .args(["-c", "import onnxruntime, unidecode, demucs; from ctc_forced_aligner import load_audio, generate_emissions, preprocess_text, get_alignments, get_spans, postprocess_results, ensure_onnx_model, Tokenizer"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        false
    };

    Ok(PythonEnvInfo {
        python_ready,
        packages_ready,
        pip_install_cmd: format!("\"{}\" -m pip install torch \"ctc-forced-aligner<2\"", python.to_string_lossy()),
        python_path: python.to_string_lossy().into_owned(),
    })
}

/// Downloads python-build-standalone (~20 MB) and extracts it into the app data directory.
/// Emits `python-download-progress` events while downloading.
#[tauri::command]
async fn download_embedded_python(app: AppHandle) -> Result<(), String> {
    let python_exe = embedded_python_exe(&app)?;
    if python_exe.exists() {
        return Ok(());
    }

    let dir = embedded_python_dir(&app)?;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let url = python_standalone_url();
    if url == "unsupported" {
        return Err("이 플랫폼은 지원되지 않습니다.".to_string());
    }

    // Stream download with progress events
    let tarball_path = dir.join("python.tar.gz");
    let client = reqwest::Client::new();
    let mut resp = client.get(url).send().await.map_err(|e| format!("다운로드 실패: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&tarball_path).await.map_err(|e| e.to_string())?;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let _ = app.emit("python-download-progress", PythonDownloadProgress {
                percent: (downloaded * 100 / total) as u32,
                done: false,
            });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    // Extract tarball
    let status = tokio::process::Command::new("tar")
        .args(["-xzf", tarball_path.to_str().unwrap(), "-C", dir.to_str().unwrap()])
        .status()
        .await
        .map_err(|e| e.to_string())?;
    let _ = tokio::fs::remove_file(&tarball_path).await;

    if !status.success() {
        return Err("압축 해제 실패".to_string());
    }

    // Remove macOS quarantine so the binary runs without Gatekeeper prompts
    #[cfg(target_os = "macos")]
    {
        let _ = tokio::process::Command::new("xattr")
            .args(["-rd", "com.apple.quarantine", dir.to_str().unwrap()])
            .status()
            .await;
    }

    let _ = app.emit("python-download-progress", PythonDownloadProgress { percent: 100, done: true });
    Ok(())
}

/// Installs torch and ctc-forced-aligner into the embedded Python.
/// Streams pip output lines via `pip-install-progress` events.
#[tauri::command]
async fn install_python_packages(app: AppHandle) -> Result<(), String> {
    let python = embedded_python_exe(&app)?;
    if !python.exists() {
        return Err("Python이 설치되지 않았습니다.".to_string());
    }

    use tokio::io::{AsyncBufReadExt, BufReader};

    // Use `python -m pip` instead of the pip3 script to avoid shebang path-with-spaces issues.
    let mut child = tokio::process::Command::new(&python)
        .args(["-m", "pip", "install", "torch", "ctc-forced-aligner<2", "unidecode", "demucs"])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("pip 실행 실패: {e}"))?;

    let stdout = child.stdout.take().unwrap();
    let stderr = child.stderr.take().unwrap();

    let app2 = app.clone();
    let stdout_handle = tokio::spawn(async move {
        let mut lines = BufReader::new(stdout).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app2.emit("pip-install-progress", PipInstallProgress {
                line,
                done: false,
                success: false,
            });
        }
    });

    let app3 = app.clone();
    let stderr_handle = tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            let _ = app3.emit("pip-install-progress", PipInstallProgress {
                line,
                done: false,
                success: false,
            });
        }
    });

    let status = child.wait().await.map_err(|e| e.to_string())?;
    let _ = stdout_handle.await;
    let _ = stderr_handle.await;

    let success = status.success();
    let _ = app.emit("pip-install-progress", PipInstallProgress {
        line: String::new(),
        done: true,
        success,
    });

    if success {
        Ok(())
    } else {
        Err("패키지 설치에 실패했습니다.".to_string())
    }
}

// ─── Alignment commands ───────────────────────────────────────────────────────

/// Run the Python ctc-forced-aligner sidecar script using the app-managed venv.
/// `lines_json`: JSON array of `{"index": number, "text": string}` (non-empty lines only).
/// `language`:   ISO 639-3 code, e.g. "eng" / "kor" / "jpn".
/// Returns JSON array of `{"index", "start", "end", "confidence"}`.
/// Progress events are emitted as `alignment-progress`.
#[tauri::command]
async fn run_alignment(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    al_state: tauri::State<'_, AlignmentState>,
    audio_path: String,
    lines_json: String,
    language: String,
) -> Result<String, String> {
    // Use the app-embedded Python (downloaded once via Settings > AI Models)
    let python_exe = embedded_python_exe(&app)?;
    if !python_exe.exists() {
        return Err(
            "Python이 설정되지 않았습니다. 설정 > AI 모델 탭에서 Python을 다운로드하세요.".to_string()
        );
    }
    let python_str = python_exe.to_string_lossy().into_owned();

    // Fresh cancel flag for this run
    let cancel = {
        let new_flag = Arc::new(AtomicBool::new(false));
        *al_state.cancel_flag.lock().unwrap() = new_flag.clone();
        new_flag
    };

    // Write the embedded Python scripts to temp files
    let align_script_path = std::env::temp_dir().join("lyrical_sync_align.py");
    tokio::fs::write(&align_script_path, ALIGN_SCRIPT)
        .await
        .map_err(|e| format!("스크립트 쓰기 실패: {e}"))?;

    let models_dir_path = models_dir(&app, &dir_state)?;
    let models_dir_str = models_dir_path.to_string_lossy().into_owned();

    use tokio::process::Command as Cmd;
    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader as ABufReader};

    // ── Vocal separation (Demucs) if model is available ──────────────────────
    let demucs_model = models_dir_path.join("demucs").join("htdemucs.th");
    let vocals_tmp_path = std::env::temp_dir().join("lyrical_sync_vocals.wav");
    let audio_for_align: String;

    if demucs_model.exists() {
        let sep_script_path = std::env::temp_dir().join("lyrical_sync_separate.py");
        tokio::fs::write(&sep_script_path, SEPARATE_SCRIPT)
            .await
            .map_err(|e| format!("스크립트 쓰기 실패: {e}"))?;

        let mut sep_child = Cmd::new(&python_str)
            .args([
                sep_script_path.to_str().unwrap(),
                "--model-path", &demucs_model.to_string_lossy(),
                "--audio",      &audio_path,
                "--output",     &vocals_tmp_path.to_string_lossy().as_ref(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Python 실행 실패: {e}"))?;

        let sep_stderr = sep_child.stderr.take().unwrap();
        let mut sep_reader = ABufReader::new(sep_stderr).lines();
        let mut sep_error: Option<String> = None;

        while let Ok(Some(line)) = sep_reader.next_line().await {
            if cancel.load(Ordering::Relaxed) {
                let _ = sep_child.kill().await;
                return Err("cancelled".into());
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                let status  = val["status"].as_str().unwrap_or("").to_string();
                let message = val["message"].as_str().unwrap_or("").to_string();
                let percent = val["percent"].as_f64().unwrap_or(0.0) as f32;
                let _ = app.emit("alignment-progress", AlignmentProgressEvent {
                    status: status.clone(), message: message.clone(), percent,
                });
                if status == "error" {
                    sep_error = Some(message);
                    let _ = sep_child.kill().await;
                    break;
                }
            }
        }

        if let Some(err) = sep_error {
            return Err(err);
        }
        let _ = sep_child.wait().await;
        audio_for_align = vocals_tmp_path.to_string_lossy().into_owned();
    } else {
        audio_for_align = audio_path.clone();
    }

    let script_str = align_script_path.to_str().unwrap();
    let mut child = Cmd::new(&python_str)
        .args([
            script_str,
            "--models-dir", &models_dir_str,
            "--audio",      &audio_for_align,
            "--lines",      &lines_json,
            "--language",   &language,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Python 실행 실패: {e}"))?;

    let stderr = child.stderr.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    // Stream stderr line by line for progress events
    let mut stderr_reader = ABufReader::new(stderr).lines();
    let mut last_error: Option<String> = None;

    while let Ok(Some(line)) = stderr_reader.next_line().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            return Err("cancelled".into());
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            let status = val["status"].as_str().unwrap_or("").to_string();
            let message = val["message"].as_str().unwrap_or("").to_string();
            let percent = val["percent"].as_f64().unwrap_or(0.0) as f32;

            let _ = app.emit("alignment-progress", AlignmentProgressEvent {
                status: status.clone(),
                message: message.clone(),
                percent,
            });

            if status == "error" {
                last_error = Some(message);
                let _ = child.kill().await;
                break;
            }
        }
    }

    if let Some(err) = last_error {
        return Err(err);
    }

    // Collect stdout (final JSON result)
    let mut stdout_data = String::new();
    ABufReader::new(stdout)
        .read_to_string(&mut stdout_data)
        .await
        .map_err(|e| e.to_string())?;

    let status = child.wait().await.map_err(|e| e.to_string())?;

    // Clean up temp vocals file
    if audio_for_align != audio_path {
        let _ = tokio::fs::remove_file(&vocals_tmp_path).await;
    }

    if !status.success() {
        return Err(format!(
            "정렬 스크립트 오류 (exit {})",
            status.code().unwrap_or(-1)
        ));
    }

    Ok(stdout_data.trim().to_string())
}

#[tauri::command]
fn cancel_alignment(al_state: tauri::State<'_, AlignmentState>) {
    al_state.cancel_flag.lock().unwrap().store(true, Ordering::Relaxed);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadState::default())
        .manage(ModelsDirState::default())
        .manage(AlignmentState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_lrc_file,
            write_lrc_file,
            read_audio_file,
            decode_audio_to_wav,
            set_models_dir_override,
            get_models_dir,
            check_model_files,
            download_model,
            cancel_model_download,
            delete_model_files,
            get_python_env_info,
            download_embedded_python,
            install_python_packages,
            run_alignment,
            cancel_alignment,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
