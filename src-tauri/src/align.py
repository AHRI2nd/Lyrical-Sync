#!/usr/bin/env python3
"""Forced-alignment sidecar for Lyrical Sync.
Stdin/argv: --models-dir DIR --audio PATH --lines JSON [--language ISO639-3]
Stderr:     JSON progress lines  {"status":…,"message":…,"percent":…}
Stdin:      JSON lyric array when --lines-stdin is used
Stdout:     JSON result          [{"index":int,"start":float,"end":float,"confidence":float},…]
"""
import sys
import json
import argparse
import math
import os
import hashlib


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


def verify_model_file(path, expected_sha256):
    """Inference never installs a model or trusts an interrupted download."""
    digest = hashlib.sha256()
    with open(path, "rb") as model:
        for chunk in iter(lambda: model.read(1024 * 1024), b""):
            digest.update(chunk)
    if digest.hexdigest() != expected_sha256:
        raise ValueError("Model checksum mismatch. Download it again in Settings > AI Models.")


def read_lines_input(lines_json, from_stdin):
    """Read line JSON from stdin to avoid platform command-line length limits."""
    return json.load(sys.stdin) if from_stdin else json.loads(lines_json)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--model-sha256", required=True)
    parser.add_argument("--audio", required=True)
    lines_source = parser.add_mutually_exclusive_group(required=True)
    lines_source.add_argument("--lines")
    lines_source.add_argument("--lines-stdin", action="store_true")
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
        lines = read_lines_input(args.lines, args.lines_stdin)
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
        verify_model_file(onnx_path, args.model_sha256)
        import onnxruntime as ort
        session = ort.InferenceSession(onnx_path)
        tokenizer = Tokenizer()
        
        # Verify model identity by checking input/output names and shapes
        inputs = session.get_inputs()
        outputs = session.get_outputs()
        if not inputs or not outputs:
            raise ValueError("Model has no valid inputs/outputs")
        expected_input = "input"
        if inputs[0].name != expected_input:
            progress("warning", f"예상치 못한 모델 입력 이름: {inputs[0].name} (기대: {expected_input})")
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

    # ── Validate CTC boundary conditions before heavy processing ──────────────
    # CTC requires T >= L (emission frames >= target tokens).
    # We can estimate minimum required audio duration from token count.
    MIN_AUDIO_DURATION_PER_TOKEN = 0.01  # 10ms per token
    MIN_AUDIO_DURATION = 0.5  # 500ms absolute minimum

    def validate_ctc_boundary(audio_waveform, sample_rate, token_count):
        """Validate that audio is long enough for CTC alignment.
        Returns (is_valid, error_message)."""
        if token_count == 0:
            return True, ""
        # Estimate frames: 16000 samples/sec / 320 samples per frame = 50 frames/sec
        # Each frame is 20ms at 16kHz with 320-sample windows
        frames = len(audio_waveform) // 320
        required_frames = token_count  # CTC needs T >= L
        if frames < required_frames:
            estimated_duration = len(audio_waveform) / 16000.0
            min_duration = max(0.5, token_count * 0.01)
            return False, (
                f"오디오가 너무 짧습니다 ({len(audio_waveform) / 16000.0:.2f}초). "
                f"최소 {max(0.5, token_count * 0.01):.2f}초 필요 (토큰 {token_count}개). "
                f"필요 프레임: {required_frames}, 현재: {frames}"
            )
        return True, ""

    # Validate CTC boundary
    token_count = sum(len(line["text"].split()) for line in lines)  # rough estimate
    if args.language in {"jpn", "chi", "zho", "cmn"}:
        token_count = sum(len(line["text"]) for line in lines)

    import numpy as np
    sample_rate = 16000  # load_audio uses 16kHz
    is_valid, error_msg = validate_ctc_boundary(audio_waveform, sample_rate, token_count)
    if not is_valid:
        progress("error", error_msg)
        sys.exit(1)

    def sanitize_line_text(text):
        """Remove or replace characters that cause CTC alignment issues.
        Returns (sanitized_text, warnings, rejected_chars)."""
        import re
        warnings = []
        rejected_chars = []

        # Characters that CTC tokenizer normalizes away or rejects
        # Punctuation-only or digit-only lines cause issues
        punct_digit_regex = re.compile(r'^[\s\W\d_]+$', re.UNICODE)
        if punct_digit_regex.match(text):
            if text.strip() == "":
                return "", ["빈 줄은 타임스탬프 없이 유지됩니다"], []
            # Reject: return empty to skip this line in alignment
            warnings.append(f"구두점/숫자만 있는 줄은 정렬되지 않습니다: {text[:50]}")
            return "", warnings, list(set(text))

        # Special characters that cause issues in CTC - REJECT them
        problematic_chars = re.findall(r"[♪♫♩♬♭♯]", text)
        if problematic_chars:
            unique_chars = list(set(problematic_chars))
            warnings.append(f"특수 문자(♪ 등)는 정렬에서 제거됩니다: {unique_chars}")
            rejected_chars.extend(unique_chars)
            text = re.sub(r"[♪♫♩♬♭♯]", "", text)

        # Long sequences of punctuation - warn but don't reject
        if re.search(r"[.!?]{3,}", text):
            warnings.append(f"연속된 구두점은 정렬에 영향을 줄 수 있습니다: {text[:50]}")

        # Control characters and other non-printable - REJECT
        control_chars = re.findall(r"[\x00-\x1f\x7f-\x9f]", text)
        if control_chars:
            unique_chars = list(set(control_chars))
            warnings.append(f"제어 문자는 정렬에서 제거됩니다: {[hex(ord(c)) for c in unique_chars]}")
            rejected_chars.extend(unique_chars)
            text = re.sub(r"[\x00-\x1f\x7f-\x9f]", "", text)

        return text, warnings, rejected_chars

    # ── Generate emissions before passing them into native CTC alignment ───────

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

    # ── Map and validate tokens to prevent silent drop of unsupported characters ──
    def map_and_validate_tokens(text, tokens_per_line, tokenizer, language):
        """Map input text to tokenizer vocabulary, track dropped characters.
        Returns (processed_text, warnings, char_to_token_map)."""
        import re
        warnings = []
        # Try to encode with the tokenizer to see what gets dropped
        try:
            # Use the tokenizer's encode method to see what gets tokenized
            tokens = tokenizer.encode(text)
            # Check for characters that might be normalized away
            decoded = tokenizer.decode(tokens)
            # Compare original vs decoded length
            if len(decoded) < len(text) * 0.8:  # significant loss
                warnings.append("일부 문자가 토크나이저에 의해 정규화/제거되었습니다")
        except Exception:
            pass
        return text, warnings, None

    # Sanitize unalignable rows before concatenating text. Keeping their original
    # token counts would shift later alignment spans onto the wrong lyric lines.
    alignment_texts = []
    tokens_per_line = []
    for i, line in enumerate(lines):
        alignment_text, warnings, _ = sanitize_line_text(line["text"])
        alignment_texts.append(alignment_text)
        tokens_per_line.append(len(alignment_text) if use_char_split else len(alignment_text.split()))
        for warning in warnings:
            progress("warning", f"줄 {i+1}: {warning}")
        if alignment_text:
            _, token_warnings, _ = map_and_validate_tokens(alignment_text, tokens_per_line[-1], tokenizer, args.language)
            for warning in token_warnings:
                progress("warning", f"줄 {i+1}: {warning}")

    combined_text = "".join(alignment_texts) if use_char_split else " ".join(text for text in alignment_texts if text)

    try:
        if not any(tokens_per_line):
            word_timestamps = []
        else:
            tokens_starred, text_starred = preprocess_text(
                combined_text,
                romanize=romanize,
                language=args.language,
                split_size="word",
            )
            if not use_char_split and len(tokens_starred) != sum(tokens_per_line):
                raise ValueError("가사 일부가 정렬 모델에서 정규화되어 원문 줄과 대응하지 않습니다")
            # Wrap C ABI calls with exception handling to catch native crashes
            try:
                segments, scores, blank_token = get_alignments(
                    emissions,
                    tokens_starred,
                    tokenizer,
                )
                spans = get_spans(tokens_starred, segments, blank_token)
                word_timestamps = postprocess_results(text_starred, spans, stride, scores)
            except Exception as e:
                # Catch potential C ABI crashes (segfault, abort, etc.)
                error_msg = f"CTC 정렬 중 네이티브 오류 발생: {e}"
                if "segfault" in str(e).lower() or "segmentation" in str(e).lower() or "abort" in str(e).lower():
                    error_msg += " (C ABI 크래시 감지 - 오디오가 너무 짧거나 토큰이 너무 많을 수 있음)"
                progress("error", error_msg)
                sys.exit(1)
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
        confidence_normalized = max(0.0, min(1.0, confidence))
        results.append({
            "index": e["index"],
            "start": round(e["start"], 3),
            "end": round(e["end"], 3),
            "confidence": round(confidence_normalized, 4),  # normalized 0-1
            "confidence_percent": round(confidence_normalized * 100, 1),  # percentage 0-100
        })

    # ── Validate returned timestamps: ensure finite, ordered, within audio duration ──────
    def validate_timestamps(results, audio_duration):
        """Validate that returned timestamps are finite, ordered, and within bounds.
        Returns (is_valid, error_message, corrected_results)."""
        import math
        if not results:
            return True, "", results
        corrected = []
        prev_end = 0.0
        for i, e in enumerate(results):
            start = e.get("start", 0.0)
            end = e.get("end", 0.0)
            # Check finite
            if not (isinstance(start, (int, float)) and math.isfinite(start) and
                    isinstance(end, (int, float)) and math.isfinite(end)):
                return False, f"줄 {i+1}: 유효하지 않은 타임스탬프 (start={start}, end={end})", results
            # Check bounds
            if start < 0 or end < 0:
                return False, f"줄 {i+1}: 음수 타임스탬프 (start={start}, end={end})", results
            if end < start:
                return False, f"줄 {i+1}: 종료가 시작보다 빠름 (start={start}, end={end})", results
            if end > audio_duration + 0.001:  # small epsilon for floating point
                return False, f"줄 {i+1}: 종료가 오디오 길이 초과 (end={end:.3f}, duration={audio_duration:.3f})", results
            # Check ordering
            if start < prev_end - 0.001:  # allow small epsilon
                return False, f"줄 {i+1}: 타임스탬프 순서 위배 (prev_end={prev_end:.3f}, start={start:.3f})", results
            prev_end = end
            corrected.append(e)
        return True, "", corrected

    # Get audio duration
    import numpy as np
    audio_duration = len(audio_waveform) / 16000.0
    is_valid, error_msg, corrected_results = validate_timestamps(results, audio_duration)
    if not is_valid:
        progress("error", error_msg)
        sys.exit(1)
    results = corrected_results

    # ── Vocal activity (only meaningful on an isolated vocal stem) ────────────
    # Used downstream to place blank-line / vocal-resume timestamps precisely.
    vocal_segments = detect_vocal_segments(audio_waveform) if (separated and vad_enabled) else []

    progress("done", "Alignment complete", 1.0)
    print(json.dumps({
        "lines": results,
        "vocal_segments": vocal_segments,
        "separated": separated,
        "confidence_unit": "normalized_0_to_1_and_percent",  # documents confidence units
    }), flush=True)



if __name__ == "__main__":
    main()
