use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use serde::{Deserialize, Serialize};

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

impl Default for ModelsDirState {
    fn default() -> Self {
        Self { custom_path: Mutex::new(None) }
    }
}

#[derive(Deserialize)]
pub struct FileSpec {
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

pub fn models_dir(app: &AppHandle, dir_state: &ModelsDirState) -> Result<PathBuf, String> {
    let custom = dir_state.custom_path.lock().unwrap();
    if let Some(ref p) = *custom {
        return Ok(p.clone());
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join("models"))
        .map_err(|e| e.to_string())
}

/// 커스텀 모델 저장 경로를 설정합니다. None이면 앱 기본 경로로 초기화합니다.
#[tauri::command]
pub fn set_models_dir_override(
    dir_state: tauri::State<'_, ModelsDirState>,
    path: Option<String>,
) -> Result<(), String> {
    let mut custom = dir_state.custom_path.lock().unwrap();
    *custom = path.filter(|p| !p.is_empty()).map(PathBuf::from);
    Ok(())
}

#[tauri::command]
pub async fn get_models_dir(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
) -> Result<String, String> {
    let dir = models_dir(&app, &dir_state)?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

/// 각 파일이 models 디렉터리에 존재하는지 확인합니다.
#[tauri::command]
pub async fn check_model_files(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    filenames: Vec<String>,
) -> Result<Vec<bool>, String> {
    let base = models_dir(&app, &dir_state)?;
    Ok(filenames.iter().map(|f| base.join(f).exists()).collect())
}

/// 모델 파일 목록을 다운로드합니다. 진행 상황은 `model-download-progress` 이벤트로 전달됩니다.
#[tauri::command]
pub async fn download_model(
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

        // 여러 파일 중 일부만 실패했다가 재시도하는 경우, 이미 온전히 받아진 파일은
        // 다시 받지 않고 건너뛴다(체크섬 지정 시 일치 확인, 없으면 존재만 확인 —
        // check_model_files와 동일 기준). 안 그러면 마지막 파일 하나만 실패해도
        // 이미 받은 대용량 파일들까지 매번 처음부터 다시 받게 된다.
        if dest.exists() {
            let existing_valid = match spec.sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
                Some(expected) => {
                    use sha2::{Digest, Sha256};
                    tokio::fs::read(&dest).await.ok().map(|bytes| {
                        let got = format!("{:x}", Sha256::digest(&bytes));
                        got.eq_ignore_ascii_case(expected)
                    }).unwrap_or(false)
                }
                None => true,
            };
            if existing_valid {
                let size = tokio::fs::metadata(&dest).await.map(|m| m.len()).unwrap_or(0);
                let _ = app.emit(
                    "model-download-progress",
                    DownloadProgressEvent {
                        model_id: model_id.clone(),
                        file_index: i,
                        file_count,
                        downloaded: size,
                        total: size,
                        done: false,
                        error: None,
                    },
                );
                continue;
            }
            // 손상/불일치 — 지우고 정상적으로 다시 받는다.
            let _ = tokio::fs::remove_file(&dest).await;
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
pub fn cancel_model_download(dl_state: tauri::State<'_, DownloadState>, model_id: String) {
    if let Ok(cancels) = dl_state.cancels.lock() {
        if let Some(flag) = cancels.get(&model_id) {
            flag.store(true, Ordering::Relaxed);
        }
    }
}

#[tauri::command]
pub async fn delete_model_files(
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
