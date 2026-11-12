const MAX_AUDIO_RANGE_BYTES: u64 = 1024 * 1024;
const MAX_CONCURRENT_AUDIO_READS: usize = 4;
const MAX_AUDIO_SNAPSHOTS: usize = 1;

use std::collections::HashMap;
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ByteRange {
    start: u64,
    end_inclusive: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct StreamResponsePlan {
    status: u16,
    range: Option<ByteRange>,
    content_length: u64,
    include_body: bool,
}

fn plan_response(
    method: &str,
    range_header: Option<&str>,
    total_length: u64,
    max_response_bytes: u64,
) -> Result<StreamResponsePlan, u16> {
    let include_body = match method {
        "GET" => true,
        "HEAD" => false,
        _ => return Err(405_u16),
    };
    if max_response_bytes == 0 || total_length == 0 {
        return Err(416_u16);
    }

    if let Some(range_header) = range_header {
        let range = parse_byte_range(Some(range_header), total_length, max_response_bytes)
            .map_err(|_| 416_u16)?;
        let content_length = range.end_inclusive - range.start + 1;
        return Ok(StreamResponsePlan {
            status: 206,
            range: Some(range),
            content_length,
            include_body,
        });
    }

    if method == "HEAD" {
        return Ok(StreamResponsePlan {
            status: 200,
            range: None,
            content_length: total_length,
            include_body: false,
        });
    }

    if total_length > max_response_bytes {
        return Err(416_u16);
    }
    Ok(StreamResponsePlan {
        status: 200,
        range: Some(ByteRange {
            start: 0,
            end_inclusive: total_length - 1,
        }),
        content_length: total_length,
        include_body,
    })
}

fn read_range<R: Read + Seek>(reader: &mut R, range: ByteRange) -> std::io::Result<Vec<u8>> {
    let length = range.end_inclusive - range.start + 1;
    if length > MAX_AUDIO_RANGE_BYTES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "audio range exceeds response limit",
        ));
    }
    let capacity = usize::try_from(length)
        .map_err(|_| std::io::Error::new(std::io::ErrorKind::InvalidInput, "range too large"))?;
    let mut bytes = Vec::with_capacity(capacity);
    reader.seek(SeekFrom::Start(range.start))?;
    reader.take(length).read_to_end(&mut bytes)?;
    if bytes.len() != capacity {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "audio snapshot changed while streaming",
        ));
    }
    Ok(bytes)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AudioStreamDescriptor {
    pub stream_url: String,
    pub content_type: String,
    pub file_bytes: u64,
    pub duration_seconds: u64,
    pub sample_rate: u32,
    pub channels: u8,
}

struct AudioStreamEntry {
    snapshot: Mutex<tempfile::NamedTempFile>,
    _snapshot_permit: tokio::sync::OwnedSemaphorePermit,
    file_bytes: u64,
    content_type: String,
    revoked: AtomicBool,
}

#[derive(Default)]
struct AudioStreamRegistry {
    entries: HashMap<String, Arc<AudioStreamEntry>>,
}

#[derive(Default)]
struct PreparationInner {
    active: Option<(String, Arc<AtomicBool>)>,
    pending_cancellations: std::collections::VecDeque<String>,
}

#[derive(Default)]
struct PreparationState {
    inner: Mutex<PreparationInner>,
    completed: tokio::sync::Notify,
}

#[derive(Clone)]
pub struct AudioStreamState {
    registry: Arc<Mutex<AudioStreamRegistry>>,
    preparations: Arc<PreparationState>,
    read_permits: Arc<tokio::sync::Semaphore>,
    snapshot_permits: Arc<tokio::sync::Semaphore>,
}

impl Default for AudioStreamState {
    fn default() -> Self {
        Self {
            registry: Arc::default(),
            preparations: Arc::default(),
            read_permits: Arc::new(tokio::sync::Semaphore::new(MAX_CONCURRENT_AUDIO_READS)),
            snapshot_permits: Arc::new(tokio::sync::Semaphore::new(MAX_AUDIO_SNAPSHOTS)),
        }
    }
}

