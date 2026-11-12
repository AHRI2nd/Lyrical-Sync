use std::io::{Read, Seek, SeekFrom, Write};

pub(crate) fn needs_windows_playback_transcode(is_windows: bool, extension: &str) -> bool {
    is_windows && matches!(extension.to_ascii_lowercase().as_str(), "aif" | "aiff")
}

pub(crate) fn transcode_aiff_to_wav(
    mut input: std::fs::File,
    output: &mut (impl Write + Seek),
    mut check_cancelled: impl FnMut() -> Result<(), String>,
) -> Result<crate::audio_resource::AudioResourceInfo, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    check_cancelled()?;
    let initial_source_metadata = input.metadata().map_err(|error| error.to_string())?;
    let source_metadata_handle = input
        .try_clone()
        .map_err(|error| format!("AIFF source could not be monitored: {error}"))?;
    let source_info = crate::audio_resource::inspect_audio_file_handle_with_check(
        &mut input,
        &mut check_cancelled,
    )?;
    if source_info.file_bytes > crate::audio_resource::MAX_AUDIO_FILE_BYTES {
        return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    let declared_frames = inspect_aiff_container(&mut input, &mut check_cancelled)?;
    crate::audio_resource::validate_web_audio_pcm_frames(
        source_info.sample_rate,
        source_info.channels,
        declared_frames,
    )?;

    input
        .seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mss = MediaSourceStream::new(Box::new(input), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("aiff");
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            mss,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Unsupported AIFF format: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or("AIFF audio track is missing")?;
    let codec_params = track.codec_params.clone();
    let track_id = track.id;
    let sample_rate = codec_params
        .sample_rate
        .ok_or("AIFF sample rate is missing")?;
    let channels = codec_params
        .channels
        .ok_or("AIFF channel information is missing")?
        .count();
    if sample_rate != source_info.sample_rate || channels != usize::from(source_info.channels) {
        return Err("AUDIO_METADATA_UNAVAILABLE".into());
    }

    let spec = hound::WavSpec {
        channels: u16::try_from(channels)
            .map_err(|_| crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?,
        sample_rate,
        bits_per_sample: 32,
        sample_format: hound::SampleFormat::Float,
    };
    let mut decoder = symphonia::default::get_codecs()
        .make(&codec_params, &DecoderOptions::default())
        .map_err(|error| format!("AIFF decoder error: {error}"))?;

    output
        .seek(SeekFrom::Start(0))
        .map_err(|error| format!("WAV snapshot seek failed: {error}"))?;
    let mut writer = hound::WavWriter::new(&mut *output, spec)
        .map_err(|error| format!("WAV snapshot creation failed: {error}"))?;
    let channels_u8 = source_info.channels;
    let mut decoded_frames = 0_u64;
    loop {
        check_cancelled()?;
        if decoded_frames >= declared_frames {
            break;
        }
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(error) if is_normal_audio_eof(&error) => break,
            Err(error) => return Err(format!("AIFF packet read failed: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|error| format!("AIFF decode failed: {error}"))?;
        if decoded.spec().channels.count() != channels {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }
        crate::audio_resource::validate_pcm_frames(
            sample_rate,
            channels_u8,
            u64::try_from(decoded.capacity())
                .map_err(|_| crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?,
        )?;
        let packet_frames = u64::try_from(decoded.frames())
            .map_err(|_| crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        let frames_to_write = declared_frames
            .saturating_sub(decoded_frames)
            .min(packet_frames);
        if frames_to_write == 0 {
            break;
        }
        decoded_frames = decoded_frames
            .checked_add(frames_to_write)
            .ok_or(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        crate::audio_resource::validate_web_audio_pcm_frames(
            sample_rate,
            channels_u8,
            decoded_frames,
        )?;

        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        samples.copy_interleaved_ref(decoded);
        let sample_count = usize::try_from(frames_to_write)
            .ok()
            .and_then(|frames| frames.checked_mul(channels))
            .ok_or(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
        for &sample in samples.samples().iter().take(sample_count) {
            writer
                .write_sample(sample)
                .map_err(|error| format!("WAV snapshot write failed: {error}"))?;
        }
    }
    if decoded_frames != declared_frames {
        return Err("Truncated AIFF audio data".into());
    }
    check_cancelled()?;
    let final_source_metadata = source_metadata_handle
        .metadata()
        .map_err(|error| error.to_string())?;
    if initial_source_metadata.len() != final_source_metadata.len()
        || initial_source_metadata.modified().ok() != final_source_metadata.modified().ok()
    {
        return Err("AUDIO_FILE_CHANGED".into());
    }
    writer
        .finalize()
        .map_err(|error| format!("WAV snapshot finalization failed: {error}"))?;
    output
        .flush()
        .map_err(|error| format!("WAV snapshot flush failed: {error}"))?;
    let file_bytes = output
        .seek(SeekFrom::End(0))
        .map_err(|error| format!("WAV snapshot size lookup failed: {error}"))?;
    let max_wav_bytes = crate::audio_resource::MAX_AUDIO_PCM_BYTES
        .checked_add(128)
        .ok_or(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR)?;
    if file_bytes > max_wav_bytes {
        return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    Ok(crate::audio_resource::AudioResourceInfo {
        file_bytes,
        ..source_info
    })
}

fn inspect_aiff_container(
    file: &mut std::fs::File,
    check_cancelled: &mut impl FnMut() -> Result<(), String>,
) -> Result<u64, String> {
    check_cancelled()?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut header = [0_u8; 12];
    file.read_exact(&mut header)
        .map_err(|error| format!("Invalid or truncated AIFF header: {error}"))?;
    if &header[..4] != b"FORM" || !matches!(&header[8..12], b"AIFF" | b"AIFC") {
        return Err("Invalid AIFF container header".into());
    }
    let form_size = u32::from_be_bytes(header[4..8].try_into().unwrap()) as u64;
    let declared_file_bytes = form_size
        .checked_add(8)
        .ok_or("Invalid AIFF container size")?;
    if file.metadata().map_err(|error| error.to_string())?.len() < declared_file_bytes {
        return Err("Truncated AIFF container".into());
    }
    let mut common: Option<(u64, u64)> = None;
    let mut sound_frames = None;
    let mut offset = 12_u64;
    while offset < declared_file_bytes {
        check_cancelled()?;
        if declared_file_bytes - offset < 8 {
            return Err("Truncated AIFF chunk header".into());
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        let mut chunk_header = [0_u8; 8];
        file.read_exact(&mut chunk_header)
            .map_err(|error| format!("Truncated AIFF chunk header: {error}"))?;
        let chunk_size = u32::from_be_bytes(chunk_header[4..8].try_into().unwrap()) as u64;
        let data_start = offset + 8;
        let data_end = data_start
            .checked_add(chunk_size)
            .ok_or("Invalid AIFF chunk size")?;
        let padded_end = data_end
            .checked_add(chunk_size % 2)
            .ok_or("Invalid AIFF chunk size")?;
        if padded_end > declared_file_bytes {
            return Err("Truncated AIFF chunk data".into());
        }
        match &chunk_header[..4] {
            b"COMM" if chunk_size >= 18 => {
                if common.is_some() {
                    return Err("Duplicate AIFF COMM chunk".into());
                }
                file.seek(SeekFrom::Start(data_start))
                    .map_err(|error| error.to_string())?;
                let mut comm = [0_u8; 8];
                file.read_exact(&mut comm)
                    .map_err(|error| format!("Truncated AIFF COMM chunk: {error}"))?;
                let channels = u16::from_be_bytes(comm[..2].try_into().unwrap()) as u64;
                let frames = u32::from_be_bytes(comm[2..6].try_into().unwrap()) as u64;
                let bits = u16::from_be_bytes(comm[6..8].try_into().unwrap()) as u64;
                let block_align = channels
                    .checked_mul(bits / 8)
                    .filter(|align| channels > 0 && bits > 0 && bits % 8 == 0 && *align > 0)
                    .ok_or("Invalid AIFF sample layout")?;
                common = Some((frames, block_align));
            }
            b"SSND" if chunk_size >= 8 => {
                if sound_frames.is_some() {
                    return Err("Duplicate AIFF SSND chunk".into());
                }
                file.seek(SeekFrom::Start(data_start))
                    .map_err(|error| error.to_string())?;
                let mut sound = [0_u8; 8];
                file.read_exact(&mut sound)
                    .map_err(|error| format!("Truncated AIFF SSND chunk: {error}"))?;
                let sound_offset = u32::from_be_bytes(sound[..4].try_into().unwrap());
                let block_size = u32::from_be_bytes(sound[4..].try_into().unwrap());
                if sound_offset != 0 || block_size != 0 {
                    return Err("Unsupported AIFF sound offset or block size".into());
                }
                let (frames, block_align) = common.ok_or("AIFF COMM chunk must precede SSND")?;
                let audio_bytes = chunk_size - 8;
                if audio_bytes % block_align != 0 || audio_bytes / block_align != frames {
                    return Err("Truncated or inconsistent AIFF sound data".into());
                }
                sound_frames = Some(frames);
            }
            _ => {}
        }
        offset = padded_end;
    }
    let frames = sound_frames.ok_or("AIFF sound chunk is missing")?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    Ok(frames)
}

fn is_normal_audio_eof(error: &symphonia::core::errors::Error) -> bool {
    matches!(error, symphonia::core::errors::Error::IoError(err)
        if err.kind() == std::io::ErrorKind::UnexpectedEof)
}

#[cfg(test)]
mod tests {
    use super::{needs_windows_playback_transcode, transcode_aiff_to_wav};
    use std::io::{Seek, SeekFrom};

    #[test]
    fn windows_transcodes_only_the_previously_supported_aiff_extensions() {
        assert!(needs_windows_playback_transcode(true, "aif"));
        assert!(needs_windows_playback_transcode(true, "AIFF"));
        assert!(!needs_windows_playback_transcode(false, "aiff"));
        assert!(!needs_windows_playback_transcode(true, "aifc"));
    }

    #[test]
    fn transcodes_aiff_to_a_wav_snapshot_without_changing_the_source() {
        let source_bytes = include_bytes!("../test-fixtures/audio-prefix/prefix.aiff");
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("song.aiff");
        std::fs::write(&source_path, source_bytes).unwrap();
        let source = std::fs::File::open(&source_path).unwrap();
        let mut output = tempfile::NamedTempFile::new().unwrap();

        let info = transcode_aiff_to_wav(source, &mut output, || Ok(())).unwrap();
        output.as_file_mut().seek(SeekFrom::Start(0)).unwrap();
        let output_bytes = output.as_file().metadata().unwrap().len();
        let mut reader = hound::WavReader::new(output.as_file_mut()).unwrap();

        assert_eq!(reader.spec().sample_format, hound::SampleFormat::Float);
        assert_eq!(reader.spec().bits_per_sample, 32);
        assert_eq!(reader.duration(), 96_000);
        assert_eq!(info.file_bytes, output_bytes);
        assert_eq!(std::fs::read(source_path).unwrap(), source_bytes);
        assert!(reader
            .samples::<f32>()
            .any(|sample| sample.unwrap().abs() > 0.01));
    }

    #[test]
    fn cancellation_drops_a_partial_wav_and_preserves_the_source() {
        let source_bytes = include_bytes!("../test-fixtures/audio-prefix/prefix.aiff");
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("song.aiff");
        std::fs::write(&source_path, source_bytes).unwrap();
        let source = std::fs::File::open(&source_path).unwrap();
        let mut output = tempfile::NamedTempFile::new().unwrap();
        let output_path = output.path().to_path_buf();
        let mut checks = 0;
        let mut cancelled_after_partial_write = false;

        let result = transcode_aiff_to_wav(source, &mut output, || {
            checks += 1;
            let partial_bytes = std::fs::metadata(&output_path)
                .map(|metadata| metadata.len())
                .unwrap_or_default();
            if partial_bytes > 44 {
                cancelled_after_partial_write = true;
                Err("cancelled".into())
            } else {
                Ok(())
            }
        });

        assert_eq!(result.unwrap_err(), "cancelled");
        assert!(cancelled_after_partial_write);
        drop(output);
        assert!(!output_path.exists());
        assert_eq!(std::fs::read(source_path).unwrap(), source_bytes);
    }

    #[test]
    fn malformed_aiff_drops_the_failed_wav_snapshot() {
        let mut source_bytes = include_bytes!("../test-fixtures/audio-prefix/prefix.aiff").to_vec();
        source_bytes[0] = b'X';
        let dir = tempfile::tempdir().unwrap();
        let source_path = dir.path().join("malformed.aiff");
        std::fs::write(&source_path, &source_bytes).unwrap();
        let source = std::fs::File::open(&source_path).unwrap();
        let mut output = tempfile::NamedTempFile::new().unwrap();
        let output_path = output.path().to_path_buf();

        assert!(transcode_aiff_to_wav(source, &mut output, || Ok(())).is_err());
        drop(output);

        assert!(!output_path.exists());
        assert_eq!(std::fs::read(source_path).unwrap(), source_bytes);
    }
}
