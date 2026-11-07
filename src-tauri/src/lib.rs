#[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
compile_error!("Lyrical Sync supports Apple Silicon Macs only; Intel macOS is unsupported.");

mod python_runtime;
mod platform_profile;
#[cfg(any(all(target_os = "windows", target_arch = "aarch64"), test))]
mod arm_ai;
mod alignment_process;
mod atomic_write;
mod audio_resource;
mod batch_output;
mod bookmark;
mod oauth_listener;
mod path_validation;
mod service_auth;
use service_auth::*;
mod now_playing;
use now_playing::*;
mod model_store;
mod models;
use models::*;
mod python_env;
use python_env::*;
mod alignment;
use alignment::*;
mod ytdlp;
use ytdlp::*;
mod lrclib;
use lrclib::*;
use bookmark::{create_security_bookmark, resolve_security_bookmark};

// ─── LRC / audio commands ────────────────────────────────────────

const MAX_LYRIC_FILE_BYTES: u64 = 64 * 1024 * 1024;

fn read_lyric_file(path: &std::path::Path) -> Result<String, String> {
    use std::io::Read;

    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Lyrics path is not a regular file".into());
    }
    if metadata.len() > MAX_LYRIC_FILE_BYTES {
        return Err("LYRIC_RESOURCE_LIMIT".into());
    }
    let mut content = String::new();
    file.take(MAX_LYRIC_FILE_BYTES + 1)
        .read_to_string(&mut content)
        .map_err(|error| error.to_string())?;
    if content.len() as u64 > MAX_LYRIC_FILE_BYTES {
        return Err("LYRIC_RESOURCE_LIMIT".into());
    }
    Ok(content)
}

