mod service_auth;
use service_auth::*;
mod now_playing;
use now_playing::*;
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

#[tauri::command]
async fn read_lrc_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_lrc_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<tauri::ipc::Response, String> {
    // 바이트를 JSON(number[]) 대신 raw 바이너리로 반환 → 대용량 오디오도 빠름
    std::fs::read(&path)
        .map(tauri::ipc::Response::new)
        .map_err(|e| e.to_string())
}

fn is_normal_audio_eof(error: &symphonia::core::errors::Error) -> bool {
    matches!(error, symphonia::core::errors::Error::IoError(err)
        if err.kind() == std::io::ErrorKind::UnexpectedEof)
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

    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
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
#[tauri::command]
fn read_audio_metadata(path: String) -> Result<AudioMetadata, String> {
    use lofty::file::TaggedFileExt;
    use lofty::tag::Accessor;
    let tagged = lofty::read_from_path(&path).map_err(|e| e.to_string())?;
    let tag = tagged.primary_tag().or_else(|| tagged.first_tag());
    let s = |o: Option<std::borrow::Cow<str>>| o.map(|c| c.trim().to_string()).unwrap_or_default();
    Ok(match tag {
        Some(t) => AudioMetadata {
            title: s(t.title()),
            artist: s(t.artist()),
            album: s(t.album()),
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
            write_lrc_file,
            read_audio_file,
            decode_audio_to_wav,
            read_audio_metadata,
            set_models_dir_override,
            get_models_dir,
            check_model_files,
            download_model,
            cancel_model_download,
            delete_model_files,
            get_python_env_info,
            download_embedded_python,
            install_python_packages,
            run_alignment,
            cancel_alignment,
            start_oauth_listener,
            exchange_spotify_token,
            refresh_spotify_token,
            save_refresh_token,
            load_refresh_token,
            clear_refresh_token,
            check_ytdlp,
            download_ytdlp,
            ytdlp_load_audio,
            cancel_ytdlp_load,
            lrclib_publish,
            get_now_playing,
            now_playing_toggle_play_pause,
            now_playing_seek,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod audio_decode_tests {
    use super::is_normal_audio_eof;
    use symphonia::core::errors::Error;

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
