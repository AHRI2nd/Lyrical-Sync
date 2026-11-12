use lofty::file::{AudioFile, FileType, TaggedFileExt};
use std::fs::{File, OpenOptions};
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

pub(crate) fn open_audio_file(path: &Path) -> Result<File, String> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|error| error.to_string())?;
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("Audio path is not a regular file".into());
    }
    Ok(file)
}

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
    let effective_rate = sample_rate.max(WEBAUDIO_BASE_SAMPLE_RATE);
    let effective_frames = u128::from(frames)
        .checked_mul(u128::from(effective_rate))
        .and_then(|samples| samples.checked_add(u128::from(sample_rate) - 1))
        .map(|samples| samples / u128::from(sample_rate))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    let estimated_web_audio_pcm_bytes = effective_frames
        .checked_mul(u128::from(channels))
        .and_then(|samples| samples.checked_mul(4))
        .ok_or_else(|| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    if pcm_bytes > u128::from(MAX_AUDIO_PCM_BYTES)
        || estimated_web_audio_pcm_bytes > u128::from(MAX_AUDIO_PCM_BYTES)
        || pcm_bytes
            .checked_add(128)
            .map_or(true, |bytes| bytes > u128::from(MAX_AUDIO_FILE_BYTES))
        || duration_nanos > MAX_AUDIO_DURATION.as_nanos()
    {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    Ok(())
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

fn inspect_adts_aac(file: &mut File, file_bytes: u64) -> Result<Option<u64>, String> {
    let mut audio_end = file_bytes;
    if file_bytes >= 128 {
        file.seek(SeekFrom::Start(file_bytes - 128))
            .map_err(|error| error.to_string())?;
        let mut signature = [0_u8; 3];
        file.read_exact(&mut signature)
            .map_err(|error| error.to_string())?;
        if &signature == b"TAG" {
            audio_end -= 128;
        }
    }

    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
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
        if offset > audio_end {
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
        let duration_nanos =
            u64::try_from(duration_nanos).map_err(|_| AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        validate_audio_properties(
            file_bytes,
            Duration::from_nanos(duration_nanos),
            rate,
            channel_count,
        )?;
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
    validate_audio_properties(
        file_bytes,
        Duration::from_nanos(duration_nanos),
        sample_rate,
        channels,
    )
    .map(|()| Some(file_bytes))
}

fn inspect_audio_file_handle(file: &mut File) -> Result<u64, String> {
    inspect_audio_file_handle_with_check(file, || Ok(()))
}

pub(crate) fn inspect_audio_file_handle_with_check(
    file: &mut File,
    mut check: impl FnMut() -> Result<(), String>,
) -> Result<u64, String> {
    check()?;
    let file_bytes = file.metadata().map_err(|error| error.to_string())?.len();
    if file_bytes > MAX_AUDIO_FILE_BYTES {
        return Err(AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    if let Some(expected_len) = inspect_adts_aac(file, file_bytes)? {
        return Ok(expected_len);
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let tagged = lofty::read_from(file).map_err(|error| error.to_string())?;
    if tagged.file_type() == FileType::Flac {
        inspect_flac_frame_budget(file, &mut check)?;
        return Ok(file_bytes);
    }
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

fn inspect_flac_frame_budget(
    file: &mut File,
    check: &mut impl FnMut() -> Result<(), String>,
) -> Result<(), String> {
    use std::io::ErrorKind;
    use symphonia::core::{
        codecs::DecoderOptions, errors::Error, formats::FormatOptions, io::MediaSourceStream,
        meta::MetadataOptions, probe::Hint,
    };

    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let source = file.try_clone().map_err(|error| error.to_string())?;
    let mut hint = Hint::new();
    hint.with_extension("flac");
    let mut format = symphonia::default::get_probe()
        .format(
            &hint,
            MediaSourceStream::new(Box::new(source), Default::default()),
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Unsupported or invalid FLAC audio: {error}"))?
        .format;
    let track = format.default_track().ok_or("No FLAC audio track")?;
    let params = track.codec_params.clone();
    let track_id = track.id;
    let sample_rate = params
        .sample_rate
        .filter(|rate| *rate > 0)
        .ok_or("Missing FLAC sample rate")?;
    let channels = params.channels.ok_or("Missing FLAC channels")?.count();
    let channels = u8::try_from(channels).map_err(|_| AUDIO_RESOURCE_LIMIT_ERROR)?;
    validate_pcm_frames(sample_rate, channels, 0)?;
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|error| format!("Unsupported FLAC codec: {error}"))?;
    let mut frames = 0u64;

    loop {
        check()?;
        let packet = match format.next_packet() {
            Ok(packet) => packet,
            Err(Error::IoError(error)) if error.kind() == ErrorKind::UnexpectedEof => break,
            Err(error) => return Err(format!("FLAC frame scan failed: {error}")),
        };
        if packet.track_id() != track_id {
            continue;
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|error| format!("FLAC frame scan failed: {error}"))?;
        if decoded.spec().rate != sample_rate
            || decoded.spec().channels.count() != channels as usize
        {
            return Err("FLAC audio format changed during decode".into());
        }
        let packet_frames = decoded.frames() as u64;
        if packet_frames == 0 {
            return Err("AUDIO_METADATA_UNAVAILABLE".into());
        }
        frames = frames
            .checked_add(packet_frames)
            .ok_or(AUDIO_RESOURCE_LIMIT_ERROR)?;
        validate_pcm_frames(sample_rate, channels, frames)?;
    }

    if frames == 0 {
        return Err("AUDIO_METADATA_UNAVAILABLE".into());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    Ok(())
}

pub fn read_bounded_audio_file(path: &Path) -> Result<Vec<u8>, String> {
    let mut file = open_audio_file(path)?;
    let expected_len = inspect_audio_file_handle(&mut file)?;
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

    #[test]
    fn flac_resource_scan_observes_analysis_cancellation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("prefix.flac");
        std::fs::write(
            &path,
            include_bytes!("../test-fixtures/audio-prefix/prefix.flac"),
        )
        .unwrap();
        let mut file = open_audio_file(&path).unwrap();
        let mut checks = 0;

        let error = inspect_audio_file_handle_with_check(&mut file, || {
            checks += 1;
            if checks == 2 {
                Err("cancelled".into())
            } else {
                Ok(())
            }
        })
        .unwrap_err();

        assert_eq!(error, "cancelled");
        assert_eq!(checks, 2);
    }

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

    fn vbr_adts(frames: usize) -> Vec<u8> {
        let mut bytes = Vec::new();
        for index in 0..frames {
            let frame_len = if index % 2 == 0 { 12_usize } else { 80_usize };
            let mut frame = vec![0_u8; frame_len];
            frame[0] = 0xff;
            frame[1] = 0xf1;
            frame[2] = 0x50; // AAC-LC, 44.1 kHz
            frame[3] = 0x80 | (((frame_len >> 11) & 0x03) as u8); // stereo
            frame[4] = (frame_len >> 3) as u8;
            frame[5] = (((frame_len & 0x07) as u8) << 5) | 0x1f;
            frame[6] = 0xfc; // one 1024-sample raw data block
            bytes.extend_from_slice(&frame);
        }
        bytes
    }

    fn aac_7_1_program_config() -> Vec<u8> {
        fn push_bits(bits: &mut Vec<bool>, value: u32, count: usize) {
            for shift in (0..count).rev() {
                bits.push((value >> shift) & 1 != 0);
            }
        }

        let mut bits = Vec::new();
        push_bits(&mut bits, 5, 3);
        push_bits(&mut bits, 0, 4);
        push_bits(&mut bits, 1, 2);
        push_bits(&mut bits, 3, 4);
        push_bits(&mut bits, 2, 4);
        push_bits(&mut bits, 1, 4);
        push_bits(&mut bits, 1, 4);
        push_bits(&mut bits, 1, 2);
        push_bits(&mut bits, 0, 3);
        push_bits(&mut bits, 0, 4);
        push_bits(&mut bits, 0, 1);
        push_bits(&mut bits, 0, 1);
        push_bits(&mut bits, 0, 1);
        push_bits(&mut bits, 1, 1);
        push_bits(&mut bits, 0, 4);
        push_bits(&mut bits, 0, 1);
        push_bits(&mut bits, 1, 4);
        push_bits(&mut bits, 1, 1);
        push_bits(&mut bits, 0, 4);
        push_bits(&mut bits, 1, 1);
        push_bits(&mut bits, 0, 4);
        push_bits(&mut bits, 0, 4);
        while bits.len() % 8 != 0 {
            bits.push(false);
        }
        push_bits(&mut bits, 0, 8);
        bits.chunks(8)
            .map(|chunk| {
                chunk
                    .iter()
                    .fold(0_u8, |byte, bit| (byte << 1) | u8::from(*bit))
            })
            .collect()
    }

    fn adts_frame(channel_configuration: u8, payload: &[u8]) -> Vec<u8> {
        adts_frame_at_rate(channel_configuration, 4, payload)
    }

    fn adts_frame_at_rate(channel_configuration: u8, rate_index: u8, payload: &[u8]) -> Vec<u8> {
        let frame_len = 7 + payload.len();
        let mut frame = vec![0_u8; frame_len];
        frame[0] = 0xff;
        frame[1] = 0xf1;
        frame[2] = 0x40 | (rate_index << 2) | ((channel_configuration >> 2) & 0x01);
        frame[3] = (channel_configuration & 0x03) << 6;
        frame[4] = (frame_len >> 3) as u8;
        frame[5] = (((frame_len & 0x07) as u8) << 5) | 0x1f;
        frame[6] = 0xfc;
        frame[7..].copy_from_slice(payload);
        frame
    }

    #[test]
    fn reads_eight_channel_layout_from_adts_program_config_element() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("seven-one.aac");
        let payload = aac_7_1_program_config();
        let frame = adts_frame_at_rate(0, 3, &payload);
        let mut stream = Vec::new();
        for _ in 0..48 {
            stream.extend_from_slice(&frame);
        }
        std::fs::write(&path, stream).unwrap();

        assert!(read_bounded_audio_file(&path).is_ok());
    }

    #[test]
    fn rejects_channel_config_zero_without_a_valid_program_config_element() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("missing-pce.aac");
        std::fs::write(&path, adts_frame(0, &[0_u8; 8])).unwrap();

        assert_eq!(
            read_bounded_audio_file(&path).unwrap_err(),
            "AUDIO_METADATA_UNAVAILABLE"
        );
    }

    #[test]
    fn keeps_explicit_adts_channel_configurations_supported() {
        for configuration in [1, 2, 6, 7] {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join(format!("channel-{configuration}.aac"));
            std::fs::write(&path, adts_frame(configuration, &[0_u8; 5])).unwrap();

            assert!(
                read_bounded_audio_file(&path).is_ok(),
                "channel configuration {configuration}"
            );
        }
    }

    #[test]
    fn uses_pce_channel_count_when_enforcing_the_pcm_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("over-limit-seven-one.aac");
        let frame = adts_frame_at_rate(0, 3, &aac_7_1_program_config());
        let mut stream = Vec::with_capacity(frame.len() * 32_769);
        for _ in 0..32_769 {
            stream.extend_from_slice(&frame);
        }
        std::fs::write(&path, stream).unwrap();

        assert_eq!(
            read_bounded_audio_file(&path).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
    }

    #[test]
    fn accepts_vbr_adts_whose_exact_pcm_estimate_is_within_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("variable-rate.aac");
        let mut bytes = b"ID3\x04\0\0\0\0\0\0".to_vec();
        bytes.extend_from_slice(&vbr_adts(110_000));
        let mut id3v1 = [0_u8; 128];
        id3v1[..3].copy_from_slice(b"TAG");
        bytes.extend_from_slice(&id3v1);
        std::fs::write(&path, bytes).unwrap();

        let result = read_bounded_audio_file(&path);
        assert!(result.is_ok(), "{result:?}");
    }

    #[test]
    fn checks_actual_flac_frames_when_streaminfo_understates_duration() {
        let dir = tempfile::tempdir().unwrap();
        let underreported = dir.path().join("underreported.flac");
        std::fs::write(
            &underreported,
            include_bytes!("../tests/fixtures/flac-understated-streaminfo.flac"),
        )
        .unwrap();
        let metadata = lofty::read_from_path(&underreported).unwrap();
        assert_eq!(metadata.properties().duration(), Duration::from_secs(1));
        assert_eq!(
            read_bounded_audio_file(&underreported).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );

        let valid = dir.path().join("valid.flac");
        std::fs::write(
            &valid,
            include_bytes!("../tests/fixtures/flac-valid-30m.flac"),
        )
        .unwrap();
        assert!(read_bounded_audio_file(&valid).is_ok());
    }

    #[test]
    fn rejects_vbr_adts_when_exact_pcm_estimate_exceeds_the_limit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("over-limit-variable-rate.aac");
        std::fs::write(&path, vbr_adts(121_000)).unwrap();

        assert_eq!(
            read_bounded_audio_file(&path).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
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
    fn accounts_for_web_audio_upsampling_before_accepting_decoded_frames() {
        let one_hour_of_8khz_stereo = 8_000 * 60 * 60;
        assert_eq!(
            validate_pcm_frames(8_000, 2, one_hour_of_8khz_stereo).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
        assert!(validate_pcm_frames(8_000, 2, 8_000 * 30 * 60).is_ok());
    }

    #[test]
    fn rejects_oversized_sparse_audio_before_parsing_or_reading_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("oversized.mp3");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(MAX_AUDIO_FILE_BYTES + 1)
            .unwrap();
        let mut file = open_audio_file(&path).unwrap();
        assert_eq!(
            inspect_audio_file_handle(&mut file).unwrap_err(),
            AUDIO_RESOURCE_LIMIT_ERROR
        );
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
        thread::spawn(move || {
            let result = open_audio_file(&inspect_path)
                .and_then(|mut file| inspect_audio_file_handle(&mut file));
            let _ = inspect_tx.send(result);
        });
        let inspect = inspect_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("FIFO inspection must not block");
        assert!(inspect.unwrap_err().contains("regular file"));

        let read_path = path.clone();
        let (read_tx, read_rx) = mpsc::channel();
        thread::spawn(move || {
            let _ = read_tx.send(read_bounded_audio_file(&read_path));
        });
        let read = read_rx
            .recv_timeout(Duration::from_secs(1))
            .expect("FIFO read must not block");
        assert!(read.unwrap_err().contains("regular file"));
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
