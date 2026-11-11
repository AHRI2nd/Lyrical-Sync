// 기기에서 재생 중인 미디어(Spotify 데스크톱 앱, Apple Music, 브라우저 재생 등)를
// 소스 앱 무관하게 감지·제어. Windows는 공식 문서화된 WinRT API(Windows.Media.Control),
// macOS는 resources/mediaremote-adapter/에 동봉한 어댑터(아래 macOS 모듈 주석 참고)를 사용.
// 그 외 플랫폼에서는 항상 빈 결과를 반환하는 스텁으로 컴파일된다.

use serde::Serialize;
#[cfg(any(not(target_os = "windows"), test))]
use std::future::Future;
use std::time::Duration;

const DEVICE_COMMAND_TIMEOUT: Duration = Duration::from_secs(5);

#[cfg(any(not(target_os = "windows"), test))]
async fn with_device_timeout<T>(future: impl Future<Output = Result<T, String>>, timeout: Duration) -> Result<T, String> {
    tokio::time::timeout(timeout, future)
        .await
        .map_err(|_| "device_command_timeout".to_string())?
}

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
    last_updated_unix_ms: Option<i64>,
}

#[cfg(test)]
mod tests {
    use super::{
        milliseconds_to_100ns_ticks, milliseconds_to_microseconds, valid_unix_timestamp,
        with_device_timeout,
    };
    use std::time::Duration;

    #[test]
    fn invalid_native_timestamps_are_unknown() {
        assert_eq!(valid_unix_timestamp(0), None);
        assert_eq!(valid_unix_timestamp(-1), None);
        assert_eq!(valid_unix_timestamp(1_700_000_000_000), Some(1_700_000_000_000));
    }

    #[test]
    fn seek_positions_clamp_negative_values_and_reject_overflow() {
        assert_eq!(milliseconds_to_100ns_ticks(-1).unwrap(), 0);
        assert_eq!(
            milliseconds_to_100ns_ticks(i64::MAX / 10_000).unwrap(),
            (i64::MAX / 10_000) * 10_000
        );
        assert_eq!(
            milliseconds_to_100ns_ticks(i64::MAX / 10_000 + 1).unwrap_err(),
            "seek_position_out_of_range"
        );
    }

    #[test]
    fn macos_seek_positions_reject_microsecond_overflow() {
        assert_eq!(milliseconds_to_microseconds(-1).unwrap(), 0);
        assert_eq!(
            milliseconds_to_microseconds(i64::MAX / 1_000).unwrap(),
            (i64::MAX / 1_000) * 1_000
        );
        assert_eq!(
            milliseconds_to_microseconds(i64::MAX / 1_000 + 1).unwrap_err(),
            "seek_position_out_of_range"
        );
    }

    #[tokio::test]
    async fn native_device_operation_has_a_bounded_wait() {
        let result = with_device_timeout(
            std::future::pending::<Result<(), String>>(),
            Duration::from_millis(10),
        )
        .await;
        assert_eq!(result.unwrap_err(), "device_command_timeout");
    }
}

fn valid_unix_timestamp(value: i64) -> Option<i64> {
    (value > 0).then_some(value)
}

#[cfg(any(target_os = "macos", test))]
fn milliseconds_to_microseconds(position_ms: i64) -> Result<i64, String> {
    position_ms
        .max(0)
        .checked_mul(1_000)
        .ok_or_else(|| "seek_position_out_of_range".into())
}

