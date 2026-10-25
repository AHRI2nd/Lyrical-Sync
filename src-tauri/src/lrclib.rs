use serde::Deserialize;
use std::collections::VecDeque;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Arc, Mutex,
};
use std::time::{Duration, Instant};

#[derive(Deserialize)]
struct LrclibChallenge {
    prefix: String,
    target: String,
}

#[derive(Default)]
struct PublishInner {
    active: Option<(String, Arc<AtomicBool>)>,
    cancelled: VecDeque<String>,
}
#[derive(Default)]
pub struct PublishState {
    inner: Mutex<PublishInner>,
}
struct PublishRun<'a> {
    state: &'a PublishState,
    id: String,
    cancel: Arc<AtomicBool>,
}
impl PublishState {
    fn begin(&self, id: String) -> Result<PublishRun<'_>, String> {
        if id.is_empty()
            || id.len() > 64
            || !id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
        {
            return Err("Invalid publish operation ID".into());
        }
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some(index) = inner.cancelled.iter().position(|value| value == &id) {
            inner.cancelled.remove(index);
            return Err(
                "Publishing cancelled; an already submitted request may still be accepted.".into(),
            );
        }
        if inner.active.is_some() {
            return Err("A publish operation is still running or cancelling".into());
        }
        let cancel = Arc::new(AtomicBool::new(false));
        inner.active = Some((id.clone(), cancel.clone()));
        Ok(PublishRun {
            state: self,
            id,
            cancel,
        })
    }
    fn cancel(&self, id: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((active_id, cancel)) = &inner.active {
            if active_id == id {
                cancel.store(true, Ordering::Relaxed);
                return;
            }
        }
        // IPC cancellation can arrive before its publish future is first polled.
        // Retain a bounded set of operation IDs without cancelling a newer run.
        if id.len() <= 64 && !inner.cancelled.iter().any(|value| value == id) {
            inner.cancelled.push_back(id.into());
            if inner.cancelled.len() > 64 {
                inner.cancelled.pop_front();
            }
        }
    }
}
impl Drop for PublishRun<'_> {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        let mut inner = self.state.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.active.as_ref().is_some_and(|(id, _)| id == &self.id) {
            inner.active = None;
        }
    }
}

fn parse_target(value: &str) -> Result<[u8; 32], String> {
    if value.len() != 64 || !value.bytes().all(|b| b.is_ascii_hexdigit()) {
        return Err("Invalid LRCLIB proof-of-work target".into());
    }
    let mut result = [0; 32];
    for (index, byte) in result.iter_mut().enumerate() {
        *byte =
            u8::from_str_radix(&value[index * 2..index * 2 + 2], 16).map_err(|e| e.to_string())?;
    }
    Ok(result)
}
fn nonce_meets_target(hash: &[u8], target: &[u8]) -> bool {
    hash <= target
}

fn solve_challenge(
    prefix: &str,
    target: &[u8; 32],
    cancel: &AtomicBool,
    budget: Duration,
    attempts: u64,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};
    let started = Instant::now();
    for nonce in 0..attempts {
        if nonce % 256 == 0 {
            if cancel.load(Ordering::Relaxed) {
                return Err("Publishing cancelled".into());
            }
            if started.elapsed() >= budget {
                return Err("LRCLIB proof-of-work budget exceeded; retry later".into());
            }
        }
        if nonce_meets_target(
            &Sha256::digest(format!("{prefix}{nonce}").as_bytes()),
            target,
        ) {
            return Ok(format!("{prefix}:{nonce}"));
        }
    }
    Err("LRCLIB proof-of-work budget exceeded; retry later".into())
}
async fn bounded_request<T>(
    future: impl std::future::Future<Output = Result<T, String>>,
    cancel: &AtomicBool,
    timeout: Duration,
) -> Result<T, String> {
    tokio::pin!(future);
    let deadline = tokio::time::sleep(timeout);
    tokio::pin!(deadline);
    loop {
        if cancel.load(Ordering::Relaxed) {
            return Err(
                "Publishing cancelled; an already submitted request may still be accepted.".into(),
            );
        }
        tokio::select! {
            biased;
            _=&mut deadline=>return Err("LRCLIB request timed out; a submitted request may still be accepted.".into()),
            _=tokio::time::sleep(Duration::from_millis(25))=>{},
            result=&mut future=>return result,
        }
    }
}

#[tauri::command]
pub fn cancel_lrclib_publish(state: tauri::State<'_, PublishState>, run_id: String) {
    state.cancel(&run_id);
}

