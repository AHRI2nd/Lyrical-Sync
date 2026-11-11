use crate::atomic_write;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

const MAX_MODEL_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;
use tauri::{AppHandle, Emitter, Manager};

pub struct DownloadState {
    active: Mutex<HashMap<String, ActiveDownload>>,
}

struct ActiveDownload {
    run_id: String,
    cancel: Arc<AtomicBool>,
    started: bool,
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
    custom_root: Mutex<Option<AuthorizedModelRoot>>,
}

#[derive(Default)]
pub struct ModelUseState {
    active: Arc<Mutex<HashMap<ModelUseKey, ModelUseEntry>>>,
}

#[derive(Clone, Debug, Eq, Hash, PartialEq)]
struct ModelUseKey {
    root: PathBuf,
    model_id: String,
}

#[derive(Default)]
struct ModelUseEntry {
    users: usize,
    deleting: bool,
}

pub struct ModelUseLease {
    active: Arc<Mutex<HashMap<ModelUseKey, ModelUseEntry>>>,
    key: ModelUseKey,
    deleting: bool,
}

impl ModelUseState {
    pub fn begin_use(&self, root: &Path, model_id: &str) -> Result<ModelUseLease, String> {
        let key = ModelUseKey {
            root: root.to_path_buf(),
            model_id: model_id.to_owned(),
        };
        let mut active = self.active.lock().unwrap_or_else(|error| error.into_inner());
        let entry = active.entry(key.clone()).or_default();
        if entry.deleting {
            return Err("MODEL_OPERATION_IN_PROGRESS".into());
        }
        entry.users = entry
            .users
            .checked_add(1)
            .ok_or("MODEL_OPERATION_IN_PROGRESS")?;
        Ok(ModelUseLease {
            active: Arc::clone(&self.active),
            key,
            deleting: false,
        })
    }

    pub fn begin_delete(&self, root: &Path, model_id: &str) -> Result<ModelUseLease, String> {
        let key = ModelUseKey {
            root: root.to_path_buf(),
            model_id: model_id.to_owned(),
        };
        let mut active = self.active.lock().unwrap_or_else(|error| error.into_inner());
        let entry = active.entry(key.clone()).or_default();
        if entry.deleting || entry.users > 0 {
            return Err("MODEL_OPERATION_IN_PROGRESS".into());
        }
        entry.deleting = true;
        Ok(ModelUseLease {
            active: Arc::clone(&self.active),
            key,
            deleting: true,
        })
    }
}

impl Drop for ModelUseLease {
    fn drop(&mut self) {
        let mut active = self.active.lock().unwrap_or_else(|error| error.into_inner());
        let Some(entry) = active.get_mut(&self.key) else {
            return;
        };
        if self.deleting {
            entry.deleting = false;
        } else {
            entry.users = entry.users.saturating_sub(1);
        }
        if entry.users == 0 && !entry.deleting {
            active.remove(&self.key);
        }
    }
}

#[derive(Clone)]
struct AuthorizedModelRoot {
    path: PathBuf,
    identity: crate::model_store::DirectoryIdentity,
}

#[derive(serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PersistedAuthorizedModelRoot {
    path: PathBuf,
    identity: Option<crate::model_store::DirectoryIdentity>,
}

impl Default for ModelsDirState {
    fn default() -> Self {
        Self {
            custom_root: Mutex::new(None),
        }
    }
}

fn authorize_custom_models_root(
    path: Option<&Path>,
    scope_is_allowed: bool,
    previously_authorized: Option<&Path>,
) -> Result<Option<PathBuf>, String> {
    let Some(requested) = path else {
        return Ok(None);
    };
    if !requested.is_absolute() {
        return Err("Model directory must be an absolute path".into());
    }
    if !requested.is_dir() {
        return Err("Model directory is not a directory".into());
    }
    if !scope_is_allowed && previously_authorized != Some(requested) {
        return Err("Model directory has not been authorized".into());
    }
    Ok(Some(requested.to_path_buf()))
}

fn canonical_custom_models_root(path: &str) -> Result<PathBuf, String> {
    let requested = Path::new(path);
    if !requested.is_absolute() {
        return Err("Model directory must be an absolute path".into());
    }
    let canonical = requested
        .canonicalize()
        .map_err(|error| error.to_string())?;
    if !canonical.is_dir() {
        return Err("Model directory is not a directory".into());
    }
    Ok(canonical)
}

fn authorized_models_root_file(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("authorized-model-directory.json"))
        .map_err(|error| error.to_string())
}

