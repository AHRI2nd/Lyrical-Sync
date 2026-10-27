use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub struct DownloadState {
    active: Mutex<HashMap<String, ActiveDownload>>,
}

struct ActiveDownload {
    run_id: String,
    cancel: Arc<AtomicBool>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            active: Mutex::new(HashMap::new()),
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
    run_id: String,
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
    run_id: String,
    expected_root: String,
    files: Vec<FileSpec>,
) -> Result<(), String> {
    let base = models_dir(&app, &dir_state)?;
    if !models_root_matches(&base, &expected_root) {
        return Err("Model directory changed before download started".into());
    }
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = dl_state.active.lock().unwrap_or_else(|e| e.into_inner());
        if active.contains_key(&model_id) {
            return Err("Model download is already running".into());
        }
        active.insert(model_id.clone(), ActiveDownload { run_id: run_id.clone(), cancel: cancel.clone() });
    }
    let result = download_files(&app, &base, &model_id, &run_id, &files, cancel).await;
    let mut active = dl_state.active.lock().unwrap_or_else(|e| e.into_inner());
    remove_download_if_current(&mut active, &model_id, &run_id);
    result
}

fn models_root_matches(current: &std::path::Path, expected_root: &str) -> bool {
    !expected_root.is_empty() && current == PathBuf::from(expected_root)
}

fn remove_download_if_current(active: &mut HashMap<String, ActiveDownload>, model_id: &str, run_id: &str) {
    if active.get(model_id).is_some_and(|download| download.run_id == run_id) {
        active.remove(model_id);
    }
}

fn cancel_download_if_current(active: &HashMap<String, ActiveDownload>, model_id: &str, run_id: &str) -> bool {
    if let Some(download) = active.get(model_id).filter(|download| download.run_id == run_id) {
        download.cancel.store(true, Ordering::Relaxed);
        true
    } else {
        false
    }
}

async fn download_files(
    app: &AppHandle,
    base: &std::path::Path,
    model_id: &str,
    run_id: &str,
    files: &[FileSpec],
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    use std::io::Write;
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let store = crate::model_store::ModelStore::open(base).map_err(|e| e.to_string())?;
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
                        run_id: run_id.into(),
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
                    run_id: run_id.into(),
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
            run_id: run_id.into(),
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
pub fn cancel_model_download(dl_state: tauri::State<'_, DownloadState>, model_id: String, run_id: String) {
    if let Ok(active) = dl_state.active.lock() {
        cancel_download_if_current(&active, &model_id, &run_id);
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

    #[test]
    fn only_the_current_run_can_be_removed_or_cancelled() {
        let mut active = HashMap::new();
        active.insert("model".into(), ActiveDownload { run_id: "new".into(), cancel: Arc::new(AtomicBool::new(false)) });
        remove_download_if_current(&mut active, "model", "old");
        assert!(active.contains_key("model"));
        assert!(!cancel_download_if_current(&active, "model", "old"));
        assert!(!active.get("model").unwrap().cancel.load(Ordering::Relaxed));
        assert!(cancel_download_if_current(&active, "model", "new"));
        assert!(active.get("model").unwrap().cancel.load(Ordering::Relaxed));
        remove_download_if_current(&mut active, "model", "new");
        assert!(!active.contains_key("model"));
    }

    #[test]
    fn download_root_must_match_the_current_configured_root() {
        let expected = PathBuf::from("/models/current");
        assert!(models_root_matches(&expected, "/models/current"));
        assert!(!models_root_matches(&expected, "/models/other"));
        assert!(!models_root_matches(&expected, ""));
    }
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
