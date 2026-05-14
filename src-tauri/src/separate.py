#!/usr/bin/env python3
"""Vocal separation sidecar using Demucs htdemucs.
Args:   --model-path PATH  --audio PATH  --output PATH
Stderr: JSON progress lines  {"status":…,"message":…,"percent":…}
"""
import sys
import json
import argparse
import numpy as np
import torch


def progress(status: str, message: str = "", percent: float = 0.0):
    print(json.dumps({"status": status, "message": message, "percent": percent}),
          file=sys.stderr, flush=True)


def load_audio(path: str) -> tuple:
    """Load audio to (channels, samples) float32 tensor without torchcodec.
    Tries soundfile first (WAV/FLAC/OGG/AIFF), then audioread (MP3/M4A/…).
    """
    # soundfile handles lossless formats
    try:
        import soundfile as sf
        data, sr = sf.read(path, always_2d=True, dtype="float32")
        wav = torch.from_numpy(data.T.copy())  # (channels, samples)
        return wav, sr
    except Exception:
        pass

    # audioread handles MP3, M4A, AAC, etc.
    import audioread
    with audioread.audio_open(path) as f:
        sr = f.samplerate
        channels = f.channels
        blocks = [np.frombuffer(b, dtype=np.int16) for b in f]
    raw = np.concatenate(blocks).astype(np.float32) / 32768.0
    wav = torch.from_numpy(raw.reshape(-1, channels).T.copy())  # (channels, samples)
    return wav, sr


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--model-path", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()

    progress("separating", "Demucs 모델 로딩 중...", 0.05)

    try:
        from demucs.apply import apply_model
        from demucs.audio import convert_audio
    except ImportError as e:
        progress("error", f"demucs 패키지 미설치: {e}")
        sys.exit(1)

    try:
        pkg = torch.load(args.model_path, map_location="cpu", weights_only=False)
        if isinstance(pkg, dict):
            klass = pkg["klass"]
            model = klass(*pkg.get("args", []), **pkg.get("kwargs", {}))
            model.load_state_dict(pkg["state"])
        else:
            model = pkg
        model.eval()
    except Exception as e:
        progress("error", f"모델 로드 실패: {e}")
        sys.exit(1)

    progress("separating", "오디오 로딩 중...", 0.10)
    try:
        wav, sr = load_audio(args.audio)
        wav = convert_audio(wav, sr, model.samplerate, model.audio_channels)
        wav = wav.unsqueeze(0)
    except Exception as e:
        progress("error", f"오디오 로드 실패: {e}")
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
        progress("error", f"보컬 분리 실패: {e}")
        sys.exit(1)

    progress("separating", "보컬 파일 저장 중...", 0.90)
    try:
        import soundfile as sf
        audio_np = vocals.numpy().T  # (samples, channels)
        sf.write(args.output, audio_np, model.samplerate)
    except Exception as e:
        progress("error", f"저장 실패: {e}")
        sys.exit(1)

    progress("done", "보컬 분리 완료", 1.0)


if __name__ == "__main__":
    main()