fn read_authorized_models_root(
    app: &AppHandle,
) -> Result<Option<PersistedAuthorizedModelRoot>, String> {
    let path = authorized_models_root_file(app)?;
    let content = match std::fs::read_to_string(path) {
        Ok(content) => content,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    parse_authorized_models_root(&content)
}

fn parse_authorized_models_root(
    content: &str,
) -> Result<Option<PersistedAuthorizedModelRoot>, String> {
    let value: serde_json::Value =
        serde_json::from_str(content).map_err(|error| error.to_string())?;
    if let Some(legacy_path) = value.as_str() {
        return Ok(Some(PersistedAuthorizedModelRoot {
            path: PathBuf::from(legacy_path),
            identity: None,
        }));
    }
    serde_json::from_value(value)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[derive(Deserialize, Debug)]
pub struct FileSpec {
    url: String,
    filename: String,
    /// 선택적 SHA-256 (소문자 hex). 지정 시 다운로드 후 무결성 검증, 불일치하면 파일 삭제·실패.
    #[serde(default)]
    sha256: Option<String>,
}

fn registered_model_files(model_id: &str) -> Result<Vec<FileSpec>, String> {
    let key = match model_id {
        "demucs-htdemucs" => "demucs",
        "ctc-mms-300m" => "model",
        _ => return Err("Unknown model identifier".into()),
    };
    let manifest: serde_json::Value = serde_json::from_str(include_str!("../ai-manifest.json"))
        .map_err(|error| format!("Invalid embedded AI manifest: {error}"))?;
    let spec: FileSpec = serde_json::from_value(
        manifest
            .get(key)
            .cloned()
            .ok_or_else(|| format!("Missing model entry in embedded AI manifest: {key}"))?,
    )
    .map_err(|error| format!("Invalid model entry in embedded AI manifest: {error}"))?;
    Ok(vec![spec])
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
        .custom_root
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    if let Some(root) = custom.as_ref() {
        return Ok(root.path.clone());
    }
    app.path()
        .app_data_dir()
        .map(|d| d.join("models"))
        .map_err(|e| e.to_string())
}

/// 커스텀 모델 저장 경로를 설정합니다. None이면 앱 기본 경로로 초기화합니다.
#[tauri::command]
pub fn set_models_dir_override(
    app: AppHandle,
    window: tauri::WebviewWindow,
    dir_state: tauri::State<'_, ModelsDirState>,
    path: Option<String>,
) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;

    let mut custom = dir_state
        .custom_root
        .lock()
        .unwrap_or_else(|e| e.into_inner());
    let selected_path = path.filter(|path| !path.is_empty());
    let previously_authorized = read_authorized_models_root(&app)?;
    let scope = window.fs_scope();
    let canonical_selected = selected_path
        .as_deref()
        .map(canonical_custom_models_root)
        .transpose()?;
    let scope_is_allowed = match canonical_selected.as_deref() {
        Some(canonical) => scope.is_allowed(canonical),
        None => false,
    };
    let selected_identity = canonical_selected
        .as_deref()
        .map(crate::model_store::DirectoryIdentity::at_path)
        .transpose()
        .map_err(|error| error.to_string())?;
    let previously_authorized_path = previously_authorized.as_ref().and_then(|saved| {
        (saved.path == canonical_selected.as_deref()?
            && saved.identity.as_ref() == selected_identity.as_ref())
            .then_some(saved.path.as_path())
    });
    if !scope_is_allowed
        && previously_authorized.as_ref().is_some_and(|saved| {
            canonical_selected.as_ref() == Some(&saved.path)
                && saved.identity.as_ref() != selected_identity.as_ref()
        })
    {
        return Err("Select the model folder again to confirm its current location".into());
    }
    let authorized = authorize_custom_models_root(
        canonical_selected.as_deref(),
        scope_is_allowed,
        previously_authorized_path,
    )?;

    if let Some(root) = &authorized {
        if scope_is_allowed {
            let auth_file = authorized_models_root_file(&app)?;
            let parent = auth_file
                .parent()
                .ok_or("Missing app configuration directory")?;
            std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
            let content = serde_json::to_string(&PersistedAuthorizedModelRoot {
                path: root.clone(),
                identity: selected_identity.clone(),
            })
            .map_err(|error| error.to_string())?;
            atomic_write::write_atomic(&auth_file, &content).map_err(|error| error.to_string())?;
        }
    } else if selected_path.is_none() {
        let auth_file = authorized_models_root_file(&app)?;
        match std::fs::remove_file(auth_file) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }
    }

    *custom = match authorized {
        Some(path) => Some(AuthorizedModelRoot {
            path,
            identity: selected_identity
                .ok_or_else(|| "Model directory identity is unavailable".to_string())?,
        }),
        None => None,
    };
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
    expected_root: String,
    model_id: String,
) -> Result<Vec<bool>, String> {
    let files = registered_model_files(&model_id)?;
    let base = models_dir(&app, &dir_state)?;
    if !models_root_matches(&base, &expected_root) {
        return Err("Model directory changed before inventory check".into());
    }
    let store = crate::model_store::ModelStore::open(&base).map_err(|e| e.to_string())?;
    let mut results = Vec::with_capacity(files.len());
    for spec in files {
        results.push(model_file_matches(&store, &spec.filename, spec.sha256.as_deref()).await);
    }
    Ok(results)
}

