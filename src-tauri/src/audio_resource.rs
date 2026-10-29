use lofty::file::AudioFile;
use serde::Serialize;
use std::io::Read;
use std::path::Path;
use std::time::Duration;

pub const MAX_AUDIO_FILE_BYTES: u64 = 256 * 1024 * 1024;
pub const MAX_AUDIO_PCM_BYTES: u64 = 512 * 1024 * 1024;
pub const MAX_AUDIO_DURATION: Duration = Duration::from_secs(4 * 60 * 60);
const MAX_AUDIO_CHANNELS: u8 = 8;
const MIN_AUDIO_SAMPLE_RATE: u32 = 8_000;
const MAX_AUDIO_SAMPLE_RATE: u32 = 192_000;
const WEBAUDIO_BASE_SAMPLE_RATE: u32 = 48_000;
pub const AUDIO_RESOURCE_LIMIT_ERROR: &str = "AUDIO_RESOURCE_LIMIT";

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AudioResourceInfo {
    pub file_bytes: u64,
    pub duration_seconds: u64,
    pub sample_rate: u32,
    pub channels: u8,
    pub estimated_pcm_bytes: u64,
}

pub fn validate_audio_properties(
    file_bytes: u64,
    duration: Duration,
    sample_rate: u32,
    channels: u8,
) -> Result<AudioResourceInfo, String> {
    if file_bytes > MAX_AUDIO_FILE_BYTES
        || duration.is_zero()
        || duration > MAX_AUDIO_DURATION
        || !(MIN_AUDIO_SAMPLE_RATE..=MAX_AUDIO_SAMPLE_RATE).contains(&sample_rate)
        || channels == 0
        || channels > MAX_AUDIO_CHANNELS
    {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }

    let effective_rate = sample_rate.max(WEBAUDIO_BASE_SAMPLE_RATE);
    let frames = duration
        .as_nanos()
        .checked_mul(u128::from(effective_rate))
        .and_then(|samples| samples.checked_add(999_999_999))
        .map(|samples| samples / 1_000_000_000)
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    let pcm_bytes = frames
        .checked_mul(u128::from(channels))
        .and_then(|samples| samples.checked_mul(4))
        .and_then(|bytes| u64::try_from(bytes).ok())
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    if pcm_bytes > MAX_AUDIO_PCM_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }

    Ok(AudioResourceInfo {
        file_bytes,
        duration_seconds: duration.as_secs(),
        sample_rate,
        channels,
        estimated_pcm_bytes: pcm_bytes,
    })
}

pub fn validate_pcm_frames(sample_rate: u32, channels: u8, frames: u64) -> Result<(), String> {
    if !(MIN_AUDIO_SAMPLE_RATE..=MAX_AUDIO_SAMPLE_RATE).contains(&sample_rate)
        || channels == 0
        || channels > MAX_AUDIO_CHANNELS
    {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    let pcm_bytes = u128::from(frames)
        .checked_mul(u128::from(channels))
        .and_then(|samples| samples.checked_mul(4))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    let duration_nanos = u128::from(frames)
        .checked_mul(1_000_000_000)
        .map(|nanos| nanos / u128::from(sample_rate))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    if pcm_bytes > u128::from(MAX_AUDIO_PCM_BYTES) || duration_nanos > MAX_AUDIO_DURATION.as_nanos()
    {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    Ok(())
}

pub fn inspect_audio_file(path: &Path) -> Result<AudioResourceInfo, String> {
    let file_bytes = std::fs::metadata(path)
        .map_err(|error| error.to_string())?
        .len();
    if file_bytes > MAX_AUDIO_FILE_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }

    let tagged = lofty::read_from_path(path).map_err(|error| error.to_string())?;
    let properties = tagged.properties();
    let sample_rate = properties
        .sample_rate()
        .ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
    let channels = properties
        .channels()
        .ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
    validate_audio_properties(file_bytes, properties.duration(), sample_rate, channels)
}

pub fn read_bounded_audio_file(path: &Path) -> Result<(Vec<u8>, AudioResourceInfo), String> {
    let info = inspect_audio_file(path)?;
    let mut file = std::fs::File::open(path).map_err(|error| error.to_string())?;
    if file.metadata().map_err(|error| error.to_string())?.len() > MAX_AUDIO_FILE_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    let mut bytes = Vec::new();
    file.by_ref()
        .take(MAX_AUDIO_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_AUDIO_FILE_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    if bytes.len() as u64 != info.file_bytes {
        return Err("AUDIO_FILE_CHANGED".into());
    }
    Ok((bytes, info))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[test]
    fn estimates_pcm_memory_from_synthetic_audio_metadata() {
        let info = validate_audio_properties(1024, Duration::from_secs(60), 48_000, 2).unwrap();
        assert_eq!(info.estimated_pcm_bytes, 60 * 48_000 * 2 * 4);
    }

    #[test]
    fn rejects_audio_that_exceeds_the_decoded_pcm_budget() {
        let result = validate_audio_properties(1024, Duration::from_secs(30 * 60), 192_000, 2);
        assert_eq!(result.unwrap_err(), AUDIO_RESOURCE_LIMIT_ERROR);
    }

    #[test]
    fn rejects_unsupported_channel_and_sample_rate_metadata() {
        assert!(validate_audio_properties(1024, Duration::from_secs(10), 48_000, 9).is_err());
        assert!(validate_audio_properties(1024, Duration::from_secs(10), 384_000, 2).is_err());
        assert!(validate_audio_properties(1024, Duration::ZERO, 48_000, 2).is_err());
    }

    #[test]
    fn rejects_oversized_sparse_file_before_parsing_or_reading_audio_data() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("oversized.mp3");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(MAX_AUDIO_FILE_BYTES + 1).unwrap();

        let error = inspect_audio_file(&path).unwrap_err();
        assert_eq!(error, AUDIO_RESOURCE_LIMIT_ERROR);
    }

    #[test]
    fn bounds_audio_reads_to_the_compressed_file_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.wav");
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for _ in 0..480 {
            writer.write_sample(0_i16).unwrap();
            writer.write_sample(0_i16).unwrap();
        }
        writer.finalize().unwrap();

        let (bytes, info) = read_bounded_audio_file(&path).unwrap();
        assert_eq!(bytes.len() as u64, info.file_bytes);
        assert_eq!(info.sample_rate, 48_000);
        assert_eq!(info.channels, 2);
        assert!(info.estimated_pcm_bytes <= MAX_AUDIO_PCM_BYTES);
    }

    #[test]
    fn enforces_pcm_frame_limit_while_transcoding() {
        assert!(validate_pcm_frames(48_000, 2, 48_000 * 60).is_ok());
        assert_eq!(
            validate_pcm_frames(192_000, 2, 192_000 * 30 * 60).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
    }
}