pub struct AudioPreparationRun {
    state: Arc<PreparationState>,
    id: String,
    cancel: Arc<AtomicBool>,
}

impl AudioStreamState {
    pub(crate) fn try_acquire_read(&self) -> Option<tokio::sync::OwnedSemaphorePermit> {
        self.read_permits.clone().try_acquire_owned().ok()
    }

    pub(crate) fn try_acquire_snapshot(&self) -> Option<tokio::sync::OwnedSemaphorePermit> {
        self.snapshot_permits.clone().try_acquire_owned().ok()
    }

    pub(crate) fn busy_response() -> tauri::http::Response<Vec<u8>> {
        empty_response(tauri::http::StatusCode::SERVICE_UNAVAILABLE, None, None)
    }

    pub fn begin_preparation(&self, id: String) -> Result<AudioPreparationRun, String> {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("Invalid audio preparation ID".into());
        }
        let mut inner = self
            .preparations
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if inner.active.is_some() {
            return Err("Audio preparation is still running or cancelling".into());
        }
        let cancelled_early = inner
            .pending_cancellations
            .iter()
            .any(|pending| pending == &id);
        inner.pending_cancellations.retain(|pending| pending != &id);
        let cancel = Arc::new(AtomicBool::new(cancelled_early));
        inner.active = Some((id.clone(), cancel.clone()));
        Ok(AudioPreparationRun {
            state: self.preparations.clone(),
            id,
            cancel,
        })
    }

    pub fn cancel_preparation(&self, id: &str) {
        let mut inner = self
            .preparations
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if let Some((active_id, cancel)) = &inner.active {
            if active_id == id {
                cancel.store(true, Ordering::Release);
                return;
            }
        }
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || inner
                .pending_cancellations
                .iter()
                .any(|pending| pending == id)
        {
            return;
        }
        if inner.pending_cancellations.len() == 64 {
            inner.pending_cancellations.pop_front();
        }
        inner.pending_cancellations.push_back(id.to_owned());
    }

    pub async fn cancel_preparation_and_wait(&self, id: &str) {
        self.cancel_preparation(id);
        loop {
            let notified = self.preparations.completed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let active = self
                .preparations
                .inner
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .active
                .as_ref()
                .is_some_and(|(active_id, _)| active_id == id);
            if !active {
                return;
            }
            notified.await;
        }
    }
}

impl AudioPreparationRun {
    pub fn is_cancelled(&self) -> bool {
        self.cancel.load(Ordering::Acquire)
    }

    pub fn check_cancelled(&self) -> Result<(), String> {
        if self.is_cancelled() {
            Err("cancelled".into())
        } else {
            Ok(())
        }
    }
}

impl Drop for AudioPreparationRun {
    fn drop(&mut self) {
        let mut inner = self
            .state
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if inner.active.as_ref().is_some_and(|(id, _)| id == &self.id) {
            inner.active = None;
        }
        drop(inner);
        self.state.completed.notify_waiters();
    }
}

impl AudioStreamState {
    #[cfg(test)]
    pub fn register(
        &self,
        snapshot: tempfile::NamedTempFile,
        info: crate::audio_resource::AudioResourceInfo,
        content_type: String,
    ) -> Result<AudioStreamDescriptor, String> {
        let permit = self
            .try_acquire_snapshot()
            .ok_or("Audio snapshot capacity is full")?;
        self.register_with_permit(snapshot, info, content_type, permit)
    }