/// 모델 파일의 체크섬을 사용 시점에 검증합니다. 정렬/추론 전에 호출해야 합니다.
#[tauri::command]
pub async fn verify_model_at_use(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    expected_root: String,
    model_id: String,
) -> Result<(), String> {
    let files = registered_model_files(&model_id)?;
    let base = models_dir(&app, &dir_state)?;
    if !models_root_matches(&base, &expected_root) {
        return Err("Model directory changed before verification".into());
    }
    let store = crate::model_store::ModelStore::open(&base).map_err(|e| e.to_string())?;
    for spec in files {
        if !model_file_matches(&store, &spec.filename, spec.sha256.as_deref()).await {
            return Err(format!(
                "Model checksum mismatch at use time: {}",
                spec.filename
            ));
        }
    }
    Ok(())
}

async fn hash_model_file(file: std::fs::File) -> Result<String, std::io::Error> {
    use sha2::{Digest, Sha256};
    use tokio::io::AsyncReadExt;
    let mut file = tokio::fs::File::from_std(file);
    let mut digest = Sha256::new();
    let mut buffer = vec![0u8; 65536];
    loop {
        let read = file.read(&mut buffer).await?;
        if read == 0 {
            break;
        }
        digest.update(&buffer[..read]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

async fn wait_for_download_io<T, E>(
    future: impl std::future::Future<Output = Result<T, E>>,
    cancel: &AtomicBool,
) -> Result<T, String>
where
    E: std::fmt::Display,
{
    tokio::pin!(future);
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        match tokio::time::timeout(std::time::Duration::from_millis(75), &mut future).await {
            Ok(result) => return result.map_err(|error| error.to_string()),
            Err(_) => continue,
        }
    }
}

async fn model_file_matches(
    store: &crate::model_store::ModelStore,
    name: &str,
    expected_checksum: Option<&str>,
) -> bool {
    let Ok(file) = store.read(name) else {
        return false;
    };
    if !file.metadata().is_ok_and(|metadata| metadata.len() > 0) {
        return false;
    }
    match expected_checksum
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some(expected) => hash_model_file(file)
            .await
            .is_ok_and(|actual| actual.eq_ignore_ascii_case(expected)),
        None => true,
    }
}

/// 모델 파일 목록을 다운로드합니다. 진행 상황은 `model-download-progress` 이벤트로 전달됩니다.
#[tauri::command]
pub fn begin_model_download(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    dl_state: tauri::State<'_, DownloadState>,
    model_id: String,
    run_id: String,
    expected_root: String,
) -> Result<(), String> {
    registered_model_files(&model_id)?;
    let base = models_dir(&app, &dir_state)?;
    if !models_root_matches(&base, &expected_root) {
        return Err("Model directory changed before download started".into());
    }
    register_download(&dl_state, &model_id, &run_id).map(|_| ())
}

fn register_download(
    dl_state: &DownloadState,
    model_id: &str,
    run_id: &str,
) -> Result<Arc<AtomicBool>, String> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut active = dl_state.active.lock().unwrap_or_else(|e| e.into_inner());
        if active.contains_key(model_id) {
            return Err("Model download is already running".into());
        }
        active.insert(
            model_id.to_string(),
            ActiveDownload {
                run_id: run_id.to_string(),
                cancel: cancel.clone(),
                started: false,
            },
        );
    }
    Ok(cancel)
}

fn start_registered_download(
    dl_state: &DownloadState,
    model_id: &str,
    run_id: &str,
) -> Result<Arc<AtomicBool>, String> {
    let mut active = dl_state.active.lock().unwrap_or_else(|e| e.into_inner());
    let Some(download) = active
        .get_mut(model_id)
        .filter(|download| download.run_id == run_id)
    else {
        return Err("Model download was not registered".into());
    };
    if download.started {
        return Err("Model download is already running".into());
    }
    download.started = true;
    Ok(download.cancel.clone())
}

#[tauri::command]
pub async fn download_model(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    dl_state: tauri::State<'_, DownloadState>,
    model_id: String,
    run_id: String,
    expected_root: String,
) -> Result<(), String> {
    let result = async {
        let files = registered_model_files(&model_id)?;
        let base = models_dir(&app, &dir_state)?;
        if !models_root_matches(&base, &expected_root) {
            return Err("Model directory changed before download started".into());
        }
        let cancel = start_registered_download(&dl_state, &model_id, &run_id)?;
        download_files(&app, &base, &model_id, &run_id, &files, cancel).await
    }
    .await;
    let mut active = dl_state.active.lock().unwrap_or_else(|e| e.into_inner());
    remove_download_if_current(&mut active, &model_id, &run_id);
    result
}

fn models_root_matches(current: &std::path::Path, expected_root: &str) -> bool {
    !expected_root.is_empty() && current == PathBuf::from(expected_root)
}

fn open_model_store_for_root(
    path: &Path,
    expected_identity: Option<&crate::model_store::DirectoryIdentity>,
) -> Result<crate::model_store::ModelStore, String> {
    let store = crate::model_store::ModelStore::open(path).map_err(|error| error.to_string())?;
    if expected_identity.is_some_and(|expected| {
        store
            .directory_identity()
            .map_or(true, |actual| &actual != expected)
    }) {
        return Err("Model directory identity changed before operation".into());
    }
    Ok(store)
}

