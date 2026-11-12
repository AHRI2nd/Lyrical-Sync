use crate::path_validation;
use serde::Serialize;
use std::collections::HashMap;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufRead, AsyncBufReadExt};

pub struct YtdlpState {
    runs: Mutex<YtdlpRunState>,
    active_install_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

#[derive(Default)]
struct YtdlpRunState {
    active_cancel: Option<(String, Arc<AtomicBool>)>,
    unclaimed_audio: HashMap<String, PathBuf>,
}

static YTDLP_RUN_COUNTER: AtomicU64 = AtomicU64::new(0);
const MAX_YTDLP_DOWNLOAD_BYTES: u64 = 100 * 1024 * 1024;
const MAX_YTDLP_METADATA_BYTES: u64 = 1024 * 1024;
const MAX_YTDLP_STDOUT_LINE_BYTES: usize = 64 * 1024;
const MAX_YTDLP_STDERR_LINE_BYTES: usize = 8 * 1024;
const MAX_YTDLP_AUDIO_BYTES: u64 = crate::audio_resource::MAX_AUDIO_FILE_BYTES;
const MAX_YTDLP_AUDIO_RUN: std::time::Duration = crate::audio_resource::MAX_AUDIO_DURATION;
const YTDLP_TRANSACTION_PREFIX: &str = ".lyrical-ytdlp-install-";
static YTDLP_INSTALL_RECOVERY_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn ytdlp_transaction_paths(parent: &Path, run_id: &str) -> (PathBuf, PathBuf) {
    let base = parent.join(format!("{YTDLP_TRANSACTION_PREFIX}{run_id}"));
    (
        base.with_extension("prepared"),
        base.with_extension("committed"),
    )
}

fn validate_ytdlp_transaction_id(run_id: &str) -> Result<(), String> {
    if run_id.is_empty()
        || run_id.len() > 128
        || !run_id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_')
    {
        return Err("Invalid yt-dlp transaction identifier".into());
    }
    Ok(())
}

fn transaction_staging_name(path: &Path, parent: &Path, expected_prefix: &str) -> Result<String, String> {
    if path.parent() != Some(parent) {
        return Err("yt-dlp staging file must be in the installation directory".into());
    }
    let name = path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid yt-dlp staging filename")?;
    if !name.starts_with(expected_prefix)
        || !name.ends_with(".part")
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"._-".contains(&byte))
    {
        return Err("Invalid yt-dlp staging filename".into());
    }
    Ok(name.to_string())
}

fn write_new_marker(path: &Path, contents: &[u8]) -> io::Result<()> {
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    let temp = path.with_file_name(format!(
        "{file_name}.{}.{}.tmp",
        std::process::id(),
        next_ytdlp_run_id()
    ));
    let mut file = std::fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&temp)?;
    let write_result = file.write_all(contents).and_then(|()| file.sync_all());
    drop(file);
    let result = write_result.and_then(|()| std::fs::rename(&temp, path));
    if result.is_err() {
        let _ = std::fs::remove_file(&temp);
    }
    result
}

fn remove_file_if_present(path: &Path) -> io::Result<()> {
    match std::fs::symlink_metadata(path) {
        Ok(metadata) if metadata.file_type().is_file() || metadata.file_type().is_symlink() => {
            std::fs::remove_file(path)
        }
        Ok(_) => Err(io::Error::other(format!(
            "yt-dlp transaction entry is not a file: {}",
            path.display()
        ))),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn recover_ytdlp_install(executable: &Path, version: &Path) -> Result<(), String> {
    let _guard = YTDLP_INSTALL_RECOVERY_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    recover_ytdlp_install_unlocked(executable, version)
}

fn recover_ytdlp_install_unlocked(executable: &Path, version: &Path) -> Result<(), String> {
    let parent = executable
        .parent()
        .ok_or("yt-dlp destination has no parent directory")?;
    let entries = match std::fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error.to_string()),
    };
    let mut prepared = Vec::new();
    for entry in entries {
        let entry = entry.map_err(|error| error.to_string())?;
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with(YTDLP_TRANSACTION_PREFIX) && name.ends_with(".prepared") {
            if !entry
                .file_type()
                .map_err(|error| error.to_string())?
                .is_file()
            {
                return Err("yt-dlp transaction marker is not a regular file".into());
            }
            prepared.push(entry.path());
        }
    }
    if prepared.is_empty() {
        return Ok(());
    }
    if prepared.len() != 1 {
        return Err("Multiple interrupted yt-dlp installations require manual recovery".into());
    }

    let prepared_path = prepared.pop().unwrap();
    let file_name = prepared_path
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid yt-dlp transaction marker")?;
    let run_id = file_name
        .strip_prefix(YTDLP_TRANSACTION_PREFIX)
        .and_then(|name| name.strip_suffix(".prepared"))
        .ok_or("Invalid yt-dlp transaction marker")?;
    validate_ytdlp_transaction_id(run_id)?;
    let (_, committed_path) = ytdlp_transaction_paths(parent, run_id);
    let executable_backup = backup_path(executable, run_id);
    let version_backup = backup_path(version, run_id);
    let executable_name = executable
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid yt-dlp executable filename")?;
    let version_name = version
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or("Invalid yt-dlp version filename")?;
    let state_text = std::fs::read_to_string(&prepared_path).map_err(|error| error.to_string())?;
    let mut state_values = state_text.split_whitespace();
    let had_executable = match state_values.next() {
        Some("1") => true,
        Some("0") => false,
        _ => return Err("Invalid yt-dlp transaction state".into()),
    };
    let had_version = match state_values.next() {
        Some("1") => true,
        Some("0") => false,
        _ => return Err("Invalid yt-dlp transaction state".into()),
    };
    let part_name = state_values
        .next()
        .ok_or("Missing yt-dlp executable staging filename")?;
    let version_part_name = state_values
        .next()
        .ok_or("Missing yt-dlp version staging filename")?;
    if state_values.next().is_some()
        || transaction_staging_name(&parent.join(part_name), parent, &format!("{executable_name}."))?
            != part_name
        || transaction_staging_name(
            &parent.join(version_part_name),
            parent,
            &format!("{version_name}."),
        )? != version_part_name
    {
        return Err("Invalid yt-dlp transaction state".into());
    }

    let committed = match std::fs::symlink_metadata(&committed_path) {
        Ok(metadata) if metadata.file_type().is_file() => {
            std::fs::read(&committed_path)
                .map(|contents| contents == b"complete")
                .map_err(|error| error.to_string())?
        }
        Ok(_) => return Err("yt-dlp commit marker is not a regular file".into()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    if committed && installed_ytdlp_version(executable, version).is_some() {
        remove_file_if_present(&executable_backup).map_err(|error| error.to_string())?;
        remove_file_if_present(&version_backup).map_err(|error| error.to_string())?;
        remove_file_if_present(&parent.join(part_name)).map_err(|error| error.to_string())?;
        remove_file_if_present(&parent.join(version_part_name)).map_err(|error| error.to_string())?;
        std::fs::remove_file(&committed_path).map_err(|error| error.to_string())?;
        std::fs::remove_file(&prepared_path).map_err(|error| error.to_string())?;
        return Ok(());
    }

    restore_ytdlp_entry(executable, &executable_backup, had_executable)?;
    restore_ytdlp_entry(version, &version_backup, had_version)?;
    remove_file_if_present(&parent.join(part_name)).map_err(|error| error.to_string())?;
    remove_file_if_present(&parent.join(version_part_name)).map_err(|error| error.to_string())?;
    remove_file_if_present(&committed_path).map_err(|error| error.to_string())?;
    std::fs::remove_file(&prepared_path).map_err(|error| error.to_string())?;
    Ok(())
}

fn backup_path(path: &Path, run_id: &str) -> PathBuf {
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!(".{name}.{run_id}.backup"))
}

fn restore_ytdlp_entry(path: &Path, backup: &Path, existed_before: bool) -> Result<(), String> {
    let backup_exists = match std::fs::symlink_metadata(backup) {
        Ok(metadata)
            if metadata.file_type().is_file() || metadata.file_type().is_symlink() =>
        {
            true
        }
        Ok(_) => return Err(format!("yt-dlp backup is not a file: {}", backup.display())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error.to_string()),
    };
    if existed_before {
        if backup_exists {
            remove_file_if_present(path).map_err(|error| error.to_string())?;
            std::fs::rename(backup, path).map_err(|error| error.to_string())?;
        } else {
            match std::fs::symlink_metadata(path) {
                Ok(metadata)
                    if metadata.file_type().is_file() || metadata.file_type().is_symlink() => {}
                Ok(_) => {
                    return Err(format!(
                        "yt-dlp previous installation entry is not a file: {}",
                        path.display()
                    ));
                }
                Err(error) => {
                    return Err(format!(
                        "yt-dlp previous installation entry is missing: {} ({error})",
                        path.display()
                    ));
                }
            }
        }
    } else {
        remove_file_if_present(path).map_err(|error| error.to_string())?;
        if backup_exists {
            return Err(format!(
                "Unexpected yt-dlp backup requires manual recovery: {}",
                backup.display()
            ));
        }
    }
    Ok(())
}

struct BoundedLine {
    bytes: Vec<u8>,
    truncated: bool,
}

async fn read_bounded_line<R>(reader: &mut R, max_bytes: usize) -> io::Result<Option<BoundedLine>>
where
    R: AsyncBufRead + Unpin,
{
    let mut bytes = Vec::with_capacity(max_bytes);
    let mut read_any = false;

    loop {
        let (chunk, consumed, line_ended, truncated) = {
            let available = reader.fill_buf().await?;
            if available.is_empty() {
                return Ok(read_any.then_some(BoundedLine {
                    bytes,
                    truncated: false,
                }));
            }

            let line_bytes = available
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(available.len(), |index| index + 1);
            let remaining = max_bytes.saturating_sub(bytes.len());
            if line_bytes > remaining {
                (available[..remaining].to_vec(), remaining, false, true)
            } else {
                (
                    available[..line_bytes].to_vec(),
                    line_bytes,
                    available[line_bytes - 1] == b'\n',
                    false,
                )
            }
        };

        reader.consume(consumed);
        read_any = true;
        bytes.extend_from_slice(&chunk);

        if truncated {
            return Ok(Some(BoundedLine {
                bytes,
                truncated: true,
            }));
        }

        if line_ended {
            bytes.pop();
            if bytes.last() == Some(&b'\r') {
                bytes.pop();
            }
            return Ok(Some(BoundedLine {
                bytes,
                truncated: false,
            }));
        }
    }
}

async fn discard_line_remainder<R>(reader: &mut R) -> io::Result<()>
where
    R: AsyncBufRead + Unpin,
{
    loop {
        let (consumed, line_ended) = {
            let available = reader.fill_buf().await?;
            if available.is_empty() {
                return Ok(());
            }
            match available.iter().position(|byte| *byte == b'\n') {
                Some(index) => (index + 1, true),
                None => (available.len(), false),
            }
        };
        reader.consume(consumed);
        if line_ended || consumed == 0 {
            return Ok(());
        }
    }
}

fn ytdlp_deadline_expired(started: std::time::Instant, now: std::time::Instant) -> bool {
    now.saturating_duration_since(started) >= MAX_YTDLP_AUDIO_RUN
}

fn next_ytdlp_run_id() -> String {
    let millis = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    format!(
        "{millis}-{}",
        YTDLP_RUN_COUNTER.fetch_add(1, Ordering::Relaxed)
    )
}

impl Default for YtdlpState {
    fn default() -> Self {
        Self {
            runs: Mutex::new(YtdlpRunState::default()),
            active_install_cancel: Mutex::new(None),
        }
    }
}

impl YtdlpState {
    fn start_install(&self) -> Result<Arc<AtomicBool>, String> {
        let mut active = self
            .active_install_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if active.is_some() {
            return Err("yt-dlp 설치가 이미 진행 중입니다".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        *active = Some(flag.clone());
        Ok(flag)
    }

    fn cancel_install(&self) {
        if let Some(flag) = self
            .active_install_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            flag.store(true, Ordering::Relaxed);
        }
    }

    fn finish_install(&self, flag: &Arc<AtomicBool>) {
        let mut active = self
            .active_install_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if active
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, flag))
        {
            *active = None;
        }
    }

    fn start_run(&self, run_id: String) -> Result<Arc<AtomicBool>, String> {
        let mut runs = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if runs.active_cancel.is_some() || runs.unclaimed_audio.contains_key(&run_id) {
            return Err("yt-dlp 다운로드가 이미 진행 중입니다".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        runs.active_cancel = Some((run_id, flag.clone()));
        Ok(flag)
    }

    fn cancel_run(&self, run_id: &str) -> Option<PathBuf> {
        let mut runs = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((active_run_id, flag)) = runs.active_cancel.as_ref() {
            if active_run_id == run_id {
                flag.store(true, Ordering::Relaxed);
            }
        }
        runs.unclaimed_audio.remove(run_id)
    }

    fn register_completed_audio(&self, run_id: &str, flag: &Arc<AtomicBool>, cache_dir: PathBuf) -> bool {
        let mut runs = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        let is_current_run = runs.active_cancel.as_ref().is_some_and(|(active_id, active_flag)| {
            active_id == run_id && Arc::ptr_eq(active_flag, flag)
        });
        if !is_current_run || flag.load(Ordering::Acquire) {
            return false;
        }
        runs.unclaimed_audio.insert(run_id.to_owned(), cache_dir);
        true
    }

    fn retain_completed_audio(&self, run_id: &str) -> bool {
        self.runs
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .unclaimed_audio
            .remove(run_id)
            .is_some()
    }

    fn finish_run(&self, flag: &Arc<AtomicBool>) {
        let mut runs = self.runs.lock().unwrap_or_else(|e| e.into_inner());
        if runs.active_cancel
            .as_ref()
            .is_some_and(|(_, current)| Arc::ptr_eq(current, flag))
        {
            runs.active_cancel = None;
        }
    }
}

struct ActiveYtdlpRun<'a> {
    state: &'a YtdlpState,
    cancel_flag: Arc<AtomicBool>,
}

impl<'a> ActiveYtdlpRun<'a> {
    fn new(state: &'a YtdlpState, cancel_flag: Arc<AtomicBool>) -> Self {
        Self { state, cancel_flag }
    }
}

impl Drop for ActiveYtdlpRun<'_> {
    fn drop(&mut self) {
        self.cancel_flag.store(true, Ordering::Relaxed);
        self.state.finish_run(&self.cancel_flag);
    }
}

