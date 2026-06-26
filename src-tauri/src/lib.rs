mod service_auth;
use service_auth::*;

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
    /// 선택적 SHA-256 (소문자 hex). 지정 시 다운로드 후 무결성 검증, 불일치하면 파일 삭제·실패.
    #[serde(default)]
    sha256: Option<String>,
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
async fn read_audio_file(path: String) -> Result<tauri::ipc::Response, String> {
    // 바이트를 JSON(number[]) 대신 raw 바이너리로 반환 → 대용량 오디오도 빠름
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
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

#[derive(serde::Serialize)]
struct AudioMetadata {
    title: String,
    artist: String,
    album: String,
}

/// 오디오 파일 태그(ID3/Vorbis/MP4 등)에서 제목·아티스트·앨범을 읽습니다.
/// 태그가 없거나 읽기 실패 시 빈 문자열을 돌려줍니다(프런트에서 빈 필드만 채움).
#[tauri::command]
fn read_audio_metadata(path: String) -> Result<AudioMetadata, String> {
    use lofty::file::TaggedFileExt;
    use lofty::tag::Accessor;
    let tagged = lofty::read_from_path(&path).map_err(|e| e.to_string())?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let s = |o: Option<std::borrow::Cow<str>>| o.map(|c| c.trim().to_string()).unwrap_or_default();
    Ok(match tag {
        Some(t) => AudioMetadata { title: s(t.title()), artist: s(t.artist()), album: s(t.album()) },
        None => AudioMetadata { title: String::new(), artist: String::new(), album: String::new() },
    })
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
        use sha2::{Digest, Sha256};
        let mut hasher = Sha256::new();
        let verify = spec.sha256.as_deref().map(str::trim).filter(|s| !s.is_empty());
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
                    if verify.is_some() { hasher.update(&chunk); }
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
                    // 무결성 검증 (sha256 지정된 파일만)
                    if let Some(expected) = verify {
                        let got = format!("{:x}", hasher.finalize());
                        if !got.eq_ignore_ascii_case(expected) {
                            drop(file);
                            let _ = tokio::fs::remove_file(&dest).await;
                            dl_state.cancels.lock().unwrap().remove(&model_id);
                            return Err(format!(
                                "체크섬 불일치 ({}): 예상 {} / 실제 {}",
                                spec.filename, expected, got
                            ));
                        }
                    }
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


/// Creates a Command for the embedded Python, pre-configured to suppress console windows on Windows.
fn python_cmd(python: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(python);
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW: prevents a black CMD console from flashing during Python subprocess spawns.
        cmd.creation_flags(0x08000000);
    }
    cmd
}

/// Like `python_cmd`, but additionally sets ABOVE_NORMAL_PRIORITY_CLASS on Windows.
/// On Intel hybrid CPUs (Alder Lake+), the Windows 11 scheduler and Intel Thread Director
/// use priority class as a hint: ABOVE_NORMAL causes P-cores to be preferred over E-cores,
/// preventing ML inference from being silently throttled to efficiency cores.
fn python_cmd_inference(python: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(python);
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW (0x08000000) | ABOVE_NORMAL_PRIORITY_CLASS (0x00008000)
        cmd.creation_flags(0x08008000);
    }
    cmd
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
        python_cmd(&python)
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
        .arg("-xzf").arg(&tarball_path).arg("-C").arg(&dir)
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
            .arg("-rd").arg("com.apple.quarantine").arg(&dir)
            .status()
            .await;
    }

    let _ = app.emit("python-download-progress", PythonDownloadProgress { percent: 100, done: true });
    Ok(())
}

// On Windows, ctc-forced-aligner 1.0.2 has three bugs that prevent a clean install:
//   1. setup.py uses `-std=c++17` (GCC syntax) — MSVC requires `/std:c++17`
//   2. main.cpp has no PyInit_align_ops symbol — MSVC linker emits LNK2001 and aborts
//   3. ctc_aligner.py globs `align_ops.*.so` only — misses the `.pyd` file on Windows
// This script is written to a temp file and executed with the embedded Python to apply
// all three patches to the downloaded source before building and installing.
#[cfg(target_os = "windows")]
const CTC_PATCH_SCRIPT: &str = r#"
import subprocess, sys, os, tarfile, shutil, tempfile, glob