fn remove_download_if_current(
    active: &mut HashMap<String, ActiveDownload>,
    model_id: &str,
    run_id: &str,
) {
    if active
        .get(model_id)
        .is_some_and(|download| download.run_id == run_id)
    {
        active.remove(model_id);
    }
}

fn cancel_download_if_current(
    active: &mut HashMap<String, ActiveDownload>,
    model_id: &str,
    run_id: &str,
) -> bool {
    if let Some(download) = active
        .get_mut(model_id)
        .filter(|download| download.run_id == run_id)
    {
        download.cancel.store(true, Ordering::Relaxed);
        let registered_only = !download.started;
        if registered_only {
            active.remove(model_id);
        }
        true
    } else {
        false
    }
}

fn checked_model_download_bytes(current: u64, additional: u64) -> Result<u64, String> {
    checked_model_download_bytes_with_limit(current, additional, MAX_MODEL_DOWNLOAD_BYTES)
}

fn checked_model_download_bytes_with_limit(
    current: u64,
    additional: u64,
    limit: u64,
) -> Result<u64, String> {
    let total = current
        .checked_add(additional)
        .ok_or_else(|| "MODEL_DOWNLOAD_LIMIT".to_string())?;
    if total > limit {
        return Err("MODEL_DOWNLOAD_LIMIT".into());
    }
    Ok(total)
}

