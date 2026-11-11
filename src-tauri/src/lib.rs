#[cfg(all(target_os = "macos", not(target_arch = "aarch64")))]
compile_error!("Lyrical Sync supports Apple Silicon Macs only; Intel macOS is unsupported.");

mod python_runtime;
mod ai_common;
mod platform_profile;
#[cfg(any(all(target_os = "windows", target_arch = "aarch64"), test))]
mod arm_ai;
mod alignment_process;
mod atomic_write;
mod audio_resource;
mod batch_output;
#[cfg(any(target_os = "windows", test))]
mod device_worker;
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

// ─── LRC / audio commands ────────────────────────────────────────

const MAX_LYRIC_FILE_BYTES: u64 = 64 * 1024 * 1024;

pub(crate) fn authorize_window_path<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    path: &std::path::Path,
) -> Result<(), String> {
    use tauri_plugin_fs::FsExt;
    let scope = window.fs_scope();
    path_validation::require_filesystem_scope(path, |candidate| scope.is_allowed(candidate))
}

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
    let mut bytes = Vec::new();
    file.take(MAX_LYRIC_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_LYRIC_FILE_BYTES {
        return Err("LYRIC_RESOURCE_LIMIT".into());
    }
    if bytes.starts_with(&[0xFF, 0xFE]) || bytes.starts_with(&[0xFE, 0xFF]) || bytes.contains(&0) {
        return Err("Unsupported lyric encoding: UTF-16 is not supported; convert a copy to UTF-8 before editing.".into());
    }
    String::from_utf8(bytes)
        .map_err(|_| "Unsupported lyric encoding: expected UTF-8; convert a copy to UTF-8 before editing.".into())
}

#[tauri::command]
async fn read_lrc_file(path: String, window: tauri::WebviewWindow) -> Result<String, String> {
    let path = path_validation::validate_safe_path(&path)?;
    authorize_window_path(&window, &path)?;
    read_lrc_file_impl(path.to_string_lossy().into_owned()).await
}

async fn read_lrc_file_impl(path: String) -> Result<String, String> {
    let path = path_validation::validate_safe_path(&path)?;
    read_lyric_file(&path)
}

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct LrcFileSnapshot {
    content: String,
    sha256: String,
}

#[tauri::command]
async fn read_lrc_file_with_hash(
    path: String,
    window: tauri::WebviewWindow,
) -> Result<LrcFileSnapshot, String> {
    let canonical = path_validation::validate_safe_path(&path)?;
    authorize_window_path(&window, &canonical)?;
    read_lrc_file_with_hash_impl(canonical.to_string_lossy().into_owned()).await
}

async fn read_lrc_file_with_hash_impl(path: String) -> Result<LrcFileSnapshot, String> {
    use sha2::{Digest, Sha256};

    let content = read_lrc_file_impl(path).await?;
    let sha256 = format!("{:x}", Sha256::digest(content.as_bytes()));
    Ok(LrcFileSnapshot { content, sha256 })
}

#[tauri::command]
async fn write_lrc_file(
    path: String,
    content: String,
    source_path: Option<String>,
    expected_sha256: Option<String>,
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    let target = path_validation::validate_write_path(&path)?;
    authorize_window_path(&window, &target)?;
    write_lrc_file_impl(
        target.to_string_lossy().into_owned(),
        content,
        source_path,
        expected_sha256,
    )
    .await
}