sys.stdout.write("[ctc] patch script started\n")
sys.stdout.flush()

def run_pip(*args):
    proc = subprocess.Popen(
        [sys.executable, "-m", "pip"] + list(args),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    for line in proc.stdout:
        sys.stdout.write(line)
        sys.stdout.flush()
    proc.wait()
    return proc.returncode

tmpdir = tempfile.mkdtemp(prefix="ctc_patch_")
try:
    sys.stdout.write("[ctc] downloading source...\n")
    sys.stdout.flush()
    ret = run_pip("download", "ctc-forced-aligner<2", "--no-deps", "-d", tmpdir)
    if ret != 0:
        sys.stderr.write("[ctc] download failed\n")
        sys.stderr.flush()
        sys.exit(1)

    tarballs = glob.glob(os.path.join(tmpdir, "ctc_forced_aligner-*.tar.gz"))
    if not tarballs:
        sys.stderr.write("[ctc] no source tarball found\n")
        sys.stderr.flush()
        sys.exit(1)

    extract_dir = os.path.join(tmpdir, "src")
    os.makedirs(extract_dir, exist_ok=True)
    with tarfile.open(tarballs[0], "r:gz") as t:
        t.extractall(extract_dir)

    subdirs = [d for d in os.listdir(extract_dir)
               if os.path.isdir(os.path.join(extract_dir, d))]
    src_dir = os.path.join(extract_dir, subdirs[0])
    sys.stdout.write("[ctc] source extracted to: " + src_dir + "\n")
    sys.stdout.flush()

    # Patch 1: setup.py — use /std:c++17 for MSVC
    sys.stdout.write("[ctc] patching setup.py...\n")
    sys.stdout.flush()
    p = os.path.join(src_dir, "setup.py")
    txt = open(p, encoding="utf-8").read()
    patched = txt.replace(
        'extra_compile_args=["-std=c++17"],',
        'extra_compile_args=["/std:c++17"] if __import__("sys").platform == "win32" else ["-std=c++17"],'
    )
    if patched == txt:
        sys.stdout.write("[ctc] WARNING: setup.py patch target not found\n")
        sys.stdout.flush()
    open(p, "w", encoding="utf-8").write(patched)

    # Patch 2: main.cpp — add PyInit stub so MSVC linker finds the required export symbol
    sys.stdout.write("[ctc] patching main.cpp...\n")
    sys.stdout.flush()
    p = os.path.join(src_dir, "ctc_forced_aligner", "main.cpp")
    txt = open(p, encoding="utf-8").read()
    stub = ('\n#ifdef _WIN32\n'
            'extern "C" __declspec(dllexport) void* PyInit_align_ops(void) { return (void*)0; }\n'
            '#endif\n')
    open(p, "w", encoding="utf-8").write(txt + stub)

    # Patch 3: ctc_aligner.py — support .pyd extension on Windows
    sys.stdout.write("[ctc] patching ctc_aligner.py...\n")
    sys.stdout.flush()
    p = os.path.join(src_dir, "ctc_forced_aligner", "ctc_aligner.py")
    txt = open(p, encoding="utf-8").read()
    patched = txt.replace(
        'lib_pattern = os.path.join(lib_dir, "align_ops.*.so")  # Matches align_ops.cpython-*.so',
        ('lib_pattern = os.path.join(lib_dir, "align_ops*.pyd") if os.name == "nt" '
         'else os.path.join(lib_dir, "align_ops.*.so")  # .pyd on Windows, .so on Unix')
    )
    if patched == txt:
        sys.stdout.write("[ctc] WARNING: ctc_aligner.py patch target not found\n")
        sys.stdout.flush()
    open(p, "w", encoding="utf-8").write(patched)

    sys.stdout.write("[ctc] building and installing (this may take several minutes)...\n")
    sys.stdout.flush()
    ret = run_pip("install", "--prefer-binary", src_dir)
    if ret != 0:
        sys.stderr.write("[ctc] install failed (see above for compiler errors)\n")
        sys.stderr.flush()
        sys.exit(1)

    sys.stdout.write("[ctc] install complete!\n")
    sys.stdout.flush()
except Exception as e:
    import traceback
    sys.stderr.write("[ctc] error: " + str(e) + "\n")
    sys.stderr.flush()
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
finally:
    shutil.rmtree(tmpdir, ignore_errors=True)
"#;

/// Streams piped stdout/stderr from a child process as `pip-install-progress` events.
/// Only streams whichever handles are actually piped (Some). Returns true on success.
/// On Windows, grandchild processes may inherit pipe write handles and block EOF;
/// we abort readers 500 ms after process exit to avoid hanging.
async fn stream_pip_child(app: AppHandle, mut child: tokio::process::Child) -> bool {
    use tokio::io::{AsyncBufReadExt, BufReader};

    fn spawn_reader(
        app: AppHandle,
        stream: Option<impl tokio::io::AsyncRead + Send + Unpin + 'static>,
    ) -> Option<tokio::task::JoinHandle<()>> {
        stream.map(|s| {
            tokio::spawn(async move {
                let mut lines = BufReader::new(s).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = app.emit("pip-install-progress", PipInstallProgress {
                        line, done: false, success: false,
                    });
                }
            })
        })
    }

    let stdout_handle = spawn_reader(app.clone(), child.stdout.take());
    let stderr_handle = spawn_reader(app.clone(), child.stderr.take());

    let ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        async {
            if let Some(h) = stdout_handle { let _ = h.await; }
            if let Some(h) = stderr_handle { let _ = h.await; }
        },
    ).await;
    ok
}