async fn stage_model_response<'d, F>(
    mut response: reqwest::Response,
    parent: &'d cap_std::fs::Dir,
    total_downloaded: &mut u64,
    limit: u64,
    cancel: &AtomicBool,
    mut on_progress: F,
) -> Result<(cap_tempfile::TempFile<'d>, u64, String), String>
where
    F: FnMut(u64, u64),
{
    use sha2::{Digest, Sha256};
    use std::io::Write;

    let declared_total = response.content_length().unwrap_or(0);
    if declared_total > limit
        || (declared_total > 0
            && checked_model_download_bytes_with_limit(*total_downloaded, declared_total, limit)
                .is_err())
    {
        return Err("MODEL_DOWNLOAD_LIMIT".into());
    }

    let mut stage = cap_tempfile::TempFile::new(parent).map_err(|e| e.to_string())?;
    let mut downloaded = 0_u64;
    let mut digest = Sha256::new();
    while let Some(chunk) = wait_for_download_io(response.chunk(), cancel).await? {
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        let chunk_bytes = chunk.len() as u64;
        let next_downloaded =
            checked_model_download_bytes_with_limit(downloaded, chunk_bytes, limit)?;
        let next_total =
            checked_model_download_bytes_with_limit(*total_downloaded, chunk_bytes, limit)?;
        stage.write_all(&chunk).map_err(|e| e.to_string())?;
        digest.update(&chunk);
        downloaded = next_downloaded;
        *total_downloaded = next_total;
        on_progress(downloaded, declared_total);
    }
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    if declared_total > 0 && declared_total != downloaded {
        return Err("Incomplete model download".into());
    }

    Ok((stage, downloaded, format!("{:x}", digest.finalize())))
}

async fn download_files<R: tauri::Runtime>(
    app: &AppHandle<R>,
    base: &std::path::Path,
    model_id: &str,
    run_id: &str,
    files: &[FileSpec],
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    std::fs::create_dir_all(&base).map_err(|e| e.to_string())?;
    let store = crate::model_store::ModelStore::open(base).map_err(|e| e.to_string())?;
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(30))
        .timeout(std::time::Duration::from_secs(3600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut total_downloaded = 0_u64;
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
                Some(expected) => wait_for_download_io(hash_model_file(file), &cancel)
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
        let response = wait_for_download_io(client.get(&spec.url).send(), &cancel)
            .await?
            .error_for_status()
            .map_err(|e| e.to_string())?;
        // Unique staging remains owned by this operation and is removed on every failure.
        // All publication paths are relative to the already-open destination directory.
        let (stage, _downloaded, digest) = stage_model_response(
            response,
            &parent,
            &mut total_downloaded,
            MAX_MODEL_DOWNLOAD_BYTES,
            &cancel,
            |downloaded, total| {
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
            },
        )
        .await?;
        if verify.is_some_and(|expected| !digest.eq_ignore_ascii_case(expected)) {
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
pub fn cancel_model_download(
    dl_state: tauri::State<'_, DownloadState>,
    model_id: String,
    run_id: String,
) {
    if let Ok(mut active) = dl_state.active.lock() {
        cancel_download_if_current(&mut active, &model_id, &run_id);
    }
}

#[tauri::command]
pub async fn delete_model_files(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    model_use_state: tauri::State<'_, ModelUseState>,
    expected_root: String,
    model_id: String,
) -> Result<(), String> {
    let files = registered_model_files(&model_id)?;
    let base = models_dir(&app, &dir_state)?;
    if !models_root_matches(&base, &expected_root) {
        return Err("Model directory changed before deletion".into());
    }
    let _deletion = model_use_state.begin_delete(&base, &model_id)?;
    let expected_identity = dir_state
        .custom_root
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .as_ref()
        .map(|root| root.identity.clone());
    let store = open_model_store_for_root(&base, expected_identity.as_ref())?;
    for spec in files {
        store.remove(&spec.filename).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[cfg(test)]
mod integrity_tests {
    use super::*;

    async fn local_model_response(response: &'static [u8]) -> reqwest::Response {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0; 4096];
            let _ = stream.read(&mut request).await;
            stream.write_all(response).await.unwrap();
        });

        reqwest::Client::builder()
            .no_proxy()
            .build()
            .unwrap()
            .get(format!("http://{address}/model"))
            .send()
            .await
            .unwrap()
    }

    #[test]
    fn an_active_model_use_prevents_deletion_until_inference_finishes() {
        let state = ModelUseState::default();
        let root = Path::new("/tmp/models");
        let usage = state.begin_use(root, "ctc-mms-300m").unwrap();
        let second_usage = state.begin_use(root, "ctc-mms-300m").unwrap();

        assert!(state.begin_delete(root, "ctc-mms-300m").is_err());
        drop(usage);
        assert!(state.begin_delete(root, "ctc-mms-300m").is_err());
        drop(second_usage);

        let deletion = state.begin_delete(root, "ctc-mms-300m").unwrap();
        assert!(state.begin_use(root, "ctc-mms-300m").is_err());
        drop(deletion);

        assert!(state.begin_use(root, "ctc-mms-300m").is_ok());
    }

    #[test]
    fn model_use_leases_are_scoped_by_root_and_model() {
        let state = ModelUseState::default();
        let usage = state
            .begin_use(Path::new("/tmp/models-a"), "ctc-mms-300m")
            .unwrap();

        assert!(state.begin_delete(Path::new("/tmp/models-b"), "ctc-mms-300m").is_ok());
        assert!(state.begin_delete(Path::new("/tmp/models-a"), "demucs-htdemucs").is_ok());
        drop(usage);
    }

    #[test]
    fn hash_future_does_not_embed_a_large_buffer() {
        let file = tempfile::tempfile().unwrap();
        let future = hash_model_file(file);
        let future_size = std::mem::size_of_val(&future);

        assert!(
            future_size <= 4 * 1024,
            "model hash future occupies {future_size} bytes; large inline buffers must not be held across async boundaries"
        );
    }

    #[test]
    fn download_future_does_not_embed_large_hash_state() {
        let app = tauri::test::mock_app();
        let files = Vec::new();
        let future = download_files(
            app.handle(),
            Path::new("."),
            "ctc-mms-300m",
            "run-1",
            &files,
            Arc::new(AtomicBool::new(false)),
        );
        let future_size = std::mem::size_of_val(&future);

        assert!(
            future_size <= 16 * 1024,
            "model download future occupies {future_size} bytes; large inline buffers must not be held across async boundaries"
        );
    }

    #[test]
    fn model_ids_resolve_only_to_the_embedded_manifest_artifacts() {
        let demucs = registered_model_files("demucs-htdemucs").unwrap();
        assert_eq!(demucs.len(), 1);
        assert_eq!(demucs[0].filename, "demucs/htdemucs.th");
        assert_eq!(
            demucs[0].sha256.as_deref(),
            Some("8726e21a993978c7ba086d3872e7608d7d5bfca646ca4aca459ffda844faa8b4")
        );

        let files = registered_model_files("ctc-mms-300m").unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].filename, "ctc-forced-aligner.onnx");
        assert_eq!(files[0].url, "https://huggingface.co/deskpai/ctc_forced_aligner/resolve/77d85f9ffaa8cd367699ecff985c70e9064ca41c/04ac86b67129634da93aea76e0147ef3.onnx");
        assert_eq!(
            files[0].sha256.as_deref(),
            Some("e8bad67fd3533b3d3c145b0ca31bb15383945c13384dd8975baaa7b73f7b61ac")
        );
        assert!(registered_model_files("untrusted-model").is_err());
    }

    #[test]
    fn rejects_custom_model_roots_without_a_picker_grant_or_saved_approval() {
        let selected = tempfile::tempdir().unwrap();
        let selected_path =
            canonical_custom_models_root(selected.path().to_str().unwrap()).unwrap();
        let error =
            authorize_custom_models_root(Some(&selected_path), false, None).unwrap_err();

        assert_eq!(error, "Model directory has not been authorized");
    }

    #[cfg(unix)]
    #[test]
    fn checks_the_canonical_model_root_against_the_filesystem_scope() {
        let root = tempfile::tempdir().unwrap();
        let allowed = root.path().join("allowed");
        let outside = root.path().join("outside");
        let selected = root.path().join("selected-models");
        std::fs::create_dir_all(&allowed).unwrap();
        std::fs::create_dir_all(&outside).unwrap();
        std::os::unix::fs::symlink(&outside, &selected).unwrap();

        let allowed_root = allowed.canonicalize().unwrap();
        let selected_canonical = canonical_custom_models_root(selected.to_str().unwrap()).unwrap();
        let is_in_scope = |path: &Path| path.starts_with(&allowed_root);

        assert!(!is_in_scope(&selected_canonical));
        let allowed_canonical = canonical_custom_models_root(allowed.to_str().unwrap()).unwrap();
        assert!(is_in_scope(&allowed_canonical));
    }

    #[cfg(unix)]
    #[test]
    fn selected_root_symlink_retarget_does_not_redirect_model_deletion() {
        let root = tempfile::tempdir().unwrap();
        let safe = root.path().join("safe");
        let outside = root.path().join("outside");
        let selected = root.path().join("selected-models");
        for directory in [&safe, &outside] {
            std::fs::create_dir_all(directory.join("demucs")).unwrap();
            std::fs::write(directory.join("demucs/htdemucs.th"), b"preserve").unwrap();
        }
        std::os::unix::fs::symlink(&safe, &selected).unwrap();
        let canonical_selected = canonical_custom_models_root(selected.to_str().unwrap()).unwrap();
        let approved =
            authorize_custom_models_root(Some(&canonical_selected), true, None)
                .unwrap()
                .unwrap();
        assert_eq!(approved, safe.canonicalize().unwrap());

        std::fs::remove_file(&selected).unwrap();
        std::os::unix::fs::symlink(&outside, &selected).unwrap();
        assert!(models_root_matches(&approved, approved.to_str().unwrap()));
        crate::model_store::ModelStore::open(&approved).unwrap()
            .remove("demucs/htdemucs.th").unwrap();

        assert!(!safe.join("demucs/htdemucs.th").exists());
        assert_eq!(std::fs::read(outside.join("demucs/htdemucs.th")).unwrap(), b"preserve");
    }

    #[cfg(unix)]
    #[test]
    fn replacing_canonical_model_root_does_not_redirect_model_deletion() {
        let root = tempfile::tempdir().unwrap();
        let approved = root.path().join("models");
        let original = root.path().join("models-original");
        let outside = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(approved.join("demucs")).unwrap();
        std::fs::create_dir_all(outside.path().join("demucs")).unwrap();
        std::fs::write(approved.join("demucs/htdemucs.th"), b"approved").unwrap();
        std::fs::write(outside.path().join("demucs/htdemucs.th"), b"preserve").unwrap();
        let approved = approved.canonicalize().unwrap();
        let identity = crate::model_store::DirectoryIdentity::at_path(&approved).unwrap();

        std::fs::rename(&approved, &original).unwrap();
        std::os::unix::fs::symlink(outside.path(), &approved).unwrap();

        assert!(models_root_matches(&approved, approved.to_str().unwrap()));
        assert!(open_model_store_for_root(&approved, Some(&identity)).is_err());
        let original_store = open_model_store_for_root(&original, Some(&identity)).unwrap();
        assert_eq!(original_store.directory_identity().unwrap(), identity);

        assert_eq!(
            std::fs::read(outside.path().join("demucs/htdemucs.th")).unwrap_or_default(),
            b"preserve",
            "deletion must remain bound to the directory approved before path replacement"
        );
        assert_eq!(
            std::fs::read(original.join("demucs/htdemucs.th")).unwrap(),
            b"approved"
        );
    }

    #[test]
    fn legacy_saved_model_root_does_not_silently_authorize_a_directory() {
        let saved = parse_authorized_models_root("\"/models/custom\"")
            .unwrap()
            .unwrap();
        assert_eq!(saved.path, PathBuf::from("/models/custom"));
        assert!(saved.identity.is_none());
    }

    #[test]
    fn accepts_a_picked_or_previously_approved_model_root() {
        let selected = tempfile::tempdir().unwrap();
        let selected_path = selected.path().canonicalize().unwrap();
        let picked = authorize_custom_models_root(Some(&selected_path), true, None)
            .unwrap()
            .unwrap();
        assert_eq!(picked, selected_path);

        let restored = authorize_custom_models_root(
            Some(&selected_path),
            false,
            Some(&selected_path),
        )
        .unwrap()
        .unwrap();
        assert_eq!(restored, selected_path);
    }

    #[test]
    fn rejects_relative_model_roots_even_when_picker_scope_matches() {
        let error = canonical_custom_models_root("relative/models").unwrap_err();

        assert_eq!(error, "Model directory must be an absolute path");
    }

    #[test]
    fn rejects_a_different_previously_approved_model_root() {
        let selected = tempfile::tempdir().unwrap();
        let other = tempfile::tempdir().unwrap();
        let other_path = other.path().canonicalize().unwrap();
        let selected_path = selected.path().canonicalize().unwrap();

        let error = authorize_custom_models_root(
            Some(&selected_path),
            false,
            Some(&other_path),
        )
        .unwrap_err();

        assert_eq!(error, "Model directory has not been authorized");
    }

    #[test]
    fn rejects_nonexistent_model_roots_even_when_picker_scope_matches() {
        let parent = tempfile::tempdir().unwrap();
        let missing = parent.path().join("missing");

        let error = canonical_custom_models_root(missing.to_str().unwrap()).unwrap_err();

        assert!(!error.is_empty());
    }

    #[test]
    fn only_the_current_run_can_be_removed_or_cancelled() {
        let mut active = HashMap::new();
        active.insert(
            "model".into(),
            ActiveDownload {
                run_id: "new".into(),
                cancel: Arc::new(AtomicBool::new(false)),
                started: true,
            },
        );
        remove_download_if_current(&mut active, "model", "old");
        assert!(active.contains_key("model"));
        assert!(!cancel_download_if_current(&mut active, "model", "old"));
        assert!(!active.get("model").unwrap().cancel.load(Ordering::Relaxed));
        assert!(cancel_download_if_current(&mut active, "model", "new"));
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

    #[test]
    fn model_download_byte_budget_accepts_exact_limit_and_rejects_overflow() {
        assert_eq!(
            checked_model_download_bytes(MAX_MODEL_DOWNLOAD_BYTES - 1, 1).unwrap(),
            MAX_MODEL_DOWNLOAD_BYTES,
        );
        assert!(checked_model_download_bytes(MAX_MODEL_DOWNLOAD_BYTES, 1).is_err());
        assert!(checked_model_download_bytes(u64::MAX, 1).is_err());
    }

    #[tokio::test]
    async fn declared_model_response_over_limit_preserves_existing_file_without_staging() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::model_store::ModelStore::open(root.path()).unwrap();
        let (parent, _) = store.destination("model.bin").unwrap();
        let path = root.path().join("model.bin");
        std::fs::write(&path, b"previous-valid-model").unwrap();
        let response = local_model_response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 6\r\nConnection: close\r\n\r\n123456",
        )
        .await;
        let mut total_downloaded = 0;

        let result = stage_model_response(
            response,
            &parent,
            &mut total_downloaded,
            5,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await;

        assert_eq!(result.unwrap_err(), "MODEL_DOWNLOAD_LIMIT");
        assert_eq!(std::fs::read(path).unwrap(), b"previous-valid-model");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn chunked_model_response_over_limit_cleans_stage_and_preserves_existing_file() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::model_store::ModelStore::open(root.path()).unwrap();
        let (parent, _) = store.destination("model.bin").unwrap();
        let path = root.path().join("model.bin");
        std::fs::write(&path, b"previous-valid-model").unwrap();
        let response = local_model_response(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\n123\r\n2\r\n45\r\n0\r\n\r\n",
        )
        .await;
        let mut total_downloaded = 0;
        let progress_events = std::sync::atomic::AtomicUsize::new(0);

        let result = stage_model_response(
            response,
            &parent,
            &mut total_downloaded,
            4,
            &AtomicBool::new(false),
            |_, _| {
                progress_events.fetch_add(1, Ordering::Relaxed);
            },
        )
        .await;

        assert_eq!(result.unwrap_err(), "MODEL_DOWNLOAD_LIMIT");
        assert_eq!(progress_events.load(Ordering::Relaxed), 1);
        assert_eq!(std::fs::read(path).unwrap(), b"previous-valid-model");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn declared_model_response_over_remaining_job_budget_is_rejected_before_staging() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::model_store::ModelStore::open(root.path()).unwrap();
        let (parent, _) = store.destination("model.bin").unwrap();
        let path = root.path().join("model.bin");
        std::fs::write(&path, b"previous-valid-model").unwrap();
        let response = local_model_response(
            b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n12",
        )
        .await;
        let mut total_downloaded = 4;

        let result = stage_model_response(
            response,
            &parent,
            &mut total_downloaded,
            5,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await;

        assert_eq!(result.unwrap_err(), "MODEL_DOWNLOAD_LIMIT");
        assert_eq!(total_downloaded, 4);
        assert_eq!(std::fs::read(path).unwrap(), b"previous-valid-model");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }

    #[tokio::test]
    async fn exact_limit_chunked_model_response_can_be_published() {
        let root = tempfile::tempdir().unwrap();
        let store = crate::model_store::ModelStore::open(root.path()).unwrap();
        let (parent, filename) = store.destination("model.bin").unwrap();
        let response = local_model_response(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n3\r\n123\r\n2\r\n45\r\n0\r\n\r\n",
        )
        .await;
        let mut total_downloaded = 0;

        let (stage, downloaded, digest) = stage_model_response(
            response,
            &parent,
            &mut total_downloaded,
            5,
            &AtomicBool::new(false),
            |_, _| {},
        )
        .await
        .unwrap();
        stage.as_file().sync_all().unwrap();
        stage.replace(&filename).unwrap();

        assert_eq!(downloaded, 5);
        assert_eq!(total_downloaded, 5);
        assert_eq!(
            digest,
            "5994471abb01112afcc18159f6cc74b4f511b99806da59b3caf5a9c173cacfc5"
        );
        assert_eq!(
            store.read("model.bin").unwrap().metadata().unwrap().len(),
            5
        );
        assert_eq!(
            std::fs::read(root.path().join("model.bin")).unwrap(),
            b"12345"
        );
    }

    #[test]
    fn cancellation_is_registered_before_the_download_request_starts() {
        let state = DownloadState::default();
        let cancel = register_download(&state, "model", "run-1").unwrap();
        assert!(cancel_download_if_current(
            &mut state.active.lock().unwrap(),
            "model",
            "run-1",
        ));
        assert!(cancel.load(Ordering::Relaxed));
        assert!(!state.active.lock().unwrap().contains_key("model"));
        assert!(start_registered_download(&state, "model", "run-1").is_err());
    }

    #[test]
    fn cancellation_during_a_started_download_keeps_its_run_registered() {
        let state = DownloadState::default();
        let cancel = register_download(&state, "model", "run-1").unwrap();
        start_registered_download(&state, "model", "run-1").unwrap();
        assert!(cancel_download_if_current(
            &mut state.active.lock().unwrap(),
            "model",
            "run-1",
        ));
        assert!(cancel.load(Ordering::Relaxed));
        assert!(state.active.lock().unwrap().contains_key("model"));
    }

    #[test]
    fn duplicate_dispatch_cannot_start_the_same_registered_download_twice() {
        let state = DownloadState::default();
        let registered = register_download(&state, "model", "run-1").unwrap();
        let first = start_registered_download(&state, "model", "run-1").unwrap();

        assert!(Arc::ptr_eq(&registered, &first));
        assert_eq!(
            start_registered_download(&state, "model", "run-1").unwrap_err(),
            "Model download is already running",
        );
        assert!(state.active.lock().unwrap().get("model").unwrap().started);
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_stalled_model_request_or_body_read() {
        let cancel = Arc::new(AtomicBool::new(false));
        let trigger = cancel.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            trigger.store(true, Ordering::Relaxed);
        });
        let result = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            wait_for_download_io(
                std::future::pending::<Result<(), std::io::Error>>(),
                &cancel,
            ),
        )
        .await
        .unwrap();
        assert_eq!(result.unwrap_err(), "cancelled");
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
            let store = crate::model_store::ModelStore::open(dir.path()).unwrap();
            assert_eq!(
                hash_model_file(std::fs::File::open(&path).unwrap())
                    .await
                    .unwrap(),
                "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
            );
            assert!(
                model_file_matches(
                    &store,
                    "model",
                    Some("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
                )
                .await
            );
            assert!(!model_file_matches(&store, "model", Some("00".repeat(32).as_str())).await);
            assert!(model_file_matches(&store, "model", None).await);
            assert!(std::fs::File::open(dir.path().join("missing")).is_err());
        });
    }

    #[tokio::test]
    async fn hashes_empty_and_multi_chunk_files() {
        use sha2::{Digest, Sha256};

        for size in [0, 65_535, 65_536, 65_537, 131_072] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("model");
            let contents = (0..size)
                .map(|index| (index % 251) as u8)
                .collect::<Vec<_>>();
            std::fs::write(&path, &contents).unwrap();

            let expected = format!("{:x}", Sha256::digest(&contents));
            let actual = hash_model_file(std::fs::File::open(&path).unwrap())
                .await
                .unwrap();

            assert_eq!(actual, expected, "incorrect hash for {size}-byte file");
        }
    }

    #[tokio::test]
    async fn inventory_rejects_nonempty_corrupt_model_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(
            dir.path().join("corrupt.onnx"),
            b"nonempty but not the model",
        )
        .unwrap();
        let store = crate::model_store::ModelStore::open(dir.path()).unwrap();
        assert!(
            !model_file_matches(
                &store,
                "corrupt.onnx",
                Some("e8bad67fd3533b3d3c145b0ca31bb15383945c13384dd8975baaa7b73f7b61ac"),
            )
            .await
        );
    }

    #[test]
    fn stale_download_owner_cancel_delete_readiness_races() {
        // Test model download cancellation and readiness race conditions
        // This tests the models.rs download state machine behavior
        use crate::models::{
            cancel_download_if_current, models_root_matches, register_download,
            start_registered_download, DownloadState,
        };
        use std::path::PathBuf;
        use std::sync::atomic::{AtomicBool, Ordering};
        use std::sync::Arc;

        // Test 1: Cancel before download starts (registered only)
        let state = DownloadState::default();
        let cancel = register_download(&state, "model1", "run1").unwrap();
        {
            let mut active = state.active.lock().unwrap();
            assert!(cancel_download_if_current(&mut active, "model1", "run1"));
        }
        assert!(cancel.load(Ordering::Relaxed));
        // After cancel (registered only), entry should be removed

        // Test 2: Cancel during download (started)
        let state2 = DownloadState::default();
        let cancel2 = register_download(&state2, "model2", "run2").unwrap();
        start_registered_download(&state2, "model2", "run2").unwrap();
        {
            let mut active = state2.active.lock().unwrap();
            assert!(cancel_download_if_current(&mut active, "model2", "run2"));
        }
        assert!(cancel2.load(Ordering::Relaxed));
        // After cancel (started), entry should remain but be cancelled

        // Test 3: Root mismatch detection
        assert!(models_root_matches(
            &PathBuf::from("/models/current"),
            "/models/current"
        ));
        assert!(!models_root_matches(
            &PathBuf::from("/models/current"),
            "/models/other"
        ));
        assert!(!models_root_matches(&PathBuf::from("/models/current"), ""));

        println!("Stale download owner test passed");
    }
}