#[cfg(any(target_os = "windows", test))]
fn milliseconds_to_100ns_ticks(position_ms: i64) -> Result<i64, String> {
    position_ms
        .max(0)
        .checked_mul(10_000)
        .ok_or_else(|| "seek_position_out_of_range".into())
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{milliseconds_to_100ns_ticks, valid_unix_timestamp, NowPlayingInfo};
    use crate::device_worker::{run_bounded_worker, ComApartment};
    use tauri::AppHandle;
    use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

    // WinRT DateTime 기준시각(1601-01-01 UTC)과 Unix epoch(1970-01-01 UTC)의 차이(100ns 틱 단위).
    const EPOCH_DIFF_TICKS: i64 = 116_444_736_000_000_000;

    pub async fn get_now_playing(_app: &AppHandle) -> Result<Option<NowPlayingInfo>, String> {
        run_bounded_worker(ComApartment::initialize, || async {
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
            let last_updated_unix_ms = timeline.LastUpdatedTime().ok()
                .map(|d| (d.UniversalTime - EPOCH_DIFF_TICKS) / 10_000)
                .and_then(valid_unix_timestamp);

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
        }, super::DEVICE_COMMAND_TIMEOUT).await
    }

    pub async fn toggle_play_pause(_app: &AppHandle) -> Result<(), String> {
        run_bounded_worker(ComApartment::initialize, || async {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
            let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
            let accepted = session
                .TryTogglePlayPauseAsync()
                .map_err(|e| e.to_string())?
                .await
                .map_err(|e| e.to_string())?;
            if accepted { Ok(()) } else {
                Err("The active media session rejected the play/pause command".into())
            }
        }, super::DEVICE_COMMAND_TIMEOUT).await
    }

    pub async fn seek(_app: &AppHandle, position_ms: i64) -> Result<(), String> {
        let ticks = milliseconds_to_100ns_ticks(position_ms)?;
        run_bounded_worker(ComApartment::initialize, move || async move {
            let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .await
            .map_err(|e| e.to_string())?;
            let session = manager.GetCurrentSession().map_err(|e| e.to_string())?;
            let accepted = session
                .TryChangePlaybackPositionAsync(ticks)
                .map_err(|e| e.to_string())?
                .await
                .map_err(|e| e.to_string())?;
            if accepted { Ok(()) } else {
                Err("The active media session rejected the seek command".into())
            }
        }, super::DEVICE_COMMAND_TIMEOUT).await
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
    use super::{milliseconds_to_microseconds, NowPlayingInfo};
    use serde::Deserialize;
    use std::path::PathBuf;
    use tauri::{AppHandle, Manager};
    use tokio::process::Command;

    const NOW_PLAYING_GET_ARGS: &[&str] = &["get", "--no-artwork"];

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
        if date.len() != 10
            || date.as_bytes().get(4) != Some(&b'-')
            || date.as_bytes().get(7) != Some(&b'-')
        {
            return None;
        }
        let parse_digits = |start: usize, end: usize| -> Option<i64> {
            let digits = date.as_bytes().get(start..end)?;
            if !digits.iter().all(u8::is_ascii_digit) {
                return None;
            }
            std::str::from_utf8(digits).ok()?.parse().ok()
        };
        let year = parse_digits(0, 4)?;
        let month = parse_digits(5, 7)?;
        let day = parse_digits(8, 10)?;
        let (time_main, frac_ms) = match time.split_once('.') {
            Some((t, f)) => {
                if f.is_empty() || f.len() > 9 || !f.bytes().all(|b| b.is_ascii_digit()) {
                    return None;
                }
                let millis_digits = &f[..f.len().min(3)];
                let parsed: i64 = millis_digits.parse().ok()?;
                let millis = if millis_digits.len() < 3 {
                    parsed * 10_i64.pow((3 - millis_digits.len()) as u32)
                } else {
                    parsed
                };
                (t, millis)
            }
            None => (time, 0i64),
        };
        if time_main.len() != 8
            || time_main.as_bytes().get(2) != Some(&b':')
            || time_main.as_bytes().get(5) != Some(&b':')
        {
            return None;
        }
        let parse_time = |start: usize, end: usize| -> Option<i64> {
            let digits = time_main.as_bytes().get(start..end)?;
            if !digits.iter().all(u8::is_ascii_digit) {
                return None;
            }
            std::str::from_utf8(digits).ok()?.parse().ok()
        };
        let hour = parse_time(0, 2)?;
        let min = parse_time(3, 5)?;
        let sec = parse_time(6, 8)?;

        if !(1..=9999).contains(&year)
            || !(1..=12).contains(&month)
            || !(0..=23).contains(&hour)
            || !(0..=59).contains(&min)
            || !(0..=59).contains(&sec)
        {
            return None;
        }
        let leap_year = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
        let days_in_month = match month {
            2 if leap_year => 29,
            2 => 28,
            4 | 6 | 9 | 11 => 30,
            _ => 31,
        };
        if !(1..=days_in_month).contains(&day) {
            return None;
        }

        // Howard Hinnant's days_from_civil algorithm (public domain).
        let y = if month <= 2 { year - 1 } else { year };
        let era = if y >= 0 { y } else { y - 399 } / 400;
        let yoe = y - era * 400;
        let mp = (month + 9) % 12;
        let doy = (153 * mp + 2) / 5 + day - 1;
        let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
        let days = era * 146097 + doe - 719468;

        let total_millis = days
            .checked_mul(86_400_000)?
            .checked_add(hour.checked_mul(3_600_000)?)?
            .checked_add(min.checked_mul(60_000)?)?
            .checked_add(sec.checked_mul(1_000)?)?;
        total_millis.checked_add(frac_ms)
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
            .kill_on_drop(true)
            .arg(&script)
            .arg(&framework)
            .args(args)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        adapter_stdout(output)
    }

    fn adapter_stdout(output: std::process::Output) -> Result<String, String> {
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            if !stderr.is_empty() {
                return Err(stderr);
            }
            return Err(format!("MediaRemote adapter exited with {}", output.status));
        }
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    }

    pub async fn get_now_playing(app: &AppHandle) -> Result<Option<NowPlayingInfo>, String> {
        let stdout = run_adapter(app, NOW_PLAYING_GET_ARGS).await?;
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
        // timestamp가 유효할 때만 보간 앵커로 사용한다.
        let last_updated_unix_ms = info
            .timestamp
            .as_deref()
            .and_then(parse_iso8601_utc_ms)
            .and_then(super::valid_unix_timestamp);

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
        let micros = milliseconds_to_microseconds(position_ms)?;
        let micros_str = micros.to_string();
        run_adapter(app, &["seek", &micros_str]).await.map(|_| ())
    }

    #[cfg(test)]
    mod tests {
        use super::{adapter_stdout, parse_iso8601_utc_ms, NOW_PLAYING_GET_ARGS};
        use std::os::unix::process::ExitStatusExt;
        use std::process::{ExitStatus, Output};

        #[test]
        fn adapter_nonzero_exit_propagates_stderr() {
            let result = adapter_stdout(Output {
                status: ExitStatus::from_raw(1 << 8),
                stdout: Vec::new(),
                stderr: b"adapter command rejected".to_vec(),
            });
            assert_eq!(result, Err("adapter command rejected".into()));
        }

        #[test]
        fn adapter_success_returns_trimmed_stdout() {
            let result = adapter_stdout(Output {
                status: ExitStatus::from_raw(0),
                stdout: b"  {\"ok\":true} \n".to_vec(),
                stderr: Vec::new(),
            });
            assert_eq!(result, Ok("{\"ok\":true}".into()));
        }

        #[test]
        fn now_playing_poll_omits_unused_artwork() {
            assert_eq!(NOW_PLAYING_GET_ARGS, &["get", "--no-artwork"]);
        }

        #[test]
        fn timestamp_parser_rejects_out_of_range_calendar_and_clock_fields() {
            for value in [
                "2024-13-01T00:00:00Z",
                "2024-02-30T00:00:00Z",
                "2024-01-01T24:00:00Z",
                "2024-01-01T00:60:00Z",
                "2024-01-01T00:00:60Z",
            ] {
                assert_eq!(parse_iso8601_utc_ms(value), None, "accepted {value}");
            }
        }

        #[test]
        fn timestamp_parser_accepts_leap_days_and_fractional_seconds() {
            assert!(parse_iso8601_utc_ms("2024-02-29T23:59:59.123Z").is_some());
            assert_eq!(parse_iso8601_utc_ms("1970-01-01T00:00:00.1Z"), Some(100));
        }
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
    #[cfg(target_os = "windows")]
    {
        platform::get_now_playing(&app).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        with_device_timeout(platform::get_now_playing(&app), DEVICE_COMMAND_TIMEOUT).await
    }
}

#[tauri::command]
pub async fn now_playing_toggle_play_pause(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        platform::toggle_play_pause(&app).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        with_device_timeout(platform::toggle_play_pause(&app), DEVICE_COMMAND_TIMEOUT).await
    }
}

#[tauri::command]
pub async fn now_playing_seek(position_ms: i64, app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        platform::seek(&app, position_ms).await
    }
    #[cfg(not(target_os = "windows"))]
    {
        with_device_timeout(platform::seek(&app, position_ms), DEVICE_COMMAND_TIMEOUT).await
    }
}