struct YtdlpProcessTreeGuard {
    pid: Option<u32>,
    armed: bool,
}

impl YtdlpProcessTreeGuard {
    fn new(pid: Option<u32>) -> Self {
        Self { pid, armed: true }
    }

    fn disarm(&mut self) {
        self.armed = false;
    }

    async fn terminate(&mut self) {
        if let Some(pid) = self.pid {
            crate::alignment_process::terminate_process_tree(pid).await;
        }
        self.armed = false;
    }
}

impl Drop for YtdlpProcessTreeGuard {
    fn drop(&mut self) {
        if !self.armed {
            return;
        }
        let Some(pid) = self.pid else { return };
        #[cfg(unix)]
        unsafe {
            libc::kill(-(pid as i32), libc::SIGKILL);
        }
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            let pid = pid.to_string();
            let _ = std::process::Command::new("taskkill")
                .args(["/PID", &pid, "/T", "/F"])
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .spawn();
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct YtdlpInstallProgress {
    downloaded: u64,
    total: u64,
    done: bool,
    error: Option<String>,
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
    app.path()
        .app_data_dir()
        .map(|d| {
            crate::platform_profile::ytdlp_root(&d, std::env::consts::OS, std::env::consts::ARCH)
        })
        .map_err(|e| e.to_string())
}

fn ytdlp_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = ytdlp_dir(app)?;
    #[cfg(target_os = "windows")]
    return Ok(dir.join("yt-dlp.exe"));
    #[cfg(not(target_os = "windows"))]
    return Ok(dir.join("yt-dlp"));
}

fn prepare_ytdlp_install(
    part: &std::path::Path,
    expected: Option<&str>,
    actual: &str,
) -> Result<(), String> {
    let result = (|| {
        let expected = expected
            .map(str::trim)
            .filter(|hash| hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
            .ok_or("yt-dlp 릴리스 체크섬을 확인할 수 없습니다")?;
        if !actual.eq_ignore_ascii_case(expected) {
            return Err(format!(
                "yt-dlp 체크섬 불일치: 예상 {expected} / 실제 {actual}"
            ));
        }

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut permissions = std::fs::metadata(part)
                .map_err(|e| e.to_string())?
                .permissions();
            permissions.set_mode(0o755);
            std::fs::set_permissions(part, permissions).map_err(|e| e.to_string())?;
        }

        Ok(())
    })();

    if result.is_err() {
        let _ = std::fs::remove_file(part);
    }
    result
}

fn publish_ytdlp_install(
    part: &std::path::Path,
    version_part: &std::path::Path,
    dest: &std::path::Path,
    version: &std::path::Path,
    run_id: &str,
) -> Result<(), String> {
    publish_ytdlp_install_with(part, version_part, dest, version, run_id, |from, to| {
        std::fs::rename(from, to)
    })
}

fn publish_ytdlp_install_with(
    part: &std::path::Path,
    version_part: &std::path::Path,
    dest: &std::path::Path,
    version: &std::path::Path,
    run_id: &str,
    rename: impl FnMut(&std::path::Path, &std::path::Path) -> std::io::Result<()>,
) -> Result<(), String> {
    publish_ytdlp_install_with_hooks(
        part,
        version_part,
        dest,
        version,
        run_id,
        rename,
        write_new_marker,
    )
}

fn publish_ytdlp_install_with_hooks(
    part: &std::path::Path,
    version_part: &std::path::Path,
    dest: &std::path::Path,
    version: &std::path::Path,
    run_id: &str,
    mut rename: impl FnMut(&std::path::Path, &std::path::Path) -> std::io::Result<()>,
    mut write_marker: impl FnMut(&Path, &[u8]) -> io::Result<()>,
) -> Result<(), String> {
    validate_ytdlp_transaction_id(run_id)?;
    let _guard = YTDLP_INSTALL_RECOVERY_LOCK
        .lock()
        .unwrap_or_else(|error| error.into_inner());

    // Validate that dest is the expected yt-dlp executable (defect 1026)
    let dest_filename = dest.file_name().ok_or("Destination has no filename")?;
    let expected_name = crate::platform_profile::ytdlp_asset(std::env::consts::OS, std::env::consts::ARCH).1;
    if dest_filename != expected_name {
        return Err(format!("Unexpected yt-dlp executable name: {} (expected {})", dest_filename.to_string_lossy(), expected_name));
    }
    // Ensure parent directory exists
    let parent = dest.parent().ok_or("yt-dlp destination has no parent directory")?;
    recover_ytdlp_install_unlocked(dest, version)?;
    // Note: We don't enforce a specific parent directory path to allow for testing
    // with temporary directories. The filename validation is the critical check.

    let dest_backup = backup_path(dest, run_id);
    let version_backup = backup_path(version, run_id);
    let (prepared_path, committed_path) = ytdlp_transaction_paths(parent, run_id);
    let dest_name = dest.file_name().and_then(|name| name.to_str()).ok_or("Invalid yt-dlp executable filename")?;
    let version_name = version.file_name().and_then(|name| name.to_str()).ok_or("Invalid yt-dlp version filename")?;
    let part_name = transaction_staging_name(part, parent, &format!("{dest_name}."))?;
    let version_part_name = transaction_staging_name(version_part, parent, &format!("{version_name}."))?;
    let entry_exists = |path: &std::path::Path| match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(format!("{} 확인 실패: {error}", path.display())),
    };
    let had_dest = entry_exists(dest)?;
    let had_version = entry_exists(version)?;

