use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};

// ─── Download state ───────────────────────────────────────────────────────────

pub struct DownloadState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self { cancels: Mutex::new(HashMap::new()) }
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

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
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

#[tauri::command]
async fn get_models_dir(app: AppHandle) -> Result<String, String> {
    let dir = models_dir(&app)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 각 파일이 models 디렉터리에 존재하는지 확인합니다.
#[tauri::command]
async fn check_model_files(app: AppHandle, filenames: Vec<String>) -> Result<Vec<bool>, String> {
    let base = models_dir(&app)?;
    Ok(filenames.iter().map(|f| base.join(f).exists()).collect())
}

/// 모델 파일 목록을 다운로드합니다. 진행 상황은 `model-download-progress` 이벤트로 전달됩니다.
#[tauri::command]
async fn download_model(
    app: AppHandle,
    state: tauri::State<'_, DownloadState>,
    model_id: String,
    files: Vec<FileSpec>,
) -> Result<(), String> {
    let cancel = Arc::new(AtomicBool::new(false));
    state.cancels.lock().unwrap().insert(model_id.clone(), cancel.clone());

    let base = models_dir(&app)?;
    let file_count = files.len();
    let client = reqwest::Client::new();

    for (i, spec) in files.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            state.cancels.lock().unwrap().remove(&model_id);
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
            state.cancels.lock().unwrap().remove(&model_id);
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
                state.cancels.lock().unwrap().remove(&model_id);
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
                    state.cancels.lock().unwrap().remove(&model_id);
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

    state.cancels.lock().unwrap().remove(&model_id);
    Ok(())
}

#[tauri::command]
fn cancel_model_download(state: tauri::State<'_, DownloadState>, model_id: String) {
    if let Ok(cancels) = state.cancels.lock() {
        if let Some(flag) = cancels.get(&model_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
async fn delete_model_files(app: AppHandle, filenames: Vec<String>) -> Result<(), String> {
    let base = models_dir(&app)?;
    for f in &filenames {
        let path = base.join(f);
        if path.exists() {
            std::fs::remove_file(&path).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_lrc_file,
            write_lrc_file,
            read_audio_file,
            decode_audio_to_wav,
            get_models_dir,
            check_model_files,
            download_model,
            cancel_model_download,
            delete_model_files,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
