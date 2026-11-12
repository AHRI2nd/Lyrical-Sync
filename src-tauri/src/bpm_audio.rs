use opus_pure::{OggOpusReader, OggPacket, OpusMSDecoder, Trim, MAX_PACKET_SAMPLES};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use symphonia::core::audio::SampleBuffer;
use symphonia::core::codecs::DecoderOptions;
use symphonia::core::errors::Error as SymphoniaError;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::MetadataOptions;
use symphonia::core::probe::Hint;

const MAX_PENDING_CANCELLATIONS: usize = 64;
const MAX_PREFIX_BUCKETS: usize = 6_000;
pub const ENERGY_RATE: u32 = 50;
const MAX_DECODED_PACKET_SAMPLES: usize = 192_000 * 8;

#[derive(Default)]
struct AnalysisStateInner {
    active: Option<(String, Arc<AtomicBool>)>,
    pending_cancellations: std::collections::VecDeque<String>,
}

#[derive(Default)]
pub struct AnalysisState {
    inner: Mutex<AnalysisStateInner>,
    completed: tokio::sync::Notify,
}

pub struct AnalysisRun<'a> {
    state: &'a AnalysisState,
    id: String,
    cancel: Arc<AtomicBool>,
}

impl AnalysisState {
    pub fn begin(&self, id: String) -> Result<AnalysisRun<'_>, String> {
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err("Invalid audio analysis ID".into());
        }
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        if inner.active.is_some() {
            return Err("Audio analysis is still running or cancelling".into());
        }
        let cancelled_early = inner
            .pending_cancellations
            .iter()
            .any(|pending| pending == &id);
        inner.pending_cancellations.retain(|pending| pending != &id);
        let cancel = Arc::new(AtomicBool::new(cancelled_early));
        inner.active = Some((id.clone(), cancel.clone()));
        Ok(AnalysisRun {
            state: self,
            id,
            cancel,
        })
    }

    pub fn cancel(&self, id: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|error| error.into_inner());
        if let Some((active_id, cancel)) = &inner.active {
            if active_id == id {
                cancel.store(true, Ordering::Relaxed);
                return;
            }
        }
        if id.is_empty()
            || id.len() > 64
            || !id
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
            || inner
                .pending_cancellations
                .iter()
                .any(|pending| pending == id)
        {
            return;
        }
        if inner.pending_cancellations.len() == MAX_PENDING_CANCELLATIONS {
            inner.pending_cancellations.pop_front();
        }
        inner.pending_cancellations.push_back(id.to_owned());
    }

    pub async fn cancel_and_wait(&self, id: &str) {
        self.cancel(id);
        loop {
            let notified = self.completed.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            let active = self
                .inner
                .lock()
                .unwrap_or_else(|error| error.into_inner())
                .active
                .as_ref()
                .is_some_and(|(active_id, _)| active_id == id);
            if !active {
                return;
            }
            notified.await;
        }
    }
}

impl AnalysisRun<'_> {
    pub fn cancel_flag(&self) -> &AtomicBool {
        &self.cancel
    }

    pub fn cancel_handle(&self) -> Arc<AtomicBool> {
        self.cancel.clone()
    }
}

impl Drop for AnalysisRun<'_> {
    fn drop(&mut self) {
        self.cancel.store(true, Ordering::Relaxed);
        let mut inner = self
            .state
            .inner
            .lock()
            .unwrap_or_else(|error| error.into_inner());
        if inner.active.as_ref().is_some_and(|(id, _)| id == &self.id) {
            inner.active = None;
        }
        drop(inner);
        self.state.completed.notify_waiters();
    }
}

pub fn decode_prefix(path: &Path, cancel: &AtomicBool) -> Result<Vec<f32>, String> {
    check_cancelled(cancel)?;
    let mut file = crate::audio_resource::open_audio_file(path)?;
    let info = crate::audio_resource::inspect_audio_file_handle_with_check(&mut file, || {
        check_cancelled(cancel)
    })?;
    check_cancelled(cancel)?;
    if file.metadata().map_err(|error| error.to_string())?.len() != info.file_bytes {
        return Err("AUDIO_FILE_CHANGED".into());
    }
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;

    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if matches!(extension.as_str(), "ogg" | "opus") {
        let is_opus = is_opus_ogg(&mut file)?;
        file.seek(SeekFrom::Start(0))
            .map_err(|error| error.to_string())?;
        if is_opus {
            return decode_opus(file, cancel);
        }
    }
    decode_symphonia(file, &extension, info.sample_rate, info.channels, cancel)
}

fn check_cancelled(cancel: &AtomicBool) -> Result<(), String> {
    if cancel.load(Ordering::Relaxed) {
        Err("cancelled".into())
    } else {
        Ok(())
    }
}

