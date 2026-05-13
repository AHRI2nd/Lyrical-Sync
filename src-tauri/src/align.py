#!/usr/bin/env python3
"""Forced-alignment sidecar for Lyrical Sync.
Stdin/argv: --models-dir DIR --audio PATH --lines JSON [--language ISO639-3]
Stderr:     JSON progress lines  {"status":…,"message":…,"percent":…}
Stdout:     JSON result          [{"index":int,"start":float,"end":float,"confidence":float},…]
"""
import sys
import json
import argparse
import os


def progress(status: str, message: str = "", percent: float = 0.0):
    print(json.dumps({"status": status, "message": message, "percent": percent}),
          file=sys.stderr, flush=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--models-dir", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--lines", required=True)
    parser.add_argument("--language", default="eng",
                        help="ISO 639-3 language code (eng/kor/jpn/…)")
    args = parser.parse_args()

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
        import torch
    except ImportError:
        progress("error", "torch not installed. Run: pip install torch")
        sys.exit(1)

    try:
        from ctc_forced_aligner import (
            load_audio,
            load_alignment_model,
            generate_emissions,
            preprocess_text,
            get_alignments,
            get_spans,
            postprocess_results,
        )
    except ImportError:
        progress("error", "ctc-forced-aligner not installed. Run: pip install ctc-forced-aligner")
        sys.exit(1)

    # ── Device selection (CUDA → MPS → CPU) ─────────────────────────────────

    device = "cpu"
    if torch.cuda.is_available():
        device = "cuda"
    elif hasattr(torch.backends, "mps") and torch.backends.mps.is_available():
        device = "mps"

    # ── Load model ───────────────────────────────────────────────────────────

    model_path = os.path.join(args.models_dir, "ctc-forced-aligner")
    if not os.path.isdir(model_path):
        progress("error", f"Model not found at: {model_path}")
        sys.exit(1)

    progress("loading_model", f"Loading model ({device})…", 0.05)
    try:
        model, tokenizer = load_alignment_model(model_path, device=device)
    except Exception as e:
        progress("error", f"Failed to load model: {e}")
        sys.exit(1)

    # ── Load audio ───────────────────────────────────────────────────────────

    progress("loading_audio", "Loading audio…", 0.10)
    try:
        audio_waveform = load_audio(args.audio, model.dtype, model.device)
    except Exception as e:
        progress("error", f"Failed to load audio: {e}")
        sys.exit(1)

    # ── Generate emissions ───────────────────────────────────────────────────

    progress("analyzing", "Generating emissions…", 0.20)
    try:
        emissions, stride = generate_emissions(model, audio_waveform, batch_size=1)
    except Exception as e:
        progress("error", f"Failed to generate emissions: {e}")
        sys.exit(1)

    # ── Preprocess text ──────────────────────────────────────────────────────

    progress("aligning", "Preprocessing text…", 0.50)
    combined_text = "\n".join(line["text"] for line in lines)

    try:
        tokens_starred, text_starred = preprocess_text(
            combined_text,
            romanize=False,
            language=args.language,
            split_size="sentence",
        )
        segments, scores, blank_token = get_alignments(
            emissions,
            tokens_starred,
            tokenizer,
        )
        spans = get_spans(tokens_starred, segments, blank_token)
        word_timestamps = postprocess_results(text_starred, spans, stride, scores)
    except Exception as e:
        progress("error", f"Alignment failed: {e}")
        sys.exit(1)

    # ── Build per-line results ────────────────────────────────────────────────

    progress("postprocessing", "Processing results…", 0.90)

    results = []
    for i, sentence_words in enumerate(word_timestamps):
        if i >= len(lines):
            break
        if not sentence_words:
            continue
        start = sentence_words[0]["start"]
        end = sentence_words[-1]["end"]
        avg_score = sum(w.get("score", 1.0) for w in sentence_words) / len(sentence_words)
        results.append({
            "index": lines[i]["index"],
            "start": round(start, 3),
            "end": round(end, 3),
            "confidence": round(float(avg_score), 4),
        })

    progress("done", "Alignment complete", 1.0)
    print(json.dumps(results), flush=True)


if __name__ == "__main__":
    main()