#[tauri::command]
async fn read_lrc_file(path: String) -> Result<String, String> {
    let path = path_validation::validate_safe_path(&path)?;
    let content = read_lyric_file(&path)?;
    // BOM-less UTF-16LE composed of ASCII code units is valid UTF-8 but
    // contains NUL bytes. Passing it to the LRC/SRT parser would silently
    // produce empty or malformed rows and could overwrite the original file.
    if content.contains('\0') {
        return Err("Unsupported lyric encoding: NUL bytes detected (possible UTF-16); convert a copy to UTF-8 before editing.".into());
    }
    Ok(content)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LrcFileSnapshot {
    content: String,
    sha256: String,
}

#[tauri::command]
async fn read_lrc_file_with_hash(path: String) -> Result<LrcFileSnapshot, String> {
    use sha2::{Digest, Sha256};

    let content = read_lrc_file(path).await?;
    let sha256 = format!("{:x}", Sha256::digest(content.as_bytes()));
    Ok(LrcFileSnapshot { content, sha256 })
}

#[tauri::command]
async fn write_lrc_file(
    path: String,
    content: String,
    source_path: Option<String>,
    expected_sha256: Option<String>,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let target = path_validation::validate_write_path(&path)?;
    let same_source = source_path.as_ref().is_some_and(|source| {
        source == &path || path_validation::validate_safe_path(source)
            .is_ok_and(|canonical_source| canonical_source == target)
    });
    if same_source {
        let expected_sha256 = expected_sha256.ok_or("LYRICS_FILE_CHANGED")?;
        return atomic_write::write_atomic_if_unchanged(
            std::path::Path::new(&target),
            &content,
            &expected_sha256,
        )
        .map_err(|e| e.to_string());
    }
    atomic_write::write_atomic(std::path::Path::new(&target), &content)
        .map_err(|e| e.to_string())?;
    Ok(format!("{:x}", Sha256::digest(content.as_bytes())))
}

#[tauri::command]
async fn write_lrc_file_if_unchanged(
    path: String,
    content: String,
    expected_sha256: String,
) -> Result<String, String> {
    let path = path_validation::validate_write_path(&path)?;
    atomic_write::write_atomic_if_unchanged(
        std::path::Path::new(&path),
        &content,
        &expected_sha256,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<tauri::ipc::Response, String> {
    let path = path_validation::validate_audio_path(&path)?;
    // Return raw bytes through IPC after applying the compressed and decoded-memory limits.
    audio_resource::read_bounded_audio_file(std::path::Path::new(&path))
        .map(|(bytes, _)| tauri::ipc::Response::new(bytes))
}

#[tauri::command]
fn validate_audio_file(path: String) -> Result<audio_resource::AudioResourceInfo, String> {
    let path = path_validation::validate_audio_path(&path)?;
    audio_resource::inspect_audio_file(std::path::Path::new(&path))
}

#[tauri::command]
fn get_audio_file_info(path: String) -> Result<AudioFileInfo, String> {
    let path = path_validation::validate_audio_path(&path)?;
    let meta = std::fs::metadata(&path).map_err(|e| e.to_string())?;
    if !meta.is_file() {
        return Err("Audio path is not a regular file".into());
    }
    let mtime = meta.modified().map_err(|e| e.to_string())?;
    let duration = mtime.duration_since(std::time::UNIX_EPOCH).map_err(|e| e.to_string())?;
    // A string retains nanosecond precision when serialized to JavaScript.
    let mtime = format!("{}.{:09}", duration.as_secs(), duration.subsec_nanos());
    #[cfg(unix)]
    let file_id = {
        use std::os::unix::fs::MetadataExt;
        Some(format!("{}:{}", meta.dev(), meta.ino()))
    };
    #[cfg(not(unix))]
    let file_id: Option<String> = None;
    Ok(AudioFileInfo { size: meta.len(), mtime, file_id })
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AudioFileInfo {
    size: u64,
    mtime: String,
    file_id: Option<String>,
}

fn is_normal_audio_eof(error: &symphonia::core::errors::Error) -> bool {
    matches!(error, symphonia::core::errors::Error::IoError(err)
        if err.kind() == std::io::ErrorKind::UnexpectedEof)
}

fn validate_aiff_container_size(file: &mut std::fs::File) -> Result<(), String> {
    use std::io::{Read, Seek, SeekFrom};

    file.seek(SeekFrom::Start(0)).map_err(|error| error.to_string())?;
    let mut header = [0_u8; 12];
    file.read_exact(&mut header)
        .map_err(|error| format!("Invalid or truncated AIFF header: {error}"))?;
    if &header[..4] != b"FORM" {
        return Ok(()); // Let Symphonia report the unsupported or mismatched format.
    }
    let declared_form_bytes = u32::from_be_bytes(header[4..8].try_into().unwrap()) as u64;
    let declared_file_bytes = declared_form_bytes + 8;
    let actual_file_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    if actual_file_bytes < declared_file_bytes {
        return Err("Truncated AIFF container".into());
    }
    file.seek(SeekFrom::Start(0)).map_err(|error| error.to_string())?;
    Ok(())
}

/// AIFF 등 WebView2 미지원 포맷을 WAV 바이트로 트랜스코딩합니다.
#[tauri::command]
async fn decode_audio_to_wav(path: String) -> Result<tauri::ipc::Response, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > audio_resource::MAX_AUDIO_FILE_BYTES {
        return Err(audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    if std::path::Path::new(&path)
        .extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case("aif") || extension.eq_ignore_ascii_case("aiff"))
    {
        validate_aiff_container_size(&mut file)?;
    }
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
    {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("지원하지 않는 포맷: {e}"))?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("오디오 트랙 없음")?;
    let codec_params = track.codec_params.clone();
    let track_id = track.id;
    let sample_rate = codec_params.sample_rate.ok_or("샘플레이트 없음")?;
    let channels = codec_params.channels.ok_or("채널 정보 없음")?.count();
    let channels_u8 =
        u8::try_from(channels).map_err(|_| audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
    audio_resource::validate_pcm_frames(
        sample_rate,
        channels_u8,
        codec_params.n_frames.unwrap_or(0),
    )?;
    let spec = hound::WavSpec {
        channels: u16::try_from(channels).map_err(|_| "채널 수가 너무 많습니다")?,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("디코더 오류: {e}"))?;

    // 샘플 전체를 별도 Vec에 쌓지 않고 WAV writer에 패킷 단위로 바로 기록해
    // PCM 전체 버퍼와 최종 WAV 버퍼가 동시에 메모리에 존재하는 일을 막습니다.
    let mut output = std::io::Cursor::new(Vec::new());
    let mut writer =
        hound::WavWriter::new(&mut output, spec).map_err(|e| format!("WAV 생성 오류: {e}"))?;

    let mut decoded_frames = 0u64;
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(error) if is_normal_audio_eof(&error) => break,
            Err(error) => return Err(format!("오디오 패킷 읽기 오류: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|e| format!("오디오 디코딩 오류: {e}"))?;
        if decoded.spec().channels.count() != channels {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }
        audio_resource::validate_pcm_frames(
            sample_rate,
            channels_u8,
            u64::try_from(decoded.capacity())
                .map_err(|_| audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?,
        )?;
        let packet_frames = u64::try_from(decoded.frames())
            .map_err(|_| audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        decoded_frames = decoded_frames
            .checked_add(packet_frames)
            .ok_or(audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        audio_resource::validate_pcm_frames(sample_rate, channels_u8, decoded_frames)?;
        let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        buf.copy_interleaved_ref(decoded);
        for &sample in buf.samples() {
            writer
                .write_sample(sample)
                .map_err(|e| format!("WAV 쓰기 오류: {e}"))?;
        }
    }

    writer
        .finalize()
        .map_err(|e| format!("WAV 완료 오류: {e}"))?;
    Ok(tauri::ipc::Response::new(output.into_inner()))
}

#[derive(serde::Serialize)]
struct AudioMetadata {
    title: String,
    artist: String,
    album: String,
}

/// 오디오 파일 태그(ID3/Vorbis/MP4 등)에서 제목·아티스트·앨범을 읽습니다.
/// 태그가 없거나 읽기 실패 시 빈 문자열을 돌려줍니다(프런트에서 빈 필드만 채움).
fn first_nonempty_tag_value<'a>(
    preferred: Option<std::borrow::Cow<'a, str>>,
    remaining: impl IntoIterator<Item = Option<std::borrow::Cow<'a, str>>>,
) -> Option<std::borrow::Cow<'a, str>> {
    preferred
        .filter(|value| !value.trim().is_empty())
        .or_else(|| remaining.into_iter().flatten().find(|value| !value.trim().is_empty()))
}

fn preferred_tag_value(
    primary: Option<std::borrow::Cow<'_, str>>,
    fallback: Option<std::borrow::Cow<'_, str>>,
) -> String {
    primary
        .filter(|value| !value.trim().is_empty())
        .or(fallback)
        .map(|value| value.trim().to_string())
        .unwrap_or_default()
}

#[tauri::command]
fn read_audio_metadata(path: String) -> Result<AudioMetadata, String> {
    use lofty::file::TaggedFileExt;
    use lofty::tag::Accessor;
    if std::fs::metadata(&path).map_err(|e| e.to_string())?.len()
        > audio_resource::MAX_AUDIO_FILE_BYTES
    {
        return Err(audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    let tagged = lofty::read_from_path(&path).map_err(|e| e.to_string())?;
    let tags = tagged.tags();
    let primary = tagged.primary_tag().or_else(|| tags.first());
    Ok(match primary {
        Some(primary) => {
            AudioMetadata {
                title: first_nonempty_tag_value(
                    primary.title(),
                    tags.iter()
                        .filter(|candidate| candidate.tag_type() != primary.tag_type())
                        .map(lofty::tag::Tag::title),
                ).map(|value| value.trim().to_string()).unwrap_or_default(),
                artist: first_nonempty_tag_value(
                    primary.artist(),
                    tags.iter()
                        .filter(|candidate| candidate.tag_type() != primary.tag_type())
                        .map(lofty::tag::Tag::artist),
                ).map(|value| value.trim().to_string()).unwrap_or_default(),
                album: first_nonempty_tag_value(
                    primary.album(),
                    tags.iter()
                        .filter(|candidate| candidate.tag_type() != primary.tag_type())
                        .map(lofty::tag::Tag::album),
                ).map(|value| value.trim().to_string()).unwrap_or_default(),
            }
        },
        None => AudioMetadata {
            title: String::new(),
            artist: String::new(),
            album: String::new(),
        },
    })
}

// ─── Entry point ──────────────────────────────────────────────────────────────

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(DownloadState::default())
        .manage(ModelsDirState::default())
        .manage(AlignmentState::default())
        .manage(YtdlpState::default())
        .manage(lrclib::PublishState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_process::init())
        .setup(|app| {
            // 업데이터는 데스크톱 전용(모바일 타깃엔 없음)
            #[cfg(desktop)]
            app.handle()
                .plugin(tauri_plugin_updater::Builder::new().build())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            read_lrc_file,
            read_lrc_file_with_hash,
            write_lrc_file,
            write_lrc_file_if_unchanged,
            batch_output::write_batch_output,
            read_audio_file,
            validate_audio_file,
            get_audio_file_info,
            decode_audio_to_wav,
            read_audio_metadata,
            set_models_dir_override,
            get_models_dir,
            check_model_files,
            begin_model_download,
            download_model,
            cancel_model_download,
            delete_model_files,
            get_python_env_info,
            download_embedded_python,
            install_python_packages,
            run_alignment,
            cancel_alignment,
            start_oauth_listener,
            cancel_oauth_listener,
            exchange_spotify_token,
            refresh_spotify_token,
            save_refresh_token,
            load_refresh_token,
            clear_refresh_token,
            check_ytdlp,
            download_ytdlp,
            cancel_ytdlp_install,
            ytdlp_load_audio,
            cancel_ytdlp_load,
            lrclib_publish,
            cancel_lrclib_publish,
            get_now_playing,
            now_playing_toggle_play_pause,
            now_playing_seek,
            create_security_bookmark,
            resolve_security_bookmark,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod audio_metadata_fallback_tests {
    use super::{first_nonempty_tag_value, preferred_tag_value};
    use std::borrow::Cow;

    #[test]
    fn fills_missing_or_blank_primary_fields_from_the_secondary_tag() {
        assert_eq!(
            preferred_tag_value(Some(Cow::Borrowed("Primary")), Some(Cow::Borrowed("Secondary"))),
            "Primary",
        );
        assert_eq!(
            preferred_tag_value(None, Some(Cow::Borrowed(" Secondary "))),
            "Secondary",
        );
        assert_eq!(
            preferred_tag_value(Some(Cow::Borrowed("  ")), Some(Cow::Borrowed("Secondary"))),
            "Secondary",
        );
        assert_eq!(preferred_tag_value(None, None), "");
        assert_eq!(
            first_nonempty_tag_value(None, [Some(Cow::Borrowed(" ")), Some(Cow::Borrowed("Third"))]),
            Some(Cow::Borrowed("Third")),
        );
    }
}

#[cfg(test)]
mod audio_decode_tests {
    use super::{is_normal_audio_eof, validate_aiff_container_size};
    use symphonia::core::errors::Error;

    #[test]
    fn truncated_aiff_container_is_rejected_before_packet_eof_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("truncated.aiff");
        let mut bytes = b"FORM".to_vec();
        bytes.extend_from_slice(&16_u32.to_be_bytes()); // Declares 24 total bytes.
        bytes.extend_from_slice(b"AIFF");
        std::fs::write(&path, bytes).unwrap();
        let mut file = std::fs::File::open(path).unwrap();
        assert!(validate_aiff_container_size(&mut file).unwrap_err().contains("Truncated AIFF"));
    }

    #[test]
    fn accepts_an_aiff_container_whose_declared_size_is_present() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("complete.aiff");
        let mut bytes = b"FORM".to_vec();
        bytes.extend_from_slice(&4_u32.to_be_bytes());
        bytes.extend_from_slice(b"AIFF");
        std::fs::write(&path, bytes).unwrap();
        let mut file = std::fs::File::open(path).unwrap();
        assert!(validate_aiff_container_size(&mut file).is_ok());
    }

    #[test]
    fn only_unexpected_eof_is_treated_as_normal_end_of_audio() {
        let eof = Error::IoError(std::io::Error::from(std::io::ErrorKind::UnexpectedEof));
        let permission_error =
            Error::IoError(std::io::Error::from(std::io::ErrorKind::PermissionDenied));
        assert!(is_normal_audio_eof(&eof));
        assert!(!is_normal_audio_eof(&permission_error));
        assert!(!is_normal_audio_eof(&Error::DecodeError("bad packet")));
    }
}

#[cfg(test)]
mod lyric_save_command_tests {
    use super::{
        read_lrc_file, read_lrc_file_with_hash, write_lrc_file, write_lrc_file_if_unchanged,
        MAX_LYRIC_FILE_BYTES,
    };
    use std::fs;

    #[tokio::test]
    async fn command_creates_new_file_then_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("new-lyrics.lrc");
        let path = target.to_str().unwrap().to_string();
        write_lrc_file(path.clone(), "[00:01.00]First".into(), None, None).await.unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "[00:01.00]First");
        write_lrc_file(path.clone(), "[00:02.00]Second".into(), None, None).await.unwrap();
        assert_eq!(read_lrc_file(path).await.unwrap(), "[00:02.00]Second");
    }

    #[tokio::test]
    async fn conditional_save_refuses_external_edits_and_accepts_the_known_version() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("shared.lrc");
        fs::write(&target, "original").unwrap();
        let path = target.to_string_lossy().into_owned();
        let opened = read_lrc_file_with_hash(path.clone()).await.unwrap();
        assert_eq!(opened.content, "original");

        fs::write(&target, "external edit").unwrap();
        let stale = write_lrc_file_if_unchanged(
            path.clone(),
            "app edit".into(),
            opened.sha256,
        )
        .await
        .unwrap_err();
        assert!(stale.contains("LYRICS_FILE_CHANGED"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "external edit");

        let current = read_lrc_file_with_hash(path.clone()).await.unwrap();
        let saved_hash = write_lrc_file_if_unchanged(
            path.clone(),
            "app edit".into(),
            current.sha256,
        )
        .await
        .unwrap();
        assert_eq!(read_lrc_file(path).await.unwrap(), "app edit");
        assert_eq!(saved_hash.len(), 64);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn conditional_saves_through_aliases_reject_stale_revisions() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("song.lrc");
        let alias = dir.path().join("alias.lrc");
        fs::write(&target, "original").unwrap();
        symlink(&target, &alias).unwrap();
        let target_path = target.to_string_lossy().into_owned();
        let alias_path = alias.to_string_lossy().into_owned();
        let opened = read_lrc_file_with_hash(target_path.clone()).await.unwrap();

        write_lrc_file_if_unchanged(
            target_path,
            "first save".into(),
            opened.sha256.clone(),
        )
        .await
        .unwrap();
        let stale = write_lrc_file_if_unchanged(alias_path, "stale save".into(), opened.sha256)
            .await
            .unwrap_err();

        assert!(stale.contains("LYRICS_FILE_CHANGED"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "first save");
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn save_as_alias_of_current_file_checks_the_loaded_revision() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("song.lrc");
        let alias = dir.path().join("alias.lrc");
        fs::write(&target, "original").unwrap();
        symlink(&target, &alias).unwrap();
        let source_path = target.to_string_lossy().into_owned();
        let alias_path = alias.to_string_lossy().into_owned();
        let opened = read_lrc_file_with_hash(source_path.clone()).await.unwrap();
        fs::write(&target, "external edit").unwrap();

        let error = write_lrc_file(
            alias_path.clone(),
            "app edit".into(),
            Some(source_path.clone()),
            Some(opened.sha256),
        )
        .await
        .unwrap_err();
        assert!(error.contains("LYRICS_FILE_CHANGED"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "external edit");

        let latest = read_lrc_file_with_hash(source_path.clone()).await.unwrap();
        write_lrc_file(
            alias_path,
            "app edit".into(),
            Some(source_path),
            Some(latest.sha256),
        )
        .await
        .unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "app edit");
    }

    #[tokio::test]
    async fn invalid_new_target_never_changes_original_bytes() {
        let dir = tempfile::tempdir().unwrap();
        let original = dir.path().join("original.lrc");
        fs::write(&original, "original content").unwrap();
        let invalid = dir.path().join("missing-dir").join("draft.lrc");
        assert!(write_lrc_file(invalid.to_string_lossy().into_owned(), "draft".into(), None, None).await.is_err());
        assert_eq!(fs::read_to_string(&original).unwrap(), "original content");
        assert!(!invalid.exists());
    }

    #[tokio::test]
    async fn read_rejects_sparse_lyrics_above_the_byte_budget() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("oversized.lrc");
        let file = fs::File::create(&target).unwrap();
        file.set_len(MAX_LYRIC_FILE_BYTES + 1).unwrap();

        let error = read_lrc_file(target.to_string_lossy().into_owned()).await.unwrap_err();
        assert!(error.contains("LYRIC_RESOURCE_LIMIT"));
        assert_eq!(fs::metadata(&target).unwrap().len(), MAX_LYRIC_FILE_BYTES + 1);
    }

    #[cfg(unix)]
    #[tokio::test]
    async fn read_rejects_a_fifo_without_blocking() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;

        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("lyrics.pipe");
        let path = CString::new(target.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(path.as_ptr(), 0o600) }, 0);

        let error = tokio::time::timeout(
            std::time::Duration::from_secs(1),
            read_lrc_file(target.to_string_lossy().into_owned()),
        )
        .await
        .expect("FIFO read must not block")
        .unwrap_err();
        assert!(error.contains("regular file"));
    }

    #[tokio::test]
    async fn read_rejects_bomless_utf16le_without_modifying_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("utf16-without-bom.srt");
        let source = "1\n00:00:01,000 --> 00:00:02,000\nOriginal";
        let raw: Vec<u8> = source.encode_utf16().flat_map(u16::to_le_bytes).collect();
        fs::write(&target, &raw).unwrap();
        let error = read_lrc_file(target.to_string_lossy().into_owned()).await.unwrap_err();
        assert!(error.contains("Unsupported lyric encoding"), "{error}");
        assert_eq!(fs::read(&target).unwrap(), raw);
    }

    #[tokio::test]
    async fn read_keeps_normal_utf8_lyrics_and_literal_escape_sequences() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("normal.lrc");
        let source = "[00:01.00]한글 日本語 \\0 text";
        fs::write(&target, source).unwrap();
        assert_eq!(read_lrc_file(target.to_string_lossy().into_owned()).await.unwrap(), source);
    }
}

#[cfg(test)]
mod audio_identity_command_tests {
    use super::get_audio_file_info;
    use std::fs;

    #[test]
    fn reports_precise_stable_metadata_for_the_same_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.wav");
        fs::write(&path, b"tiny-audio").unwrap();
        let path = path.to_str().unwrap().to_owned();
        let before = get_audio_file_info(path.clone()).unwrap();
        let after = get_audio_file_info(path).unwrap();
        assert_eq!(before.size, 10);
        assert_eq!(before.mtime, after.mtime);
        assert_eq!(before.file_id, after.file_id);
        let json = serde_json::to_value(&before).unwrap();
        assert!(json["mtime"].is_string());
        assert!(json.get("fileId").is_some());
    }
}