    pub(crate) fn register_with_permit(
        &self,
        snapshot: tempfile::NamedTempFile,
        info: crate::audio_resource::AudioResourceInfo,
        content_type: String,
        snapshot_permit: tokio::sync::OwnedSemaphorePermit,
    ) -> Result<AudioStreamDescriptor, String> {
        let file_bytes = snapshot
            .as_file()
            .metadata()
            .map_err(|error| error.to_string())?
            .len();
        if file_bytes == 0 || file_bytes != info.file_bytes {
            return Err("AUDIO_FILE_CHANGED".into());
        }

        let mut registry = self
            .registry
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        registry
            .entries
            .retain(|_, entry| !entry.revoked.load(Ordering::Acquire));
        if registry.entries.len() >= MAX_AUDIO_SNAPSHOTS {
            return Err("Audio stream capacity is full".into());
        }

        let mut token_bytes = [0_u8; 32];
        let token = loop {
            getrandom::fill(&mut token_bytes).map_err(|_| "Audio stream token creation failed")?;
            let candidate = token_bytes
                .iter()
                .map(|byte| format!("{byte:02x}"))
                .collect::<String>();
            if !registry.entries.contains_key(&candidate) {
                break candidate;
            }
        };
        let stream_url = format!("lyrical-audio://localhost/{token}");
        registry.entries.insert(
            token,
            Arc::new(AudioStreamEntry {
                snapshot: Mutex::new(snapshot),
                _snapshot_permit: snapshot_permit,
                file_bytes,
                content_type: content_type.clone(),
                revoked: AtomicBool::new(false),
            }),
        );

        Ok(AudioStreamDescriptor {
            stream_url,
            content_type,
            file_bytes,
            duration_seconds: info.duration_seconds,
            sample_rate: info.sample_rate,
            channels: info.channels,
        })
    }

    pub fn revoke_url(&self, stream_url: &str) -> bool {
        let Some(token) = token_from_url(stream_url) else {
            return false;
        };
        let entry = self
            .registry
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entries
            .remove(token);
        if let Some(entry) = entry {
            entry.revoked.store(true, Ordering::Release);
            true
        } else {
            false
        }
    }

    pub(crate) fn response(
        &self,
        webview_label: &str,
        request: &tauri::http::Request<Vec<u8>>,
    ) -> tauri::http::Response<Vec<u8>> {
        use tauri::http::{header, Response, StatusCode};

        if webview_label != "main" {
            return empty_response(StatusCode::FORBIDDEN, None, None);
        }
        let allowed_host = request
            .uri()
            .host()
            .is_some_and(|host| host == "localhost" || host == "lyrical-audio.localhost");
        if !allowed_host || request.uri().query().is_some() {
            return empty_response(StatusCode::NOT_FOUND, None, None);
        }
        let Some(token) = token_from_uri(request.uri().path()) else {
            return empty_response(StatusCode::NOT_FOUND, None, None);
        };
        let entry = self
            .registry
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .entries
            .get(token)
            .cloned();
        let Some(entry) = entry.filter(|entry| !entry.revoked.load(Ordering::Acquire)) else {
            return empty_response(StatusCode::NOT_FOUND, None, None);
        };
        let range_header = request
            .headers()
            .get(header::RANGE)
            .and_then(|value| value.to_str().ok());
        let plan = match plan_response(
            request.method().as_str(),
            range_header,
            entry.file_bytes,
            MAX_AUDIO_RANGE_BYTES,
        ) {
            Ok(plan) => plan,
            Err(status) => {
                let status = StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_REQUEST);
                let unsatisfied_length =
                    (status == StatusCode::RANGE_NOT_SATISFIABLE).then_some(entry.file_bytes);
                let allow = (status == StatusCode::METHOD_NOT_ALLOWED).then_some("GET, HEAD");
                return empty_response(status, unsatisfied_length, allow);
            }
        };

        let body = if plan.include_body {
            let Some(range) = plan.range else {
                return empty_response(StatusCode::INTERNAL_SERVER_ERROR, None, None);
            };
            let mut snapshot = entry
                .snapshot
                .lock()
                .unwrap_or_else(|error| error.into_inner());
            if entry.revoked.load(Ordering::Acquire) {
                return empty_response(StatusCode::NOT_FOUND, None, None);
            }
            match read_range(snapshot.as_file_mut(), range) {
                Ok(body) => body,
                Err(_) => return empty_response(StatusCode::INTERNAL_SERVER_ERROR, None, None),
            }
        } else {
            Vec::new()
        };
        if entry.revoked.load(Ordering::Acquire) {
            return empty_response(StatusCode::NOT_FOUND, None, None);
        }

