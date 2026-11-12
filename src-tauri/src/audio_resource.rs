use lofty::file::AudioFile;
use serde::Serialize;
use std::fs::{File, OpenOptions};
use std::io::{Read, Seek, SeekFrom};
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

pub(crate) fn open_audio_file(path: &Path) -> Result<File, String> {
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

pub(crate) fn validate_web_audio_pcm_frames(
    sample_rate: u32,
    channels: u8,
    frames: u64,
) -> Result<(), String> {
    validate_pcm_frames(sample_rate, channels, frames)?;

    let effective_rate = sample_rate.max(WEBAUDIO_BASE_SAMPLE_RATE);
    let estimated_frames = u128::from(frames)
        .checked_mul(u128::from(effective_rate))
        .and_then(|scaled| scaled.checked_add(u128::from(sample_rate) - 1))
        .map(|scaled| scaled / u128::from(sample_rate))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    let estimated_pcm_bytes = estimated_frames
        .checked_mul(u128::from(channels))
        .and_then(|samples| samples.checked_mul(4))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    if estimated_pcm_bytes > u128::from(MAX_AUDIO_PCM_BYTES) {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    Ok(())
}

#[cfg(test)]
pub fn inspect_audio_file(path: &Path) -> Result<AudioResourceInfo, String> {
    let mut file = open_audio_file(path)?;
    inspect_audio_file_handle(&mut file)
}

/// Copies admitted audio into a private, bounded temporary file and validates the exact bytes
/// that downstream AI sidecars will reopen. The returned path owns the snapshot lifetime.
pub fn stage_bounded_audio_file(
    path: &Path,
) -> Result<(tempfile::TempPath, AudioResourceInfo), String> {
    let (staged, info) = stage_bounded_audio_file_with_check(path, || Ok(()))?;
    Ok((staged.into_temp_path(), info))
}

pub(crate) fn stage_bounded_audio_file_with_check(
    path: &Path,
    mut check_cancelled: impl FnMut() -> Result<(), String>,
) -> Result<(tempfile::NamedTempFile, AudioResourceInfo), String> {
    check_cancelled()?;
    let mut source = open_audio_file(path)?;
    let expected_bytes = source.metadata().map_err(|error| error.to_string())?.len();
    if expected_bytes > MAX_AUDIO_FILE_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }

    let suffix = path
        .extension()
        .and_then(|extension| extension.to_str())
        .filter(|extension| {
            !extension.is_empty()
                && extension.len() <= 16
                && extension.bytes().all(|byte| byte.is_ascii_alphanumeric())
        })
        .map(|extension| format!(".{extension}"));
    let mut builder = tempfile::Builder::new();
    builder.prefix("lyrical_sync_ai_audio_");
    if let Some(suffix) = suffix.as_deref() {
        builder.suffix(suffix);
    }
    let mut staged = builder
        .tempfile()
        .map_err(|error| format!("Audio snapshot creation failed: {error}"))?;

    let mut copied = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        check_cancelled()?;
        let remaining = MAX_AUDIO_FILE_BYTES
            .checked_add(1)
            .and_then(|limit| limit.checked_sub(copied))
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        let read_limit = usize::try_from(remaining.min(buffer.len() as u64)).unwrap();
        let read = source
            .read(&mut buffer[..read_limit])
            .map_err(|error| format!("Audio snapshot failed: {error}"))?;
        if read == 0 {
            break;
        }
        copied = copied
            .checked_add(read as u64)
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        if copied > MAX_AUDIO_FILE_BYTES {
            return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        std::io::Write::write_all(staged.as_file_mut(), &buffer[..read])
            .map_err(|error| format!("Audio snapshot failed: {error}"))?;
    }
    if copied != expected_bytes {
        return Err("AUDIO_FILE_CHANGED".into());
    }
    std::io::Write::flush(staged.as_file_mut())
        .map_err(|error| format!("Audio snapshot flush failed: {error}"))?;

    let snapshot_info =
        inspect_audio_file_handle_with_check(staged.as_file_mut(), &mut check_cancelled)?;
    if snapshot_info.file_bytes != copied {
        return Err("AUDIO_FILE_CHANGED".into());
    }

    Ok((staged, snapshot_info))
}

struct AacBitReader<'a> {
    bytes: &'a [u8],
    bit_offset: usize,
}

