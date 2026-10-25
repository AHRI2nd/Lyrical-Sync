use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub struct DownloadState {
    cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            cancels: Mutex::new(HashMap::new()),
        }
    }
}

/// 사용자가 지정한 커스텀 모델 저장 경로. None이면 앱 기본 경로를 사용합니다.
pub struct ModelsDirState {
    custom_path: Mutex<Option<PathBuf>>,
}

impl Default for ModelsDirState {
    fn default() -> Self {
        Self {
            custom_path: Mutex::new(None),
        }
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
    let custom = dir_state
        .custom_path
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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
    let mut custom = dir_state
        .custom_path
        .lock()
        .unwrap_or_else(|e| e.into_inner());
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
    let store = crate::model_store::ModelStore::open(&base);
    Ok(filenames
        .iter()
        .map(|name| {
            store
                .as_ref()
                .ok()
                .and_then(|store| store.read(name).ok())
                .and_then(|file| file.metadata().ok())
                .is_some_and(|m| m.len() > 0)
        })
        .collect())
}

async fn hash_model_file(file: std::fs::File) -> Result<String, std::io::Error> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::from_std(file);
    let mut digest = Sha256::new();
    let mut buffer = [0u8; 65536];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
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
    {
        let mut active = dl_state.cancels.lock().unwrap_or_else(|e| e.into_inner());
        if active.contains_key(&model_id) {
            return Err("Model download is already running".into());
        }
        active.insert(model_id.clone(), cancel.clone());
    }
    let result = download_files(&app, &dir_state, &model_id, &files, cancel).await;
    dl_state
        .cancels
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .remove(&model_id);
    result
}

async fn download_files(
    app: &AppHandle,
    dir_state: &ModelsDirState,
    model_id: &str,
    files: &[FileSpec],
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    let base = models_dir(app, dir_state)?;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let store = crate::model_store::ModelStore::open(&base).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    for (i, spec) in files.iter().enumerate() {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let (parent, filename) = store
            .destination(&spec.filename)
            .map_err(|e| e.to_string())?;
        let verify = spec
            .sha256
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty());
        if let Ok(file) = store.read(&spec.filename) {
            let size = file.metadata().map_err(|e| e.to_string())?.len();
            let valid = match verify {
                Some(expected) => hash_model_file(file)
                    .await
                    .is_ok_and(|got| got.eq_ignore_ascii_case(expected)),
                None => size > 0,
            };
            if valid {
                let _ = app.emit(
                    "model-download-progress",
                    DownloadProgressEvent {
                        model_id: model_id.into(),
                        file_index: i,
                        file_count: files.len(),
                        downloaded: size,
                        total: size,
                        done: false,
                        error: None,
                    },
                );
                continue;
            }
        }
        let mut response = client
            .get(&spec.url)
            .send()
            .await
            .map_err(|e| e.to_string())?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        let total = response.content_length().unwrap_or(0);
        let mut downloaded = 0u64;
        let mut digest = Sha256::new();
        // Unique staging remains owned by this operation and is removed on every failure.
        // All publication paths are relative to the already-open destination directory.
        let mut stage = cap_tempfile::TempFile::new(&parent).map_err(|e| e.to_string())?;
        while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
            if cancel.load(Ordering::Relaxed) {
                return Err("cancelled".into());
            }
            stage.write_all(&chunk).map_err(|e| e.to_string())?;
            digest.update(&chunk);
            downloaded += chunk.len() as u64;
            let _ = app.emit(
                "model-download-progress",
                DownloadProgressEvent {
                    model_id: model_id.into(),
                    file_index: i,
                    file_count: files.len(),
                    downloaded,
                    total,
                    done: false,
                    error: None,
                },
            );
        }
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        if total > 0 && total != downloaded {
            return Err("Incomplete model download".into());
        }
        if verify.is_some_and(|expected| {
            !format!("{:x}", digest.finalize()).eq_ignore_ascii_case(expected)
        }) {
            return Err(format!("Model checksum mismatch: {}", spec.filename));
        }
        stage.as_file().sync_all().map_err(|e| e.to_string())?;
        stage.replace(&filename).map_err(|e| e.to_string())?;
    }
    let _ = app.emit(
        "model-download-progress",
        DownloadProgressEvent {
            model_id: model_id.into(),
            file_index: files.len(),
            file_count: files.len(),
            downloaded: 0,
            total: 0,
            done: true,
            error: None,
        },
    );
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
    let store = crate::model_store::ModelStore::open(&base).map_err(|e| e.to_string())?;
    for name in filenames {
        store.remove(&name).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod integrity_tests {
    use super::*;
    #[cfg(unix)]
    #[test]
    fn model_parent_symlink_cannot_delete_outside_store() {
        let root = tempfile::tempdir().unwrap();
        let base = root.path().join("models");
        let outside = root.path().join("outside");
        std::fs::create_dir_all(&base).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        let victim = outside.join("htdemucs.th");
        std::fs::write(&victim, b"preserve").unwrap();
        std::os::unix::fs::symlink(&outside, base.join("demucs")).unwrap();
        // Exercise the production validation and deletion operation.
        let result = crate::model_store::ModelStore::open(&base)
            .unwrap()
            .remove("demucs/htdemucs.th");
        assert!(result.is_err());
        assert_eq!(std::fs::read(victim).unwrap(), b"preserve");
    }

    #[test]
    fn validates_model_checksum_from_disk() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("model");
            std::fs::write(&path, b"abc").unwrap();
            assert_eq!(
                hash_model_file(std::fs::File::open(&path).unwrap())
                    .await
                    .unwrap(),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            );
            assert!(std::fs::File::open(dir.path().join("missing")).is_err());
        });
    }
}