        let status = StatusCode::from_u16(plan.status).unwrap_or(StatusCode::BAD_REQUEST);
        let mut builder = Response::builder()
            .status(status)
            .header(header::ACCEPT_RANGES, "bytes")
            .header(header::CONTENT_TYPE, entry.content_type.as_str())
            .header(header::CONTENT_LENGTH, plan.content_length.to_string())
            .header(header::CACHE_CONTROL, "no-store")
            .header("x-content-type-options", "nosniff");
        if let Some(range) = plan.range.filter(|_| plan.status == 206) {
            builder = builder.header(
                header::CONTENT_RANGE,
                format!(
                    "bytes {}-{}/{}",
                    range.start, range.end_inclusive, entry.file_bytes
                ),
            );
        }
        builder.body(body).unwrap_or_else(|_| {
            Response::builder()
                .status(StatusCode::INTERNAL_SERVER_ERROR)
                .body(Vec::new())
                .unwrap()
        })
    }
}

fn token_from_url(stream_url: &str) -> Option<&str> {
    let token = stream_url.strip_prefix("lyrical-audio://localhost/")?;
    if token_from_uri(&format!("/{token}"))? == token {
        Some(token)
    } else {
        None
    }
}

fn token_from_uri(path: &str) -> Option<&str> {
    let token = path.strip_prefix('/')?;
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return None;
    }
    Some(token)
}

fn empty_response(
    status: tauri::http::StatusCode,
    unsatisfied_length: Option<u64>,
    allow: Option<&'static str>,
) -> tauri::http::Response<Vec<u8>> {
    use tauri::http::{header, Response};
    let mut builder = Response::builder()
        .status(status)
        .header(header::CONTENT_LENGTH, "0");
    if let Some(length) = unsatisfied_length {
        builder = builder.header(header::CONTENT_RANGE, format!("bytes */{length}"));
    }
    if let Some(allow) = allow {
        builder = builder.header(header::ALLOW, allow);
    }
    builder.body(Vec::new()).unwrap()
}

pub fn content_type_for_path(path: &std::path::Path) -> String {
    let extension = path
        .extension()
        .and_then(std::ffi::OsStr::to_str)
        .unwrap_or_default()
        .to_ascii_lowercase();
    match extension.as_str() {
        "wav" | "wave" => "audio/wav",
        "aif" | "aiff" | "aifc" => "audio/aiff",
        "flac" => "audio/flac",
        "mp3" => "audio/mpeg",
        "aac" => "audio/aac",
        "m4a" | "mp4" => "audio/mp4",
        "ogg" => "audio/ogg",
        "opus" => "audio/ogg; codecs=opus",
        _ => "application/octet-stream",
    }
    .to_owned()
}

fn parse_byte_range(
    header: Option<&str>,
    total_length: u64,
    max_response_bytes: u64,
) -> Result<ByteRange, &'static str> {
    let header = header.ok_or("missing byte range")?.trim();
    let value = header
        .strip_prefix("bytes=")
        .ok_or("unsupported range unit")?;
    if value.contains(',') || total_length == 0 || max_response_bytes == 0 {
        return Err("invalid byte range");
    }
    let (start, end) = value.split_once('-').ok_or("invalid byte range")?;
    if end.contains('-') {
        return Err("invalid byte range");
    }

    let (start, end_inclusive) = if start.is_empty() {
        let suffix_length = end.parse::<u64>().map_err(|_| "invalid suffix length")?;
        if suffix_length == 0 {
            return Err("empty suffix range");
        }
        let suffix_length = suffix_length.min(max_response_bytes).min(total_length);
        (total_length - suffix_length, total_length - 1)
    } else {
        let start = start.parse::<u64>().map_err(|_| "invalid range start")?;
        if start >= total_length {
            return Err("range starts after end of file");
        }
        let requested_end = if end.is_empty() {
            total_length - 1
        } else {
            end.parse::<u64>().map_err(|_| "invalid range end")?
        };
        if requested_end < start {
            return Err("range end precedes start");
        }
        let cap_end = start
            .checked_add(max_response_bytes - 1)
            .ok_or("range limit overflow")?;
        (start, requested_end.min(total_length - 1).min(cap_end))
    };

    Ok(ByteRange {
        start,
        end_inclusive,
    })
}