impl AacBitReader<'_> {
    fn read_bits(&mut self, bit_count: u8) -> Option<u32> {
        let end = self.bit_offset.checked_add(usize::from(bit_count))?;
        if end > self.bytes.len().checked_mul(8)? {
            return None;
        }
        let mut value = 0_u32;
        while self.bit_offset < end {
            let byte = self.bytes[self.bit_offset / 8];
            let bit = (byte >> (7 - self.bit_offset % 8)) & 1;
            value = (value << 1) | u32::from(bit);
            self.bit_offset += 1;
        }
        Some(value)
    }

    fn skip_bits(&mut self, bit_count: usize) -> Option<()> {
        let end = self.bit_offset.checked_add(bit_count)?;
        if end > self.bytes.len().checked_mul(8)? {
            return None;
        }
        self.bit_offset = end;
        Some(())
    }

    fn align_to_byte(&mut self) -> Option<()> {
        self.bit_offset = self.bit_offset.checked_add(7)? & !7;
        if self.bit_offset > self.bytes.len().checked_mul(8)? {
            return None;
        }
        Some(())
    }
}

fn aac_program_config_channels(payload: &[u8], expected_rate_index: usize) -> Option<u8> {
    let mut bits = AacBitReader {
        bytes: payload,
        bit_offset: 0,
    };
    if bits.read_bits(3)? != 5 {
        return None;
    }
    bits.skip_bits(4)?;
    bits.skip_bits(2)?;
    if usize::try_from(bits.read_bits(4)?).ok()? != expected_rate_index {
        return None;
    }

    let front_count = bits.read_bits(4)? as usize;
    let side_count = bits.read_bits(4)? as usize;
    let back_count = bits.read_bits(4)? as usize;
    let lfe_count = bits.read_bits(2)? as usize;
    let assoc_count = bits.read_bits(3)? as usize;
    let valid_cc_count = bits.read_bits(4)? as usize;

    if bits.read_bits(1)? != 0 {
        bits.skip_bits(4)?;
    }
    if bits.read_bits(1)? != 0 {
        bits.skip_bits(4)?;
    }
    if bits.read_bits(1)? != 0 {
        bits.skip_bits(3)?;
    }

    let mut channels = 0_u8;
    for element_count in [front_count, side_count, back_count] {
        for _ in 0..element_count {
            let is_channel_pair = bits.read_bits(1)? != 0;
            bits.skip_bits(4)?;
            channels = channels.checked_add(if is_channel_pair { 2 } else { 1 })?;
        }
    }
    bits.skip_bits(lfe_count.checked_mul(4)?)?;
    channels = channels.checked_add(u8::try_from(lfe_count).ok()?)?;
    bits.skip_bits(assoc_count.checked_mul(4)?)?;
    bits.skip_bits(valid_cc_count.checked_mul(5)?)?;
    bits.align_to_byte()?;
    let comment_bytes = usize::try_from(bits.read_bits(8)?).ok()?;
    bits.skip_bits(comment_bytes.checked_mul(8)?)?;

    (channels > 0 && channels <= MAX_AUDIO_CHANNELS).then_some(channels)
}

