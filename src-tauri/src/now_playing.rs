// 기기에서 재생 중인 미디어(Spotify 데스크톱 앱, Apple Music, 브라우저 재생 등)를
// 소스 앱 무관하게 감지·제어. Windows는 공식 문서화된 WinRT API(Windows.Media.Control),
// macOS는 resources/mediaremote-adapter/에 동봉한 어댑터(아래 macOS 모듈 주석 참고)를 사용.
// 그 외 플랫폼에서는 항상 빈 결과를 반환하는 스텁으로 컴파일된다.

use serde::Serialize;

#[derive(Serialize, Clone)]
pub struct NowPlayingInfo {
    title: String,
    artist: String,
    album: String,
    position_ms: i64,
    duration_ms: i64,
    is_playing: bool,
    source_app: String,
    /// Unix epoch(ms) 기준 timeline 마지막 갱신 시각 — 프런트엔드가 Date.now() 기준으로
    /// 보간(interpolation)할 때 앵커로 사용(Spotify 모드와 동일한 기법).
    last_updated_unix_ms: i64,
}

#[cfg(target_os = "windows")]
mod platform {
    use super::NowPlayingInfo;
    use tauri::AppHandle;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;
    use windows::Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED};

    // WinRT DateTime 기준시각(1601-01-01 UTC)과 Unix epoch(1970-01-01 UTC)의 차이(100ns 틱 단위).
    const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

    // tokio 워커 스레드는 기본적으로 COM이 초기화돼 있지 않아 WinRT 호출 전 필요할 수 있음.
    // 이미 초기화된 스레드에서 다시 불러도 안전(실패는 무시 — 대개 "이미 초기화됨" 의미).
    fn ensure_com_initialized() {
        unsafe {
            let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        }
    }

    pub async fn get_now_playing(_app: &AppHandle) -> Result<Option<NowPlayingInfo>, String> {
        ensure_com_initialized();

        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;

        let session = match manager.GetCurrentSession() {
            Ok(s) => s,
            Err(_) => return Ok(None), // 활성 세션 없음
        };

        let media_props = session
            .TryGetMediaPropertiesAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;

        let title = media_props.Title().map(|s| s.to_string()).unwrap_or_default();
        let artist = media_props.Artist().map(|s| s.to_string()).unwrap_or_default();
        let album = media_props.AlbumTitle().map(|s| s.to_string()).unwrap_or_default();

        // 제목·아티스트 둘 다 비었으면 실질적으로 "재생 중인 게 없음"으로 간주
        if title.is_empty() && artist.is_empty() {
            return Ok(None);
        }

        let timeline = session.GetTimelineProperties().map_err(|e| e.to_string())?;
        let playback_info = session.GetPlaybackInfo().map_err(|e| e.to_string())?;

        let position_ticks = timeline.Position().map(|t| t.Duration).unwrap_or(0);
        let end_ticks = timeline.EndTime().map(|t| t.Duration).unwrap_or(0);
        let last_updated_ticks = timeline.LastUpdatedTime().map(|d| d.UniversalTime).unwrap_or(0);
        let last_updated_unix_ms = (last_updated_ticks - EPOCH_DIFF_TICKS) / 10_000;

        let status_raw = playback_info.PlaybackStatus().map(|s| s.0).unwrap_or(0);
        let is_playing = status_raw == 4; // GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing

        let source_app = session.SourceAppUserModelId().map(|s| s.to_string()).unwrap_or_default();

        Ok(Some(NowPlayingInfo {
            title,
            artist,
            album,
            position_ms: position_ticks / 10_000,
            duration_ms: end_ticks / 10_000,
            is_playing,
            source_app,
            last_updated_unix_ms,
        }))
    }

    pub async fn toggle_play_pause(_app: &AppHandle) -> Result<(), String> {
        ensure_com_initialized();
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
        session
            .TryTogglePlayPauseAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn seek(_app: &AppHandle, position_ms: i64) -> Result<(), String> {
        ensure_com_initialized();
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
        let ticks = position_ms.max(0) * 10_000;
        session
            .TryChangePlaybackPositionAsync(ticks)
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
}

// macOS는 시스템 전역 "지금 재생 중" 정보를 읽는 공식 API가 없다. 비공식 MediaRemote.framework는
// macOS 15.4+부터 서드파티 프로세스의 직접 호출을 막아뒀지만(entitlement 검증 도입),
// 시스템 바이너리 /usr/bin/perl은 Apple 서명 덕에 예외적으로 허용된다. 이 우회 경로를 이용하는
// 오픈소스 어댑터(BSD-3-Clause, https://github.com/ungive/mediaremote-adapter)를
// resources/mediaremote-adapter/에 동봉해 서브프로세스로 호출한다(직접 링크 없음).
// App Store 경량판에서는 비공식 API 우회로 간주돼 리뷰를 통과하지 못하므로 제외 대상.
#[cfg(target_os = "macos")]
mod platform {
    use super::NowPlayingInfo;
    use serde::Deserialize;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use tauri::{AppHandle, Manager};
    use tokio::process::Command;

    #[derive(Deserialize, Default)]
    struct AdapterInfo {
        title: Option<String>,
        artist: Option<String>,
        album: Option<String>,
        #[serde(rename = "elapsedTime")]
        elapsed_time: Option<f64>,
        duration: Option<f64>,
        playing: Option<bool>,
        #[serde(rename = "bundleIdentifier")]
        bundle_identifier: Option<String>,
        /// 이 스냅샷이 실제로 갱신된 시각(ISO 8601, UTC). elapsedTime은 재생 앱이 값을 밀어줄
        /// 때만 갱신되므로(매 폴링마다 새로 계산되는 게 아님) 이 필드로 보간 기준점을 잡아야
        /// 프런트엔드의 "경과 시간 보정" 로직이 올바르게 동작한다(Windows LastUpdatedTime과 동일 역할).
        timestamp: Option<String>,
    }

    /// "YYYY-MM-DDTHH:MM:SS(.fff)?Z" 형식의 UTC 타임스탬프를 Unix epoch ms로 변환.
    /// 외부 crate(chrono 등) 없이 처리하기 위한 최소 파서 — 어댑터 출력 형식이 고정적이라 충분함.
    fn parse_iso8601_utc_ms(s: &str) -> Option<i64> {
        let s = s.strip_suffix('Z')?;
        let (date, time) = s.split_once('T')?;
        let mut date_parts = date.split('-');
        let year: i64 = date_parts.next()?.parse().ok()?;
        let month: i64 = date_parts.next()?.parse().ok()?;
        let day: i64 = date_parts.next()?.parse().ok()?;
        let (time_main, frac_ms) = match time.split_once('.') {
            Some((t, f)) => {
                let padded = format!("{:0<3}", f);
                (t, padded.get(0..3)?.parse().ok()?)
            }
            None => (time, 0i64),
        };
        let mut time_parts = time_main.split(':');
        let hour: i64 = time_parts.next()?.parse().ok()?;
        let min: i64 = time_parts.next()?.parse().ok()?;
        let sec: i64 = time_parts.next()?.parse().ok()?;

        // Howard Hinnant's days_from_civil algorithm (public domain).
        let y = if month <= 2 { year - 1 } else { year };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (month + 9) % 12;
        let doy = (153 * mp + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146097 + doe - 719468;

        let total_seconds = days * 86400 + hour * 3600 + min * 60 + sec;
        Some(total_seconds * 1000 + frac_ms)
    }

    fn adapter_paths(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
        let base = app
            .path()
            .resource_dir()
            .map_err(|e| e.to_string())?
            .join("mediaremote-adapter");
        Ok((
            base.join("mediaremote-adapter.pl"),
            base.join("MediaRemoteAdapter.framework"),
        ))
    }

    async fn run_adapter(app: &AppHandle, args: &[&str]) -> Result<String, String> {
        let (script, framework) = adapter_paths(app)?;
        let output = Command::new("/usr/bin/perl")
            .arg(&script)
            .arg(&framework)
            .args(args)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub async fn get_now_playing(app: &AppHandle) -> Result<Option<NowPlayingInfo>, String> {
        let stdout = run_adapter(app, &["get"]).await?;
        if stdout.is_empty() || stdout == "null" {
            return Ok(None);
        }
        let info: AdapterInfo = serde_json::from_str(&stdout).map_err(|e| e.to_string())?;

        let title = info.title.unwrap_or_default();
        let artist = info.artist.unwrap_or_default();
        // 제목·아티스트 둘 다 비었으면 실질적으로 "재생 중인 게 없음"으로 간주(Windows와 동일 규칙)
        if title.is_empty() && artist.is_empty() {
            return Ok(None);
        }

        // elapsedTime은 재생 앱이 실제로 값을 밀어줄 때만 갱신되므로, 어댑터가 함께 주는
        // timestamp(그 스냅샷이 찍힌 시각)를 그대로 보간 앵커로 써야 한다. 파싱 실패 시에만
        // 현재 시각으로 폴백(약간의 오차는 있어도 완전히 멈추는 것보다는 낫다).
        let last_updated_unix_ms = info
            .timestamp
            .as_deref()
            .and_then(parse_iso8601_utc_ms)
            .unwrap_or_else(|| {
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .map(|d| d.as_millis() as i64)
                    .unwrap_or(0)
            });

        Ok(Some(NowPlayingInfo {
            title,
            artist,
            album: info.album.unwrap_or_default(),
            position_ms: (info.elapsed_time.unwrap_or(0.0) * 1000.0) as i64,
            duration_ms: (info.duration.unwrap_or(0.0) * 1000.0) as i64,
            is_playing: info.playing.unwrap_or(false),
            source_app: info.bundle_identifier.unwrap_or_default(),
            last_updated_unix_ms,
        }))
    }

    pub async fn toggle_play_pause(app: &AppHandle) -> Result<(), String> {
        // MediaRemote command ID 2 = kMRTogglePlayPause
        run_adapter(app, &["send", "2"]).await.map(|_| ())
    }

    pub async fn seek(app: &AppHandle, position_ms: i64) -> Result<(), String> {
        let micros = position_ms.max(0) * 1000;
        let micros_str = micros.to_string();
        run_adapter(app, &["seek", &micros_str]).await.map(|_| ())
    }
}

#[cfg(not(any(target_os = "windows", target_os = "macos")))]
mod platform {
    use super::NowPlayingInfo;
    use tauri::AppHandle;

    pub async fn get_now_playing(_app: &AppHandle) -> Result<Option<NowPlayingInfo>, String> {
        Ok(None)
    }

    pub async fn toggle_play_pause(_app: &AppHandle) -> Result<(), String> {
        Err("이 플랫폼에서는 지원하지 않습니다".into())
    }

    pub async fn seek(_app: &AppHandle, _position_ms: i64) -> Result<(), String> {
        Err("이 플랫폼에서는 지원하지 않습니다".into())
    }
}

#[tauri::command]
pub async fn get_now_playing(app: tauri::AppHandle) -> Result<Option<NowPlayingInfo>, String> {
    platform::get_now_playing(&app).await
}

#[tauri::command]
pub async fn now_playing_toggle_play_pause(app: tauri::AppHandle) -> Result<(), String> {
    platform::toggle_play_pause(&app).await
}

#[tauri::command]
pub async fn now_playing_seek(position_ms: i64, app: tauri::AppHandle) -> Result<(), String> {
    platform::seek(&app, position_ms).await
}
