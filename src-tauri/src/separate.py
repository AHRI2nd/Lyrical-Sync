#!/usr/bin/env python3
"""Vocal separation sidecar using Demucs htdemucs.
Args:   --model-path PATH  --audio PATH  --output PATH
Stderr: JSON progress lines  {"status":…,"message":…,"percent":…}
"""
import sys
import json
import argparse
import hashlib
import tempfile
import numpy as np
import torch


def progress(status: str, message: str = "", percent: float = 0.0, code: str | None = None):
    payload = {"status": status, "percent": percent}
    if status == "error":
        payload["code"] = code or "general"
    elif message:
        payload["message"] = message
    print(json.dumps(payload), file=sys.stderr, flush=True)


def load_audio(path: str) -> tuple:
    """Load audio to (channels, samples) float32 tensor without torchcodec.
    Tries soundfile first (WAV/FLAC/OGG/AIFF), then audioread (MP3/M4A/…).
    """
    # soundfile handles lossless formats
    try:
        import soundfile as sf
        data, sr = sf.read(path, always_2d=True, dtype="float32")
        wav = torch.from_numpy(data.T)  # (channels, samples), shares the decoded array
        return wav, sr
    except Exception:
        pass

    # audioread handles MP3, M4A, AAC, etc.
    import audioread
    with audioread.audio_open(path) as f:
        sr = f.samplerate
        channels = f.channels
        blocks = [np.frombuffer(b, dtype=np.int16) for b in f]
    raw_pcm = np.concatenate(blocks)
    del blocks
    audio = raw_pcm.astype(np.float32)
    del raw_pcm
    np.multiply(audio, 1.0 / 32768.0, out=audio)
    wav = torch.from_numpy(audio.reshape(-1, channels).T)  # (channels, samples)
    return wav, sr


def read_pcm_stream(reader, channels: int, max_bytes: int = 1024 * 1024 * 1024):
    """Read bounded interleaved little-endian float32 PCM from native stdin."""
    if not isinstance(channels, int) or channels < 1 or channels > 8:
        raise ValueError("Invalid audio channel count")
    payload = bytearray()
    while len(payload) <= max_bytes:
        chunk = reader.read(min(1024 * 1024, max_bytes + 1 - len(payload)))
        if not chunk:
            break
        payload.extend(chunk)
    if len(payload) > max_bytes or len(payload) % (4 * channels) != 0:
        raise ValueError("Invalid or oversized audio PCM stream")
    samples = np.frombuffer(payload, dtype="<f4")
    if samples.size == 0:
        raise ValueError("Invalid audio PCM samples")
    for offset in range(0, samples.size, 1_048_576):
        if not np.isfinite(samples[offset:offset + 1_048_576]).all():
            raise ValueError("Invalid audio PCM samples")
    return samples.reshape(-1, channels)


def write_vocal_audio(soundfile_module, path, audio, sample_rate):
    # Keep Demucs' float output out of the default PCM_16 range/clipping path.
    soundfile_module.write(path, audio, sample_rate, format="WAV", subtype="FLOAT")


def load_verified_checkpoint(path, expected_sha256, loader):
    """Deserialize only the private bytes that passed the trusted digest check."""
    digest = hashlib.sha256()
    with tempfile.TemporaryFile(mode="w+b") as verified:
        with open(path, "rb") as source:
            for chunk in iter(lambda: source.read(1024 * 1024), b""):
                digest.update(chunk)
                verified.write(chunk)
        if digest.hexdigest() != expected_sha256:
            raise ValueError("Model checksum mismatch. Download it again in Settings > AI Models.")
        verified.seek(0)
        return loader(verified, map_location="cpu", weights_only=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--model-sha256", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--audio-sample-rate", type=int)
    parser.add_argument("--audio-channels", type=int)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    progress("separating", "Demucs 모델 로딩 중...", 0.05)

    try:
        from demucs.apply import apply_model
        from demucs.audio import convert_audio
    except ImportError as e:
        progress("error", f"demucs 패키지 미설치: {e}", code="packages")
        sys.exit(1)

    try:
        pkg = load_verified_checkpoint(args.model_path, args.model_sha256, torch.load)
        if isinstance(pkg, dict):
            klass = pkg["klass"]
            model = klass(*pkg.get("args", []), **pkg.get("kwargs", {}))
            model.load_state_dict(pkg["state"])
        else:
            model = pkg
        model.eval()
    except Exception as e:
        progress("error", f"모델 로드 실패: {e}", code="model")
        sys.exit(1)

    progress("separating", "오디오 로딩 중...", 0.10)
    try:
        if args.audio == "-":
            if (args.audio_sample_rate is None or not 8_000 <= args.audio_sample_rate <= 192_000
                    or args.audio_channels is None or not 1 <= args.audio_channels <= 8):
                raise ValueError("Invalid native audio stream format")
            samples = read_pcm_stream(sys.stdin.buffer, args.audio_channels)
            wav = torch.from_numpy(samples.T)
            sr = args.audio_sample_rate
        else:
            wav, sr = load_audio(args.audio)
        wav = convert_audio(wav, sr, model.samplerate, model.audio_channels)
        wav = wav.unsqueeze(0)
    except Exception as e:
        progress("error", f"오디오 로드 실패: {e}", code="audio")
        sys.exit(1)

    device = "cpu"
    try:
        if torch.cuda.is_available():
            device = "cuda"
        elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
            device = "mps"
    except Exception:
        pass

    progress("separating", f"보컬 분리 중 ({device})...", 0.20)
    try:
        with torch.no_grad():
            sources = apply_model(model, wav, device=device, num_workers=0, progress=False)
        vocals_idx = model.sources.index("vocals")
        vocals = sources[0, vocals_idx].cpu()
    except Exception as e:
        progress("error", f"보컬 분리 실패: {e}", code="audio")
        sys.exit(1)

    progress("separating", "보컬 파일 저장 중...", 0.90)
    try:
        import soundfile as sf
        audio_np = vocals.numpy().T  # (samples, channels)
        write_vocal_audio(sf, args.output, audio_np, model.samplerate)
    except Exception as e:
        progress("error", f"저장 실패: {e}", code="audio")
        sys.exit(1)

    progress("done", "보컬 분리 완료", 1.0)


if __name__ == "__main__":
    main()
