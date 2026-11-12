use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};

pub(crate) const WAVEFORM_BLOCK_FRAMES: u32 = 256;
const SUMMARY_MAGIC: &[u8; 4] = b"LSWF";
const SUMMARY_VERSION: u16 = 1;
const SUMMARY_HEADER_BYTES: usize = 40;
const MAX_SUMMARY_BINS: u32 =
    (crate::audio_resource::MAX_AUDIO_PCM_BYTES / 4 / WAVEFORM_BLOCK_FRAMES as u64) as u32;
const MAX_PACKET_SAMPLES: usize = 192_000 * 8;

#[derive(Debug, Clone, PartialEq)]
pub(crate) struct WaveformSummary {
    pub sample_rate: u32,
    pub channels: u8,
    pub frame_count: u64,
    pub duration_nanos: u64,
    pub block_frames: u32,
    pub minima: Vec<f32>,
    pub maxima: Vec<f32>,
}

struct WaveformAccumulator {
    sample_rate: u32,
    channels: u8,
    frame_count: u64,
    current_minimum: f32,
    current_maximum: f32,
    minima: Vec<f32>,
    maxima: Vec<f32>,
    amplitude: f32,
}

impl WaveformAccumulator {
    fn new(sample_rate: u32, channels: u8) -> Result<Self, String> {
        if !(8_000..=192_000).contains(&sample_rate) || !(1..=8).contains(&channels) {
            return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        Ok(Self {
            sample_rate,
            channels,
            frame_count: 0,
            current_minimum: 0.0,
            current_maximum: 0.0,
            minima: Vec::new(),
            maxima: Vec::new(),
            amplitude: 0.0,
        })
    }

    #[cfg(test)]
    fn push_interleaved(&mut self, samples: &[f32]) -> Result<(), String> {
        self.push_interleaved_with_cancel(samples, None)
    }

    fn push_interleaved_with_cancel(
        &mut self,
        samples: &[f32],
        cancel: Option<&AtomicBool>,
    ) -> Result<(), String> {
        if samples.len() % usize::from(self.channels) != 0 {
            return Err("Invalid interleaved waveform sample count".into());
        }
        for (index, frame) in samples.chunks_exact(usize::from(self.channels)).enumerate() {
            if index % 4096 == 0 && cancel.is_some_and(|flag| flag.load(Ordering::Acquire)) {
                return Err("cancelled".into());
            }
            if self.frame_count >= u64::from(MAX_SUMMARY_BINS) * u64::from(WAVEFORM_BLOCK_FRAMES) {
                return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
            }
            for sample in frame {
                if !sample.is_finite() {
                    return Err("Invalid nonfinite waveform sample".into());
                }
                self.current_minimum = self.current_minimum.min(*sample);
                self.current_maximum = self.current_maximum.max(*sample);
                self.amplitude = self.amplitude.max(sample.abs());
            }
            self.frame_count += 1;
            if self.frame_count % u64::from(WAVEFORM_BLOCK_FRAMES) == 0 {
                self.finish_block();
            }
        }
        Ok(())
    }

    fn finish_block(&mut self) {
        self.minima.push(self.current_minimum);
        self.maxima.push(self.current_maximum);
        self.current_minimum = 0.0;
        self.current_maximum = 0.0;
    }

    fn finish(mut self) -> Result<WaveformSummary, String> {
        if self.frame_count == 0 {
            return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        if self.frame_count % u64::from(WAVEFORM_BLOCK_FRAMES) != 0 {
            self.finish_block();
        }
        crate::audio_resource::validate_web_audio_pcm_frames(
            self.sample_rate,
            self.channels,
            self.frame_count,
        )?;
        if self.minima.len() > MAX_SUMMARY_BINS as usize {
            return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        if self.amplitude > 0.0 {
            for (minimum, maximum) in self.minima.iter_mut().zip(&mut self.maxima) {
                *minimum /= self.amplitude;
                *maximum /= self.amplitude;
            }
        }
        let duration_nanos = u64::try_from(
            u128::from(self.frame_count)
                .checked_mul(1_000_000_000)
                .ok_or_else(|| crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.to_string())?
                / u128::from(self.sample_rate),
        )
        .map_err(|_| crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
        Ok(WaveformSummary {
            sample_rate: self.sample_rate,
            channels: self.channels,
            frame_count: self.frame_count,
            duration_nanos,
            block_frames: WAVEFORM_BLOCK_FRAMES,
            minima: self.minima,
            maxima: self.maxima,
        })
    }
}

impl WaveformSummary {
    pub(crate) fn encode(&self) -> Result<Vec<u8>, String> {
        if self.minima.is_empty()
            || self.minima.len() != self.maxima.len()
            || self.minima.len() > MAX_SUMMARY_BINS as usize
            || self.block_frames != WAVEFORM_BLOCK_FRAMES
            || self.frame_count == 0
        {
            return Err("Invalid waveform summary".into());
        }
        let payload_bytes = self
            .minima
            .len()
            .checked_mul(8)
            .ok_or_else(|| "Invalid waveform summary size".to_string())?;
        let total_bytes = SUMMARY_HEADER_BYTES
            .checked_add(payload_bytes)
            .ok_or_else(|| "Invalid waveform summary size".to_string())?;
        let mut bytes = Vec::with_capacity(total_bytes);
        bytes.extend_from_slice(SUMMARY_MAGIC);
        bytes.extend_from_slice(&SUMMARY_VERSION.to_be_bytes());
        bytes.extend_from_slice(&(SUMMARY_HEADER_BYTES as u16).to_be_bytes());
        bytes.extend_from_slice(&self.sample_rate.to_be_bytes());
        bytes.push(self.channels);
        bytes.extend_from_slice(&[0, 0, 0]);
        bytes.extend_from_slice(&self.frame_count.to_be_bytes());
        bytes.extend_from_slice(&self.duration_nanos.to_be_bytes());
        bytes.extend_from_slice(&self.block_frames.to_be_bytes());
        bytes.extend_from_slice(
            &u32::try_from(self.minima.len())
                .map_err(|_| "Invalid waveform summary size".to_string())?
                .to_be_bytes(),
        );
        for (minimum, maximum) in self.minima.iter().zip(&self.maxima) {
            if !minimum.is_finite() || !maximum.is_finite() {
                return Err("Invalid waveform summary value".into());
            }
            bytes.extend_from_slice(&minimum.to_bits().to_be_bytes());
            bytes.extend_from_slice(&maximum.to_bits().to_be_bytes());
        }
        Ok(bytes)
    }

    #[cfg(test)]
    fn parse(bytes: &[u8]) -> Result<Self, String> {
        if bytes.len() < SUMMARY_HEADER_BYTES || bytes.get(..4) != Some(SUMMARY_MAGIC) {
            return Err("Invalid waveform summary header".into());
        }
        let read_u16 = |offset| -> Result<u16, String> {
            Ok(u16::from_be_bytes(
                bytes
                    .get(offset..offset + 2)
                    .ok_or("Invalid waveform summary header")?
                    .try_into()
                    .map_err(|_| "Invalid waveform summary header")?,
            ))
        };
        let read_u32 = |offset| -> Result<u32, String> {
            Ok(u32::from_be_bytes(
                bytes
                    .get(offset..offset + 4)
                    .ok_or("Invalid waveform summary header")?
                    .try_into()
                    .map_err(|_| "Invalid waveform summary header")?,
            ))
        };
        let read_u64 = |offset| -> Result<u64, String> {
            Ok(u64::from_be_bytes(
                bytes
                    .get(offset..offset + 8)
                    .ok_or("Invalid waveform summary header")?
                    .try_into()
                    .map_err(|_| "Invalid waveform summary header")?,
            ))
        };
        if read_u16(4)? != SUMMARY_VERSION
            || usize::from(read_u16(6)?) != SUMMARY_HEADER_BYTES
            || bytes[13..16] != [0, 0, 0]
        {
            return Err("Unsupported waveform summary header".into());
        }
        let sample_rate = read_u32(8)?;
        let channels = bytes[12];
        let frame_count = read_u64(16)?;
        let duration_nanos = read_u64(24)?;
        let block_frames = read_u32(32)?;
        if block_frames != WAVEFORM_BLOCK_FRAMES {
            return Err("Invalid waveform summary dimensions".into());
        }
        let bin_count = usize::try_from(read_u32(36)?)
            .map_err(|_| "Invalid waveform summary size".to_string())?;
        let expected_bins = frame_count
            .checked_add(u64::from(block_frames) - 1)
            .ok_or_else(|| "Invalid waveform summary size".to_string())?
            / u64::from(block_frames);
        let payload_bytes = bin_count
            .checked_mul(8)
            .ok_or_else(|| "Invalid waveform summary size".to_string())?;
        if !(8_000..=192_000).contains(&sample_rate)
            || !(1..=8).contains(&channels)
            || frame_count == 0
            || duration_nanos == 0
            || block_frames != WAVEFORM_BLOCK_FRAMES
            || bin_count == 0
            || bin_count > MAX_SUMMARY_BINS as usize
            || expected_bins != bin_count as u64
            || SUMMARY_HEADER_BYTES.checked_add(payload_bytes) != Some(bytes.len())
        {
            return Err("Invalid waveform summary dimensions".into());
        }
        crate::audio_resource::validate_web_audio_pcm_frames(sample_rate, channels, frame_count)?;
        let expected_duration =
            u64::try_from(u128::from(frame_count) * 1_000_000_000 / u128::from(sample_rate))
                .map_err(|_| "Invalid waveform summary duration".to_string())?;
        if duration_nanos != expected_duration {
            return Err("Invalid waveform summary duration".into());
        }
        let mut minima = Vec::with_capacity(bin_count);
        let mut maxima = Vec::with_capacity(bin_count);
        for bin in bytes[SUMMARY_HEADER_BYTES..].chunks_exact(8) {
            let minimum = f32::from_bits(u32::from_be_bytes(bin[..4].try_into().unwrap()));
            let maximum = f32::from_bits(u32::from_be_bytes(bin[4..].try_into().unwrap()));
            if !minimum.is_finite()
                || !maximum.is_finite()
                || minimum < -1.0
                || maximum > 1.0
                || minimum > maximum
            {
                return Err("Invalid waveform summary values".into());
            }
            minima.push(minimum);
            maxima.push(maximum);
        }
        Ok(Self {
            sample_rate,
            channels,
            frame_count,
            duration_nanos,
            block_frames,
            minima,
            maxima,
        })
    }
}

pub(crate) fn decode_audio_file(
    file: std::fs::File,
    extension: &str,
    cancel: &AtomicBool,
) -> Result<WaveformSummary, String> {
    check_cancelled(cancel)?;
    let mut file = file;
    if matches!(extension, "ogg" | "opus") && is_opus_ogg(&mut file)? {
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        return decode_opus(file, cancel);
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    decode_symphonia(file, extension, cancel)
}

fn check_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Acquire) {
        Err("cancelled".into())
    } else {
        Ok(())
    }
}

fn is_opus_ogg(file: &mut std::fs::File) -> Result<bool, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut header = [0_u8; 27];
    if file.read_exact(&mut header).is_err() || &header[..4] != b"OggS" || header[4] != 0 {
        return Ok(false);
    }
    let mut lacing = vec![0; usize::from(header[26])];
    if file.read_exact(&mut lacing).is_err() {
        return Ok(false);
    }
    let Some(length) = lacing
        .iter()
        .try_fold((0_usize, false), |(total, done), segment| {
            if done {
                return Some((total, true));
            }
            Some((total.checked_add(usize::from(*segment))?, *segment < 255))
        })
        .and_then(|(length, done)| done.then_some(length))
    else {
        return Ok(false);
    };
    if length < 8 {
        return Ok(false);
    }
    let mut signature = [0; 8];
    if file.read_exact(&mut signature).is_err() {
        return Ok(false);
    }
    Ok(&signature == b"OpusHead")
}

fn decode_opus(file: std::fs::File, cancel: &AtomicBool) -> Result<WaveformSummary, String> {
    use opus_pure::{OggOpusReader, OggPacket, OpusMSDecoder, Trim, MAX_PACKET_SAMPLES};

    let mut reader =
        OggOpusReader::new(file).map_err(|error| format!("Unsupported Opus stream: {error}"))?;
    let head = reader.head().clone();
    let channels = head.channel_count;
    let mut decoder = OpusMSDecoder::new(48_000, usize::from(channels), head.mapping_family)
        .map_err(|error| format!("Opus decoder setup failed: {error}"))?;
    for stream in decoder.streams_mut() {
        stream.gain_q8 = i32::from(head.output_gain_q8);
    }
    let mut trim =
        Trim::new(&head, 48_000, usize::from(channels)).map_err(|error| error.to_string())?;
    let mut packet = OggPacket::default();
    let capacity = MAX_PACKET_SAMPLES
        .checked_mul(usize::from(channels))
        .ok_or_else(|| crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.to_string())?;
    let mut decoded = vec![0.0; capacity];
    let mut accumulator = WaveformAccumulator::new(48_000, channels)?;
    while reader
        .read_packet_into(&mut packet)
        .map_err(|error| format!("Opus packet read failed: {error}"))?
    {
        check_cancelled(cancel)?;
        let frames = decoder
            .decode(&packet.data, MAX_PACKET_SAMPLES, &mut decoded)
            .map_err(|error| format!("Opus packet decode failed: {error}"))?;
        let valid = trim.keep(&packet, &decoded[..frames * usize::from(channels)]);
        accumulator.push_interleaved_with_cancel(valid, Some(cancel))?;
    }
    accumulator.finish()
}

fn decode_symphonia(
    file: std::fs::File,
    extension: &str,
    cancel: &AtomicBool,
) -> Result<WaveformSummary, String> {
    use symphonia::core::audio::SampleBuffer;
    use symphonia::core::codecs::DecoderOptions;
    use symphonia::core::errors::Error as SymphoniaError;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(extension);
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .map_err(|error| format!("Unsupported audio format: {error}"))?;
    let mut format = probed.format;
    let track = format.default_track().ok_or("Audio track is unavailable")?;
    let track_id = track.id;
    let params = track.codec_params.clone();
    let sample_rate = params
        .sample_rate
        .ok_or("Audio sample rate is unavailable")?;
    let mut expected_channels = params.channels.map(|channels| channels.count());
    let mut accumulator = None;
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|error| format!("Audio decoder setup failed: {error}"))?;
    let mut sample_buffer: Option<SampleBuffer<f32>> = None;
    loop {
        check_cancelled(cancel)?;
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
        let decoded = decoder
            .decode(&packet)
            .map_err(|error| format!("Audio packet decode failed: {error}"))?;
        let actual_channels = decoded.spec().channels.count();
        if !(1..=8).contains(&actual_channels)
            || expected_channels.is_some_and(|channels| actual_channels != channels)
            || decoded.spec().rate != sample_rate
            || decoded
                .capacity()
                .checked_mul(actual_channels)
                .is_none_or(|samples| samples > MAX_PACKET_SAMPLES)
        {
            return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        expected_channels = Some(actual_channels);
        let accumulator = accumulator.get_or_insert_with(|| {
            WaveformAccumulator::new(sample_rate, actual_channels as u8)
                .expect("validated decoder format")
        });
        if sample_buffer
            .as_ref()
            .is_none_or(|buffer| buffer.capacity() < decoded.capacity() * actual_channels)
        {
            sample_buffer = Some(SampleBuffer::<f32>::new(
                decoded.capacity() as u64,
                *decoded.spec(),
            ));
        }
        let buffer = sample_buffer.as_mut().expect("sample buffer initialized");
        buffer.copy_interleaved_ref(decoded);
        accumulator.push_interleaved_with_cancel(buffer.samples(), Some(cancel))?;
    }
    accumulator
        .ok_or_else(|| crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.to_string())?
        .finish()
}

#[cfg(test)]
mod tests {
    use super::{decode_audio_file, WaveformAccumulator, WAVEFORM_BLOCK_FRAMES};
    use std::io::Write;
    use std::sync::atomic::AtomicBool;

    #[test]
    fn summarizes_frame_minimum_and_maximum_into_normalized_fixed_blocks() {
        let mut summary = WaveformAccumulator::new(48_000, 2).unwrap();
        summary.push_interleaved(&[-0.5, 0.25, 0.75, -1.0]).unwrap();
        let result = summary.finish().unwrap();

        assert_eq!(result.sample_rate, 48_000);
        assert_eq!(result.channels, 2);
        assert_eq!(result.frame_count, 2);
        assert_eq!(result.block_frames, WAVEFORM_BLOCK_FRAMES);
        assert_eq!(result.minima, vec![-1.0]);
        assert_eq!(result.maxima, vec![0.75]);
    }

    #[test]
    fn closes_a_partial_final_block_without_padding_samples() {
        let mut summary = WaveformAccumulator::new(8_000, 1).unwrap();
        let mut samples = vec![0.0; WAVEFORM_BLOCK_FRAMES as usize + 1];
        samples[WAVEFORM_BLOCK_FRAMES as usize] = -0.5;
        summary.push_interleaved(&samples).unwrap();
        let result = summary.finish().unwrap();

        assert_eq!(result.frame_count, WAVEFORM_BLOCK_FRAMES as u64 + 1);
        assert_eq!(result.minima.len(), 2);
        assert_eq!(result.maxima.len(), 2);
        assert_eq!(result.minima[1], -1.0);
        assert_eq!(result.maxima[1], 0.0);
    }

    #[test]
    fn rejects_nonfinite_samples_and_invalid_interleaving() {
        let mut summary = WaveformAccumulator::new(48_000, 2).unwrap();
        assert!(summary.push_interleaved(&[0.0]).is_err());
        assert!(summary.push_interleaved(&[f32::NAN, 0.0]).is_err());
        assert!(summary.push_interleaved(&[f32::INFINITY, 0.0]).is_err());
    }

    #[test]
    fn enforces_the_summary_memory_cap_before_adding_another_block() {
        let mut summary = WaveformAccumulator::new(48_000, 1).unwrap();
        summary.frame_count = u64::from(super::MAX_SUMMARY_BINS) * u64::from(WAVEFORM_BLOCK_FRAMES);
        assert!(summary.push_interleaved(&[0.0]).is_err());
    }

    #[test]
    fn binary_summary_round_trips_and_rejects_trailing_bytes() {
        let mut summary = WaveformAccumulator::new(48_000, 1).unwrap();
        summary.push_interleaved(&[-0.25, 0.75]).unwrap();
        let result = summary.finish().unwrap();
        let encoded = result.encode().unwrap();
        let decoded = super::WaveformSummary::parse(&encoded).unwrap();

        assert_eq!(decoded, result);
        let mut trailing = encoded;
        trailing.push(0);
        assert!(super::WaveformSummary::parse(&trailing).is_err());
    }

    #[test]
    fn binary_summary_rejects_invalid_dimensions_values_and_versions() {
        let mut accumulator = WaveformAccumulator::new(48_000, 1).unwrap();
        accumulator.push_interleaved(&[0.0]).unwrap();
        let encoded = accumulator.finish().unwrap().encode().unwrap();

        let mut invalid = encoded.clone();
        invalid[4] = 0;
        invalid[5] = 9;
        assert!(super::WaveformSummary::parse(&invalid).is_err());

        let mut invalid = encoded.clone();
        invalid[12] = 0;
        assert!(super::WaveformSummary::parse(&invalid).is_err());

        let mut invalid = encoded.clone();
        invalid[34] = 0;
        assert!(super::WaveformSummary::parse(&invalid).is_err());

        let mut invalid = encoded.clone();
        invalid[40..44].copy_from_slice(&f32::NAN.to_bits().to_be_bytes());
        assert!(super::WaveformSummary::parse(&invalid).is_err());
    }

    #[test]
    fn silence_stays_zero_and_uses_a_single_summary_bin() {
        let mut summary = WaveformAccumulator::new(48_000, 1).unwrap();
        summary.push_interleaved(&[0.0; 12]).unwrap();
        let result = summary.finish().unwrap();
        assert_eq!(result.minima, vec![0.0]);
        assert_eq!(result.maxima, vec![0.0]);
    }

    #[test]
    fn generated_wav_summary_matches_a_full_decode_oracle() {
        let file = tempfile::Builder::new().suffix(".wav").tempfile().unwrap();
        let spec = hound::WavSpec {
            channels: 2,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::new(file.as_file(), spec).unwrap();
        let frames = 513;
        let mut samples = Vec::new();
        for frame in 0..frames {
            let left = if frame == 300 {
                i16::MIN
            } else {
                frame as i16 - 256
            };
            let right = if frame == 280 {
                i16::MAX
            } else {
                128 - frame as i16
            };
            writer.write_sample(left).unwrap();
            writer.write_sample(right).unwrap();
            samples.push(left as f32 / 32768.0);
            samples.push(right as f32 / 32768.0);
        }
        writer.finalize().unwrap();
        file.as_file().sync_all().unwrap();

        let summary = decode_audio_file(
            std::fs::File::open(file.path()).unwrap(),
            "wav",
            &AtomicBool::new(false),
        )
        .unwrap();
        let amplitude = samples
            .iter()
            .map(|sample| sample.abs())
            .fold(0.0_f32, f32::max);
        let mut expected_minima = Vec::new();
        let mut expected_maxima = Vec::new();
        for block in samples.chunks_exact(usize::try_from(WAVEFORM_BLOCK_FRAMES).unwrap() * 2) {
            expected_minima.push(block.iter().copied().fold(0.0_f32, f32::min) / amplitude);
            expected_maxima.push(block.iter().copied().fold(0.0_f32, f32::max) / amplitude);
        }
        let remainder = &samples[(samples.len() / (WAVEFORM_BLOCK_FRAMES as usize * 2)
            * WAVEFORM_BLOCK_FRAMES as usize
            * 2)..];
        if !remainder.is_empty() {
            expected_minima.push(remainder.iter().copied().fold(0.0_f32, f32::min) / amplitude);
            expected_maxima.push(remainder.iter().copied().fold(0.0_f32, f32::max) / amplitude);
        }

        assert_eq!(summary.frame_count, frames as u64);
        assert_eq!(summary.minima, expected_minima);
        assert_eq!(summary.maxima, expected_maxima);
    }

    #[test]
    fn decodes_the_supported_format_fixtures_with_bounded_peak_counts() {
        let fixtures: [(&str, &[u8]); 12] = [
            (
                "wav",
                include_bytes!("../test-fixtures/audio-prefix/prefix.wav"),
            ),
            (
                "aiff",
                include_bytes!("../test-fixtures/audio-prefix/prefix.aiff"),
            ),
            (
                "aif",
                include_bytes!("../test-fixtures/audio-prefix/prefix.aiff"),
            ),
            (
                "flac",
                include_bytes!("../test-fixtures/audio-prefix/prefix.flac"),
            ),
            (
                "mp3",
                include_bytes!("../test-fixtures/audio-prefix/prefix.mp3"),
            ),
            (
                "m4a",
                include_bytes!("../test-fixtures/audio-prefix/prefix.m4a"),
            ),
            (
                "m4a",
                include_bytes!("../test-fixtures/audio-prefix/prefix-alac.m4a"),
            ),
            (
                "aac",
                include_bytes!("../test-fixtures/audio-prefix/prefix.aac"),
            ),
            (
                "ogg",
                include_bytes!("../test-fixtures/audio-prefix/prefix.ogg"),
            ),
            (
                "opus",
                include_bytes!("../test-fixtures/audio-prefix/prefix.opus"),
            ),
            (
                "opus",
                include_bytes!("../test-fixtures/audio-prefix/prefix-6ch.opus"),
            ),
            (
                "opus",
                include_bytes!("../test-fixtures/audio-prefix/prefix-8ch.opus"),
            ),
        ];
        for (extension, bytes) in fixtures {
            let file = tempfile::Builder::new()
                .suffix(&format!(".{extension}"))
                .tempfile()
                .unwrap();
            file.as_file().write_all(bytes).unwrap();
            let summary = decode_audio_file(
                std::fs::File::open(file.path()).unwrap(),
                extension,
                &AtomicBool::new(false),
            )
            .unwrap_or_else(|error| panic!(".{extension} waveform decode failed: {error}"));
            assert!(summary.frame_count > 0, ".{extension} decoded no frames");
            assert!(summary.minima.len() <= super::MAX_SUMMARY_BINS as usize);
            assert!(summary.minima.iter().all(|value| value.is_finite()));
            assert!(summary.maxima.iter().all(|value| value.is_finite()));
        }
    }
}
