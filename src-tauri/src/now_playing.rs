// Windows System Media Transport Controls(SMTC) 연동 — 이 PC에서 재생 중인 미디어
// 세션(Spotify 데스크톱 앱, Apple Music, 브라우저 재생 등)을 소스 앱 무관하게 감지·제어.
// 공식 문서화된 WinRT API(Windows.Media.Control)이며 특별한 권한/매니페스트가 필요 없다.
// 비 Windows 플랫폼에서는 항상 빈 결과를 반환하는 스텁으로 컴파일된다.

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

    pub async fn get_now_playing() -> Result<Option<NowPlayingInfo>, String> {
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

    pub async fn toggle_play_pause() -> Result<(), String> {
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

    pub async fn seek(position_ms: i64) -> Result<(), String> {
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

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::NowPlayingInfo;

    pub async fn get_now_playing() -> Result<Option<NowPlayingInfo>, String> {
        Ok(None)
    }

    pub async fn toggle_play_pause() -> Result<(), String> {
        Err("이 플랫폼에서는 지원하지 않습니다".into())
    }

    pub async fn seek(_position_ms: i64) -> Result<(), String> {
        Err("이 플랫폼에서는 지원하지 않습니다".into())
    }
}

#[tauri::command]
pub async fn get_now_playing() -> Result<Option<NowPlayingInfo>, String> {
    platform::get_now_playing().await
}

#[tauri::command]
pub async fn now_playing_toggle_play_pause() -> Result<(), String> {
    platform::toggle_play_pause().await
}

#[tauri::command]
pub async fn now_playing_seek(position_ms: i64) -> Result<(), String> {
    platform::seek(position_ms).await
}