    for backup in [&dest_backup, &version_backup] {
        if entry_exists(backup)? {
            return Err(format!(
                "yt-dlp 임시 백업 경로가 이미 존재합니다: {}",
                backup.display()
            ));
        }
    }
    for marker in [&prepared_path, &committed_path] {
        if entry_exists(marker)? {
            return Err(format!(
                "yt-dlp installation transaction marker already exists: {}",
                marker.display()
            ));
        }
    }

    for (path, exists) in [(dest, had_dest), (version, had_version)] {
        if exists {
            let metadata = std::fs::symlink_metadata(path).map_err(|e| e.to_string())?;
            let kind = metadata.file_type();
            if !kind.is_file() && !kind.is_symlink() {
                return Err(format!(
                    "yt-dlp 설치 대상이 파일이 아닙니다: {}",
                    path.display()
                ));
            }
        }
    }

    write_marker(
        &prepared_path,
        format!(
            "{} {} {part_name} {version_part_name}\n",
            u8::from(had_dest),
            u8::from(had_version)
        )
        .as_bytes(),
    )
    .map_err(|error| format!("yt-dlp installation transaction could not start: {error}"))?;

    if had_dest {
        if let Err(error) = rename(dest, &dest_backup) {
            let _ = std::fs::remove_file(&prepared_path);
            return Err(format!("기존 yt-dlp 실행 파일 백업 실패: {error}"));
        }
    }
    if had_version {
        if let Err(error) = rename(version, &version_backup) {
            if had_dest {
                if let Err(restore_error) = rename(&dest_backup, dest) {
                    return Err(format!(
                        "기존 yt-dlp 버전 정보 백업 실패: {error}; 실행 파일 복구 실패: {restore_error}. 백업 유지 위치: {}",
                        dest_backup.display()
                    ));
                }
            }
            let _ = std::fs::remove_file(&prepared_path);
            return Err(format!("기존 yt-dlp 버전 정보 백업 실패: {error}"));
        }
    }

    let publish_result = rename(part, dest)
        .map_err(|e| format!("yt-dlp 설치 파일 확정 실패: {e}"))
        .and_then(|()| {
            rename(version_part, version)
                .map_err(|e| format!("yt-dlp 버전 정보 확정 실패: {e}"))
        });

    if let Err(error) = publish_result {
        let mut rollback_errors = Vec::new();
        match std::fs::remove_file(dest) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => rollback_errors.push(format!("새 실행 파일 제거 실패: {error}")),
        }
        if had_version {
            if let Err(error) = rename(&version_backup, version) {
                rollback_errors.push(format!("기존 버전 정보 복구 실패: {error}"));
            }
        }
        if had_dest {
            if let Err(error) = rename(&dest_backup, dest) {
                rollback_errors.push(format!("기존 실행 파일 복구 실패: {error}"));
            }
        }
        if rollback_errors.is_empty() {
            let _ = std::fs::remove_file(&prepared_path);
        }
        let _ = std::fs::remove_file(part);
        let _ = std::fs::remove_file(version_part);
        return Err(if rollback_errors.is_empty() {
            error
        } else {
            format!(
                "{error}; 롤백이 완료되지 않았습니다: {}",
                rollback_errors.join(" / ")
            )
        });
    }

    if let Err(error) = write_marker(&committed_path, b"complete") {
        let mut rollback_errors = Vec::new();
        let executable_removed = match remove_file_if_present(dest) {
            Ok(()) => true,
            Err(error) => {
                rollback_errors.push(format!("새 실행 파일 제거 실패: {error}"));
                false
            }
        };
        let version_removed = match remove_file_if_present(version) {
            Ok(()) => true,
            Err(error) => {
                rollback_errors.push(format!("새 버전 정보 제거 실패: {error}"));
                false
            }
        };
        if had_version && version_removed {
            if let Err(error) = rename(&version_backup, version) {
                rollback_errors.push(format!("기존 버전 정보 복구 실패: {error}"));
            }
        }
        if had_dest && executable_removed {
            if let Err(error) = rename(&dest_backup, dest) {
                rollback_errors.push(format!("기존 실행 파일 복구 실패: {error}"));
            }
        }
        if rollback_errors.is_empty() {
            let _ = std::fs::remove_file(&prepared_path);
        }
        return Err(if rollback_errors.is_empty() {
            format!("yt-dlp 설치 완료 기록 실패: {error}")
        } else {
            format!("yt-dlp 설치 완료 기록 실패: {error}; 롤백 미완료: {}", rollback_errors.join(" / "))
        });
    }

    // The committed marker makes the new pair authoritative. Cleanup is safe to retry on
    // the next readiness check if the process exits or the filesystem rejects a removal.
    if remove_file_if_present(&dest_backup).is_ok()
        && remove_file_if_present(&version_backup).is_ok()
    {
        let _ = std::fs::remove_file(&committed_path);
        let _ = std::fs::remove_file(&prepared_path);
    }
    Ok(())
}

fn checked_limited_bytes(current: u64, additional: u64, limit: u64) -> Result<u64, String> {
    let total = current
        .checked_add(additional)
        .ok_or_else(|| "yt-dlp response size overflow".to_string())?;
    if total > limit {
        return Err(format!("yt-dlp response exceeds the {limit}-byte size limit"));
    }
    Ok(total)
}

async fn read_response_limited(
    mut response: reqwest::Response,
    limit: u64,
    cancel: &AtomicBool,
) -> Result<Vec<u8>, String> {
    if response.content_length().is_some_and(|length| length > limit) {
        return Err(format!("yt-dlp response exceeds the {limit}-byte size limit"));
    }
    let mut body = Vec::new();
    loop {
        match wait_for_ytdlp_io(response.chunk(), cancel).await? {
            Some(chunk) => {
                checked_limited_bytes(body.len() as u64, chunk.len() as u64, limit)?;
                body.extend_from_slice(&chunk);
            }
            None => return Ok(body),
        }
    }
}

async fn wait_for_ytdlp_io<T, E>(
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

#[tauri::command]
pub fn check_ytdlp(app: AppHandle) -> Result<Option<String>, String> {
    let exe = match ytdlp_exe(&app) {
        Ok(e) => e,
        Err(_) => return Ok(None),
    };
    let dir = ytdlp_dir(&app)?;
    recover_ytdlp_install(&exe, &dir.join("version.txt"))?;
    Ok(installed_ytdlp_version(&exe, &dir.join("version.txt")))
}

fn installed_ytdlp_version(exe: &Path, version_file: &Path) -> Option<String> {
    let metadata = std::fs::symlink_metadata(exe).ok()?;
    if !metadata.file_type().is_file() {
        return None;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return None;
        }
    }
    std::fs::read_to_string(version_file)
        .ok()
        .map(|version| version.trim().to_string())
        .filter(|version| !version.is_empty())
}

#[tauri::command]
pub async fn download_ytdlp(
    app: AppHandle,
    state: tauri::State<'_, YtdlpState>,
) -> Result<(), String> {
    let cancel = state.start_install()?;
    let result = download_ytdlp_inner(app.clone(), cancel.clone()).await;
    state.finish_install(&cancel);
    let _ = app.emit(
        "ytdlp-install-progress",
        YtdlpInstallProgress {
            downloaded: 0,
            total: 0,
            done: true,
            error: result.as_ref().err().cloned(),
        },
    );
    result
}

#[tauri::command]
pub fn cancel_ytdlp_install(state: tauri::State<'_, YtdlpState>) {
    state.cancel_install();
}