#[cfg(test)]
mod tests {
    use super::{
        content_type_for_path, parse_byte_range, plan_response, read_range, token_from_url,
        AudioStreamState, ByteRange, StreamResponsePlan,
    };
    use std::io::Write;

    fn register_test_stream() -> (AudioStreamState, super::AudioStreamDescriptor) {
        let mut snapshot = tempfile::NamedTempFile::new().unwrap();
        snapshot.write_all(b"0123456789").unwrap();
        let state = AudioStreamState::default();
        let descriptor = state
            .register(
                snapshot,
                crate::audio_resource::AudioResourceInfo {
                    file_bytes: 10,
                    duration_seconds: 1,
                    sample_rate: 48_000,
                    channels: 1,
                    estimated_pcm_bytes: 48_000 * 4,
                },
                "audio/wav".into(),
            )
            .unwrap();
        (state, descriptor)
    }

    fn register_bytes(state: &AudioStreamState, bytes: &[u8]) -> super::AudioStreamDescriptor {
        let mut snapshot = tempfile::NamedTempFile::new().unwrap();
        snapshot.write_all(bytes).unwrap();
        state
            .register(
                snapshot,
                crate::audio_resource::AudioResourceInfo {
                    file_bytes: bytes.len() as u64,
                    duration_seconds: 1,
                    sample_rate: 48_000,
                    channels: 1,
                    estimated_pcm_bytes: 48_000 * 4,
                },
                "audio/wav".into(),
            )
            .unwrap()
    }

    #[test]
    fn parses_and_caps_explicit_ranges() {
        assert_eq!(
            parse_byte_range(Some("bytes=2-8"), 10, 4),
            Ok(ByteRange {
                start: 2,
                end_inclusive: 5
            }),
        );
        assert_eq!(
            parse_byte_range(Some("bytes=2-"), 10, 4),
            Ok(ByteRange {
                start: 2,
                end_inclusive: 5
            }),
        );
    }

    #[test]
    fn parses_suffix_ranges_and_caps_them_to_the_response_limit() {
        assert_eq!(
            parse_byte_range(Some("bytes=-4"), 10, 3),
            Ok(ByteRange {
                start: 7,
                end_inclusive: 9
            }),
        );
        assert_eq!(
            parse_byte_range(Some("bytes=-99"), 10, 3),
            Ok(ByteRange {
                start: 7,
                end_inclusive: 9
            }),
        );
    }

    #[test]
    fn rejects_invalid_multiple_and_unsatisfiable_ranges() {
        for header in [
            "bytes=",
            "bytes=-0",
            "bytes=3-2",
            "bytes=0-1,4-5",
            "items=0-1",
            "bytes=18446744073709551616-",
        ] {
            assert!(
                parse_byte_range(Some(header), 10, 4).is_err(),
                "accepted {header}"
            );
        }
        assert!(parse_byte_range(Some("bytes=0-"), 0, 4).is_err());
        assert!(parse_byte_range(Some("bytes=10-"), 10, 4).is_err());
    }

    #[test]
    fn plans_bounded_range_and_small_full_responses() {
        assert_eq!(
            plan_response("GET", Some("bytes=2-8"), 10, 4),
            Ok(StreamResponsePlan {
                status: 206,
                range: Some(ByteRange {
                    start: 2,
                    end_inclusive: 5
                }),
                content_length: 4,
                include_body: true,
            }),
        );
        assert_eq!(
            plan_response("GET", None, 4, 4),
            Ok(StreamResponsePlan {
                status: 200,
                range: Some(ByteRange {
                    start: 0,
                    end_inclusive: 3
                }),
                content_length: 4,
                include_body: true,
            }),
        );
    }

