mod audio_decode;
mod file_access;
mod privacy_policy;
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
    std::fs::write(access.path(), content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_audio_file(path: String, bookmark: Option<String>) -> Result<tauri::ipc::Response, String> {
    // 바이트를 JSON(number[]) 대신 raw 바이너리로 반환 → 대용량 오디오도 빠름
    let access = file_access::FileAccess::open(path, bookmark)?;
    std::fs::read(access.path())
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

/// Convert unsupported WebView2 audio to a binary WAV response without a shared file.
#[tauri::command]
async fn decode_audio_to_wav(path: String, bookmark: Option<String>) -> Result<tauri::ipc::Response, String> {
    // Keep the native read and CPU conversion off the application event loop.
    tauri::async_runtime::spawn_blocking(move || {
        let access = file_access::FileAccess::open(path, bookmark)?;
        let resolved_path = access.path();
        let file = std::fs::File::open(&resolved_path).map_err(|e| e.to_string())?;
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
    let tagged = lofty::read_from_path(access.path()).map_err(|e| e.to_string())?;
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
            read_lrc_file,
            write_lrc_file,
            read_audio_file,
            decode_audio_to_wav,
            read_audio_metadata,
            create_security_bookmark,
            resolve_security_bookmark,
            privacy_policy::open_privacy_policy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
