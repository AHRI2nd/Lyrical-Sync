#!/usr/bin/env python3
"""Forced-alignment sidecar for Lyrical Sync.
Stdin/argv: --models-dir DIR --audio PATH --lines JSON [--language ISO639-3]
Stderr:     JSON progress lines  {"status":…,"message":…,"percent":…}
Stdout:     JSON result          [{"index":int,"start":float,"end":float,"confidence":float},…]
"""
import sys
import json
import argparse
import math
import os


def progress(status: str, message: str = "", percent: float = 0.0):
    print(json.dumps({"status": status, "message": message, "percent": percent}),
          file=sys.stderr, flush=True)


def detect_vocal_segments(waveform, sr=16000, hop=0.01, win=0.025,
                          rel_thresh=0.06, merge_gap=0.25, min_dur=0.15):
    """Energy-based voice activity on an (ideally isolated) vocal waveform.
    Returns [[start_sec, end_sec], …] of vocal-active regions. Best-effort:
    any failure yields [] so the caller falls back to its offset heuristic.
    The MMS aligner feeds audio at 16 kHz mono, hence the default sr."""
    try:
        import numpy as np
        x = np.asarray(waveform, dtype=np.float32).reshape(-1)
        if x.size == 0:
            return []
        hop_n = max(1, int(sr * hop))
        win_n = max(hop_n, int(sr * win))
        n_frames = 1 + max(0, (x.size - win_n) // hop_n)
        if n_frames <= 0:
            return []
        rms = np.empty(n_frames, dtype=np.float32)
        for i in range(n_frames):
            s = i * hop_n
            frame = x[s:s + win_n]
            rms[i] = np.sqrt(np.mean(frame * frame) + 1e-12)
        peak = float(rms.max())
        if peak <= 0:
            return []
        active = rms > peak * rel_thresh

        segs = []
        start = None
        for i, a in enumerate(active):
            t = i * hop_n / sr
            if a and start is None:
                start = t
            elif not a and start is not None:
                segs.append([start, t])
                start = None
        if start is not None:
            segs.append([start, n_frames * hop_n / sr])

        merged = []
        for s, e in segs:
            if merged and s - merged[-1][1] <= merge_gap:
                merged[-1][1] = e
            else:
                merged.append([s, e])
        return [[round(s, 3), round(e, 3)] for s, e in merged if (e - s) >= min_dur]
    except Exception:
        return []


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--lines", required=True)
    parser.add_argument("--language", default="eng",
                        help="ISO 639-3 language code (eng/kor/jpn/…)")
    parser.add_argument("--separated", default="false",
                        help="'true' if --audio is an isolated vocal stem (enables VAD)")
    parser.add_argument("--vad", default="true",
                        help="'true' to compute vocal-activity segments (needs --separated)")
    args = parser.parse_args()
    separated = args.separated == "true"
    vad_enabled = args.vad == "true"

    try:
        lines = json.loads(args.lines)  # [{"index": int, "text": str}]
    except json.JSONDecodeError as e:
        progress("error", f"Invalid lines JSON: {e}")
        sys.exit(1)

    if not lines:
        print(json.dumps([]), flush=True)
        sys.exit(0)

    # ── Import dependencies ──────────────────────────────────────────────────

    progress("loading_model", "Loading dependencies...", 0.0)

    try:
        import onnxruntime  # noqa: F401
        from ctc_forced_aligner import (
            load_audio,
            generate_emissions,
            preprocess_text,
            get_alignments,
            get_spans,
            postprocess_results,
            ensure_onnx_model,
            MODEL_URL,
            Tokenizer,
        )
    except ImportError as e:
        progress("error", f"패키지 임포트 실패: {e}. 설정 > AI 모델에서 패키지를 다시 설치하세요.")
        sys.exit(1)

    # ── Load / auto-download ONNX model ─────────────────────────────────────

    os.makedirs(args.models_dir, exist_ok=True)
    onnx_path = os.path.join(args.models_dir, "ctc-forced-aligner.onnx")

    progress("loading_model", "Loading model...", 0.05)
    try:
        ensure_onnx_model(onnx_path, MODEL_URL)
        import onnxruntime as ort
        session = ort.InferenceSession(onnx_path)
        tokenizer = Tokenizer()
    except Exception as e:
        progress("error", f"모델 로드 실패: {e}")
        sys.exit(1)

    # ── Load audio ───────────────────────────────────────────────────────────

    progress("loading_audio", "Loading audio…", 0.10)
    try:
        # load_audio returns 1D numpy float32 array in v1.x
        audio_waveform = load_audio(args.audio, ret_type='np')
    except Exception as e:
        progress("error", f"오디오 로드 실패: {e}")
        sys.exit(1)

    # ── Generate emissions ───────────────────────────────────────────────────

    progress("analyzing", "Generating emissions…", 0.20)
    try:
        emissions, stride = generate_emissions(session, audio_waveform, batch_size=1)
    except Exception as e:
        progress("error", f"emissions 생성 실패: {e}")
        sys.exit(1)

    # ── Preprocess text (word-level) ─────────────────────────────────────────
    #
    # split_size="word" so that we can map word timestamps back to lyric lines.
    # split_size="sentence" uses nltk.PunktTokenizer and doesn't split on \n.

    progress("aligning", "Preprocessing text…", 0.50)

    # Languages whose scripts are not in the model vocab → romanize via uroman.
    NON_LATIN = {"jpn", "kor", "chi", "zho", "cmn", "ara", "hin", "ben", "rus",
                 "tha", "heb", "ell", "bul", "ukr", "kat", "kan", "tel", "tam",
                 "mal", "sin", "mya", "khm", "lao", "mon", "tib"}
    romanize = args.language in NON_LATIN

    # For CJK languages preprocess_text internally overrides split_size to "char".
    # Join without separator and count characters so the mapping is exact.
    # For other languages join with " " and count space-split words.
    CHAR_SPLIT_LANGS = {"jpn", "chi", "zho", "cmn"}
    use_char_split = args.language in CHAR_SPLIT_LANGS

    if use_char_split:
        combined_text = "".join(line["text"] for line in lines)
        tokens_per_line = [len(line["text"]) for line in lines]
    else:
        combined_text = " ".join(line["text"] for line in lines)
        tokens_per_line = [len(line["text"].split()) for line in lines]

    try:
        tokens_starred, text_starred = preprocess_text(
            combined_text,
            romanize=romanize,
            language=args.language,
            split_size="word",
        )
        segments, scores, blank_token = get_alignments(
            emissions,
            tokens_starred,
            tokenizer,
        )
        spans = get_spans(tokens_starred, segments, blank_token)
        word_timestamps = postprocess_results(text_starred, spans, stride, scores)
    except Exception as e:
        progress("error", f"정렬 실패: {e}")
        sys.exit(1)

    # ── Map word/char timestamps → lyric-line timestamps ─────────────────────

    progress("postprocessing", "Processing results…", 0.90)

    # First pass: collect per-line avg log-prob scores
    raw_entries = []
    tok_idx = 0
    for i, line in enumerate(lines):
        n = tokens_per_line[i]
        if n == 0:
            continue
        line_toks = word_timestamps[tok_idx:tok_idx + n]
        tok_idx += n
        if not line_toks:
            continue
        start = line_toks[0]["start"]
        end = line_toks[-1]["end"]
        char_count = max(1, sum(len(w.get("text", "x")) for w in line_toks))
        avg_log_prob = sum(w.get("score", 0) for w in line_toks) / char_count
        raw_entries.append({
            "index": line["index"],
            "start": start,
            "end": end,
            "avg_log_prob": avg_log_prob,
        })

    # Second pass: min-max normalize so scores are relative to this batch
    if raw_entries:
        scores = [e["avg_log_prob"] for e in raw_entries]
        lo, hi = min(scores), max(scores)
        score_range = hi - lo if hi > lo else 1.0
    else:
        lo, score_range = 0.0, 1.0

    results = []
    for e in raw_entries:
        confidence = (e["avg_log_prob"] - lo) / score_range
        results.append({
            "index": e["index"],
            "start": round(e["start"], 3),
            "end": round(e["end"], 3),
            "confidence": round(max(0.0, min(1.0, confidence)), 4),
        })

    # ── Vocal activity (only meaningful on an isolated vocal stem) ────────────
    # Used downstream to place blank-line / vocal-resume timestamps precisely.
    vocal_segments = detect_vocal_segments(audio_waveform) if (separated and vad_enabled) else []

    progress("done", "Alignment complete", 1.0)
    print(json.dumps({
        "lines": results,
        "vocal_segments": vocal_segments,
        "separated": separated,
    }), flush=True)


if __name__ == "__main__":
    main()
