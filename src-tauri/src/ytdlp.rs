use serde::Serialize;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

pub struct YtdlpState {
    active_cancel: Mutex<Option<Arc<AtomicBool>>>,
    active_install_cancel: Mutex<Option<Arc<AtomicBool>>>,
}

static YTDLP_RUN_COUNTER: AtomicU64 = AtomicU64::new(0);

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
            active_cancel: Mutex::new(None),
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

    fn start_run(&self) -> Result<Arc<AtomicBool>, String> {
        let mut active = self.active_cancel.lock().unwrap_or_else(|e| e.into_inner());
        if active.is_some() {
            return Err("yt-dlp 다운로드가 이미 진행 중입니다".into());
        }
        let flag = Arc::new(AtomicBool::new(false));
        *active = Some(flag.clone());
        Ok(flag)
    }

    fn cancel_active(&self) {
        if let Some(flag) = self
            .active_cancel
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .as_ref()
        {
            flag.store(true, Ordering::Relaxed);
        }
    }

    fn finish_run(&self, flag: &Arc<AtomicBool>) {
        let mut active = self.active_cancel.lock().unwrap_or_else(|e| e.into_inner());
        if active
            .as_ref()
            .is_some_and(|current| Arc::ptr_eq(current, flag))
        {
            *active = None;
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
    let backup_path = |path: &std::path::Path| {
        let name = path.file_name().unwrap_or_default().to_string_lossy();
        path.with_file_name(format!(".{name}.{run_id}.backup"))
    };
    let dest_backup = backup_path(dest);
    let version_backup = backup_path(version);
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

    if had_dest {
        std::fs::rename(dest, &dest_backup)
            .map_err(|e| format!("기존 yt-dlp 실행 파일 백업 실패: {e}"))?;
    }
    if had_version {
        if let Err(error) = std::fs::rename(version, &version_backup) {
            if had_dest {
                let _ = std::fs::rename(&dest_backup, dest);
            }
            return Err(format!("기존 yt-dlp 버전 정보 백업 실패: {error}"));
        }
    }

    let publish_result = std::fs::rename(part, dest)
        .map_err(|e| format!("yt-dlp 설치 파일 확정 실패: {e}"))
        .and_then(|()| {
            std::fs::rename(version_part, version)
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
            if let Err(error) = std::fs::rename(&version_backup, version) {
                rollback_errors.push(format!("기존 버전 정보 복구 실패: {error}"));
            }
        }
        if had_dest {
            if let Err(error) = std::fs::rename(&dest_backup, dest) {
                rollback_errors.push(format!("기존 실행 파일 복구 실패: {error}"));
            }
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

    if had_dest {
        let _ = std::fs::remove_file(dest_backup);
    }
    if had_version {
        let _ = std::fs::remove_file(version_backup);
    }
    Ok(())
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
        let release: serde_json::Value = wait_for_ytdlp_io(release_response.json(), &cancel)
            .await
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
                        file.write_all(&chunk)
                            .await
                            .map_err(|e| format!("yt-dlp 임시 파일 쓰기 실패: {e}"))?;
                        hasher.update(&chunk);
                        downloaded += chunk.len() as u64;
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
        let sums_text = wait_for_ytdlp_io(sums_response.text(), &cancel)
            .await
            .map_err(|e| format!("yt-dlp 체크섬 읽기 실패: {e}"))?;
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
        if name.starts_with(prefix) && !name.ends_with(".part") {
            return Ok(entry.path());
        }
    }
    Err("다운로드된 파일을 찾을 수 없습니다".into())
}

#[tauri::command]
pub async fn ytdlp_load_audio(
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

    let cancel_flag = ytdlp_state.start_run()?;
    let result = ytdlp_load_audio_inner(
        url,
        quality,
        cookies_file,
        proxy,
        app.clone(),
        exe,
        cancel_flag.clone(),
    )
    .await;
    ytdlp_state.finish_run(&cancel_flag);
    result
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

    let format = match quality.as_str() {
        "192" => "bestaudio[abr<=192]/bestaudio/best",
        "128" => "bestaudio[abr<=128]/bestaudio/best",
        _ => "bestaudio/best",
    };

    let mut cmd = tokio::process::Command::new(&exe);
    cmd.arg("--no-playlist")
        .arg("-f")
        .arg(format)
        .arg("-o")
        .arg(&output_tpl)
        .arg("--newline")
        .arg("--no-part");

    if let Some(ref c) = cookies_file {
        if !c.is_empty() {
            cmd.arg("--cookies").arg(c);
        }
    }
    if let Some(ref p) = proxy {
        if !p.is_empty() {
            cmd.arg("--proxy").arg(p);
        }
    }

    cmd.arg("--")
        .arg(&url)
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped());

    #[cfg(target_os = "windows")]
    cmd.creation_flags(0x08000000);

    let mut child = cmd.spawn().map_err(|e| format!("yt-dlp 실행 실패: {e}"))?;
    let stdout = child
        .stdout
        .take()
        .ok_or("yt-dlp stdout를 열 수 없습니다")?;
    let stderr = child
        .stderr
        .take()
        .ok_or("yt-dlp stderr를 열 수 없습니다")?;

    use tokio::io::{AsyncBufReadExt, BufReader};

    // stderr는 실패 원인 파악용으로 병행해서 끝까지 비워야 한다(안 읽으면 파이프가 차서
    // 자식 프로세스가 멈출 수 있음). 마지막 몇 줄만 보관해 에러 메시지에 붙인다.
    let stderr_tail = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let stderr_tail_c = stderr_tail.clone();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let mut tail = stderr_tail_c.lock().unwrap_or_else(|e| e.into_inner());
            tail.push(line);
            if tail.len() > 5 {
                tail.remove(0);
            }
        }
    });

    let mut reader = BufReader::new(stdout).lines();

    let app_c = app.clone();
    let mut dest_path: Option<String> = None;
    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            let _ = child.wait().await;
            let _ = stderr_task.await;
            return Err("cancelled".into());
        }
        match tokio::time::timeout(std::time::Duration::from_millis(100), reader.next_line()).await
        {
            Err(_) => continue,
            Ok(Ok(Some(line))) => {
                if let Some(p) = line.strip_prefix("[download] Destination: ") {
                    dest_path = Some(p.trim().to_string());
                } else if let Some(p) = line.strip_prefix("[Merger] Merging formats into \"") {
                    dest_path = Some(p.trim_end_matches('"').to_string());
                }
                if let Some(progress) = parse_ytdlp_progress(&line) {
                    let _ = app_c.emit("ytdlp-audio-progress", &progress);
                }
            }
            Ok(Ok(None)) => break,
            Ok(Err(e)) => {
                let _ = child.kill().await;
                let _ = child.wait().await;
                let _ = stderr_task.await;
                return Err(e.to_string());
            }
        }
    }

    let status = loop {
        if cancel_flag.load(Ordering::Relaxed) {
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

    let file_path = if let Some(ref p) = dest_path {
        let pb = PathBuf::from(p);
        if pb.exists() {
            pb
        } else {
            find_ytdlp_output(&cache_dir, &ts).await?
        }
    } else {
        find_ytdlp_output(&cache_dir, &ts).await?
    };

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
pub fn cancel_ytdlp_load(ytdlp_state: tauri::State<'_, YtdlpState>) {
    ytdlp_state.cancel_active();
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
    fn a_new_download_does_not_clear_an_older_runs_cancel_request() {
        let state = YtdlpState::default();
        let first_run_flag = state.start_run().expect("first run should start");
        first_run_flag.store(true, Ordering::Relaxed);
        state.finish_run(&first_run_flag);

        // A second run gets its own cancellation flag instead of resetting the first one.
        let second_run_flag = state
            .start_run()
            .expect("second run should start after first finishes");

        assert!(first_run_flag.load(Ordering::Relaxed));
        assert!(!second_run_flag.load(Ordering::Relaxed));
    }

    #[test]
    fn a_second_download_cannot_start_until_the_active_child_is_reaped() {
        let state = YtdlpState::default();
        let first_run_flag = state.start_run().expect("first run should start");
        assert!(state.start_run().is_err());
        state.cancel_active();
        assert!(first_run_flag.load(Ordering::Relaxed));
        state.finish_run(&first_run_flag);
        assert!(state.start_run().is_ok());
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