/// Installs torch and ctc-forced-aligner into the embedded Python.
/// Streams pip output lines via `pip-install-progress` events.
#[tauri::command]
async fn install_python_packages(app: AppHandle) -> Result<(), String> {
    let python = embedded_python_exe(&app)?;
    if !python.exists() {
        return Err("Python이 설치되지 않았습니다.".to_string());
    }

    // Upgrade pip first so wheel resolution is up-to-date.
    let _ = python_cmd(&python)
        .args(["-m", "pip", "install", "--upgrade", "pip"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;

    // Step 1: install packages that have pre-built wheels everywhere.
    // On Windows, ctc-forced-aligner is handled separately in Step 2 via a patched source build.
    #[cfg(target_os = "windows")]
    let step1: &[&str] = &["torch", "unidecode", "demucs"];
    #[cfg(not(target_os = "windows"))]
    let step1: &[&str] = &["torch", "ctc-forced-aligner<2", "unidecode", "demucs"];

    // pip writes all output to stderr in modern versions; stdout is empty.
    // Capturing only stderr eliminates duplicate lines (pip sometimes writes to both).
    // --no-warn-script-location suppresses the "Scripts not on PATH" noise.
    let child1 = python_cmd(&python)
        .args(["-m", "pip", "install", "--prefer-binary", "--no-warn-script-location"])
        .args(step1)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("pip 실행 실패: {e}"))?;

    let ok1 = stream_pip_child(app.clone(), child1).await;

    // Step 2 (Windows only): patch ctc-forced-aligner source and install.
    #[cfg(target_os = "windows")]
    let ok2 = {
        let _ = app.emit("pip-install-progress", PipInstallProgress {
            line: "── Building ctc-forced-aligner from source. This may take 3-5 minutes... ──".to_string(),
            done: false,
            success: false,
        });

        let script_path = std::env::temp_dir().join("lyrical_sync_ctc_patch.py");
        tokio::fs::write(&script_path, CTC_PATCH_SCRIPT)
            .await
            .map_err(|e| format!("패치 스크립트 쓰기 실패: {e}"))?;

        let child2 = python_cmd(&python)
            .arg("-u")
            .arg(&script_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("패치 스크립트 실행 실패: {e}"))?;

        stream_pip_child(app.clone(), child2).await
    };
    #[cfg(not(target_os = "windows"))]
    let ok2 = true;

    let success = ok1 && ok2;

    // On Windows, pip may return a non-zero exit code due to post-install hook
    // failures or transient file-system locks even when all package files were
    // written successfully.  Verify by actually importing the packages so we
    // don't show a false-positive error to the user.
    #[cfg(target_os = "windows")]
    let success = if success { true } else {
        python_cmd(&python)
            .args(["-c", "import onnxruntime, unidecode, demucs; from ctc_forced_aligner import load_audio, generate_emissions, preprocess_text, get_alignments, get_spans, postprocess_results, ensure_onnx_model, Tokenizer"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false)
    };

    let _ = app.emit("pip-install-progress", PipInstallProgress {
        line: String::new(),
        done: true,
        success,
    });

    if success { Ok(()) } else { Err("패키지 설치에 실패했습니다.".to_string()) }
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
    use_separation: bool,
    use_vad: bool,
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

    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader as ABufReader};

    // ── Vocal separation (Demucs) if model is available ──────────────────────
    let demucs_model = models_dir_path.join("demucs").join("htdemucs.th");
    let vocals_tmp_path = std::env::temp_dir().join("lyrical_sync_vocals.wav");
    let audio_for_align: String;

    if use_separation && demucs_model.exists() {
        let sep_script_path = std::env::temp_dir().join("lyrical_sync_separate.py");
        tokio::fs::write(&sep_script_path, SEPARATE_SCRIPT)
            .await
            .map_err(|e| format!("스크립트 쓰기 실패: {e}"))?;

        let mut sep_child = python_cmd_inference(&python_str)
            .args([
                sep_script_path.to_string_lossy().as_ref(),
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

    let script_str = align_script_path.to_string_lossy().into_owned();
    // VAD on the audio is only meaningful when it's the isolated vocal stem
    let separated_flag = if audio_for_align != audio_path { "true" } else { "false" };
    let vad_flag = if use_vad { "true" } else { "false" };
    let mut child = python_cmd_inference(&python_str)
        .args([
            script_str.as_str(),
            "--models-dir", &models_dir_str,
            "--audio",      &audio_for_align,
            "--lines",      &lines_json,
            "--language",   &language,
            "--separated",  separated_flag,
            "--vad",        vad_flag,
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

// ─── yt-dlp ───────────────────────────────────────────────────────────────────

pub struct YtdlpState {
    cancel_flag: Arc<AtomicBool>,
}

impl Default for YtdlpState {
    fn default() -> Self {
        Self { cancel_flag: Arc::new(AtomicBool::new(false)) }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct YtdlpInstallProgress {
    downloaded: u64,
    total: u64,
    done: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct YtdlpAudioProgress {
    percent: f32,
    speed: String,
    eta: String,
    done: bool,
}

fn ytdlp_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path().app_data_dir()
        .map(|d| d.join("ytdlp"))
        .map_err(|e| e.to_string())
}

fn ytdlp_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = ytdlp_dir(app)?;
    #[cfg(target_os = "windows")]
    return Ok(dir.join("yt-dlp.exe"));
    #[cfg(not(target_os = "windows"))]
    return Ok(dir.join("yt-dlp"));
}

#[tauri::command]
fn check_ytdlp(app: AppHandle) -> Result<Option<String>, String> {
    let exe = match ytdlp_exe(&app) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    if !exe.exists() {
        return Ok(None);
    }
    let dir = ytdlp_dir(&app).unwrap_or_default();
    let version = std::fs::read_to_string(dir.join("version.txt"))
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_default();
    Ok(Some(version))
}

#[tauri::command]
async fn download_ytdlp(app: AppHandle) -> Result<(), String> {
    let dir = ytdlp_dir(&app)?;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let (remote_name, local_name) = ("yt-dlp.exe", "yt-dlp.exe");
    #[cfg(not(target_os = "windows"))]
    let (remote_name, local_name) = ("yt-dlp_macos", "yt-dlp");

    let url = format!(
        "https://github.com/yt-dlp/yt-dlp/releases/latest/download/{}",
        remote_name
    );
    let dest = dir.join(local_name);

    let client = reqwest::Client::new();

    // Fetch latest release tag from GitHub API before downloading
    let version_tag: String = async {
        let r = client
            .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
            .header("User-Agent", "lyrical-sync/1.0")
            .send()
            .await?;
        let j: serde_json::Value = r.json().await?;
        Ok::<String, reqwest::Error>(
            j["tag_name"].as_str().unwrap_or("").to_string()
        )
    }
    .await
    .unwrap_or_default();

    let mut resp = client
        .get(&url)
        .header("User-Agent", "lyrical-sync/1.0")
        .send()
        .await
        .map_err(|e| format!("요청 실패: {e}"))?;

    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }

    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use tokio::io::AsyncWriteExt;
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    let mut file = tokio::fs::File::create(&dest).await.map_err(|e| e.to_string())?;

    loop {
        match resp.chunk().await {
            Ok(Some(chunk)) => {
                file.write_all(&chunk).await.map_err(|e| e.to_string())?;
                hasher.update(&chunk);
                downloaded += chunk.len() as u64;
                let _ = app.emit("ytdlp-install-progress", YtdlpInstallProgress {
                    downloaded, total, done: false,
                });
            }
            Ok(None) => {
                file.flush().await.map_err(|e| e.to_string())?;
                break;
            }
            Err(e) => {
                drop(file);
                let _ = tokio::fs::remove_file(&dest).await;
                return Err(e.to_string());
            }
        }
    }

    // 무결성 검증: 같은 릴리즈의 SHA2-256SUMS에서 자산 해시를 받아 대조.
    // SUMS를 받을 수 있으면 엄격히 검증(불일치=실패), 못 받으면 best-effort로 통과.
    let actual = format!("{:x}", hasher.finalize());
    let expected: Option<String> = async {
        let r = client
            .get("https://github.com/yt-dlp/yt-dlp/releases/latest/download/SHA2-256SUMS")
            .header("User-Agent", "lyrical-sync/1.0")
            .send()
            .await
            .ok()?;
        if !r.status().is_success() { return None; }
        let text = r.text().await.ok()?;
        text.lines().find_map(|l| {
            let mut it = l.split_whitespace();
            let hash = it.next()?;
            let name = it.next()?;
            if name == remote_name { Some(hash.to_string()) } else { None }
        })
    }
    .await;
    if let Some(exp) = expected {
        if !actual.eq_ignore_ascii_case(&exp) {
            let _ = tokio::fs::remove_file(&dest).await;
            return Err(format!("yt-dlp 체크섬 불일치: 예상 {exp} / 실제 {actual}"));
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        use std::os::unix::fs::PermissionsExt;
        let mut perms = std::fs::metadata(&dest).map_err(|e| e.to_string())?.permissions();
        perms.set_mode(0o755);
        std::fs::set_permissions(&dest, perms).map_err(|e| e.to_string())?;
    }

    if !version_tag.is_empty() {
        let _ = std::fs::write(dir.join("version.txt"), &version_tag);
    }

    let _ = app.emit("ytdlp-install-progress", YtdlpInstallProgress {
        downloaded, total, done: true,
    });
    Ok(())
}

fn parse_ytdlp_progress(line: &str) -> Option<YtdlpAudioProgress> {
    let t = line.trim();
    if !t.starts_with("[download]") || !t.contains('%') {
        return None;
    }
    let parts: Vec<&str> = t.split_whitespace().collect();
    let percent: f32 = parts.get(1)?.trim_end_matches('%').parse().ok()?;
    let speed = parts.iter().position(|&s| s == "at")
        .and_then(|i| parts.get(i + 1)).map(|s| s.to_string()).unwrap_or_default();
    let eta = parts.iter().position(|&s| s == "ETA")
        .and_then(|i| parts.get(i + 1)).map(|s| s.to_string()).unwrap_or_default();
    Some(YtdlpAudioProgress { percent, speed, eta, done: false })
}

async fn find_ytdlp_output(dir: &PathBuf, prefix: &str) -> Result<PathBuf, String> {
    let mut rd = tokio::fs::read_dir(dir).await.map_err(|e| e.to_string())?;
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(prefix) && !name.ends_with(".part") {
            return Ok(entry.path());
        }
    }
    Err("다운로드된 파일을 찾을 수 없습니다".into())
}

#[tauri::command]
async fn ytdlp_load_audio(
    url: String,
    quality: String,
    cookies_file: Option<String>,
    proxy: Option<String>,
    app: AppHandle,
    ytdlp_state: tauri::State<'_, YtdlpState>,
) -> Result<String, String> {
    let exe = ytdlp_exe(&app)?;
    if !exe.exists() {
        return Err("yt-dlp가 설치되지 않았습니다".into());
    }

    ytdlp_state.cancel_flag.store(false, Ordering::Relaxed);

    let cache_dir = app.path().app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("ytdlp-audio");

    if cache_dir.exists() {
        let _ = tokio::fs::remove_dir_all(&cache_dir).await;
    }
    tokio::fs::create_dir_all(&cache_dir).await.map_err(|e| e.to_string())?;

    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();

    let output_tpl = cache_dir.join(format!("{}.%(ext)s", ts));

    let format = match quality.as_str() {
        "192" => "bestaudio[abr<=192]/bestaudio/best",
        "128" => "bestaudio[abr<=128]/bestaudio/best",
        _ => "bestaudio/best",
    };

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.arg("--no-playlist")
        .arg("-f").arg(format)
        .arg("-o").arg(&output_tpl)
        .arg("--newline")
        .arg("--no-part");

    if let Some(ref c) = cookies_file {
        if !c.is_empty() { cmd.arg("--cookies").arg(c); }
    }
    if let Some(ref p) = proxy {
        if !p.is_empty() { cmd.arg("--proxy").arg(p); }
    }

    cmd.arg(&url)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let mut child = cmd.spawn().map_err(|e| format!("yt-dlp 실행 실패: {e}"))?;
    let stdout = child.stdout.take().unwrap();

    use tokio::io::{AsyncBufReadExt, BufReader};
    let mut reader = BufReader::new(stdout).lines();

    let cancel_flag = ytdlp_state.cancel_flag.clone();
    let app_c = app.clone();
    let mut dest_path: Option<String> = None;

    while let Ok(Some(line)) = reader.next_line().await {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            let _ = tokio::fs::remove_dir_all(&cache_dir).await;
            return Err("cancelled".into());
        }
        if let Some(p) = line.strip_prefix("[download] Destination: ") {
            dest_path = Some(p.trim().to_string());
        } else if let Some(p) = line.strip_prefix("[Merger] Merging formats into \"") {
            dest_path = Some(p.trim_end_matches('"').to_string());
        }
        if let Some(progress) = parse_ytdlp_progress(&line) {
            let _ = app_c.emit("ytdlp-audio-progress", &progress);
        }
    }

    let status = child.wait().await.map_err(|e| e.to_string())?;

    if cancel_flag.load(Ordering::Relaxed) {
        let _ = tokio::fs::remove_dir_all(&cache_dir).await;
        return Err("cancelled".into());
    }
    if !status.success() {
        return Err(format!("yt-dlp 오류 (종료 코드 {:?})", status.code()));
    }

    let file_path = if let Some(ref p) = dest_path {
        let pb = PathBuf::from(p);
        if pb.exists() { pb } else { find_ytdlp_output(&cache_dir, &ts).await? }
    } else {
        find_ytdlp_output(&cache_dir, &ts).await?
    };

    let _ = app.emit("ytdlp-audio-progress", YtdlpAudioProgress {
        percent: 100.0, speed: String::new(), eta: String::new(), done: true,
    });

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
fn cancel_ytdlp_load(ytdlp_state: tauri::State<'_, YtdlpState>) {
    ytdlp_state.cancel_flag.store(true, Ordering::Relaxed);
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadState::default())
        .manage(ModelsDirState::default())
        .manage(AlignmentState::default())
        .manage(YtdlpState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .invoke_handler(tauri::generate_handler![
            read_lrc_file,
            write_lrc_file,
            read_audio_file,
            decode_audio_to_wav,
            read_audio_metadata,
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
            start_oauth_listener,
            exchange_spotify_token,
            refresh_spotify_token,
            save_refresh_token,
            load_refresh_token,
            clear_refresh_token,
            check_ytdlp,
            download_ytdlp,
            ytdlp_load_audio,
            cancel_ytdlp_load,
            lrclib_publish,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

// ─── LRCLIB publish (가사 기여) ─────────────────────────────────────────────────

#[derive(Deserialize)]
struct LrclibChallenge {
    prefix: String,
    target: String,
}

fn hex_to_bytes(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .filter_map(|i| s.get(i..i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect()
}

/// SHA-256(prefix+nonce) ≤ target (big-endian 32바이트 비교)
fn nonce_meets_target(hash: &[u8], target: &[u8]) -> bool {
    for i in 0..target.len().min(hash.len()) {
        if hash[i] > target[i] {
            return false;
        } else if hash[i] < target[i] {
            return true;
        }
    }
    true
}

/// 동기화 가사를 LRCLIB에 업로드(기여). PoW 챌린지를 풀어 토큰을 만든 뒤 publish.
#[tauri::command]
async fn lrclib_publish(
    track_name: String,
    artist_name: String,
    album_name: String,
    duration: f64,
    plain_lyrics: String,
    synced_lyrics: String,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let client = reqwest::Client::new();

    // 1) 챌린지 요청
    let ch: LrclibChallenge = client
        .post("https://lrclib.net/api/request-challenge")
        .header("User-Agent", "lyrical-sync")
        .send()
        .await
        .map_err(|e| format!("챌린지 요청 실패: {e}"))?
        .json()
        .await
        .map_err(|e| format!("챌린지 파싱 실패: {e}"))?;

    // 2) PoW 풀기 (CPU 집약 → 블로킹 스레드)
    let prefix = ch.prefix;
    let target = hex_to_bytes(&ch.target);
    let token = tokio::task::spawn_blocking(move || {
        let mut nonce: u64 = 0;
        loop {
            let hash = Sha256::digest(format!("{prefix}{nonce}").as_bytes());
            if nonce_meets_target(&hash, &target) {
                return format!("{prefix}:{nonce}");
            }
            nonce += 1;
        }
    })
    .await
    .map_err(|e| format!("PoW 실패: {e}"))?;

    // 3) 업로드
    let body = serde_json::json!({
        "trackName": track_name,
        "artistName": artist_name,
        "albumName": album_name,
        "duration": duration,
        "plainLyrics": plain_lyrics,
        "syncedLyrics": synced_lyrics,
    });
    let resp = client
        .post("https://lrclib.net/api/publish")
        .header("X-Publish-Token", token)
        .header("User-Agent", "lyrical-sync")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("업로드 요청 실패: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("업로드 실패 ({status}): {text}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ytdlp_progress_extracts_fields() {
        let p = parse_ytdlp_progress("[download]  45.3% of 5.00MiB at 1.20MiB/s ETA 00:03")
            .expect("should parse progress line");
        assert!((p.percent - 45.3_f32).abs() < 0.01_f32);
        assert_eq!(p.speed, "1.20MiB/s");
        assert_eq!(p.eta, "00:03");
        assert!(!p.done);
    }

    #[test]
    fn parse_ytdlp_progress_ignores_non_progress() {
        assert!(parse_ytdlp_progress("[info] Downloading webpage").is_none());
        assert!(parse_ytdlp_progress("just some text").is_none());
        assert!(parse_ytdlp_progress("[download] Destination: out.mp3").is_none());
    }

    #[test]
    fn hex_to_bytes_parses_pairs() {
        assert_eq!(hex_to_bytes("00ff10"), vec![0u8, 255, 16]);
    }

    #[test]
    fn nonce_target_comparison() {
        assert!(nonce_meets_target(&[0x00, 0x10], &[0x00, 0x20])); // hash < target
        assert!(!nonce_meets_target(&[0x00, 0x30], &[0x00, 0x20])); // hash > target
        assert!(nonce_meets_target(&[0x00, 0x20], &[0x00, 0x20])); // equal
    }
}
