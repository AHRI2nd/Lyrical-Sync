use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use serde::Serialize;

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
pub async fn download_ytdlp(app: AppHandle) -> Result<(), String> {
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
    let stderr = child.stderr.take().unwrap();

    use tokio::io::{AsyncBufReadExt, BufReader};

    // stderr는 실패 원인 파악용으로 병행해서 끝까지 비워야 한다(안 읽으면 파이프가 차서
    // 자식 프로세스가 멈출 수 있음). 마지막 몇 줄만 보관해 에러 메시지에 붙인다.
    let stderr_tail = std::sync::Arc::new(std::sync::Mutex::new(Vec::<String>::new()));
    let stderr_tail_c = stderr_tail.clone();
    let stderr_task = tokio::spawn(async move {
        let mut reader = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = reader.next_line().await {
            let mut tail = stderr_tail_c.lock().unwrap();
            tail.push(line);
            if tail.len() > 5 { tail.remove(0); }
        }
    });

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
    let _ = stderr_task.await;

    if cancel_flag.load(Ordering::Relaxed) {
        let _ = tokio::fs::remove_dir_all(&cache_dir).await;
        return Err("cancelled".into());
    }
    if !status.success() {
        let detail = stderr_tail.lock().unwrap().join(" / ");
        return Err(if detail.is_empty() {
            format!("yt-dlp 오류 (종료 코드 {:?})", status.code())
        } else {
            format!("yt-dlp 오류 (종료 코드 {:?}): {detail}", status.code())
        });
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
pub fn cancel_ytdlp_load(ytdlp_state: tauri::State<'_, YtdlpState>) {
    ytdlp_state.cancel_flag.store(true, Ordering::Relaxed);
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
}