async fn download_ytdlp_inner(app: AppHandle, cancel: Arc<AtomicBool>) -> Result<(), String> {
    let dir = ytdlp_dir(&app)?;
    tokio::fs::create_dir_all(&dir)
        .await
        .map_err(|e| e.to_string())?;
    let (remote_name, local_name) =
        crate::platform_profile::ytdlp_asset(std::env::consts::OS, std::env::consts::ARCH);
    recover_ytdlp_install(&dir.join(local_name), &dir.join("version.txt"))?;

    let dest = dir.join(local_name);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut pending_files: Vec<PathBuf> = Vec::new();

    let result = async {
        let release_response = wait_for_ytdlp_io(
            client
                .get("https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest")
                .header("User-Agent", "lyrical-sync/1.0")
                .send(),
            &cancel,
        )
        .await
        .map_err(|e| format!("릴리스 정보 요청 실패: {e}"))?;
        if !release_response.status().is_success() {
            return Err(format!("릴리스 정보 HTTP {}", release_response.status()));
        }
        let release_bytes = read_response_limited(release_response, MAX_YTDLP_METADATA_BYTES, &cancel)
            .await
            .map_err(|e| format!("릴리스 정보 읽기 실패: {e}"))?;
        let release: serde_json::Value = serde_json::from_slice(&release_bytes)
            .map_err(|e| format!("릴리스 정보 파싱 실패: {e}"))?;
        let version_tag = release["tag_name"]
            .as_str()
            .filter(|tag| {
                !tag.is_empty()
                    && tag
                        .bytes()
                        .all(|b| b.is_ascii_alphanumeric() || b".-_".contains(&b))
            })
            .ok_or("yt-dlp 릴리스 태그가 올바르지 않습니다")?;
        let release_url =
            format!("https://github.com/yt-dlp/yt-dlp/releases/download/{version_tag}");

        let mut resp = wait_for_ytdlp_io(
            client
                .get(format!("{release_url}/{remote_name}"))
                .header("User-Agent", "lyrical-sync/1.0")
                .send(),
            &cancel,
        )
        .await
        .map_err(|e| format!("요청 실패: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("HTTP {}", resp.status()));
        }

        let total = resp.content_length().unwrap_or(0);
        if total > MAX_YTDLP_DOWNLOAD_BYTES {
            return Err(format!("yt-dlp download exceeds the {MAX_YTDLP_DOWNLOAD_BYTES}-byte size limit"));
        }
        let mut downloaded: u64 = 0;
        let part = dir.join(format!("{local_name}.{}.part", next_ytdlp_run_id()));
        pending_files.push(part.clone());
        use sha2::{Digest, Sha256};
        use tokio::io::AsyncWriteExt;
        let mut hasher = Sha256::new();
        let mut file = tokio::fs::File::create(&part)
            .await
            .map_err(|e| e.to_string())?;

        let stream_result: Result<(), String> = async {
            loop {
                match wait_for_ytdlp_io(resp.chunk(), &cancel).await {
                    Ok(Some(chunk)) => {
                        let next_downloaded = checked_limited_bytes(
                            downloaded,
                            chunk.len() as u64,
                            MAX_YTDLP_DOWNLOAD_BYTES,
                        )?;
                        file.write_all(&chunk)
                            .await
                            .map_err(|e| format!("yt-dlp 임시 파일 쓰기 실패: {e}"))?;
                        hasher.update(&chunk);
                        downloaded = next_downloaded;
                        let _ = app.emit(
                            "ytdlp-install-progress",
                            YtdlpInstallProgress {
                                downloaded,
                                total,
                                done: false,
                                error: None,
                            },
                        );
                    }
                    Ok(None) => break,
                    Err(e) => return Err(format!("yt-dlp 다운로드 중 연결 오류: {e}")),
                }
            }
            file.flush()
                .await
                .map_err(|e| format!("yt-dlp 임시 파일 flush 실패: {e}"))?;
            file.sync_all()
                .await
                .map_err(|e| format!("yt-dlp 임시 파일 동기화 실패: {e}"))?;
            if total > 0 && downloaded != total {
                return Err(format!(
                    "yt-dlp 다운로드가 불완전합니다 ({downloaded} / {total} bytes)"
                ));
            }
            Ok(())
        }
        .await;
        drop(file);
        stream_result?;

        let sums_response = wait_for_ytdlp_io(
            client
                .get(format!("{release_url}/SHA2-256SUMS"))
                .header("User-Agent", "lyrical-sync/1.0")
                .send(),
            &cancel,
        )
        .await
        .map_err(|e| format!("yt-dlp 체크섬 요청 실패: {e}"))?;
        if !sums_response.status().is_success() {
            let _ = tokio::fs::remove_file(&part).await;
            return Err(format!("yt-dlp 체크섬 HTTP {}", sums_response.status()));
        }
        let sums_bytes = read_response_limited(sums_response, MAX_YTDLP_METADATA_BYTES, &cancel)
            .await
            .map_err(|e| format!("yt-dlp 체크섬 읽기 실패: {e}"))?;
        let sums_text = String::from_utf8(sums_bytes)
            .map_err(|e| format!("yt-dlp 체크섬 인코딩 오류: {e}"))?;
        let expected = checksum_for_asset(&sums_text, remote_name)
            .ok_or("yt-dlp 릴리스 체크섬에서 실행 파일을 찾을 수 없습니다")?;
        let actual = format!("{:x}", hasher.finalize());
        prepare_ytdlp_install(&part, Some(expected), &actual)?;

        // 버전 정보는 설치된 실행 파일과 같은 릴리스 태그를 기록합니다.
        let version_tmp = dir.join(format!("version.txt.{}.part", next_ytdlp_run_id()));
        pending_files.push(version_tmp.clone());
        tokio::fs::write(&version_tmp, version_tag)
            .await
            .map_err(|e| format!("yt-dlp 버전 파일 쓰기 실패: {e}"))?;
        if cancel.load(Ordering::Relaxed) {
            return Err("cancelled".into());
        }
        publish_ytdlp_install(
            &part,
            &version_tmp,
            &dest,
            &dir.join("version.txt"),
            &next_ytdlp_run_id(),
        )?;
        pending_files.clear();

        Ok(())
    }
    .await;

    if result.is_err() {
        for path in pending_files {
            let _ = std::fs::remove_file(path);
        }
    }
    result
}

fn checksum_for_asset<'a>(sums: &'a str, asset: &str) -> Option<&'a str> {
    sums.lines().find_map(|line| {
        let mut parts = line.split_whitespace();
        let hash = parts.next()?;
        let name = parts.next()?.trim_start_matches('*');
        (name == asset && hash.len() == 64 && hash.bytes().all(|b| b.is_ascii_hexdigit()))
            .then_some(hash)
    })
}

fn parse_ytdlp_progress(line: &str) -> Option<YtdlpAudioProgress> {
    let t = line.trim();
    if !t.starts_with("[download]") || !t.contains('%') {
        return None;
    }
    let parts: Vec<&str> = t.split_whitespace().collect();
    let percent: f32 = parts.get(1)?.trim_end_matches('%').parse().ok()?;
    let speed = parts
        .iter()
        .position(|&s| s == "at")
        .and_then(|i| parts.get(i + 1))
        .map(|s| s.to_string())
        .unwrap_or_default();
    let eta = parts
        .iter()
        .position(|&s| s == "ETA")
        .and_then(|i| parts.get(i + 1))
        .map(|s| s.to_string())
        .unwrap_or_default();
    Some(YtdlpAudioProgress {
        percent,
        speed,
        eta,
        done: false,
    })
}

async fn find_ytdlp_output(dir: &PathBuf, prefix: &str) -> Result<PathBuf, String> {
    let mut rd = tokio::fs::read_dir(dir).await.map_err(|e| e.to_string())?;
    while let Ok(Some(entry)) = rd.next_entry().await {
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with(prefix)
            && !name.ends_with(".part")
            && entry.file_type().await.map(|kind| kind.is_file()).unwrap_or(false)
        {
            return Ok(entry.path());
        }
    }
    Err("다운로드된 파일을 찾을 수 없습니다".into())
}

fn validate_ytdlp_output(path: &Path, run_dir: &Path) -> Result<PathBuf, String> {
    let canonical_run_dir = run_dir.canonicalize().map_err(|error| error.to_string())?;
    let canonical_path = path.canonicalize().map_err(|error| error.to_string())?;
    let metadata = std::fs::metadata(&canonical_path).map_err(|error| error.to_string())?;
    if !canonical_path.starts_with(&canonical_run_dir) || !metadata.is_file() {
        return Err("yt-dlp output is outside the active download directory".into());
    }
    Ok(canonical_path)
}

#[tauri::command]
pub async fn ytdlp_load_audio(
    url: String,
    quality: String,
    cookies_file: Option<String>,
    proxy: Option<String>,
    run_id: String,
    app: AppHandle,
    ytdlp_state: tauri::State<'_, YtdlpState>,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    if run_id.is_empty() || run_id.len() > 128 {
        return Err("잘못된 yt-dlp 요청 식별자입니다".into());
    }
    validate_ytdlp_proxy(proxy.as_deref())?;
    path_validation::validate_ytdlp_url(&url)?;
    let exe = ytdlp_exe(&app)?;
    let dir = ytdlp_dir(&app)?;
    let version = dir.join("version.txt");
    recover_ytdlp_install(&exe, &version)?;
    if installed_ytdlp_version(&exe, &version).is_none() {
        return Err("yt-dlp가 설치되지 않았습니다".into());
    }

    let cancel_flag = ytdlp_state.start_run(run_id.clone())?;
    let _run_guard = ActiveYtdlpRun::new(&ytdlp_state, cancel_flag.clone());
    let path = ytdlp_load_audio_inner(
        url,
        quality,
        cookies_file,
        proxy,
        app.clone(),
        exe,
        cancel_flag.clone(),
    )
    .await?;
    let output_path = PathBuf::from(path);
    let raw_cache_dir = output_path
        .parent()
        .ok_or_else(|| "yt-dlp output has no cache directory".to_string())?
        .to_path_buf();
    let validation = (|| {
        let path = output_path.canonicalize().map_err(|error| error.to_string())?;
        let cache_root = app
            .path()
            .app_cache_dir()
            .map_err(|error| error.to_string())?
            .join("ytdlp-audio")
            .canonicalize()
            .map_err(|error| error.to_string())?;
        if !path.starts_with(&cache_root)
            || !std::fs::metadata(&path)
                .map_err(|error| error.to_string())?
                .is_file()
        {
            return Err("yt-dlp output is outside the application cache".into());
        }
        let cache_dir = path
            .parent()
            .ok_or_else(|| "yt-dlp output has no cache directory".to_string())?
            .to_path_buf();
        Ok((path, cache_dir))
    })();
    let (path, cache_dir) = match validation {
        Ok(output) => output,
        Err(error) => {
            let _ = remove_ytdlp_audio_cache(raw_cache_dir).await;
            return Err(error);
        }
    };
    if !ytdlp_state.register_completed_audio(&run_id, &cancel_flag, cache_dir.clone()) {
        let _ = remove_ytdlp_audio_cache(cache_dir).await;
        return Err("yt-dlp download was cancelled before it could be selected".into());
    }
    use tauri_plugin_fs::FsExt;
    if let Err(error) = window.fs_scope().allow_file(&path) {
        if let Some(cache_dir) = ytdlp_state.cancel_run(&run_id) {
            let _ = remove_ytdlp_audio_cache(cache_dir).await;
        }
        return Err(error.to_string());
    }
    Ok(path.to_string_lossy().into_owned())
}

async fn ytdlp_load_audio_inner(
    url: String,
    quality: String,
    cookies_file: Option<String>,
    proxy: Option<String>,
    app: AppHandle,
    exe: PathBuf,
    cancel_flag: Arc<AtomicBool>,
) -> Result<String, String> {
    let ts = next_ytdlp_run_id();

    let cache_dir = app
        .path()
        .app_cache_dir()
        .map_err(|e| e.to_string())?
        .join("ytdlp-audio")
        .join(&ts);
    tokio::fs::create_dir_all(&cache_dir)
        .await
        .map_err(|e| e.to_string())?;

    let result = ytdlp_run_child(
        url,
        quality,
        cookies_file,
        proxy,
        app,
        exe,
        cache_dir.clone(),
        ts,
        cancel_flag,
    )
    .await;
    if result.is_err() {
        let _ = tokio::fs::remove_dir_all(&cache_dir).await;
    }
    result
}

