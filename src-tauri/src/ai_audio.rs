use std::io::Write;
use std::sync::atomic::{AtomicBool, Ordering};

const MAX_DECODED_PACKET_SAMPLES: usize = 192_000 * 8;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct AudioPcmFormat {
    pub sample_rate: u32,
    pub channels: u8,
    pub frames: u64,
}

pub(crate) fn is_native_ai_decoder_path(extension: &str) -> bool {
    matches!(
        extension.to_ascii_lowercase().as_str(),
        "aac" | "m4a" | "mp4"
    )
}

pub(crate) fn decode_to_writer(
    file: std::fs::File,
    extension: &str,
    expected_sample_rate: u32,
    expected_channels: u8,
    cancel: &AtomicBool,
    output: &mut impl Write,
) -> Result<AudioPcmFormat, String> {
    decode_to_writer_with_limit(
        file,
        extension,
        expected_sample_rate,
        expected_channels,
        cancel,
        output,
        crate::audio_resource::MAX_AUDIO_PCM_BYTES,
    )
}

fn decode_to_writer_with_limit(
    file: std::fs::File,
    extension: &str,
    expected_sample_rate: u32,
    expected_channels: u8,
    cancel: &AtomicBool,
    output: &mut impl Write,
    max_pcm_bytes: u64,
) -> Result<AudioPcmFormat, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error as SymphoniaError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    if !is_native_ai_decoder_path(extension) {
        return Err("Unsupported native AI audio extension".into());
    }
    if cancel.load(Ordering::Acquire) {
        return Err("cancelled".into());
    }
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            MediaSourceStream::new(Box::new(file), Default::default()),
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Audio format probe failed: {error}"))?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("Audio track is unavailable")?;
    let track_id = track.id;
    let params = track.codec_params.clone();
    let sample_rate = params.sample_rate.unwrap_or(expected_sample_rate);
    let channels = params
        .channels
        .map(|value| value.count())
        .unwrap_or(usize::from(expected_channels));
    if sample_rate != expected_sample_rate
        || channels != usize::from(expected_channels)
        || !(1..=8).contains(&channels)
    {
        return Err("AUDIO_METADATA_UNAVAILABLE".into());
    }
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|error| format!("Audio decoder setup failed: {error}"))?;
    let mut sample_buffer: Option<SampleBuffer<f32>> = None;
    let mut frames_written = 0_u64;
    loop {
        if cancel.load(Ordering::Acquire) {
            return Err("cancelled".into());
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(SymphoniaError::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break
            }
            Err(error) => return Err(format!("Audio packet read failed: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let packet_channels = params
            .channels
            .map(|value| value.count())
            .unwrap_or(channels);
        if packet
            .dur()
            .checked_mul(packet_channels as u64)
            .is_none_or(|samples| samples > MAX_DECODED_PACKET_SAMPLES as u64)
        {
            return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|error| format!("Audio packet decode failed: {error}"))?;
        let actual_channels = decoded.spec().channels.count();
        if decoded.spec().rate != sample_rate
            || actual_channels != channels
            || decoded
                .capacity()
                .checked_mul(actual_channels)
                .is_none_or(|samples| samples > MAX_DECODED_PACKET_SAMPLES)
        {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }
        let packet_frames = u64::try_from(decoded.frames())
            .map_err(|_| crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        let new_frames = frames_written
            .checked_add(packet_frames)
            .ok_or(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        crate::audio_resource::validate_pcm_frames(sample_rate, expected_channels, new_frames)?;
        let pcm_bytes = new_frames
            .checked_mul(u64::from(expected_channels))
            .and_then(|samples| samples.checked_mul(4))
            .ok_or(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        if pcm_bytes > max_pcm_bytes {
            return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        if sample_buffer
            .as_ref()
            .is_none_or(|buffer| buffer.capacity() < decoded.capacity() * channels)
        {
            sample_buffer = Some(SampleBuffer::<f32>::new(
                decoded.capacity() as u64,
                *decoded.spec(),
            ));
        }
        let buffer = sample_buffer
            .as_mut()
            .expect("sample buffer is initialized before use");
        buffer.copy_interleaved_ref(decoded);
        let sample_count = usize::try_from(packet_frames)
            .ok()
            .and_then(|frames| frames.checked_mul(channels))
            .ok_or(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        let mut bytes = Vec::with_capacity(sample_count.saturating_mul(4));
        for sample in buffer.samples().iter().take(sample_count) {
            if !sample.is_finite() {
                return Err("Invalid nonfinite decoded audio sample".into());
            }
            bytes.extend_from_slice(&sample.to_le_bytes());
        }
        output
            .write_all(&bytes)
            .map_err(|error| format!("Audio stream write failed: {error}"))?;
        frames_written = new_frames;
    }
    if frames_written == 0 {
        return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    Ok(AudioPcmFormat {
        sample_rate,
        channels: expected_channels,
        frames: frames_written,
    })
}

#[cfg(test)]
mod tests {
    use super::{decode_to_writer, decode_to_writer_with_limit, is_native_ai_decoder_path};
    use std::io::Cursor;
    use std::sync::atomic::AtomicBool;

    fn fixture(name: &str) -> std::fs::File {
        std::fs::File::open(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("test-fixtures/audio-prefix")
                .join(name),
        )
        .unwrap()
    }

    #[test]
    fn streams_aac_m4a_and_alac_frames_without_accumulating_the_track() {
        for (name, extension) in [
            ("prefix.aac", "aac"),
            ("prefix.m4a", "m4a"),
            ("prefix-alac.m4a", "m4a"),
        ] {
            let mut output = Vec::new();
            let format = decode_to_writer(
                fixture(name),
                extension,
                48_000,
                2,
                &AtomicBool::new(false),
                &mut output,
            )
            .unwrap_or_else(|error| panic!("{name}: {error}"));
            assert_eq!(format.sample_rate, 48_000, "{name}");
            assert_eq!(format.channels, 2, "{name}");
            assert!(format.frames > 0, "{name}");
            assert_eq!(output.len() as u64, format.frames * 2 * 4, "{name}");
        }
    }

    #[test]
    fn decoder_rejects_malformed_and_wrong_extension_inputs() {
        for (bytes, extension) in [(b"not media".as_slice(), "m4a"), (b"not media", "wav")] {
            let path = tempfile::NamedTempFile::new().unwrap();
            std::fs::write(path.path(), bytes).unwrap();
            let mut output = Vec::new();
            assert!(decode_to_writer(
                std::fs::File::open(path.path()).unwrap(),
                extension,
                48_000,
                2,
                &AtomicBool::new(false),
                &mut output,
            )
            .is_err());
        }
    }

    #[test]
    fn decoder_enforces_actual_pcm_limit_and_cancellation() {
        let mut output = Cursor::new(Vec::new());
        assert_eq!(
            decode_to_writer_with_limit(
                fixture("prefix.m4a"),
                "m4a",
                48_000,
                2,
                &AtomicBool::new(false),
                &mut output,
                8,
            )
            .unwrap_err(),
            crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR
        );
        assert_eq!(output.get_ref().len(), 0);

        let mut output = Vec::new();
        assert_eq!(
            decode_to_writer(
                fixture("prefix.m4a"),
                "m4a",
                48_000,
                2,
                &AtomicBool::new(true),
                &mut output,
            )
            .unwrap_err(),
            "cancelled"
        );
        assert!(output.is_empty());
    }

    #[test]
    fn only_python_backend_gap_extensions_use_native_streaming() {
        for extension in ["aac", "AAC", "m4a", "M4A", "mp4"] {
            assert!(is_native_ai_decoder_path(extension));
        }
        for extension in ["wav", "aiff", "mp3", "flac", "ogg", "opus"] {
            assert!(!is_native_ai_decoder_path(extension));
        }
    }
}