async fn write_lrc_file_impl(
    path: String,
    content: String,
    source_path: Option<String>,
    expected_sha256: Option<String>,
) -> Result<String, String> {
    use sha2::{Digest, Sha256};

    let target = path_validation::validate_write_path(&path)?;
    let same_source = source_path.as_ref().is_some_and(|source| {
        source == &path
            || path_validation::validate_safe_path(source)
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
    window: tauri::WebviewWindow,
) -> Result<String, String> {
    let path = path_validation::validate_write_path(&path)?;
    authorize_window_path(&window, &path)?;
    write_lrc_file_if_unchanged_impl(
        path.to_string_lossy().into_owned(),
        content,
        expected_sha256,
    )
    .await
}

async fn write_lrc_file_if_unchanged_impl(
    path: String,
    content: String,
    expected_sha256: String,
) -> Result<String, String> {
    atomic_write::write_atomic_if_unchanged(
        std::path::Path::new(&path),
        &content,
        &expected_sha256,
    )
    .map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_audio_file(
    path: String,
    window: tauri::WebviewWindow,
) -> Result<tauri::ipc::Response, String> {
    let path = path_validation::validate_safe_path(&path)?;
    authorize_window_path(&window, &path)?;
    // Return raw bytes through IPC after applying the compressed and decoded-memory limits.
    audio_resource::read_bounded_audio_file(std::path::Path::new(&path))
        .map(|(bytes, _)| tauri::ipc::Response::new(bytes))
}

#[cfg(test)]
fn get_audio_file_info_impl(path: std::path::PathBuf) -> Result<AudioFileInfo, String> {
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

#[cfg(test)]
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

fn inspect_aiff_container(file: &mut std::fs::File) -> Result<u64, String> {
    use std::io::{Read, Seek, SeekFrom};

    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut header = [0_u8; 12];
    file.read_exact(&mut header)
        .map_err(|error| format!("Invalid or truncated AIFF header: {error}"))?;
    if &header[..4] != b"FORM" || !matches!(&header[8..12], b"AIFF" | b"AIFC") {
        return Err("Invalid AIFF container header".into());
    }
    let declared_form_bytes = u32::from_be_bytes(header[4..8].try_into().unwrap()) as u64;
    let declared_file_bytes = declared_form_bytes
        .checked_add(8)
        .ok_or_else(|| "Invalid AIFF container size".to_string())?;
    let actual_file_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    if actual_file_bytes < declared_file_bytes {
        return Err("Truncated AIFF container".into());
    }

    let mut common: Option<(u64, u64)> = None;
    let mut sound_frames: Option<u64> = None;
    let mut chunk_offset = 12_u64;
    while chunk_offset < declared_file_bytes {
        if declared_file_bytes - chunk_offset < 8 {
            return Err("Truncated AIFF chunk header".into());
        }
        file.seek(SeekFrom::Start(chunk_offset))
            .map_err(|error| error.to_string())?;
        let mut chunk_header = [0_u8; 8];
        file.read_exact(&mut chunk_header)
            .map_err(|error| format!("Truncated AIFF chunk header: {error}"))?;
        let chunk_size = u32::from_be_bytes(chunk_header[4..8].try_into().unwrap()) as u64;
        let chunk_data_start = chunk_offset + 8;
        let chunk_data_end = chunk_data_start
            .checked_add(chunk_size)
            .ok_or_else(|| "Invalid AIFF chunk size".to_string())?;
        let padded_chunk_end = chunk_data_end
            .checked_add(chunk_size % 2)
            .ok_or_else(|| "Invalid AIFF chunk size".to_string())?;
        if padded_chunk_end > declared_file_bytes {
            return Err("Truncated AIFF chunk data".into());
        }

        match &chunk_header[..4] {
            b"COMM" if chunk_size >= 18 => {
                if common.is_some() {
                    return Err("Duplicate AIFF COMM chunk".into());
                }
                file.seek(SeekFrom::Start(chunk_data_start))
                    .map_err(|error| error.to_string())?;
                let mut common_header = [0_u8; 8];
                file.read_exact(&mut common_header)
                    .map_err(|error| format!("Truncated AIFF COMM chunk: {error}"))?;
                let channels = u16::from_be_bytes(common_header[..2].try_into().unwrap()) as u64;
                let frames = u32::from_be_bytes(common_header[2..6].try_into().unwrap()) as u64;
                let sample_bits =
                    u16::from_be_bytes(common_header[6..8].try_into().unwrap()) as u64;
                let block_align = channels
                    .checked_mul(sample_bits / 8)
                    .filter(|value| {
                        channels > 0 && sample_bits > 0 && sample_bits % 8 == 0 && *value > 0
                    })
                    .ok_or_else(|| "Invalid AIFF sample layout".to_string())?;
                common = Some((frames, block_align));
            }
            b"SSND" if chunk_size >= 8 => {
                if sound_frames.is_some() {
                    return Err("Duplicate AIFF SSND chunk".into());
                }
                file.seek(SeekFrom::Start(chunk_data_start))
                    .map_err(|error| error.to_string())?;
                let mut sound_header = [0_u8; 8];
                file.read_exact(&mut sound_header)
                    .map_err(|error| format!("Truncated AIFF SSND chunk: {error}"))?;
                let offset = u32::from_be_bytes(sound_header[..4].try_into().unwrap()) as u64;
                let block_size = u32::from_be_bytes(sound_header[4..].try_into().unwrap());
                if offset != 0 || block_size != 0 {
                    return Err("Unsupported AIFF sound offset or block size".into());
                }
                let (frames, block_align) = common.ok_or("AIFF COMM chunk must precede SSND")?;
                let audio_bytes = chunk_size - 8;
                if audio_bytes % block_align != 0 {
                    return Err("Invalid AIFF sound data alignment".into());
                }
                let available_frames = audio_bytes / block_align;
                if available_frames != frames {
                    return Err("Truncated or inconsistent AIFF sound data".into());
                }
                sound_frames = Some(frames);
            }
            _ => {}
        }
        chunk_offset = padded_chunk_end;
    }

    let frames = sound_frames.ok_or("AIFF sound chunk is missing")?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    Ok(frames)
}

/// AIFF 등 WebView2 미지원 포맷을 WAV 바이트로 트랜스코딩합니다.
#[tauri::command]
async fn decode_audio_to_wav(
    path: String,
    window: tauri::WebviewWindow,
) -> Result<tauri::ipc::Response, String> {
    let path = path_validation::validate_safe_path(&path)?;
    authorize_window_path(&window, &path)?;
    let mut file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    if file.metadata().map_err(|e| e.to_string())?.len() > audio_resource::MAX_AUDIO_FILE_BYTES {
        return Err(audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    let extension = path.extension().and_then(|value| value.to_str());
    let is_aiff = extension.is_some_and(|value| {
        value.eq_ignore_ascii_case("aif") || value.eq_ignore_ascii_case("aiff")
    });
    let declared_aiff_frames = if is_aiff {
        Some(inspect_aiff_container(&mut file)?)
    } else {
        None
    };
    decode_audio_file_to_wav(file, extension, declared_aiff_frames).map(tauri::ipc::Response::new)
}

fn decode_audio_file_to_wav(
    file: std::fs::File,
    extension: Option<&str>,
    declared_aiff_frames: Option<u64>,
) -> Result<Vec<u8>, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let is_aiff = extension.is_some_and(|value| {
        value.eq_ignore_ascii_case("aif") || value.eq_ignore_ascii_case("aiff")
    });
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = extension {
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
        declared_aiff_frames.or(codec_params.n_frames).unwrap_or(0),
    )?;
    if let Some(frames) = declared_aiff_frames {
        audio_resource::validate_web_audio_pcm_frames(sample_rate, channels_u8, frames)?;
    }
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
        if declared_aiff_frames.is_some_and(|declared| decoded_frames >= declared) {
            break;
        }
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
        let frames_to_write = declared_aiff_frames
            .map(|declared| declared.saturating_sub(decoded_frames).min(packet_frames))
            .unwrap_or(packet_frames);
        if frames_to_write == 0 {
            break;
        }
        decoded_frames = decoded_frames
            .checked_add(frames_to_write)
            .ok_or(audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        audio_resource::validate_pcm_frames(sample_rate, channels_u8, decoded_frames)?;
        if is_aiff {
            audio_resource::validate_web_audio_pcm_frames(
                sample_rate,
                channels_u8,
                decoded_frames,
            )?;
        }
        let mut buf = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        buf.copy_interleaved_ref(decoded);
        let samples_to_write = usize::try_from(frames_to_write)
            .ok()
            .and_then(|frames| frames.checked_mul(channels))
            .ok_or(audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        for &sample in buf.samples().iter().take(samples_to_write) {
            writer
                .write_sample(sample)
                .map_err(|e| format!("WAV 쓰기 오류: {e}"))?;
        }
    }

    if declared_aiff_frames.is_some_and(|declared| decoded_frames != declared) {
        return Err("Truncated AIFF audio data".into());
    }

    writer
        .finalize()
        .map_err(|e| format!("WAV 완료 오류: {e}"))?;
    Ok(output.into_inner())
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
fn read_audio_metadata(path: String, window: tauri::WebviewWindow) -> Result<AudioMetadata, String> {
    use lofty::file::TaggedFileExt;
    use lofty::tag::Accessor;
    let path = path_validation::validate_safe_path(&path)?;
    authorize_window_path(&window, &path)?;
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
                title: preferred_tag_value(
                    primary.title(),
                    first_nonempty_tag_value(
                        None,
                        tags.iter()
                            .filter(|candidate| candidate.tag_type() != primary.tag_type())
                            .map(lofty::tag::Tag::title),
                    ),
                ),
                artist: preferred_tag_value(
                    primary.artist(),
                    first_nonempty_tag_value(
                        None,
                        tags.iter()
                            .filter(|candidate| candidate.tag_type() != primary.tag_type())
                            .map(lofty::tag::Tag::artist),
                    ),
                ),
                album: preferred_tag_value(
                    primary.album(),
                    first_nonempty_tag_value(
                        None,
                        tags.iter()
                            .filter(|candidate| candidate.tag_type() != primary.tag_type())
                            .map(lofty::tag::Tag::album),
                    ),
                ),
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
        .manage(ModelUseState::default())
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
            has_refresh_token,
            persist_pending_refresh_token,
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
            preferred_tag_value(
                Some(Cow::Borrowed("  ")),
                first_nonempty_tag_value(None, [Some(Cow::Borrowed(" ")), Some(Cow::Borrowed("Third"))]),
            ),
            "Third",
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
    use super::{decode_audio_file_to_wav, inspect_aiff_container, is_normal_audio_eof};
    use symphonia::core::errors::Error;

    fn append_aiff_chunk(bytes: &mut Vec<u8>, id: &[u8; 4], payload: &[u8]) {
        bytes.extend_from_slice(id);
        bytes.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        bytes.extend_from_slice(payload);
        if payload.len() % 2 != 0 {
            bytes.push(0);
        }
    }

    fn pcm_aiff(
        channels: u16,
        sample_frames: u32,
        samples: &[u8],
        trailing_chunk: Option<(&[u8; 4], &[u8])>,
    ) -> Vec<u8> {
        let mut bytes = b"FORM\0\0\0\0AIFF".to_vec();
        let mut comm = Vec::new();
        comm.extend_from_slice(&channels.to_be_bytes());
        comm.extend_from_slice(&sample_frames.to_be_bytes());
        comm.extend_from_slice(&16_u16.to_be_bytes());
        comm.extend_from_slice(&[0x40, 0x0e, 0xac, 0x44, 0, 0, 0, 0, 0, 0]); // 44.1 kHz extended float.
        append_aiff_chunk(&mut bytes, b"COMM", &comm);

        let mut sound = vec![0_u8; 8]; // SSND offset and block size.
        sound.extend_from_slice(samples);
        append_aiff_chunk(&mut bytes, b"SSND", &sound);
        if let Some((id, payload)) = trailing_chunk {
            append_aiff_chunk(&mut bytes, id, payload);
        }
        let form_size = u32::try_from(bytes.len() - 8).unwrap();
        bytes[4..8].copy_from_slice(&form_size.to_be_bytes());
        bytes
    }

    fn decode_aiff(bytes: &[u8]) -> Result<Vec<u8>, String> {
        let frames = inspect_aiff(bytes)?;
        decode_aiff_with_frames(bytes, frames)
    }

    fn decode_aiff_with_frames(bytes: &[u8], frames: u64) -> Result<Vec<u8>, String> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.aiff");
        std::fs::write(&path, bytes).unwrap();
        let file = std::fs::File::open(path).unwrap();
        decode_audio_file_to_wav(file, Some("aiff"), Some(frames))
    }

    fn inspect_aiff(bytes: &[u8]) -> Result<u64, String> {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("fixture.aiff");
        std::fs::write(&path, bytes).unwrap();
        inspect_aiff_container(&mut std::fs::File::open(path).unwrap())
    }

    fn wav_frame_count(bytes: Vec<u8>) -> u32 {
        hound::WavReader::new(std::io::Cursor::new(bytes))
            .unwrap()
            .duration()
    }

    #[test]
    fn truncated_aiff_container_is_rejected_before_packet_eof_is_accepted() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("truncated.aiff");
        let mut bytes = b"FORM".to_vec();
        bytes.extend_from_slice(&16_u32.to_be_bytes()); // Declares 24 total bytes.
        bytes.extend_from_slice(b"AIFF");
        std::fs::write(&path, bytes).unwrap();
        let mut file = std::fs::File::open(path).unwrap();
        assert!(inspect_aiff_container(&mut file)
            .unwrap_err()
            .contains("Truncated AIFF"));
    }

    #[test]
    fn accepts_an_aiff_container_whose_declared_size_is_present() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("complete.aiff");
        let bytes = pcm_aiff(1, 4, &[0, 1, 0, 2, 0, 3, 0, 4], None);
        std::fs::write(&path, bytes).unwrap();
        let mut file = std::fs::File::open(path).unwrap();
        assert_eq!(inspect_aiff_container(&mut file).unwrap(), 4);
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

    #[test]
    fn decoded_aiff_frame_count_matches_the_comm_chunk() {
        let complete = pcm_aiff(1, 4, &[0, 1, 0, 2, 0, 3, 0, 4], None);
        assert_eq!(wav_frame_count(decode_aiff(&complete).unwrap()), 4);

        let stereo = pcm_aiff(
            2,
            4,
            &[0, 1, 0, 2, 0, 3, 0, 4, 0, 5, 0, 6, 0, 7, 0, 8],
            None,
        );
        assert_eq!(wav_frame_count(decode_aiff(&stereo).unwrap()), 4);

        let truncated = pcm_aiff(1, 4, &[0, 1, 0, 2], None);
        assert!(inspect_aiff(&truncated)
            .unwrap_err()
            .contains("Truncated or inconsistent AIFF sound data"));
        assert!(decode_aiff_with_frames(&truncated, 4)
            .unwrap_err()
            .contains("Truncated AIFF audio data"));
    }

    #[test]
    fn valid_aiff_trailing_chunks_do_not_become_audio_frames() {
        let with_annotation = pcm_aiff(
            1,
            4,
            &[0, 1, 0, 2, 0, 3, 0, 4],
            Some((b"ANNO", &[b'x', b'y', b'z'])),
        );
        assert_eq!(wav_frame_count(decode_aiff(&with_annotation).unwrap()), 4);
    }
}

#[cfg(test)]
mod lyric_save_command_tests {
    use super::{
        read_lrc_file_impl, read_lrc_file_with_hash_impl, write_lrc_file_impl,
        write_lrc_file_if_unchanged_impl,
        MAX_LYRIC_FILE_BYTES,
    };
    use std::fs;

    #[tokio::test]
    async fn command_creates_new_file_then_replaces_existing_file() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("new-lyrics.lrc");
        let path = target.to_str().unwrap().to_string();
        write_lrc_file_impl(path.clone(), "[00:01.00]First".into(), None, None).await.unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "[00:01.00]First");
        write_lrc_file_impl(path.clone(), "[00:02.00]Second".into(), None, None).await.unwrap();
        assert_eq!(read_lrc_file_impl(path).await.unwrap(), "[00:02.00]Second");
    }

    #[tokio::test]
    async fn rejects_bom_marked_utf16_with_an_actionable_error_without_changing_bytes() {
        let dir = tempfile::tempdir().unwrap();
        for (name, bom, little_endian) in [
            ("utf16-le.srt", [0xFF, 0xFE], true),
            ("utf16-be.srt", [0xFE, 0xFF], false),
        ] {
            let target = dir.path().join(name);
            let text = "1\n00:00:01,000 --> 00:00:02,000\ncue\n";
            let mut bytes = bom.to_vec();
            for unit in text.encode_utf16() {
                bytes.extend(if little_endian { unit.to_le_bytes() } else { unit.to_be_bytes() });
            }
            fs::write(&target, &bytes).unwrap();
            let error = read_lrc_file_impl(target.to_string_lossy().into_owned()).await.unwrap_err();
            assert!(error.contains("UTF-16"), "unexpected error for {name}: {error}");
            assert_eq!(fs::read(target).unwrap(), bytes);
        }
    }

    #[tokio::test]
    async fn conditional_save_refuses_external_edits_and_accepts_the_known_version() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("shared.lrc");
        fs::write(&target, "original").unwrap();
        let path = target.to_string_lossy().into_owned();
        let opened = read_lrc_file_with_hash_impl(path.clone()).await.unwrap();
        assert_eq!(opened.content, "original");

        fs::write(&target, "external edit").unwrap();
        let stale = write_lrc_file_if_unchanged_impl(
            path.clone(),
            "app edit".into(),
            opened.sha256,
        )
        .await
        .unwrap_err();
        assert!(stale.contains("LYRICS_FILE_CHANGED"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "external edit");

        let current = read_lrc_file_with_hash_impl(path.clone()).await.unwrap();
        let saved_hash = write_lrc_file_if_unchanged_impl(
            path.clone(),
            "app edit".into(),
            current.sha256,
        )
        .await
        .unwrap();
        assert_eq!(read_lrc_file_impl(path).await.unwrap(), "app edit");
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
        let opened = read_lrc_file_with_hash_impl(target_path.clone()).await.unwrap();

        write_lrc_file_if_unchanged_impl(
            target_path,
            "first save".into(),
            opened.sha256.clone(),
        )
        .await
        .unwrap();
        let stale = write_lrc_file_if_unchanged_impl(alias_path, "stale save".into(), opened.sha256)
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
        let opened = read_lrc_file_with_hash_impl(source_path.clone()).await.unwrap();
        fs::write(&target, "external edit").unwrap();

        let error = write_lrc_file_impl(
            alias_path.clone(),
            "app edit".into(),
            Some(source_path.clone()),
            Some(opened.sha256),
        )
        .await
        .unwrap_err();
        assert!(error.contains("LYRICS_FILE_CHANGED"));
        assert_eq!(fs::read_to_string(&target).unwrap(), "external edit");

        let latest = read_lrc_file_with_hash_impl(source_path.clone()).await.unwrap();
        write_lrc_file_impl(
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
        assert!(write_lrc_file_impl(invalid.to_string_lossy().into_owned(), "draft".into(), None, None).await.is_err());
        assert_eq!(fs::read_to_string(&original).unwrap(), "original content");
        assert!(!invalid.exists());
    }

    #[tokio::test]
    async fn read_rejects_sparse_lyrics_above_the_byte_budget() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("oversized.lrc");
        let file = fs::File::create(&target).unwrap();
        file.set_len(MAX_LYRIC_FILE_BYTES + 1).unwrap();

        let error = read_lrc_file_impl(target.to_string_lossy().into_owned()).await.unwrap_err();
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
            read_lrc_file_impl(target.to_string_lossy().into_owned()),
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
        let error = read_lrc_file_impl(target.to_string_lossy().into_owned()).await.unwrap_err();
        assert!(error.contains("Unsupported lyric encoding"), "{error}");
        assert_eq!(fs::read(&target).unwrap(), raw);
    }

    #[tokio::test]
    async fn read_keeps_normal_utf8_lyrics_and_literal_escape_sequences() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("normal.lrc");
        let source = "[00:01.00]한글 日本語 \\0 text";
        fs::write(&target, source).unwrap();
        assert_eq!(read_lrc_file_impl(target.to_string_lossy().into_owned()).await.unwrap(), source);
    }
}

#[cfg(test)]
mod audio_identity_command_tests {
    use super::get_audio_file_info_impl;
    use std::fs;

    #[test]
    fn reports_precise_stable_metadata_for_the_same_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.wav");
        fs::write(&path, b"tiny-audio").unwrap();
        let path = path.to_str().unwrap().to_owned();
        let before = get_audio_file_info_impl(std::path::PathBuf::from(path.clone())).unwrap();
        let after = get_audio_file_info_impl(std::path::PathBuf::from(path)).unwrap();
        assert_eq!(before.size, 10);
        assert_eq!(before.mtime, after.mtime);
        assert_eq!(before.file_id, after.file_id);
        let json = serde_json::to_value(&before).unwrap();
        assert!(json["mtime"].is_string());
        assert!(json.get("fileId").is_some());
    }
}

#[cfg(test)]
mod window_scope_tests {
    use super::authorize_window_path;
    use tauri_plugin_fs::FsExt;

    #[test]
    fn native_file_commands_require_a_window_grant_and_accept_a_selected_file() {
        let app = tauri::test::mock_builder()
            .plugin(tauri_plugin_fs::init())
            .build(tauri::test::mock_context(tauri::test::noop_assets()))
            .unwrap();
        let window = tauri::WebviewWindowBuilder::new(&app, "main", Default::default())
            .build()
            .unwrap();
        let dir = tempfile::tempdir().unwrap();
        let selected = dir.path().join("selected.lrc");
        std::fs::write(&selected, "lyrics").unwrap();
        let selected = selected.canonicalize().unwrap();

        assert!(authorize_window_path(&window, &selected).is_err());
        window.fs_scope().allow_file(&selected).unwrap();
        assert!(authorize_window_path(&window, &selected).is_ok());

    }
}