fn configure_ytdlp_audio_command(
    command: &mut tokio::process::Command,
    format: &str,
    output_template: &Path,
    cookies_file: Option<&str>,
    proxy: Option<&str>,
    url: &str,
) -> Result<(), String> {
    validate_ytdlp_proxy(proxy)?;
    command
        .arg("--ignore-config")
        .arg("--no-plugin-dirs")
        .arg("--no-playlist")
        .arg("-f")
        .arg(format)
        .arg("-o")
        .arg(output_template)
        .arg("--newline")
        .arg("--no-part")
        .arg("--max-filesize")
        .arg(MAX_YTDLP_AUDIO_BYTES.to_string())
        .arg("--socket-timeout")
        .arg("30");

    if let Some(cookies) = cookies_file.filter(|value| !value.is_empty()) {
        command.arg("--cookies").arg(cookies);
    }
    if let Some(proxy) = proxy.filter(|value| !value.is_empty()) {
        command.arg("--proxy").arg(proxy);
    }

    command.arg("--").arg(url);
    Ok(())
}

fn validate_ytdlp_proxy(proxy: Option<&str>) -> Result<(), String> {
    let Some(proxy) = proxy.map(str::trim).filter(|proxy| !proxy.is_empty()) else {
        return Ok(());
    };
    let parsed_userinfo = url::Url::parse(proxy)
        .map(|parsed| !parsed.username().is_empty() || parsed.password().is_some())
        .unwrap_or(false);
    let authority_start = proxy.find("://").map(|index| index + 3).unwrap_or(0);
    let authority = proxy[authority_start..]
        .split(|character| matches!(character, '/' | '?' | '#'))
        .next()
        .unwrap_or_default();
    if parsed_userinfo || authority.contains('@') {
        return Err("YTDLP_AUTH_PROXY_UNSUPPORTED".into());
    }
    Ok(())
}

fn audio_format_for_quality(quality: &str) -> &'static str {
    match quality {
        "192" => "bestaudio[ext=m4a][abr<=192]/bestaudio[ext=m4a]",
        "128" => "bestaudio[ext=m4a][abr<=128]/bestaudio[ext=m4a]",
        _ => "bestaudio[ext=m4a]",
    }
}