    #[test]
    fn requires_ranges_for_large_files_and_supports_head() {
        assert_eq!(plan_response("GET", None, 10, 4), Err(416));
        assert_eq!(
            plan_response("HEAD", Some("bytes=2-8"), 10, 4),
            Ok(StreamResponsePlan {
                status: 206,
                range: Some(ByteRange {
                    start: 2,
                    end_inclusive: 5
                }),
                content_length: 4,
                include_body: false,
            }),
        );
        assert_eq!(plan_response("POST", None, 10, 4), Err(405));
        assert_eq!(
            plan_response("HEAD", None, 10, 4),
            Ok(StreamResponsePlan {
                status: 200,
                range: None,
                content_length: 10,
                include_body: false,
            }),
        );
    }

    #[test]
    fn reads_only_the_planned_range() {
        let mut bytes = std::io::Cursor::new(b"0123456789".to_vec());
        assert_eq!(
            read_range(
                &mut bytes,
                ByteRange {
                    start: 3,
                    end_inclusive: 6
                }
            )
            .unwrap(),
            b"3456",
        );
    }

    #[test]
    fn serves_only_bounded_ranges_to_the_main_webview() {
        let (state, descriptor) = register_test_stream();
        let request = tauri::http::Request::builder()
            .method("GET")
            .uri(&descriptor.stream_url)
            .header("Range", "bytes=2-8")
            .body(Vec::new())
            .unwrap();

        let response = state.response("main", &request);
        assert_eq!(response.status(), 206);
        assert_eq!(response.body(), b"2345678");
        assert_eq!(response.headers()["content-length"], "7");
        assert_eq!(response.headers()["content-range"], "bytes 2-8/10");

        let denied = state.response("spotify-sdk", &request);
        assert_eq!(denied.status(), 403);
        assert!(denied.body().is_empty());
    }

    #[test]
    fn revocation_makes_future_requests_unavailable() {
        let (state, descriptor) = register_test_stream();
        let request = tauri::http::Request::builder()
            .method("GET")
            .uri(&descriptor.stream_url)
            .header("Range", "bytes=0-1")
            .body(Vec::new())
            .unwrap();
        assert!(state.revoke_url(&descriptor.stream_url));
        assert!(!state.revoke_url(&descriptor.stream_url));
        assert_eq!(state.response("main", &request).status(), 404);
        assert!(!state.revoke_url("https://example.com/audio"));
    }

    #[test]
    fn maps_supported_file_extensions_to_media_types() {
        assert_eq!(
            content_type_for_path(std::path::Path::new("song.mp3")),
            "audio/mpeg"
        );
        assert_eq!(
            content_type_for_path(std::path::Path::new("song.m4a")),
            "audio/mp4"
        );
        assert_eq!(
            content_type_for_path(std::path::Path::new("song.opus")),
            "audio/ogg; codecs=opus"
        );
        assert_eq!(
            content_type_for_path(std::path::Path::new("song.unknown")),
            "application/octet-stream"
        );
    }

    #[test]
    fn refuses_to_register_more_than_one_unrevoked_snapshot() {
        let state = AudioStreamState::default();
        let first = register_bytes(&state, b"first");
        let mut extra = tempfile::NamedTempFile::new().unwrap();
        extra.write_all(b"third").unwrap();
        let result = state.register(
            extra,
            crate::audio_resource::AudioResourceInfo {
                file_bytes: 5,
                duration_seconds: 1,
                sample_rate: 48_000,
                channels: 1,
                estimated_pcm_bytes: 48_000 * 4,
            },
            "audio/wav".into(),
        );
        assert!(result.unwrap_err().contains("capacity"));
        assert!(state.revoke_url(&first.stream_url));
    }

    #[test]
    #[cfg(unix)]
    fn snapshots_are_private_and_deleted_when_revoked() {
        use std::os::unix::fs::PermissionsExt;

        let state = AudioStreamState::default();
        let mut snapshot = tempfile::NamedTempFile::new().unwrap();
        snapshot.write_all(b"private audio").unwrap();
        let path = snapshot.path().to_path_buf();
        assert_eq!(
            snapshot.as_file().metadata().unwrap().permissions().mode() & 0o777,
            0o600
        );
        let descriptor = state
            .register(
                snapshot,
                crate::audio_resource::AudioResourceInfo {
                    file_bytes: 13,
                    duration_seconds: 1,
                    sample_rate: 48_000,
                    channels: 1,
                    estimated_pcm_bytes: 48_000 * 4,
                },
                "audio/wav".into(),
            )
            .unwrap();
        assert!(path.exists());
        assert!(state.revoke_url(&descriptor.stream_url));
        assert!(!path.exists());
    }

