use std::io::{Read, Seek, SeekFrom};
use symphonia::core::io::MediaSource;

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
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|e| format!("Unsupported audio codec: {e}"))?;
    if declared_frames.is_some_and(|frames| Some(frames) != params.n_frames) {
        return Err("Inconsistent AIFF frame count".into());
    }
    // Reserve the known output once to avoid retaining old and new allocations
    // while a long WAV grows. IPC and browser copies still remain whole-file.
    let mut bytes = Vec::new();
    if let Some(frames) = params.n_frames {
        let capacity = frames
            .checked_mul(channels as u64)
            .and_then(|n| n.checked_mul(4))
            .and_then(|n| n.checked_add(128))
            .ok_or("WAV size overflow")?;
        if capacity > u32::MAX as u64 {
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
        frames += decoded.frames() as u64;
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