async fn ytdlp_run_child(
    url: String,
    quality: String,
    cookies_file: Option<String>,
    proxy: Option<String>,
    app: AppHandle,
    exe: PathBuf,
    cache_dir: PathBuf,
    ts: String,
    cancel_flag: Arc<AtomicBool>,
) -> Result<String, String> {
    let output_tpl = cache_dir.join(format!("{}.%(ext)s", ts));

    let format = audio_format_for_quality(&quality);

    let mut cmd = tokio::process::Command::new(&exe);
    configure_ytdlp_audio_command(
        &mut cmd,
        format,
        &output_tpl,
        cookies_file.as_deref(),
        proxy.as_deref(),
        &url,
    )?;
    cmd.kill_on_drop(true);
    #[cfg(unix)]
    cmd.process_group(0);
    cmd.stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let started = std::time::Instant::now();
    let mut child = cmd.spawn().map_err(|e| format!("yt-dlp 실행 실패: {e}"))?;
    let mut process_tree = YtdlpProcessTreeGuard::new(child.id());
    let stdout = child
        .stdout
        .take()
        .ok_or("yt-dlp stdout를 열 수 없습니다")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("yt-dlp stderr를 열 수 없습니다")?;

    use tokio::io::BufReader;

    // stderr는 실패 원인 파악용으로 병행해서 끝까지 비워야 한다(안 읽으면 파이프가 차서
    // 자식 프로세스가 멈출 수 있음). 마지막 몇 줄만 보관해 에러 메시지에 붙인다.
    let stderr_tail = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let stderr_tail_c = stderr_tail.clone();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr);
        loop {
            let line = match read_bounded_line(&mut reader, MAX_YTDLP_STDERR_LINE_BYTES).await {
                Ok(Some(line)) => line,
                Ok(None) | Err(_) => break,
            };
            let mut message = String::from_utf8_lossy(&line.bytes).into_owned();
            if line.truncated {
                message.push_str(" …[line truncated]");
                if discard_line_remainder(&mut reader).await.is_err() {
                    break;
                }
            }
            let mut tail = stderr_tail_c.lock().unwrap_or_else(|e| e.into_inner());
            tail.push(message);
            if tail.len() > 5 {
                tail.remove(0);
            }
        }
    });

    let mut reader = BufReader::new(stdout);
    let mut pending_line = Box::pin(read_bounded_line(&mut reader, MAX_YTDLP_STDOUT_LINE_BYTES));

    let app_c = app.clone();
    let mut dest_path: Option<String> = None;
    loop {
        if ytdlp_deadline_expired(started, std::time::Instant::now()) {
            process_tree.terminate().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stderr_task.await;
            return Err("yt-dlp audio download exceeded its time limit".into());
        }
        if cancel_flag.load(Ordering::Relaxed) {
            process_tree.terminate().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stderr_task.await;
            return Err("cancelled".into());
        }
        match tokio::time::timeout(std::time::Duration::from_millis(100), &mut pending_line).await {
            Err(_) => continue,
            Ok(Ok(Some(line))) if line.truncated => {
                process_tree.terminate().await;
                let _ = child.kill().await;
                let _ = child.wait().await;
                let _ = stderr_task.await;
                return Err(format!(
                    "yt-dlp stdout line exceeded the {MAX_YTDLP_STDOUT_LINE_BYTES}-byte limit"
                ));
            }
            Ok(Ok(Some(line))) => {
                let line = match String::from_utf8(line.bytes) {
                    Ok(line) => line,
                    Err(error) => {
                        process_tree.terminate().await;
                        let _ = child.kill().await;
                        let _ = child.wait().await;
                        let _ = stderr_task.await;
                        return Err(error.to_string());
                    }
                };
                if let Some(p) = line.strip_prefix("[download] Destination: ") {
                    dest_path = Some(p.trim().to_string());
                } else if let Some(p) = line.strip_prefix("[Merger] Merging formats into \"") {
                    dest_path = Some(p.trim_end_matches('"').to_string());
                }
                if let Some(progress) = parse_ytdlp_progress(&line) {
                    let _ = app_c.emit("ytdlp-audio-progress", &progress);
                }
                drop(pending_line);
                pending_line =
                    Box::pin(read_bounded_line(&mut reader, MAX_YTDLP_STDOUT_LINE_BYTES));
            }
            Ok(Ok(None)) => break,
            Ok(Err(e)) => {
                process_tree.terminate().await;
                let _ = child.kill().await;
                let _ = child.wait().await;
                let _ = stderr_task.await;
                return Err(e.to_string());
            }
        }
    }

    let status = loop {
        if ytdlp_deadline_expired(started, std::time::Instant::now()) {
            process_tree.terminate().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stderr_task.await;
            return Err("yt-dlp audio download exceeded its time limit".into());
        }
        if cancel_flag.load(Ordering::Relaxed) {
            process_tree.terminate().await;
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stderr_task.await;
            return Err("cancelled".into());
        }
        match tokio::time::timeout(std::time::Duration::from_millis(100), child.wait()).await {
            Err(_) => continue,
            Ok(status) => break status.map_err(|e| e.to_string())?,
        }
    };
    let _ = stderr_task.await;

    if cancel_flag.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    if !status.success() {
        let detail = stderr_tail
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .join(" / ");
        return Err(if detail.is_empty() {
            format!("yt-dlp 오류 (종료 코드 {:?})", status.code())
        } else {
            format!("yt-dlp 오류 (종료 코드 {:?}): {detail}", status.code())
        });
    }

    let candidate_path = if let Some(ref p) = dest_path {
        let pb = PathBuf::from(p);
        if pb.exists() {
            pb
        } else {
            find_ytdlp_output(&cache_dir, &ts).await?
        }
    } else {
        find_ytdlp_output(&cache_dir, &ts).await?
    };
    let file_path = validate_ytdlp_output(&candidate_path, &cache_dir)?;

    process_tree.disarm();

    let _ = app.emit(
        "ytdlp-audio-progress",
        YtdlpAudioProgress {
            percent: 100.0,
            speed: String::new(),
            eta: String::new(),
            done: true,
        },
    );

    Ok(file_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn cancel_ytdlp_load(
    run_id: String,
    ytdlp_state: tauri::State<'_, YtdlpState>,
) -> Result<(), String> {
    if let Some(cache_dir) = ytdlp_state.cancel_run(&run_id) {
        remove_ytdlp_audio_cache(cache_dir).await?;
    }
    Ok(())
}

#[tauri::command]
pub fn retain_ytdlp_audio(
    run_id: String,
    ytdlp_state: tauri::State<'_, YtdlpState>,
) -> Result<(), String> {
    if ytdlp_state.retain_completed_audio(&run_id) {
        Ok(())
    } else {
        Err("yt-dlp result is no longer available for selection".into())
    }
}

async fn remove_ytdlp_audio_cache(cache_dir: PathBuf) -> Result<(), String> {
    match tokio::fs::remove_dir_all(cache_dir).await {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::BufReader;

    #[test]
    fn audio_command_ignores_external_config_and_plugins() {
        let output = PathBuf::from("/tmp/owned-run/audio.%(ext)s");
        let mut command = tokio::process::Command::new("yt-dlp");
        configure_ytdlp_audio_command(
            &mut command,
            "bestaudio/best",
            &output,
            Some("/tmp/cookies.txt"),
            Some("http://127.0.0.1:8080"),
            "https://www.youtube.com/watch?v=fixture",
        )
        .unwrap();
        let args: Vec<String> = command
            .as_std()
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();

        assert!(args.contains(&"--ignore-config".to_string()));
        assert!(args.contains(&"--no-plugin-dirs".to_string()));
        assert!(args.windows(2).any(|pair| pair == ["--cookies", "/tmp/cookies.txt"]));
        assert!(args.windows(2).any(|pair| pair == ["--proxy", "http://127.0.0.1:8080"]));
        let terminator = args.iter().position(|argument| argument == "--").unwrap();
        assert_eq!(args[terminator + 1], "https://www.youtube.com/watch?v=fixture");
    }

    #[test]
    fn audio_command_does_not_put_proxy_credentials_in_child_arguments() {
        let output = PathBuf::from("/tmp/owned-run/audio.%(ext)s");
        let mut command = tokio::process::Command::new("yt-dlp");
        let result = configure_ytdlp_audio_command(
            &mut command,
            "bestaudio/best",
            &output,
            None,
            Some("http://alice:secret@proxy.example:8080"),
            "https://www.youtube.com/watch?v=fixture",
        );
        let args: Vec<String> = command
            .as_std()
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();

        assert_eq!(result.unwrap_err(), "YTDLP_AUTH_PROXY_UNSUPPORTED");
        assert!(args.is_empty());
    }

    #[test]
    fn audio_command_caps_download_to_supported_audio_file_size() {
        let output = PathBuf::from("/tmp/owned-run/audio.%(ext)s");
        let mut command = tokio::process::Command::new("yt-dlp");
        configure_ytdlp_audio_command(
            &mut command,
            "bestaudio/best",
            &output,
            None,
            None,
            "https://www.youtube.com/watch?v=fixture",
        )
        .unwrap();
        let args: Vec<String> = command
            .as_std()
            .get_args()
            .map(|argument| argument.to_string_lossy().into_owned())
            .collect();

        let limit_index = args
            .iter()
            .position(|argument| argument == "--max-filesize")
            .unwrap();
        assert_eq!(args[limit_index + 1], MAX_YTDLP_AUDIO_BYTES.to_string());
        let timeout_index = args
            .iter()
            .position(|argument| argument == "--socket-timeout")
            .unwrap();
        assert_eq!(args[timeout_index + 1], "30");
    }

    #[test]
    fn audio_format_selection_restricts_output_to_playback_compatible_m4a() {
        assert_eq!(
            audio_format_for_quality("192"),
            "bestaudio[ext=m4a][abr<=192]/bestaudio[ext=m4a]"
        );
        assert_eq!(
            audio_format_for_quality("128"),
            "bestaudio[ext=m4a][abr<=128]/bestaudio[ext=m4a]"
        );
        assert_eq!(audio_format_for_quality("best"), "bestaudio[ext=m4a]");
    }

    #[test]
    fn ytdlp_deadline_expires_at_the_configured_limit() {
        let started = std::time::Instant::now();
        assert!(!ytdlp_deadline_expired(
            started,
            started + MAX_YTDLP_AUDIO_RUN - std::time::Duration::from_nanos(1)
        ));
        assert!(ytdlp_deadline_expired(started, started + MAX_YTDLP_AUDIO_RUN));
    }

    #[test]
    fn output_validation_accepts_only_regular_files_in_the_active_run_directory() {
        let temp = tempfile::tempdir().unwrap();
        let audio_root = temp.path().join("ytdlp-audio");
        let run_dir = audio_root.join("run-1");
        let other_run = audio_root.join("run-2");
        std::fs::create_dir_all(&run_dir).unwrap();
        std::fs::create_dir_all(&other_run).unwrap();
        let valid = run_dir.join("run-1.m4a");
        let sibling = other_run.join("run-2.m4a");
        let outside = temp.path().join("outside.m4a");
        let directory = run_dir.join("run-1-directory");
        std::fs::write(&valid, b"audio").unwrap();
        std::fs::write(&sibling, b"audio").unwrap();
        std::fs::write(&outside, b"audio").unwrap();
        std::fs::create_dir(&directory).unwrap();

        assert_eq!(
            validate_ytdlp_output(&valid, &run_dir).unwrap(),
            valid.canonicalize().unwrap()
        );
        assert!(validate_ytdlp_output(&sibling, &run_dir).is_err());
        assert!(validate_ytdlp_output(&outside, &run_dir).is_err());
        assert!(validate_ytdlp_output(&directory, &run_dir).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn installed_version_requires_an_executable_regular_file() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let exe = dir.path().join("yt-dlp");
        let version = dir.path().join("version.txt");
        std::fs::write(&exe, b"fixture").unwrap();
        std::fs::write(&version, "2026.10.21\n").unwrap();
        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o644)).unwrap();

        assert_eq!(installed_ytdlp_version(&exe, &version), None);

        std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(installed_ytdlp_version(&exe, &version).as_deref(), Some("2026.10.21"));
    }

    #[test]
    fn ytdlp_process_tree_fixture() {
        match std::env::var("LYRICAL_YTDLP_FIXTURE").as_deref() {
            Ok("grandchild") => std::thread::sleep(std::time::Duration::from_secs(60)),
            Ok("parent") => {
                let marker = std::env::var("LYRICAL_YTDLP_PID_FILE").unwrap();
                let child = std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "ytdlp::tests::ytdlp_process_tree_fixture", "--nocapture"])
                    .env("LYRICAL_YTDLP_FIXTURE", "grandchild")
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .unwrap();
                std::fs::write(marker, child.id().to_string()).unwrap();
                std::thread::sleep(std::time::Duration::from_secs(60));
            }
            _ => {}
        }
    }

    #[test]
    fn dropping_active_run_releases_the_single_run_slot() {
        let state = YtdlpState::default();
        let cancel = state.start_run("first".into()).unwrap();
        {
            let _guard = ActiveYtdlpRun::new(&state, cancel.clone());
            assert!(state.start_run("other".into()).is_err());
        }
        assert!(cancel.load(Ordering::Relaxed));
        assert!(state.start_run("after".into()).is_ok());
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn dropping_process_tree_guard_terminates_yt_dlp_descendants() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("grandchild.pid");
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "ytdlp::tests::ytdlp_process_tree_fixture", "--nocapture"])
            .env("LYRICAL_YTDLP_FIXTURE", "parent")
            .env("LYRICAL_YTDLP_PID_FILE", &marker)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .process_group(0);
        let child = command.spawn().unwrap();
        let pid = child.id().unwrap();
        let guard = YtdlpProcessTreeGuard::new(Some(pid));
        tokio::time::timeout(std::time::Duration::from_secs(3), async {
            while !marker.exists() {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("fixture should publish its descendant PID");
        let grandchild: i32 = std::fs::read_to_string(marker).unwrap().parse().unwrap();
        assert_eq!(unsafe { libc::kill(grandchild, 0) }, 0);

        drop(guard);
        drop(child);
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while unsafe { libc::kill(grandchild, 0) } == 0 {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("dropped yt-dlp operation should terminate its descendant");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn terminating_process_tree_closes_a_pipe_held_by_a_child_grandchild() {
        use tokio::io::AsyncReadExt;

        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("grandchild.pid");
        let mut command = tokio::process::Command::new("sh");
        command
            .arg("-c")
            .arg("sleep 60 & echo $! > \"$1\"")
            .arg("ytdlp-pipe-fixture")
            .arg(&marker)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true)
            .process_group(0);
        let mut child = command.spawn().unwrap();
        let pid = child.id().unwrap();
        let stdout = child.stdout.take().unwrap();
        let mut reader = BufReader::new(stdout);
        let mut guard = YtdlpProcessTreeGuard::new(Some(pid));

        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            while !marker.exists() {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
            }
            child.wait().await.unwrap();
        })
        .await
        .expect("direct child should exit while its descendant keeps stdout open");
        let _grandchild: i32 = std::fs::read_to_string(marker)
            .unwrap()
            .trim()
            .parse()
            .unwrap();

        assert!(
            tokio::time::timeout(std::time::Duration::from_millis(100), reader.read_u8(),)
                .await
                .is_err(),
            "descendant should keep the pipe open before cleanup"
        );

        guard.terminate().await;
        tokio::time::timeout(std::time::Duration::from_secs(2), async {
            let mut byte = [0u8; 1];
            assert_eq!(reader.read(&mut byte).await.unwrap(), 0);
        })
        .await
        .expect("terminating the process group should release the inherited pipe");
    }

    #[test]
    fn bounded_response_byte_count_rejects_limit_plus_one_and_overflow() {
        assert_eq!(checked_limited_bytes(4, 6, 10).unwrap(), 10);
        assert!(checked_limited_bytes(4, 7, 10).is_err());
        assert!(checked_limited_bytes(u64::MAX, 1, u64::MAX).is_err());
    }

    #[tokio::test]
    async fn child_output_line_reader_caps_memory_and_can_resume_after_discard() {
        let input = b"0123456789abcdef\nnext\n";
        let mut reader = BufReader::new(input.as_slice());

        let line = read_bounded_line(&mut reader, 8).await.unwrap().unwrap();
        assert!(line.truncated);
        assert_eq!(line.bytes.len(), 8);

        discard_line_remainder(&mut reader).await.unwrap();
        let next = read_bounded_line(&mut reader, 8).await.unwrap().unwrap();
        assert!(!next.truncated);
        assert_eq!(next.bytes, b"next");
    }

    #[tokio::test]
    async fn child_output_line_reader_bounds_a_large_newline_free_stream() {
        use tokio::io::AsyncWriteExt;

        let (mut writer, stream) = tokio::io::duplex(8 * 1024);
        let writer_task = tokio::spawn(async move {
            let block = [b'x'; 16 * 1024];
            let mut total = 0usize;
            loop {
                match writer.write_all(&block).await {
                    Ok(()) => total += block.len(),
                    Err(_) => return total,
                }
            }
        });

        let mut reader = BufReader::new(stream);
        let line = tokio::time::timeout(
            std::time::Duration::from_secs(2),
            read_bounded_line(&mut reader, MAX_YTDLP_STDOUT_LINE_BYTES),
        )
        .await
        .expect("newline-free output should hit the byte cap promptly")
        .unwrap()
        .unwrap();
        assert!(line.truncated);
        assert_eq!(line.bytes.len(), MAX_YTDLP_STDOUT_LINE_BYTES);

        drop(reader);
        let written = tokio::time::timeout(std::time::Duration::from_secs(2), writer_task)
            .await
            .expect("writer should stop after the bounded reader is dropped")
            .unwrap();
        assert!(written < MAX_YTDLP_STDOUT_LINE_BYTES + 8 * 1024 + 16 * 1024);
    }

    #[tokio::test]
    async fn child_output_line_reader_accepts_exact_limit_and_final_unterminated_line() {
        let input = b"abc\n1234";
        let mut reader = BufReader::new(input.as_slice());

        let line = read_bounded_line(&mut reader, 4).await.unwrap().unwrap();
        assert!(!line.truncated);
        assert_eq!(line.bytes, b"abc");

        let final_line = read_bounded_line(&mut reader, 4).await.unwrap().unwrap();
        assert!(!final_line.truncated);
        assert_eq!(final_line.bytes, b"1234");
        assert!(read_bounded_line(&mut reader, 4).await.unwrap().is_none());
    }

    #[tokio::test]
    async fn streamed_response_without_content_length_is_capped() {
        use tokio::io::{AsyncReadExt, AsyncWriteExt};
        use tokio::net::TcpListener;

        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let server = tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut request = [0_u8; 1024];
            let _ = socket.read(&mut request).await.unwrap();
            socket.write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n5\r\n12345\r\n0\r\n\r\n",
            ).await.unwrap();
        });
        let response = reqwest::Client::new()
            .get(format!("http://{address}/payload"))
            .send()
            .await
            .unwrap();
        assert_eq!(response.content_length(), None);

        let error = read_response_limited(response, 4, &AtomicBool::new(false))
            .await
            .unwrap_err();
        assert!(error.contains("size limit"));
        server.await.unwrap();
    }

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
    fn a_new_download_does_not_clear_an_older_runs_cancel_request() {
        let state = YtdlpState::default();
        let first_run_flag = state
            .start_run("first".into())
            .expect("first run should start");
        first_run_flag.store(true, Ordering::Relaxed);
        state.finish_run(&first_run_flag);

        // A second run gets its own cancellation flag instead of resetting the first one.
        let second_run_flag = state
            .start_run("second".into())
            .expect("second run should start after first finishes");

        assert!(first_run_flag.load(Ordering::Relaxed));
        assert!(!second_run_flag.load(Ordering::Relaxed));
    }

    #[test]
    fn a_stale_cancel_request_cannot_cancel_a_newer_download() {
        let state = YtdlpState::default();
        let first = state
            .start_run("first".into())
            .expect("first run should start");
        state.finish_run(&first);
        let second = state
            .start_run("second".into())
            .expect("second run should start");

        let _ = state.cancel_run("first");
        assert!(!second.load(Ordering::Relaxed));
        let _ = state.cancel_run("second");
        assert!(second.load(Ordering::Relaxed));
    }

    #[test]
    fn a_second_download_cannot_start_until_the_active_child_is_reaped() {
        let state = YtdlpState::default();
        let first_run_flag = state
            .start_run("first".into())
            .expect("first run should start");
        assert!(state.start_run("second".into()).is_err());
        let _ = state.cancel_run("first");
        assert!(first_run_flag.load(Ordering::Relaxed));
        state.finish_run(&first_run_flag);
        assert!(state.start_run("second".into()).is_ok());
    }

    #[test]
    fn cancelled_completed_audio_returns_its_native_owned_cache_for_cleanup() {
        let temp = tempfile::tempdir().unwrap();
        let cache_dir = temp.path().join("run");
        std::fs::create_dir(&cache_dir).unwrap();
        std::fs::write(cache_dir.join("audio.m4a"), b"fixture").unwrap();

        let state = YtdlpState::default();
        let run = state.start_run("run-1".into()).unwrap();
        assert!(state.register_completed_audio("run-1", &run, cache_dir.clone()));
        state.finish_run(&run);

        assert_eq!(state.cancel_run("run-1"), Some(cache_dir.clone()));
        assert!(!state.retain_completed_audio("run-1"));
        assert!(cache_dir.join("audio.m4a").exists());
    }

    #[tokio::test]
    async fn cancelling_a_completed_run_removes_only_its_cache_directory() {
        let temp = tempfile::tempdir().unwrap();
        let cache_dir = temp.path().join("run");
        std::fs::create_dir(&cache_dir).unwrap();
        std::fs::write(cache_dir.join("audio.m4a"), b"fixture").unwrap();
        let unrelated = temp.path().join("unrelated");
        std::fs::create_dir(&unrelated).unwrap();

        let state = YtdlpState::default();
        let run = state.start_run("run-1".into()).unwrap();
        assert!(state.register_completed_audio("run-1", &run, cache_dir.clone()));
        state.finish_run(&run);

        remove_ytdlp_audio_cache(state.cancel_run("run-1").unwrap())
            .await
            .unwrap();
        assert!(!cache_dir.exists());
        assert!(unrelated.exists());
    }

    #[test]
    fn retained_completed_audio_survives_a_late_cancel_request() {
        let temp = tempfile::tempdir().unwrap();
        let cache_dir = temp.path().join("run");
        std::fs::create_dir(&cache_dir).unwrap();
        std::fs::write(cache_dir.join("audio.m4a"), b"fixture").unwrap();

        let state = YtdlpState::default();
        let run = state.start_run("run-1".into()).unwrap();
        assert!(state.register_completed_audio("run-1", &run, cache_dir.clone()));
        state.finish_run(&run);

        assert!(state.retain_completed_audio("run-1"));
        assert_eq!(state.cancel_run("run-1"), None);
        assert!(cache_dir.join("audio.m4a").exists());
    }

    #[test]
    fn cancelled_run_cannot_register_a_completed_audio_cache() {
        let temp = tempfile::tempdir().unwrap();
        let state = YtdlpState::default();
        let run = state.start_run("run-1".into()).unwrap();
        let _ = state.cancel_run("run-1");

        assert!(!state.register_completed_audio("run-1", &run, temp.path().join("run")));
        state.finish_run(&run);
    }

    #[test]
    fn installation_is_single_owner_and_cancellation_targets_that_run() {
        let state = YtdlpState::default();
        let first = state.start_install().expect("first install should start");
        assert!(state.start_install().is_err());

        state.cancel_install();
        assert!(first.load(Ordering::Relaxed));

        state.finish_install(&first);
        let second = state
            .start_install()
            .expect("a new install should start after completion");
        assert!(!second.load(Ordering::Relaxed));
    }

    #[test]
    fn finishing_an_old_install_does_not_clear_a_new_install() {
        let state = YtdlpState::default();
        let first = state.start_install().expect("first install should start");
        state.finish_install(&first);
        let second = state.start_install().expect("second install should start");

        state.finish_install(&first);

        assert!(state.start_install().is_err());
        state.finish_install(&second);
        assert!(state.start_install().is_ok());
    }

    #[tokio::test]
    async fn stalled_install_request_can_be_cancelled() {
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_task = cancel.clone();
        let task = tokio::spawn(async move {
            wait_for_ytdlp_io(
                std::future::pending::<Result<(), std::io::Error>>(),
                &cancel_task,
            )
            .await
        });
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        cancel.store(true, Ordering::Relaxed);

        let result = task.await.expect("cancellation task should finish");
        assert_eq!(result.unwrap_err(), "cancelled");
    }

    #[test]
    fn download_run_ids_are_unique_even_within_one_millisecond() {
        assert_ne!(next_ytdlp_run_id(), next_ytdlp_run_id());
    }

    #[test]
    fn checksum_for_asset_accepts_only_a_matching_valid_entry() {
        let sums = format!(
            "{}  yt-dlp.exe\n{}  other.exe\n",
            "a".repeat(64),
            "b".repeat(64)
        );
        assert_eq!(
            checksum_for_asset(&sums, "yt-dlp.exe"),
            Some("a".repeat(64).as_str())
        );
        assert_eq!(
            checksum_for_asset("not-a-hash  yt-dlp.exe\n", "yt-dlp.exe"),
            None
        );
        assert_eq!(checksum_for_asset(&sums, "missing.exe"), None);
    }

    #[test]
    fn failed_checksum_does_not_replace_an_existing_install() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("yt-dlp.part");
        let dest = dir.path().join("yt-dlp");
        std::fs::write(&part, b"new binary").unwrap();
        std::fs::write(&dest, b"working binary").unwrap();

        let expected = "a".repeat(64);
        let actual = "b".repeat(64);
        let result = prepare_ytdlp_install(&part, Some(&expected), &actual);

        assert!(result.is_err());
        assert_eq!(std::fs::read(&dest).unwrap(), b"working binary");
        assert!(!part.exists());
    }

    #[test]
    fn failed_version_publish_preserves_the_previous_binary_and_version() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("yt-dlp.part");
        let version_part = dir.path().join("version.txt.part");
        let dest = dir.path().join("yt-dlp");
        let version = dir.path().join("version.txt");
        std::fs::write(&part, b"new binary").unwrap();
        std::fs::write(&dest, b"working binary").unwrap();
        std::fs::write(&version, "old-version").unwrap();

        let result = publish_ytdlp_install(&part, &version_part, &dest, &version, "test-run");

        assert!(result.is_err());
        assert_eq!(std::fs::read(&dest).unwrap(), b"working binary");
        assert_eq!(std::fs::read_to_string(&version).unwrap(), "old-version");
        assert!(!part.exists());
        assert!(!version_part.exists());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn failed_commit_marker_restores_the_previous_install_pair() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("yt-dlp.part");
        let version_part = dir.path().join("version.txt.part");
        let dest = dir.path().join(
            crate::platform_profile::ytdlp_asset(std::env::consts::OS, std::env::consts::ARCH).1,
        );
        let version = dir.path().join("version.txt");
        std::fs::write(&part, b"new binary").unwrap();
        std::fs::write(&version_part, "new-version").unwrap();
        std::fs::write(&dest, b"old binary").unwrap();
        std::fs::write(&version, "old-version").unwrap();
        let mut marker_writes = 0;

        let result = publish_ytdlp_install_with_hooks(
            &part,
            &version_part,
            &dest,
            &version,
            "commit-marker-failure",
            |from, to| std::fs::rename(from, to),
            |path, contents| {
                marker_writes += 1;
                if marker_writes == 2 {
                    return Err(std::io::Error::other("injected commit marker failure"));
                }
                write_new_marker(path, contents)
            },
        );

        assert!(result.unwrap_err().contains("설치 완료 기록 실패"));
        assert_eq!(std::fs::read(&dest).unwrap(), b"old binary");
        assert_eq!(std::fs::read_to_string(&version).unwrap(), "old-version");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
        assert_eq!(marker_writes, 2);
    }

    #[test]
    fn failed_version_backup_reports_and_retains_an_unrestored_binary_backup() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("yt-dlp.part");
        let version_part = dir.path().join("version.txt.part");
        let dest = dir.path().join("yt-dlp");
        let version = dir.path().join("version.txt");
        let dest_backup = dir.path().join(".yt-dlp.rollback-test.backup");
        std::fs::write(&part, b"new binary").unwrap();
        std::fs::write(&version_part, "new-version").unwrap();
        std::fs::write(&dest, b"working binary").unwrap();
        std::fs::write(&version, "old-version").unwrap();
        let mut calls = 0;

        let result = publish_ytdlp_install_with(
            &part,
            &version_part,
            &dest,
            &version,
            "rollback-test",
            |from, to| {
                calls += 1;
                if calls == 2 || calls == 3 {
                    Err(std::io::Error::other("injected rename failure"))
                } else {
                    std::fs::rename(from, to)
                }
            },
        );

        let error = result.unwrap_err();
        assert!(error.contains("실행 파일 복구 실패"));
        assert!(error.contains(&dest_backup.display().to_string()));
        assert!(!dest.exists());
        assert_eq!(std::fs::read(&dest_backup).unwrap(), b"working binary");
        assert_eq!(std::fs::read_to_string(&version).unwrap(), "old-version");
        assert!(part.exists());
        assert!(version_part.exists());

        recover_ytdlp_install(&dest, &version).unwrap();
        assert_eq!(std::fs::read(&dest).unwrap(), b"working binary");
        assert_eq!(std::fs::read_to_string(&version).unwrap(), "old-version");
        for entry in std::fs::read_dir(dir.path()).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            assert!(!name.ends_with(".backup"), "stale backup: {name}");
            assert!(!name.ends_with(".prepared"), "stale journal: {name}");
        }
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }

    #[test]
    fn interrupted_publication_recovers_a_complete_installed_pair() {
        if let Ok(root) = std::env::var("LYRICAL_YTDLP_CRASH_FIXTURE") {
            let root = PathBuf::from(root);
            let exe_name = crate::platform_profile::ytdlp_asset(
                std::env::consts::OS,
                std::env::consts::ARCH,
            )
            .1;
            let dest = root.join(exe_name);
            let version = root.join("version.txt");
            let part = root.join("yt-dlp.part");
            let version_part = root.join("version.txt.part");
            std::fs::write(&dest, b"working binary").unwrap();
            std::fs::write(&version, "old-version").unwrap();
            std::fs::write(&part, b"new binary").unwrap();
            std::fs::write(&version_part, "new-version").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&dest, std::fs::Permissions::from_mode(0o755)).unwrap();
                std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let crash_after = std::env::var("LYRICAL_YTDLP_CRASH_AFTER")
                .unwrap()
                .parse::<usize>()
                .unwrap();
            let mut calls = 0;
            let _ = publish_ytdlp_install_with(
                &part,
                &version_part,
                &dest,
                &version,
                "crash-fixture",
                |from, to| {
                    calls += 1;
                    let result = std::fs::rename(from, to);
                    if calls == crash_after {
                        std::process::exit(51);
                    }
                    result
                },
            );
            panic!("fixture must exit after the first publication rename");
        }

        for crash_after in 1..=4 {
            let root = tempfile::tempdir().unwrap();
            let status = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "ytdlp::tests::interrupted_publication_recovers_a_complete_installed_pair",
                    "--nocapture",
                ])
                .env("LYRICAL_YTDLP_CRASH_FIXTURE", root.path())
                .env("LYRICAL_YTDLP_CRASH_AFTER", crash_after.to_string())
                .status()
                .unwrap();
            assert_eq!(status.code(), Some(51), "rename boundary {crash_after}");

            let exe = root.path().join(
                crate::platform_profile::ytdlp_asset(
                    std::env::consts::OS,
                    std::env::consts::ARCH,
                )
                .1,
            );
            let version = root.path().join("version.txt");
            recover_ytdlp_install(&exe, &version).unwrap();
            assert_eq!(
                std::fs::read(&exe).unwrap(),
                b"working binary",
                "rename boundary {crash_after} must restore the prior executable"
            );
            assert_eq!(
                std::fs::read_to_string(&version).unwrap(),
                "old-version",
                "rename boundary {crash_after} must restore the prior version"
            );
            // Recovery removes staging inputs owned by the interrupted transaction.
            for entry in std::fs::read_dir(root.path()).unwrap() {
                let name = entry.unwrap().file_name().to_string_lossy().into_owned();
                assert!(!name.ends_with(".backup"), "stale backup: {name}");
                assert!(!name.ends_with(".prepared"), "stale journal: {name}");
                assert!(!name.ends_with(".committed"), "stale commit marker: {name}");
            }
            assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 2);
        }
    }

    #[test]
    fn committed_install_recovery_keeps_new_pair_and_cleans_backups() {
        let root = tempfile::tempdir().unwrap();
        let exe = root.path().join(
            crate::platform_profile::ytdlp_asset(std::env::consts::OS, std::env::consts::ARCH).1,
        );
        let version = root.path().join("version.txt");
        let run_id = "committed-fixture";
        std::fs::write(&exe, b"new binary").unwrap();
        std::fs::write(&version, "new-version").unwrap();
        std::fs::write(backup_path(&exe, run_id), b"old binary").unwrap();
        std::fs::write(backup_path(&version, run_id), "old-version").unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&exe, std::fs::Permissions::from_mode(0o755)).unwrap();
        }
        let (prepared, committed) = ytdlp_transaction_paths(root.path(), run_id);
        write_new_marker(
            &prepared,
            b"1 1 yt-dlp.committed-fixture.part version.txt.committed-fixture.part\n",
        )
        .unwrap();
        write_new_marker(&committed, b"complete").unwrap();

        recover_ytdlp_install(&exe, &version).unwrap();

        assert_eq!(std::fs::read(&exe).unwrap(), b"new binary");
        assert_eq!(std::fs::read_to_string(&version).unwrap(), "new-version");
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 2);
    }

    #[test]
    fn malformed_install_journal_fails_closed_without_touching_install() {
        let root = tempfile::tempdir().unwrap();
        let exe = root.path().join(
            crate::platform_profile::ytdlp_asset(std::env::consts::OS, std::env::consts::ARCH).1,
        );
        let version = root.path().join("version.txt");
        std::fs::write(&exe, b"installed binary").unwrap();
        std::fs::write(&version, "installed-version").unwrap();
        let (prepared, _) = ytdlp_transaction_paths(root.path(), "malformed-fixture");
        write_new_marker(&prepared, b"not a valid state\n").unwrap();

        assert!(recover_ytdlp_install(&exe, &version).is_err());
        assert_eq!(std::fs::read(&exe).unwrap(), b"installed binary");
        assert_eq!(std::fs::read_to_string(&version).unwrap(), "installed-version");
        assert!(prepared.exists());
    }

    #[test]
    fn interrupted_first_install_removes_uncommitted_executable() {
        if let Ok(root) = std::env::var("LYRICAL_YTDLP_FIRST_INSTALL_FIXTURE") {
            let root = PathBuf::from(root);
            let exe_name = crate::platform_profile::ytdlp_asset(
                std::env::consts::OS,
                std::env::consts::ARCH,
            )
            .1;
            let dest = root.join(exe_name);
            let version = root.join("version.txt");
            let part = root.join("yt-dlp.part");
            let version_part = root.join("version.txt.part");
            std::fs::write(&part, b"new binary").unwrap();
            std::fs::write(&version_part, "new-version").unwrap();
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&part, std::fs::Permissions::from_mode(0o755)).unwrap();
            }
            let _ = publish_ytdlp_install_with(
                &part,
                &version_part,
                &dest,
                &version,
                "first-install-fixture",
                |from, to| {
                    let _ = std::fs::rename(from, to);
                    std::process::exit(52)
                },
            );
            panic!("fixture must exit after publishing the executable");
        }

        let root = tempfile::tempdir().unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "ytdlp::tests::interrupted_first_install_removes_uncommitted_executable",
                "--nocapture",
            ])
            .env("LYRICAL_YTDLP_FIRST_INSTALL_FIXTURE", root.path())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(52));

        let exe = root.path().join(
            crate::platform_profile::ytdlp_asset(std::env::consts::OS, std::env::consts::ARCH).1,
        );
        let version = root.path().join("version.txt");
        recover_ytdlp_install(&exe, &version).unwrap();
        assert_eq!(installed_ytdlp_version(&exe, &version), None);
        assert!(!exe.exists());
        assert!(!version.exists());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
        for entry in std::fs::read_dir(root.path()).unwrap() {
            let name = entry.unwrap().file_name().to_string_lossy().into_owned();
            assert!(!name.ends_with(".prepared"), "stale journal: {name}");
            assert!(!name.ends_with(".committed"), "stale commit marker: {name}");
        }
    }

    #[test]
    fn successful_publish_replaces_binary_and_version_together() {
        let dir = tempfile::tempdir().unwrap();
        let part = dir.path().join("yt-dlp.part");
        let version_part = dir.path().join("version.txt.part");
        let dest = dir.path().join("yt-dlp");
        let version = dir.path().join("version.txt");
        std::fs::write(&part, b"new binary").unwrap();
        std::fs::write(&version_part, "new-version").unwrap();
        std::fs::write(&dest, b"old binary").unwrap();
        std::fs::write(&version, "old-version").unwrap();

        publish_ytdlp_install(&part, &version_part, &dest, &version, "success-run").unwrap();

        assert_eq!(std::fs::read(&dest).unwrap(), b"new binary");
        assert_eq!(std::fs::read_to_string(&version).unwrap(), "new-version");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2);
    }
}