fn finish_bucket(output: &mut Vec<f32>, sum_squares: f64, frames: u64) {
    if frames > 0 {
        output.push((sum_squares / frames as f64).sqrt() as f32);
    }
}

fn add_interleaved(
    output: &mut Vec<f32>,
    current_bucket: &mut Option<u64>,
    sum_squares: &mut f64,
    bucket_frames: &mut u64,
    samples: &[f32],
    channels: usize,
    sample_rate: u32,
    first_frame: &mut u64,
    cancel: &AtomicBool,
) -> Result<bool, String> {
    for frame in samples.chunks_exact(channels) {
        let bucket = first_frame.saturating_mul(u64::from(ENERGY_RATE)) / u64::from(sample_rate);
        if bucket >= MAX_PREFIX_BUCKETS as u64 {
            return Ok(true);
        }
        if current_bucket.is_some_and(|previous| previous != bucket) {
            finish_bucket(output, *sum_squares, *bucket_frames);
            *sum_squares = 0.0;
            *bucket_frames = 0;
        }
        *current_bucket = Some(bucket);
        let mean_square = frame
            .iter()
            .map(|sample| f64::from(*sample).powi(2))
            .sum::<f64>()
            / channels as f64;
        *sum_squares += mean_square;
        *bucket_frames += 1;
        *first_frame += 1;
        if *first_frame % 4096 == 0 {
            check_cancelled(cancel)?;
        }
    }
    Ok(false)
}

fn is_opus_ogg(file: &mut File) -> Result<bool, String> {
    file.seek(SeekFrom::Start(0))
        .map_err(|error| error.to_string())?;
    let mut header = [0_u8; 27];
    if file.read_exact(&mut header).is_err() || &header[..4] != b"OggS" || header[4] != 0 {
        return Ok(false);
    }
    let segment_count = usize::from(header[26]);
    let mut lacing = vec![0_u8; segment_count];
    if file.read_exact(&mut lacing).is_err() {
        return Ok(false);
    }
    let Some(first_packet_len) = lacing
        .iter()
        .try_fold((0_usize, false), |(total, ended), value| {
            if ended {
                return Some((total, true));
            }
            let next = total.checked_add(usize::from(*value))?;
            Some((next, *value < 255))
        })
        .and_then(|(length, ended)| ended.then_some(length))
    else {
        return Ok(false);
    };
    if first_packet_len < 8 {
        return Ok(false);
    }
    let mut signature = [0_u8; 8];
    if file.read_exact(&mut signature).is_err() {
        return Ok(false);
    }
    Ok(&signature == b"OpusHead")
}

