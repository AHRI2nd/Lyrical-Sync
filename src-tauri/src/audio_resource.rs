use lofty::file::AudioFile;
use serde::Serialize;
use std::io::{Read, Seek, SeekFrom};
use std::fs::{File, OpenOptions};
use std::path::Path;
use std::time::Duration;

pub const MAX_AUDIO_FILE_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_AUDIO_PCM_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_AUDIO_DURATION: Duration = Duration::from_secs(4 * 60 * 60);
const MAX_AUDIO_CHANNELS: u8 = 8;
const MIN_AUDIO_SAMPLE_RATE: u32 = 8_000;
const MAX_AUDIO_SAMPLE_RATE: u32 = 192_000;
const WEBAUDIO_BASE_SAMPLE_RATE: u32 = 48_000;
pub const AUDIO_RESOURCE_LIMIT_ERROR: &str = "AUDIO_RESOURCE_LIMIT";

fn open_audio_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|error| error.to_string())?;
    if !file.metadata().map_err(|error| error.to_string())?.is_file() {
        return Err("Audio path is not a regular file".into());
    }
    Ok(file)
}

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
    let mut file = open_audio_file(path)?;
    inspect_audio_file_handle(&mut file)
}

fn inspect_audio_file_handle(file: &mut std::fs::File) -> Result<AudioResourceInfo, String> {
    let file_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    if file_bytes > MAX_AUDIO_FILE_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }

    file.seek(SeekFrom::Start(0)).map_err(|error| error.to_string())?;
    let tagged = lofty::read_from(file).map_err(|error| error.to_string())?;
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
    read_bounded_audio_file_with_hook(path, || {})
}

fn read_bounded_audio_file_with_hook(
    path: &Path,
    after_inspect: impl FnOnce(),
) -> Result<(Vec<u8>, AudioResourceInfo), String> {
    let mut file = open_audio_file(path)?;
    let info = inspect_audio_file_handle(&mut file)?;
    after_inspect();
    if file.metadata().map_err(|error| error.to_string())?.len() > MAX_AUDIO_FILE_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    file.seek(SeekFrom::Start(0)).map_err(|error| error.to_string())?;
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
    fn permits_exactly_one_gibibyte_resource_budgets_and_rejects_the_next_unit() {
        let one_gib = 1024_u64 * 1024 * 1024;
        assert_eq!(MAX_AUDIO_FILE_BYTES, one_gib);
        assert_eq!(MAX_AUDIO_PCM_BYTES, one_gib);
        assert!(validate_audio_properties(one_gib, Duration::from_secs(1), 48_000, 2).is_ok());
        assert_eq!(
            validate_audio_properties(one_gib + 1, Duration::from_secs(1), 48_000, 2)
                .unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );

        let stereo_frames_at_limit = MAX_AUDIO_PCM_BYTES / (2 * 4);
        assert!(validate_pcm_frames(48_000, 2, stereo_frames_at_limit).is_ok());
        assert_eq!(
            validate_pcm_frames(48_000, 2, stereo_frames_at_limit + 1).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
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
    #[cfg(unix)]
    fn rejects_fifo_audio_paths_without_blocking() {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        use std::sync::mpsc;
        use std::thread;

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.pipe");
        let c_path = CString::new(path.as_os_str().as_bytes()).unwrap();
        assert_eq!(unsafe { libc::mkfifo(c_path.as_ptr(), 0o600) }, 0);

        let inspect_path = path.clone();
        let (inspect_tx, inspect_rx) = mpsc::channel();
        thread::spawn(move || { let _ = inspect_tx.send(inspect_audio_file(&inspect_path)); });
        let inspect = inspect_rx.recv_timeout(Duration::from_secs(1)).expect("FIFO inspection must not block");
        assert!(inspect.unwrap_err().contains("regular file"));

        let read_path = path.clone();
        let (read_tx, read_rx) = mpsc::channel();
        thread::spawn(move || { let _ = read_tx.send(read_bounded_audio_file(&read_path)); });
        let read = read_rx.recv_timeout(Duration::from_secs(1)).expect("FIFO read must not block");
        assert!(read.unwrap_err().contains("regular file"));
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
    #[cfg(unix)]
    fn audio_replacement_after_inspection_cannot_change_the_read_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.wav");
        let replacement = dir.path().join("replacement.wav");
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        for (target, sample) in [(&path, 1_i16), (&replacement, 2_i16)] {
            let mut writer = hound::WavWriter::create(target, spec).unwrap();
            for _ in 0..480 {
                writer.write_sample(sample).unwrap();
                writer.write_sample(sample).unwrap();
            }
            writer.finalize().unwrap();
        }
        let original_bytes = std::fs::read(&path).unwrap();
        let replacement_bytes = std::fs::read(&replacement).unwrap();
        assert_eq!(original_bytes.len(), replacement_bytes.len());
        assert_ne!(original_bytes, replacement_bytes);

        let (bytes, _) = read_bounded_audio_file_with_hook(&path, || {
            std::fs::rename(&replacement, &path).unwrap();
        })
        .unwrap();

        assert_eq!(bytes, original_bytes);
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