#[tauri::command]
pub async fn lrclib_publish(
    state: tauri::State<'_, PublishState>,
    run_id: String,
    track_name: String,
    artist_name: String,
    album_name: String,
    duration: f64,
    plain_lyrics: String,
    synced_lyrics: String,
) -> Result<(), String> {
    let run = state.begin(run_id)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(5))
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let ch: LrclibChallenge = bounded_request(
        async {
            let response = client
                .post("https://lrclib.net/api/request-challenge")
                .header("User-Agent", "lyrical-sync")
                .send()
                .await
                .map_err(|e| e.to_string())?
                .error_for_status()
                .map_err(|e| e.to_string())?;
            if response.content_length().is_some_and(|n| n > 8192) {
                return Err("LRCLIB challenge is too large".into());
            }
            let mut response = response;
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
                if bytes.len() + chunk.len() > 8192 {
                    return Err("LRCLIB challenge is too large".into());
                }
                bytes.extend_from_slice(&chunk);
            }
            serde_json::from_slice(&bytes).map_err(|e| e.to_string())
        },
        &run.cancel,
        Duration::from_secs(30),
    )
    .await?;
    if ch.prefix.len() > 1024 {
        return Err("LRCLIB challenge prefix is too large".into());
    }
    let target = parse_target(&ch.target)?;
    let cancel = run.cancel.clone();
    let token = tokio::task::spawn_blocking(move || {
        solve_challenge(
            &ch.prefix,
            &target,
            &cancel,
            Duration::from_secs(30),
            100_000_000,
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    let body = serde_json::json!({"trackName":track_name,"artistName":artist_name,"albumName":album_name,"duration":duration,"plainLyrics":plain_lyrics,"syncedLyrics":synced_lyrics});
    bounded_request(
        async {
            let response = client
                .post("https://lrclib.net/api/publish")
                .header("User-Agent", "lyrical-sync")
                .header("X-Publish-Token", token)
                .json(&body)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !response.status().is_success() {
                return Err(format!("LRCLIB publish failed ({})", response.status()));
            }
            Ok(())
        },
        &run.cancel,
        Duration::from_secs(30),
    )
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_to_bytes_parses_pairs() {
        assert!(parse_target("00ff10").is_err());
    }

    #[test]
    fn nonce_target_comparison() {
        assert!(nonce_meets_target(&[0x00, 0x10], &[0x00, 0x20])); // hash < target
        assert!(!nonce_meets_target(&[0x00, 0x30], &[0x00, 0x20])); // hash > target
        assert!(nonce_meets_target(&[0x00, 0x20], &[0x00, 0x20])); // equal
    }
}

#[cfg(test)]
mod publish_safety_tests {
    use super::*;
    #[test]
    fn malformed_targets_are_not_silently_shortened() {
        for value in ["", "00zzff", "0", &"00".repeat(31), &"00".repeat(33)] {
            assert!(parse_target(value).is_err(), "{value}");
        }
        assert_eq!(parse_target(&"fF".repeat(32)).unwrap(), [255; 32]);
    }
    #[test]
    fn impossible_work_is_cancelled_or_exhausts_a_budget() {
        let cancel = std::sync::atomic::AtomicBool::new(true);
        assert!(solve_challenge(
            "fixture",
            &[0; 32],
            &cancel,
            std::time::Duration::from_secs(1),
            1000
        )
        .unwrap_err()
        .contains("cancel"));
        cancel.store(false, std::sync::atomic::Ordering::Relaxed);
        assert!(solve_challenge(
            "fixture",
            &[0; 32],
            &cancel,
            std::time::Duration::from_secs(1),
            2
        )
        .unwrap_err()
        .contains("budget"));
        assert!(solve_challenge(
            "fixture",
            &[0; 32],
            &cancel,
            std::time::Duration::ZERO,
            1000
        )
        .unwrap_err()
        .contains("budget"));
        assert_eq!(
            solve_challenge(
                "fixture",
                &[255; 32],
                &cancel,
                std::time::Duration::from_secs(1),
                1000
            )
            .unwrap(),
            "fixture:0"
        );
    }
    #[test]
    fn cancellation_before_start_and_stale_cancellation_are_scoped() {
        let state = PublishState::default();
        state.cancel("first");
        assert!(state.begin("first".into()).is_err());
        let active = state.begin("second".into()).unwrap();
        state.cancel("first");
        assert!(!active.cancel.load(std::sync::atomic::Ordering::Relaxed));
        assert!(state.begin("third".into()).is_err());
        state.cancel("second");
        assert!(active.cancel.load(std::sync::atomic::Ordering::Relaxed));
        drop(active);
        assert!(state.begin("third".into()).is_ok());
    }
    #[tokio::test]
    async fn stalled_network_work_observes_cancellation_and_deadline() {
        let cancelled = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let trigger = cancelled.clone();
        tokio::spawn(async move {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
            trigger.store(true, std::sync::atomic::Ordering::Relaxed);
        });
        let result = bounded_request(
            std::future::pending::<Result<(), String>>(),
            &cancelled,
            std::time::Duration::from_secs(2),
        )
        .await;
        assert!(result.unwrap_err().contains("cancel"));
        let fresh = std::sync::atomic::AtomicBool::new(false);
        let result = bounded_request(
            std::future::pending::<Result<(), String>>(),
            &fresh,
            std::time::Duration::from_millis(10),
        )
        .await;
        assert!(result.unwrap_err().contains("timed out"));
    }
    #[test]
    fn a_running_pow_worker_exits_after_cancellation() {
        let flag = Arc::new(AtomicBool::new(false));
        let worker_flag = flag.clone();
        let worker = std::thread::spawn(move || {
            solve_challenge(
                "fixture",
                &[0; 32],
                &worker_flag,
                Duration::from_secs(2),
                100_000_000,
            )
        });
        std::thread::sleep(Duration::from_millis(10));
        let start = Instant::now();
        flag.store(true, Ordering::Relaxed);
        assert!(worker.join().unwrap().unwrap_err().contains("cancel"));
        assert!(start.elapsed() < Duration::from_secs(1));
    }
}
