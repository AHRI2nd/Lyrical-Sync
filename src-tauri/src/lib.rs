#[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
compile_error!("Lyrical Sync supports Apple Silicon Macs only; Intel macOS is unsupported.");

mod atomic_write;
mod batch_output;
mod audio_decode;
mod file_access;
mod privacy_policy;
mod third_party_notices;
#[cfg(target_os = "macos")]
mod bookmark;
#[cfg(not(target_os = "macos"))]
#[path = "bookmark_unsupported.rs"]
mod bookmark;
#[cfg(all(windows, feature = "msstore"))]
mod store_runtime;
use bookmark::{create_security_bookmark, resolve_security_bookmark};

// ─── LRC / audio commands ────────────────────────────────────────

#[tauri::command]
async fn read_lrc_file(path: String, bookmark: Option<String>) -> Result<String, String> {
    let access = file_access::FileAccess::open(path, bookmark)?;
    std::fs::read_to_string(access.path()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_lrc_file(path: String, content: String, bookmark: Option<String>) -> Result<(), String> {
    let access = file_access::FileAccess::open(path, bookmark)?;
    atomic_write::write_atomic(&access.path(), &content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_audio_file(path: String, bookmark: Option<String>) -> Result<tauri::ipc::Response, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let access = file_access::FileAccess::open(path, bookmark)?;
        audio_decode::read_bounded_audio_file(&access.path()).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Convert unsupported WebView2 audio to a binary WAV response without a shared file.
#[tauri::command]
async fn decode_audio_to_wav(path: String, bookmark: Option<String>) -> Result<tauri::ipc::Response, String> {
    // Keep the native read and CPU conversion off the application event loop.
    tauri::async_runtime::spawn_blocking(move || {
        let access = file_access::FileAccess::open(path, bookmark)?;
        let resolved_path = access.path();
        let file = audio_decode::open_audio_file(&resolved_path)?;
        if file.metadata().map_err(|e| e.to_string())?.len() > audio_decode::MAX_AUDIO_FILE_BYTES {
            return Err(audio_decode::AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        let extension = resolved_path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("");
        audio_decode::decode_to_wav(Box::new(file), extension).map(tauri::ipc::Response::new)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(serde::Serialize)]
struct AudioMetadata {
    title: String,
    artist: String,
    album: String,
}

/// 오디오 파일 태그(ID3/Vorbis/MP4 등)에서 제목·아티스트·앨범을 읽습니다.
/// 태그가 없거나 읽기 실패 시 빈 문자열을 돌려줍니다(프런트에서 빈 필드만 채움).
#[tauri::command]
fn read_audio_metadata(path: String, bookmark: Option<String>) -> Result<AudioMetadata, String> {
    use lofty::file::TaggedFileExt;
    use lofty::tag::Accessor;
    let access = file_access::FileAccess::open(path, bookmark)?;
    let mut file = audio_decode::open_audio_file(&access.path())?;
    if file
        .metadata()
        .map_err(|error| error.to_string())?
        .len()
        > audio_decode::MAX_AUDIO_FILE_BYTES
    {
        return Err(audio_decode::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    let tagged = lofty::read_from(&mut file).map_err(|e| e.to_string())?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let s = |o: Option<std::borrow::Cow<str>>| o.map(|c| c.trim().to_string()).unwrap_or_default();
    Ok(match tag {
        Some(t) => AudioMetadata { title: s(t.title()), artist: s(t.artist()), album: s(t.album()) },
        None => AudioMetadata { title: String::new(), artist: String::new(), album: String::new() },
    })
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(all(windows, feature = "msstore"))]
    store_runtime::configure().expect("packaged WebView2 runtime is missing or invalid");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::Builder::new().open_js_links_on_click(false).build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            file_access::prepare_file_ref,
            batch_output::write_batch_output,
            read_lrc_file,
            write_lrc_file,
            read_audio_file,
            decode_audio_to_wav,
            read_audio_metadata,
            create_security_bookmark,
            resolve_security_bookmark,
            privacy_policy::open_privacy_policy,
            privacy_policy::open_microsoft_privacy_policy,
            third_party_notices::read_third_party_notices,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn metadata_lookup_still_reads_tags_from_a_normal_sized_file() {
        use lofty::file::{AudioFile, TaggedFileExt};
        use lofty::tag::{ItemKey, Tag, TagType};

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tagged.wav");
        let mut writer = hound::WavWriter::create(
            &path,
            hound::WavSpec {
                channels: 1,
                sample_rate: 8_000,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            },
        )
        .unwrap();
        writer.write_sample(1_i16).unwrap();
        writer.finalize().unwrap();
        let mut tagged = lofty::read_from_path(&path).unwrap();
        let mut tag = Tag::new(TagType::Id3v2);
        tag.insert_text(ItemKey::TrackTitle, "Example title".into());
        tagged.insert_tag(tag);
        tagged
            .save_to_path(&path, lofty::config::WriteOptions::default())
            .unwrap();

        let metadata = read_audio_metadata(path.to_string_lossy().into_owned(), None).unwrap();

        assert_eq!(metadata.title, "Example title");
    }

    #[test]
    fn metadata_lookup_returns_an_error_for_a_truncated_tag() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("truncated.mp3");
        std::fs::write(&path, b"ID3\x04\0\0\0\0\x7f\x7f").unwrap();

        assert!(read_audio_metadata(path.to_string_lossy().into_owned(), None).is_err());
    }

    #[test]
    fn metadata_lookup_rejects_oversized_audio_before_tag_parsing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("oversized.mp3");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(audio_decode::MAX_AUDIO_FILE_BYTES + 1)
            .unwrap();

        let result = read_audio_metadata(path.to_string_lossy().into_owned(), None);
        assert!(matches!(
            result,
            Err(error) if error == audio_decode::AUDIO_RESOURCE_LIMIT_ERROR
        ));
    }

    #[test]
    #[cfg(target_os = "macos")]
    fn metadata_lookup_rejects_fifo_without_blocking() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::sync::mpsc;
        use std::time::Duration;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.pipe");
        let c_path = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);

        let metadata_path = path.to_string_lossy().into_owned();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let _ = tx.send(read_audio_metadata(metadata_path, None));
        });
        let result = rx
            .recv_timeout(Duration::from_secs(1))
            .expect("metadata lookup must not block on a FIFO");

        assert!(matches!(result, Err(error) if error.contains("regular file")));
    }
}