fn inspect_adts_aac(
    file: &mut File,
    file_bytes: u64,
    check_cancelled: &mut impl FnMut() -> Result<(), String>,
) -> Result<Option<AudioResourceInfo>, String> {
    let mut audio_end = file_bytes;
    if file_bytes >= 128 {
        file.seek(SeekFrom::Start(file_bytes - 128))
            .map_err(|error| error.to_string())?;
        let mut id3v1_signature = [0_u8; 3];
        file.read_exact(&mut id3v1_signature)
            .map_err(|error| error.to_string())?;
        if &id3v1_signature == b"TAG" {
            audio_end -= 128;
        }
    }

    file.seek(SeekFrom::Start(0)).map_err(|error| error.to_string())?;
    let mut prefix = [0_u8; 10];
    let prefix_len = file.read(&mut prefix).map_err(|error| error.to_string())?;
    let mut offset = 0_u64;

    if prefix_len >= prefix.len() && &prefix[..3] == b"ID3" {
        if prefix[6..10].iter().any(|byte| byte & 0x80 != 0) {
            return Ok(None);
        }
        let tag_size = prefix[6..10]
            .iter()
            .fold(0_u64, |size, byte| (size << 7) | u64::from(*byte));
        let footer_size = if prefix[5] & 0x10 != 0 { 10 } else { 0 };
        offset = 10_u64
            .checked_add(tag_size)
            .and_then(|size| size.checked_add(footer_size))
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        if offset > file_bytes {
            return Ok(None);
        }
    }

    if audio_end.saturating_sub(offset) < 2 {
        return Ok(None);
    }
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let mut sync = [0_u8; 2];
    file.read_exact(&mut sync)
        .map_err(|error| error.to_string())?;
    if sync[0] != 0xff || sync[1] & 0xf6 != 0xf0 {
        return Ok(None);
    }

    const SAMPLE_RATES: [u32; 13] = [
        96_000, 88_200, 64_000, 48_000, 44_100, 32_000, 24_000, 22_050, 16_000, 12_000, 11_025,
        8_000, 7_350,
    ];
    const CHANNELS: [u8; 8] = [0, 1, 2, 3, 4, 5, 6, 8];

    let mut sample_rate = None;
    let mut channels = None;
    let mut decoded_frames = 0_u128;
    while offset < audio_end {
        check_cancelled()?;
        if audio_end - offset < 7 {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }
        file.seek(SeekFrom::Start(offset))
            .map_err(|error| error.to_string())?;
        let mut header = [0_u8; 7];
        file.read_exact(&mut header)
            .map_err(|error| error.to_string())?;
        if header[0] != 0xff || header[1] & 0xf6 != 0xf0 {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }

        let rate_index = usize::from((header[2] >> 2) & 0x0f);
        let rate = *SAMPLE_RATES
            .get(rate_index)
            .ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
        let channel_index = usize::from(((header[2] & 0x01) << 2) | (header[3] >> 6));
        let frame_length = (u64::from(header[3] & 0x03) << 11)
            | (u64::from(header[4]) << 3)
            | u64::from(header[5] >> 5);
        let header_length = if header[1] & 0x01 == 0 { 9 } else { 7 };
        if frame_length < header_length || frame_length > audio_end - offset {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }

        let channel_count = if channel_index == 0 {
            if let Some(channels) = channels {
                channels
            } else {
                let payload_length = usize::try_from(frame_length - header_length)
                    .map_err(|_| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
                let mut payload = vec![0_u8; payload_length];
                file.seek(SeekFrom::Start(offset + header_length))
                    .map_err(|error| error.to_string())?;
                file.read_exact(&mut payload)
                    .map_err(|error| error.to_string())?;
                aac_program_config_channels(&payload, rate_index)
                    .ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?
            }
        } else {
            CHANNELS[channel_index]
        };
        if channel_count == 0
            || sample_rate.is_some_and(|previous| previous != rate)
            || channels.is_some_and(|previous| previous != channel_count)
        {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }

        sample_rate = Some(rate);
        channels = Some(channel_count);
        let raw_blocks = u128::from(header[6] & 0x03) + 1;
        decoded_frames = decoded_frames
            .checked_add(1024_u128 * raw_blocks)
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        let duration_nanos = decoded_frames
            .checked_mul(1_000_000_000)
            .map(|nanos| nanos / u128::from(rate))
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        if duration_nanos > MAX_AUDIO_DURATION.as_nanos() {
            return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        let effective_rate = u128::from(rate.max(WEBAUDIO_BASE_SAMPLE_RATE));
        let estimated_output_frames = decoded_frames
            .checked_mul(effective_rate)
            .and_then(|frames| frames.checked_add(u128::from(rate) - 1))
            .map(|frames| frames / u128::from(rate))
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        let estimated_pcm_bytes = estimated_output_frames
            .checked_mul(u128::from(channel_count))
            .and_then(|samples| samples.checked_mul(4))
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        if estimated_pcm_bytes > u128::from(MAX_AUDIO_PCM_BYTES) {
            return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        offset = offset
            .checked_add(frame_length)
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    }

    let sample_rate = sample_rate.ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
    let channels = channels.ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
    let duration_nanos = decoded_frames
        .checked_mul(1_000_000_000)
        .map(|nanos| nanos / u128::from(sample_rate))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    let duration_nanos =
        u64::try_from(duration_nanos).map_err(|_| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    let duration = Duration::from_nanos(duration_nanos);
    validate_audio_properties(file_bytes, duration, sample_rate, channels).map(Some)
}

fn validate_flac_frame_budget(
    file_bytes: u64,
    sample_rate: u32,
    channels: u8,
    frames: u64,
) -> Result<AudioResourceInfo, String> {
    if frames == 0 {
        return Err("AUDIO_METADATA_UNAVAILABLE".into());
    }
    validate_audio_properties(file_bytes, Duration::from_secs(1), sample_rate, channels)?;
    let duration_nanos = u128::from(frames)
        .checked_mul(1_000_000_000)
        .map(|nanos| nanos / u128::from(sample_rate))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    let duration_nanos =
        u64::try_from(duration_nanos).map_err(|_| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    validate_audio_properties(
        file_bytes,
        Duration::from_nanos(duration_nanos),
        sample_rate,
        channels,
    )
}

fn find_flac_stream_offset(file: &mut File) -> Result<Option<u64>, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut prefix = [0_u8; 4];
    match file.read_exact(&mut prefix) {
        Ok(()) if &prefix == b"fLaC" => return Ok(Some(0)),
        Ok(()) if &prefix[..3] != b"ID3" => return Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => return Ok(None),
        Err(error) => return Err(error.to_string()),
        _ => {}
    }

    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut header = [0_u8; 10];
    file.read_exact(&mut header)
        .map_err(|_| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
    if !(2..=4).contains(&header[3]) || header[6..10].iter().any(|byte| byte & 0x80 != 0) {
        return Err("AUDIO_METADATA_UNAVAILABLE".into());
    }
    let tag_bytes = (u64::from(header[6]) << 21)
        | (u64::from(header[7]) << 14)
        | (u64::from(header[8]) << 7)
        | u64::from(header[9]);
    let footer_bytes = u64::from(header[3] == 4 && header[5] & 0x10 != 0) * 10;
    let offset = 10_u64
        .checked_add(tag_bytes)
        .and_then(|offset| offset.checked_add(footer_bytes))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    file.seek(SeekFrom::Start(offset))
        .map_err(|error| error.to_string())?;
    let mut magic = [0_u8; 4];
    match file.read_exact(&mut magic) {
        Ok(()) if &magic == b"fLaC" => Ok(Some(offset)),
        Ok(()) => Ok(None),
        Err(error) if error.kind() == std::io::ErrorKind::UnexpectedEof => {
            Err("AUDIO_METADATA_UNAVAILABLE".into())
        }
        Err(error) => Err(error.to_string()),
    }
}

fn inspect_flac_frames(
    file: &mut File,
    file_bytes: u64,
    check_cancelled: &mut impl FnMut() -> Result<(), String>,
) -> Result<Option<AudioResourceInfo>, String> {
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let Some(stream_offset) = find_flac_stream_offset(file)? else {
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        return Ok(None);
    };

    file.seek(SeekFrom::Start(stream_offset))
        .map_err(|error| error.to_string())?;
    let source = file.try_clone().map_err(|error| error.to_string())?;
    let stream = MediaSourceStream::new(Box::new(source), Default::default());
    let mut hint = Hint::new();
    hint.with_extension("flac");
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            stream,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("AUDIO_METADATA_UNAVAILABLE: {error}"))?;
    let mut format = probed.format;
    let track = format
        .default_track()
        .ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
    let track_id = track.id;
    let sample_rate = track
        .codec_params
        .sample_rate
        .ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?;
    let channels = track
        .codec_params
        .channels
        .ok_or_else(|| "AUDIO_METADATA_UNAVAILABLE".to_string())?
        .count();
    let channels = u8::try_from(channels).map_err(|_| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;

    let mut frames = 0_u64;
    loop {
        check_cancelled()?;
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(symphonia::core::errors::Error::IoError(error))
                if error.kind() == std::io::ErrorKind::UnexpectedEof =>
            {
                break;
            }
            Err(error) => return Err(format!("AUDIO_METADATA_UNAVAILABLE: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let packet_frames = packet.dur();
        if packet_frames == 0 {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }
        frames = frames
            .checked_add(packet_frames)
            .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        validate_flac_frame_budget(file_bytes, sample_rate, channels, frames)?;
    }

    let info = validate_flac_frame_budget(file_bytes, sample_rate, channels, frames)?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    Ok(Some(info))
}

pub(crate) fn inspect_audio_file_handle(file: &mut std::fs::File) -> Result<AudioResourceInfo, String> {
    inspect_audio_file_handle_with_check(file, || Ok(()))
}

pub(crate) fn inspect_audio_file_handle_with_check(
    file: &mut std::fs::File,
    mut check_cancelled: impl FnMut() -> Result<(), String>,
) -> Result<AudioResourceInfo, String> {
    check_cancelled()?;
    let file_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    if file_bytes > MAX_AUDIO_FILE_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }

    if let Some(info) = inspect_adts_aac(file, file_bytes, &mut check_cancelled)? {
        return Ok(info);
    }

    if let Some(info) = inspect_flac_frames(file, file_bytes, &mut check_cancelled)? {
        return Ok(info);
    }

    check_cancelled()?;
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
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
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
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
            validate_audio_properties(one_gib + 1, Duration::from_secs(1), 48_000, 2).unwrap_err(),
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
    fn staged_audio_remains_the_admitted_input_after_the_source_path_is_replaced() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("audio.wav");
        let replacement = dir.path().join("replacement.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut original = hound::WavWriter::create(&path, spec).unwrap();
        for _ in 0..480 {
            original.write_sample(0_i16).unwrap();
        }
        original.finalize().unwrap();
        let admitted_bytes = std::fs::read(&path).unwrap();

        let mut changed = hound::WavWriter::create(&replacement, spec).unwrap();
        for _ in 0..480 {
            changed.write_sample(1_000_i16).unwrap();
        }
        changed.finalize().unwrap();
        let replacement_bytes = std::fs::read(&replacement).unwrap();
        assert_ne!(admitted_bytes, replacement_bytes);

        let (snapshot, info) = stage_bounded_audio_file(&path).unwrap();
        assert_eq!(info.file_bytes, admitted_bytes.len() as u64);
        assert!(snapshot
            .extension()
            .is_some_and(|extension| extension == "wav"));
        let snapshot_path = snapshot.to_path_buf();
        std::fs::remove_file(&path).unwrap();
        std::fs::rename(&replacement, &path).unwrap();

        let sidecar_bytes = std::fs::read(&snapshot).unwrap();
        assert_eq!(sidecar_bytes, admitted_bytes);
        drop(snapshot);
        assert!(
            !snapshot_path.exists(),
            "temporary audio snapshot should be removed"
        );
    }

    #[test]
    fn cancellable_snapshot_copy_stops_between_bounded_chunks_and_preserves_source() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("cancel-copy.wav");
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(&path, spec).unwrap();
        for _ in 0..80_000 {
            writer.write_sample(123_i16).unwrap();
            writer.write_sample(-123_i16).unwrap();
        }
        writer.finalize().unwrap();
        let source_before = std::fs::read(&path).unwrap();
        let mut checks = 0;

        let result = stage_bounded_audio_file_with_check(&path, || {
            checks += 1;
            if checks >= 3 {
                Err("cancelled".into())
            } else {
                Ok(())
            }
        });

        assert_eq!(result.unwrap_err(), "cancelled");
        assert_eq!(std::fs::read(&path).unwrap(), source_before);
    }

    #[test]
    fn inspects_flac_duration_from_frames_instead_of_streaminfo_total_samples() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("understated.flac");
        std::fs::write(
            &path,
            include_bytes!("../test-fixtures/understated-duration.flac"),
        )
        .unwrap();

        let (bytes, info) = read_bounded_audio_file(&path).unwrap();

        assert!(bytes.starts_with(b"fLaC"));
        assert_eq!(info.duration_seconds, 3);
        assert_eq!(info.estimated_pcm_bytes, 3 * 48_000 * 2 * 4);
    }

    #[test]
    fn inspects_flac_duration_after_a_valid_id3v2_prefix() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("understated-with-id3.flac");
        let mut bytes = b"ID3\x04\x00\x00\x00\x00\x00\x00".to_vec();
        bytes.extend_from_slice(include_bytes!("../test-fixtures/understated-duration.flac"));
        std::fs::write(&path, bytes).unwrap();

        let info = inspect_audio_file(&path).unwrap();

        assert_eq!(info.duration_seconds, 3);
        assert_eq!(info.estimated_pcm_bytes, 3 * 48_000 * 2 * 4);
    }

    #[test]
    fn rejects_flac_frame_count_that_exceeds_the_decoded_pcm_budget() {
        let frames_over_limit = MAX_AUDIO_PCM_BYTES / (2 * 4) + 1;

        assert_eq!(
            validate_flac_frame_budget(1024, 48_000, 2, frames_over_limit).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
    }

    #[test]
    fn rejects_invalid_flac_sample_rate_without_panicking() {
        assert!(validate_flac_frame_budget(1024, 0, 2, 1).is_err());
    }

    #[test]
    fn inspects_adts_aac_duration_from_frame_headers() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("variable-rate.aac");
        let mut bytes = Vec::new();
        for index in 0..1_292 {
            let frame_len = if index % 2 == 0 { 12_usize } else { 80_usize };
            let channel_config = 1_u8;
            let mut frame = vec![0_u8; frame_len];
            frame[0] = 0xff;
            frame[1] = 0xf1;
            frame[2] = 0x50 | (channel_config >> 2);
            frame[3] = ((channel_config & 0x03) << 6) | (((frame_len >> 11) & 0x03) as u8);
            frame[4] = (frame_len >> 3) as u8;
            frame[5] = (((frame_len & 0x07) as u8) << 5) | 0x1f;
            frame[6] = 0xfc;
            bytes.extend_from_slice(&frame);
        }
        let mut id3v1_tag = [0_u8; 128];
        id3v1_tag[..3].copy_from_slice(b"TAG");
        bytes.extend_from_slice(&id3v1_tag);
        std::fs::write(&path, bytes).unwrap();

        let info = inspect_audio_file(&path).unwrap();

        assert_eq!(info.sample_rate, 44_100);
        assert_eq!(info.channels, 1);
        assert_eq!(info.duration_seconds, 30);
    }

    #[test]
    fn reads_multichannel_layout_from_adts_program_config_element() {
        fn push_bits(bits: &mut Vec<bool>, value: u32, count: usize) {
            for shift in (0..count).rev() {
                bits.push((value >> shift) & 1 != 0);
            }
        }

        let mut pce = Vec::new();
        push_bits(&mut pce, 5, 3); // program_config_element
        push_bits(&mut pce, 0, 4); // element_instance_tag
        push_bits(&mut pce, 1, 2); // object_type
        push_bits(&mut pce, 3, 4); // 48 kHz sampling_frequency_index
        push_bits(&mut pce, 2, 4); // two front elements
        push_bits(&mut pce, 1, 4); // one side element
        push_bits(&mut pce, 1, 4); // one back element
        push_bits(&mut pce, 1, 2); // one LFE element
        push_bits(&mut pce, 0, 3); // no associated data elements
        push_bits(&mut pce, 0, 4); // no valid CC elements
        push_bits(&mut pce, 0, 1); // no mono mixdown
        push_bits(&mut pce, 0, 1); // no stereo mixdown
        push_bits(&mut pce, 0, 1); // no matrix mixdown
        push_bits(&mut pce, 1, 1); // front CPE = two channels
        push_bits(&mut pce, 0, 4);
        push_bits(&mut pce, 0, 1); // front SCE = one channel
        push_bits(&mut pce, 1, 4);
        push_bits(&mut pce, 1, 1); // side CPE = two channels
        push_bits(&mut pce, 0, 4);
        push_bits(&mut pce, 1, 1); // back CPE = two channels
        push_bits(&mut pce, 0, 4);
        push_bits(&mut pce, 0, 4); // LFE tag
        while pce.len() % 8 != 0 {
            pce.push(false);
        }
        push_bits(&mut pce, 0, 8); // no comment bytes
        let payload: Vec<u8> = pce
            .chunks(8)
            .map(|chunk| {
                chunk
                    .iter()
                    .fold(0_u8, |byte, bit| (byte << 1) | u8::from(*bit))
            })
            .collect();

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seven-one.aac");
        let frame_len = 7 + payload.len();
        let mut stream = Vec::new();
        for _ in 0..48 {
            let mut header = [0_u8; 7];
            header[0] = 0xff;
            header[1] = 0xf1;
            header[2] = 0x4c; // AAC-LC, 48 kHz, channel configuration 0
            header[3] = 0;
            header[4] = (frame_len >> 3) as u8;
            header[5] = (((frame_len & 0x07) as u8) << 5) | 0x1f;
            header[6] = 0xfc;
            stream.extend_from_slice(&header);
            stream.extend_from_slice(&payload);
        }
        std::fs::write(&path, stream).unwrap();

        let info = inspect_audio_file(&path).unwrap();

        assert_eq!(info.sample_rate, 48_000);
        assert_eq!(info.channels, 8);
        assert_eq!(info.duration_seconds, 1);
    }

    #[test]
    fn rejects_adts_aac_when_decoded_pcm_would_exceed_the_budget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("oversized.aac");
        let mut bytes = Vec::with_capacity(7 * 300_000);
        for _ in 0..300_000 {
            bytes.extend_from_slice(&[0xff, 0xf1, 0x50, 0x40, 0x00, 0xff, 0xfc]);
        }
        std::fs::write(&path, bytes).unwrap();

        assert_eq!(
            inspect_audio_file(&path).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
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

    #[test]
    fn rejects_low_rate_audio_whose_web_audio_resampling_exceeds_the_pcm_budget() {
        assert!(validate_web_audio_pcm_frames(8_000, 1, 8_000 * 60).is_ok());

        let frames_at_budget = MAX_AUDIO_PCM_BYTES / 4 * 8_000 / 48_000;
        assert!(validate_web_audio_pcm_frames(8_000, 1, frames_at_budget).is_ok());
        assert_eq!(
            validate_web_audio_pcm_frames(8_000, 1, frames_at_budget + 1).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );

        let three_hours_at_8khz = 3 * 60 * 60 * 8_000;
        assert!(validate_pcm_frames(8_000, 1, three_hours_at_8khz).is_ok());
        assert_eq!(
            validate_web_audio_pcm_frames(8_000, 1, three_hours_at_8khz).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
    }
}
