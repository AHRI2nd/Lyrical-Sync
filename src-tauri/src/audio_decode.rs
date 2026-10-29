use lofty::file::AudioFile;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::time::Duration;
use symphonia::core::io::MediaSource;

pub const MAX_AUDIO_FILE_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_AUDIO_PCM_BYTES: u64 = 1024 * 1024 * 1024;
pub const MAX_AUDIO_DURATION: Duration = Duration::from_secs(4 * 60 * 60);
const MAX_AUDIO_CHANNELS: u8 = 8;
const MIN_AUDIO_SAMPLE_RATE: u32 = 8_000;
const MAX_AUDIO_SAMPLE_RATE: u32 = 192_000;
const WEBAUDIO_BASE_SAMPLE_RATE: u32 = 48_000;
pub const AUDIO_RESOURCE_LIMIT_ERROR: &str = "AUDIO_RESOURCE_LIMIT";

pub fn validate_audio_properties(
    file_bytes: u64,
    duration: Duration,
    sample_rate: u32,
    channels: u8,
) -> Result<(), String> {
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
    Ok(())
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
    if pcm_bytes > u128::from(MAX_AUDIO_PCM_BYTES)
        || pcm_bytes
            .checked_add(128)
            .map_or(true, |bytes| bytes > u128::from(MAX_AUDIO_FILE_BYTES))
        || duration_nanos > MAX_AUDIO_DURATION.as_nanos()
    {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    Ok(())
}

pub fn inspect_audio_file(path: &Path) -> Result<u64, String> {
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
    validate_audio_properties(file_bytes, properties.duration(), sample_rate, channels)?;
    Ok(file_bytes)
}

pub fn read_bounded_audio_file(path: &Path) -> Result<Vec<u8>, String> {
    let expected_len = inspect_audio_file(path)?;
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
    if bytes.len() as u64 != expected_len {
        return Err("AUDIO_FILE_CHANGED".into());
    }
    Ok(bytes)
}

// Symphonia 0.5.5 counts the SSND offset/block-size header as sample data.
// Present only its length field corrected to the decoder; never modify the file.
struct AiffSource {
    source: Box<dyn MediaSource>,
    position: u64,
    length_offset: u64,
    length: [u8; 4],
}
impl Read for AiffSource {
    fn read(&mut self, buffer: &mut [u8]) -> std::io::Result<usize> {
        let count = self.source.read(buffer)?;
        let start = self.position.max(self.length_offset);
        let end = (self.position + count as u64).min(self.length_offset + 4);
        for position in start..end {
            buffer[(position - self.position) as usize] =
                self.length[(position - self.length_offset) as usize];
        }
        self.position += count as u64;
        Ok(count)
    }
}
impl Seek for AiffSource {
    fn seek(&mut self, position: SeekFrom) -> std::io::Result<u64> {
        self.position = self.source.seek(position)?;
        Ok(self.position)
    }
}
impl MediaSource for AiffSource {
    fn is_seekable(&self) -> bool {
        self.source.is_seekable()
    }
    fn byte_len(&self) -> Option<u64> {
        self.source.byte_len()
    }
}

fn prepare_source(
    mut source: Box<dyn MediaSource>,
) -> Result<(Box<dyn MediaSource>, Option<u64>), String> {
    let mut header = [0u8; 12];
    source
        .read_exact(&mut header)
        .map_err(|e| format!("Invalid audio header: {e}"))?;
    source.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    if &header[..4] != b"FORM" || !matches!(&header[8..], b"AIFF" | b"AIFC") {
        return Ok((source, None));
    }
    let end = 8 + u64::from(u32::from_be_bytes(header[4..8].try_into().unwrap()));
    if end < 12 || source.byte_len().is_some_and(|len| end > len) {
        return Err("Truncated AIFF container".into());
    }
    let mut position = 12u64;
    let mut expected_frames = None;
    while position + 8 <= end {
        source
            .seek(SeekFrom::Start(position))
            .map_err(|e| e.to_string())?;
        let mut chunk = [0u8; 8];
        source
            .read_exact(&mut chunk)
            .map_err(|e| format!("Truncated AIFF chunk: {e}"))?;
        let length = u32::from_be_bytes(chunk[4..].try_into().unwrap());
        if position + 8 + u64::from(length) > end {
            return Err("Invalid AIFF chunk length".into());
        }
        if &chunk[..4] == b"COMM" {
            if length < 18 {
                return Err("Invalid AIFF common chunk".into());
            }
            let mut common = [0u8; 6];
            source.read_exact(&mut common).map_err(|e| e.to_string())?;
            expected_frames = Some(u64::from(u32::from_be_bytes(
                common[2..].try_into().unwrap(),
            )));
        }
        if &chunk[..4] == b"SSND" {
            if length < 8 || expected_frames.is_none() {
                return Err("Invalid AIFF sound chunk".into());
            }
            source.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
            return Ok((
                Box::new(AiffSource {
                    source,
                    position: 0,
                    length_offset: position + 4,
                    length: (length - 8).to_be_bytes(),
                }),
                expected_frames,
            ));
        }
        position += 8 + u64::from(length) + u64::from(length % 2);
    }
    Err("Missing AIFF sound chunk".into())
}

pub fn decode_to_wav(source: Box<dyn MediaSource>, extension: &str) -> Result<Vec<u8>, String> {
    use std::io::{Cursor, ErrorKind};
    use symphonia::core::{
        audio::SampleBuffer, codecs::DecoderOptions, errors::Error, formats::FormatOptions,
        io::MediaSourceStream, meta::MetadataOptions, probe::Hint,
    };
    let (source, declared_frames) = prepare_source(source)?;
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let mut format = symphonia::default::get_probe()
        .format(
            &hint,
            MediaSourceStream::new(source, Default::default()),
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|e| format!("Unsupported or invalid audio format: {e}"))?
        .format;
    let track = format.default_track().ok_or("No audio track")?;
    let params = track.codec_params.clone();
    let track_id = track.id;
    let sample_rate = params
        .sample_rate
        .filter(|r| *r > 0)
        .ok_or("Missing sample rate")?;
    let channels = params.channels.ok_or("Missing channels")?.count();
    if channels == 0 || channels > u16::MAX as usize {
        return Err("Invalid channel count".into());
    }
    let channels_u8 = u8::try_from(channels).map_err(|_| AUDIO_RESOURCE_LIMIT_ERROR)?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|e| format!("Unsupported audio codec: {e}"))?;
    if declared_frames.is_some_and(|frames| Some(frames) != params.n_frames) {
        return Err("Inconsistent AIFF frame count".into());
    }
    validate_pcm_frames(sample_rate, channels_u8, params.n_frames.unwrap_or(0))?;
    // Reserve the known output once to avoid retaining old and new allocations
    // while a long WAV grows. IPC and browser copies still remain whole-file.
    let mut bytes = Vec::new();
    if let Some(frames) = params.n_frames {
        let capacity = frames
            .checked_mul(channels as u64)
            .and_then(|n| n.checked_mul(4))
            .and_then(|n| n.checked_add(128))
            .ok_or("WAV size overflow")?;
        if capacity > u32::MAX as u64 || capacity > MAX_AUDIO_FILE_BYTES {
            return Err("Audio exceeds WAV size limit".into());
        }
        bytes
            .try_reserve_exact(capacity as usize)
            .map_err(|e| format!("WAV allocation failed: {e}"))?;
    }
    let mut output = Cursor::new(bytes);
    let mut writer = hound::WavWriter::new(
        &mut output,
        hound::WavSpec {
            channels: channels as u16,
            sample_rate,
            bits_per_sample: 32,
            sample_format: hound::SampleFormat::Float,
        },
    )
    .map_err(|e| format!("WAV creation failed: {e}"))?;
    let mut frames = 0u64;
    loop {
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(e)) if e.kind() == ErrorKind::UnexpectedEof => break,
            Err(e) => return Err(format!("Audio packet read failed: {e}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|e| format!("Audio decode failed: {e}"))?;
        if decoded.spec().rate != sample_rate || decoded.spec().channels.count() != channels {
            return Err("Audio format changed during decoding".into());
        }
        frames = frames
            .checked_add(decoded.frames() as u64)
            .ok_or(AUDIO_RESOURCE_LIMIT_ERROR)?;
        validate_pcm_frames(sample_rate, channels_u8, frames)?;
        let output_size = u128::from(frames)
            .checked_mul(u128::from(channels_u8))
            .and_then(|samples| samples.checked_mul(4))
            .and_then(|bytes| bytes.checked_add(128))
            .ok_or(AUDIO_RESOURCE_LIMIT_ERROR)?;
        if output_size > u128::from(MAX_AUDIO_FILE_BYTES) {
            return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        // Only this packet's interleaved PCM is retained alongside the output WAV.
        let mut samples = SampleBuffer::<f32>::new(decoded.capacity() as u64, *decoded.spec());
        samples.copy_interleaved_ref(decoded);
        for &sample in samples.samples() {
            writer
                .write_sample(sample)
                .map_err(|e| format!("WAV write failed: {e}"))?;
        }
    }
    if frames == 0
        || params.n_frames.is_some_and(|expected| frames != expected)
        || declared_frames.is_some_and(|expected| frames != expected)
    {
        return Err(format!(
            "Truncated or empty audio data: decoded {frames}, expected {:?}",
            params.n_frames
        ));
    }
    writer
        .finalize()
        .map_err(|e| format!("WAV finalization failed: {e}"))?;
    Ok(output.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    // Synthetic signed 16-bit AIFF with a standard 8 kHz extended sample rate.
    fn aiff(frames: u32, channels: u16) -> Vec<u8> {
        let data_len = frames * u32::from(channels) * 2;
        let mut data = Vec::new();
        data.extend_from_slice(b"FORM");
        data.extend_from_slice(&(46 + data_len).to_be_bytes());
        data.extend_from_slice(b"AIFFCOMM");
        data.extend_from_slice(&18u32.to_be_bytes());
        data.extend_from_slice(&channels.to_be_bytes());
        data.extend_from_slice(&frames.to_be_bytes());
        data.extend_from_slice(&16u16.to_be_bytes());
        data.extend_from_slice(&[0x40, 0x0b, 0xfa, 0, 0, 0, 0, 0, 0, 0]);
        data.extend_from_slice(b"SSND");
        data.extend_from_slice(&(8 + data_len).to_be_bytes());
        data.extend_from_slice(&[0; 8]);
        for _ in 0..frames * u32::from(channels) {
            data.extend_from_slice(&8192i16.to_be_bytes());
        }
        data
    }

    #[test]
    fn converts_mono_and_stereo_to_float_wav_bytes() {
        for channels in [1, 2] {
            let bytes =
                decode_to_wav(Box::new(Cursor::new(aiff(16000, channels))), "aiff").unwrap();
            assert_eq!(&bytes[..4], b"RIFF");
            let mut wav = hound::WavReader::new(Cursor::new(bytes)).unwrap();
            assert_eq!(wav.spec().channels, channels);
            assert_eq!(wav.spec().sample_rate, 8000);
            assert_eq!(wav.duration(), 16000);
            assert!(wav
                .samples::<f32>()
                .all(|s| (s.unwrap() - 0.25).abs() < 0.0001));
        }
    }

    #[test]
    fn enforces_the_one_gib_audio_file_and_pcm_limits() {
        assert!(
            validate_audio_properties(1024, std::time::Duration::from_secs(60), 48_000, 2).is_ok()
        );
        assert!(validate_audio_properties(
            MAX_AUDIO_FILE_BYTES,
            std::time::Duration::from_secs(60),
            48_000,
            2
        )
        .is_ok());
        assert_eq!(
            validate_audio_properties(
                MAX_AUDIO_FILE_BYTES + 1,
                std::time::Duration::from_secs(60),
                48_000,
                2
            )
            .unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
        assert_eq!(
            validate_audio_properties(1024, std::time::Duration::from_secs(30 * 60), 192_000, 2)
                .unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
        assert!(validate_pcm_frames(48_000, 2, 48_000 * 60).is_ok());
        assert_eq!(
            validate_pcm_frames(192_000, 2, 192_000 * 30 * 60).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
    }

    #[test]
    fn rejects_oversized_sparse_audio_before_parsing_or_reading_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("oversized.mp3");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(MAX_AUDIO_FILE_BYTES + 1)
            .unwrap();
        assert_eq!(
            inspect_audio_file(&path).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
    }

    #[test]
    fn reads_a_supported_audio_file_after_validating_its_size_and_pcm_estimate() {
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
        let bytes = read_bounded_audio_file(&path).unwrap();
        assert_eq!(bytes.len() as u64, std::fs::metadata(path).unwrap().len());
    }

    #[test]
    fn rejects_corrupt_and_truncated_input() {
        assert!(decode_to_wav(Box::new(Cursor::new(b"invalid".to_vec())), "aiff").is_err());
        let mut bytes = aiff(16000, 2);
        bytes.truncate(bytes.len() - 100);
        assert!(decode_to_wav(Box::new(Cursor::new(bytes)), "aiff").is_err());
    }

    #[test]
    fn conversions_are_independent() {
        let tasks: Vec<_> = [1, 2]
            .into_iter()
            .map(|channels| {
                std::thread::spawn(move || {
                    decode_to_wav(Box::new(Cursor::new(aiff(8000, channels))), "aiff").unwrap()
                })
            })
            .collect();
        for (index, task) in tasks.into_iter().enumerate() {
            let wav = hound::WavReader::new(Cursor::new(task.join().unwrap())).unwrap();
            assert_eq!(wav.spec().channels, (index + 1) as u16);
            assert_eq!(wav.duration(), 8000);
        }
    }
    #[test]
    fn validates_declared_frames_and_ignores_trailing_chunks() {
        let mut bytes = aiff(8000, 1);
        bytes[22..26].copy_from_slice(&8001u32.to_be_bytes());
        assert!(decode_to_wav(Box::new(Cursor::new(bytes)), "aiff").is_err());
        let mut bytes = aiff(8000, 1);
        bytes.extend_from_slice(b"NAME\0\0\0\x04test");
        let size = (bytes.len() - 8) as u32;
        bytes[4..8].copy_from_slice(&size.to_be_bytes());
        let result = decode_to_wav(Box::new(Cursor::new(bytes)), "aiff").unwrap();
        assert_eq!(
            hound::WavReader::new(Cursor::new(result))
                .unwrap()
                .duration(),
            8000
        );
    }

    #[test]
    #[ignore = "Requires opt-in synthetic 1/10/60-minute fixture directory"]
    fn profile_long_aiff_fixtures() {
        let directory = std::env::var("LYRICAL_AUDIO_FIXTURES").unwrap();
        let sample_rate: u32 = std::env::var("LYRICAL_AUDIO_SAMPLE_RATE")
            .unwrap_or_else(|_| "8000".into())
            .parse()
            .unwrap();
        for minutes in [1, 10, 60] {
            for channels in [1, 2] {
                let path = format!("{directory}/{minutes}-{channels}.aiff");
                let start = std::time::Instant::now();
                let bytes =
                    decode_to_wav(Box::new(std::fs::File::open(path).unwrap()), "aiff").unwrap();
                let length = bytes.len();
                let wav = hound::WavReader::new(Cursor::new(bytes)).unwrap();
                assert_eq!(wav.spec().sample_rate, sample_rate);
                assert_eq!(wav.spec().channels, channels);
                assert_eq!(wav.duration(), minutes * 60 * sample_rate);
                println!(
                    "{minutes}min {channels}ch: {length} WAV bytes, {:?}",
                    start.elapsed()
                );
            }
        }
    }
}
