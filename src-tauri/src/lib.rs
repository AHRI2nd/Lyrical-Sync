#[tauri::command]
async fn read_lrc_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| e.to_string())
}

#[tauri::command]
async fn write_lrc_file(path: String, content: String) -> Result<(), String> {
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

#[tauri::command]
async fn read_audio_file(path: String) -> Result<Vec<u8>, String> {
    std::fs::read(&path).map_err(|e| e.to_string())
}

/// AIFF 등 WebView2 미지원 포맷을 WAV로 트랜스코딩해 임시 파일 경로를 반환합니다.
#[tauri::command]
async fn decode_audio_to_wav(path: String) -> Result<String, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mss = MediaSourceStream::new(Box::new(file), Default::default());

    let mut hint = Hint::new();
    if let Some(ext) = std::path::Path::new(&path).extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }

    let probed = symphonia::default::get_probe()
        .format(&hint, mss, &FormatOptions::default(), &MetadataOptions::default())
        .map_err(|e| format!("지원하지 않는 포맷: {e}"))?;

    let mut format = probed.format;
    let track = format.default_track().ok_or("오디오 트랙 없음")?;
    let codec_params = track.codec_params.clone();
    let track_id = track.id;

    let sample_rate = codec_params.sample_rate.ok_or("샘플레이트 없음")?;
    let channels = codec_params.channels.ok_or("채널 정보 없음")?.count();

    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|e| format!("디코더 오류: {e}"))?;

    let mut samples: Vec<f32> = Vec::new();

    loop {
        let packet = match format.next_packet() {
            Ok(p) => p,
            Err(_) => break,
        };
        if packet.track_id() != track_id {
            continue;
        }
        match decoder.decode(&packet) {
            Ok(decoded) => {
                let mut buf =
                    SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
                buf.copy_interleaved_ref(decoded);
                samples.extend_from_slice(buf.samples());
            }
            Err(_) => continue,
        }
    }

    let spec = hound::WavSpec {
        channels: channels as u16,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };

    let temp_path = std::env::temp_dir().join("lyrical_sync_transcoded.wav");
    {
        let mut writer =
            hound::WavWriter::create(&temp_path, spec).map_err(|e| format!("WAV 생성 오류: {e}"))?;
        for &s in &samples {
            writer.write_sample(s).map_err(|e| format!("WAV 쓰기 오류: {e}"))?;
        }
        writer.finalize().map_err(|e| format!("WAV 완료 오류: {e}"))?;
    }

    Ok(temp_path.to_string_lossy().into_owned())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            read_lrc_file,
            write_lrc_file,
            read_audio_file,
            decode_audio_to_wav,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