fn decode_opus(file: File, cancel: &AtomicBool) -> Result<Vec<f32>, String> {
    let mut reader =
        OggOpusReader::new(file).map_err(|error| format!("Unsupported Opus stream: {error}"))?;
    let head = reader.head().clone();
    let channels = usize::from(head.channel_count);
    if channels == 0 || channels > 8 {
        return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    let mut decoder = OpusMSDecoder::new(48_000, channels, head.mapping_family)
        .map_err(|error| format!("Opus decoder setup failed: {error}"))?;
    for stream in decoder.streams_mut() {
        stream.gain_q8 = i32::from(head.output_gain_q8);
    }
    let mut trim = Trim::new(&head, 48_000, channels).map_err(|error| error.to_string())?;
    let mut packet = OggPacket::default();
    let mut decoded = vec![0.0; MAX_PACKET_SAMPLES * channels];
    let mut output = Vec::with_capacity(MAX_PREFIX_BUCKETS);
    let mut bucket = None;
    let mut sum_squares = 0.0;
    let mut bucket_frames = 0;
    let mut frame_index = 0;
    while reader
        .read_packet_into(&mut packet)
        .map_err(|error| format!("Opus packet read failed: {error}"))?
    {
        check_cancelled(cancel)?;
        let frames = decoder
            .decode(&packet.data, MAX_PACKET_SAMPLES, &mut decoded)
            .map_err(|error| format!("Opus packet decode failed: {error}"))?;
        let valid = trim.keep(&packet, &decoded[..frames * channels]);
        if add_interleaved(
            &mut output,
            &mut bucket,
            &mut sum_squares,
            &mut bucket_frames,
            valid,
            channels,
            48_000,
            &mut frame_index,
            cancel,
        )? {
            break;
        }
    }
    finish_bucket(&mut output, sum_squares, bucket_frames);
    Ok(output)
}

fn decode_symphonia(
    file: File,
    extension: &str,
    expected_sample_rate: u32,
    expected_channels: u8,
    cancel: &AtomicBool,
) -> Result<Vec<f32>, String> {
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
    if sample_rate != expected_sample_rate || !(8_000..=192_000).contains(&sample_rate) {
        return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    let mut decoder = symphonia::default::get_codecs()
        .make(&params, &DecoderOptions::default())
        .map_err(|error| format!("Audio decoder setup failed: {error}"))?;
    let mut sample_buffer: Option<SampleBuffer<f32>> = None;
    let mut output = Vec::with_capacity(MAX_PREFIX_BUCKETS);
    let mut bucket = None;
    let mut sum_squares = 0.0;
    let mut bucket_frames = 0;
    let mut frame_index = 0;
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
        let packet_channels = params
            .channels
            .map(|channels| channels.count())
            .unwrap_or(usize::from(expected_channels));
        if packet.dur().saturating_mul(packet_channels as u64) > MAX_DECODED_PACKET_SAMPLES as u64 {
            return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
        }
        let decoded = decoder
            .decode(&packet)
            .map_err(|error| format!("Audio packet decode failed: {error}"))?;
        let channels = decoded.spec().channels.count();
        if channels == 0
            || channels > 8
            || channels != usize::from(expected_channels)
            || decoded.spec().rate != sample_rate
            || decoded.capacity().saturating_mul(channels) > MAX_DECODED_PACKET_SAMPLES
        {
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
        let buffer = sample_buffer.as_mut().expect("buffer initialized");
        buffer.copy_interleaved_ref(decoded);
        if add_interleaved(
            &mut output,
            &mut bucket,
            &mut sum_squares,
            &mut bucket_frames,
            buffer.samples(),
            channels,
            sample_rate,
            &mut frame_index,
            cancel,
        )? {
            break;
        }
    }
    finish_bucket(&mut output, sum_squares, bucket_frames);
    Ok(output)
}

#[cfg(test)]
mod tests {
    use super::{decode_prefix, AnalysisState, ENERGY_RATE};
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;

    #[test]
    fn prefix_decode_returns_at_most_two_minutes_of_mono_energy() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 48_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut writer = hound::WavWriter::create(file.path(), spec).unwrap();
        for frame in 0..(48_000 * 121) {
            let value = if frame % 24_000 < 480 {
                i16::MAX / 2
            } else {
                0
            };
            writer.write_sample(value).unwrap();
        }
        writer.finalize().unwrap();

        let decoded = decode_prefix(file.path(), &AtomicBool::new(false)).unwrap();

        assert_eq!(decoded.len(), 120 * ENERGY_RATE as usize);
        assert!(decoded.iter().any(|energy| *energy > 0.0));
    }

    #[test]
    fn prefix_decode_stops_when_cancelled_before_start() {
        let file = tempfile::NamedTempFile::new().unwrap();
        let result = decode_prefix(file.path(), &AtomicBool::new(true));
        assert_eq!(result.unwrap_err(), "cancelled");
    }

    #[test]
    fn prefix_decoder_preserves_every_selectable_audio_format() {
        use std::io::Write;

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
            let decoded = decode_prefix(file.path(), &AtomicBool::new(false))
                .unwrap_or_else(|error| panic!(".{extension} prefix decode failed: {error}"));
            assert!(
                (8..=120 * ENERGY_RATE as usize).contains(&decoded.len()),
                ".{extension} produced {} buckets",
                decoded.len()
            );
            assert!(
                decoded.iter().all(|energy| energy.is_finite()),
                ".{extension} returned non-finite energy"
            );
            assert!(
                decoded.iter().any(|energy| *energy > 0.0),
                ".{extension} returned silence"
            );
        }
    }

    #[test]
    fn analysis_cancellation_is_owned_by_run_id_and_handles_early_cancel() {
        let state = AnalysisState::default();
        state.cancel("run-a");
        let run = state.begin("run-a".into()).unwrap();
        assert!(run.cancel_flag().load(std::sync::atomic::Ordering::Relaxed));
        drop(run);

        let run = state.begin("run-b".into()).unwrap();
        state.cancel("stale-run");
        assert!(!run.cancel_flag().load(std::sync::atomic::Ordering::Relaxed));
        state.cancel("run-b");
        assert!(run.cancel_flag().load(std::sync::atomic::Ordering::Relaxed));
    }

    #[tokio::test]
    async fn cancellation_waits_for_the_owned_native_worker_to_exit() {
        let state = Arc::new(AnalysisState::default());
        let run = state.begin("run-wait".into()).unwrap();
        let cancel_state = state.clone();
        let cancellation =
            tokio::spawn(async move { cancel_state.cancel_and_wait("run-wait").await });
        tokio::task::yield_now().await;
        assert!(run.cancel_flag().load(std::sync::atomic::Ordering::Relaxed));
        drop(run);
        tokio::time::timeout(std::time::Duration::from_secs(1), cancellation)
            .await
            .expect("cancellation must observe run completion")
            .unwrap();
    }
}