    #[test]
    fn releases_disk_capacity_only_after_the_snapshot_owner_is_gone() {
        let state = AudioStreamState::default();
        let first = register_bytes(&state, b"first");
        assert!(state.try_acquire_snapshot().is_none());

        let response_entry = state
            .registry
            .lock()
            .unwrap()
            .entries
            .get(token_from_url(&first.stream_url).unwrap())
            .unwrap()
            .clone();
        assert!(state.revoke_url(&first.stream_url));
        assert!(state.try_acquire_snapshot().is_none());
        drop(response_entry);
        assert!(state.try_acquire_snapshot().is_some());
    }

    #[test]
    fn limits_concurrent_protocol_responses() {
        let state = AudioStreamState::default();
        let permits: Vec<_> = (0..4).map(|_| state.try_acquire_read().unwrap()).collect();
        assert!(state.try_acquire_read().is_none());
        drop(permits);
        assert!(state.try_acquire_read().is_some());
    }

    #[test]
    fn caps_a_large_requested_range_to_one_mebibyte() {
        let state = AudioStreamState::default();
        let bytes = vec![7_u8; 1024 * 1024 + 512];
        let descriptor = register_bytes(&state, &bytes);
        let request = tauri::http::Request::builder()
            .method("GET")
            .uri(&descriptor.stream_url)
            .header("Range", "bytes=0-")
            .body(Vec::new())
            .unwrap();
        let response = state.response("main", &request);
        assert_eq!(response.status(), 206);
        assert_eq!(response.body().len(), 1024 * 1024);
        assert_eq!(
            response.headers()["content-range"],
            "bytes 0-1048575/1049088"
        );
    }

    #[test]
    fn refuses_unknown_hosts_and_reports_unsatisfied_ranges_without_body() {
        let (state, descriptor) = register_test_stream();
        let wrong_host = descriptor
            .stream_url
            .replace("localhost", "attacker.example");
        let request = tauri::http::Request::builder()
            .method("GET")
            .uri(wrong_host)
            .header("Range", "bytes=0-1")
            .body(Vec::new())
            .unwrap();
        assert_eq!(state.response("main", &request).status(), 404);

        let request = tauri::http::Request::builder()
            .method("GET")
            .uri(&descriptor.stream_url)
            .header("Range", "bytes=10-")
            .body(Vec::new())
            .unwrap();
        let response = state.response("main", &request);
        assert_eq!(response.status(), 416);
        assert_eq!(response.headers()["content-range"], "bytes */10");
        assert!(response.body().is_empty());
    }

    #[test]
    fn preparation_cancellation_is_owned_by_the_run_id() {
        let state = AudioStreamState::default();
        state.cancel_preparation("cancel-before-start");
        let cancelled = state
            .begin_preparation("cancel-before-start".into())
            .unwrap();
        assert!(cancelled.is_cancelled());
        drop(cancelled);

        let active = state.begin_preparation("current-run".into()).unwrap();
        state.cancel_preparation("old-run");
        assert!(!active.is_cancelled());
        state.cancel_preparation("current-run");
        assert!(active.is_cancelled());
    }

    #[tokio::test]
    async fn cancellation_waits_until_snapshot_work_releases_its_owner() {
        let state = AudioStreamState::default();
        let active = state.begin_preparation("current-run".into()).unwrap();
        let cancel_state = state.clone();
        let waiter = tokio::spawn(async move {
            cancel_state
                .cancel_preparation_and_wait("current-run")
                .await;
        });
        tokio::task::yield_now().await;
        assert!(active.is_cancelled());
        drop(active);
        waiter.await.unwrap();
    }
}
