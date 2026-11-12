"""Standard-library regressions for sidecar boundaries; no ML runtime required."""
import importlib.util
import hashlib
import io
import json
import math
import tempfile
import subprocess
import struct
import sys
import os
import sysconfig
import types
import unittest
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("lyrical_align", ROOT / "src-tauri/src/align.py")
align = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align)


class VocalActivityTests(unittest.TestCase):
    def test_ai_pcm_stream_is_read_as_little_endian_interleaved_float32(self):
        import numpy as np
        data = struct.pack("<ffff", 0.25, -0.5, 1.0, -1.0)
        samples = align.read_pcm_stream(io.BytesIO(data), channels=2, max_bytes=16)
        self.assertEqual(samples.shape, (2, 2))
        self.assertEqual(samples.tolist(), [[0.25, -0.5], [1.0, -1.0]])
        self.assertEqual(samples.dtype, np.dtype("float32"))

    def test_ai_pcm_stream_rejects_unaligned_nonfinite_and_over_budget_data(self):
        for payload, channels, limit in (
            (b"\0", 1, 8),
            (struct.pack("<ff", 0.0, float("nan")), 1, 8),
            (b"\0" * 12, 1, 8),
        ):
            with self.subTest(payload=payload, channels=channels, limit=limit):
                with self.assertRaises(ValueError):
                    align.read_pcm_stream(io.BytesIO(payload), channels, limit)

    def test_framed_lyric_header_leaves_pcm_bytes_unconsumed(self):
        lyrics = b'[{"index":0,"text":"hello"}]'
        stream = io.BytesIO(struct.pack("<I", len(lyrics)) + lyrics + b"pcm")
        self.assertEqual(align.read_framed_lines_input(stream), json.loads(lyrics))
        self.assertEqual(stream.read(), b"pcm")

    def test_framed_lyric_header_rejects_truncation_and_oversize(self):
        with self.assertRaises(ValueError):
            align.read_framed_lines_input(io.BytesIO(b"\x03\x00"))
        with self.assertRaises(ValueError):
            align.read_framed_lines_input(io.BytesIO(struct.pack("<I", 17) + b"x" * 17), max_bytes=16)

    def test_progress_error_uses_stable_code_and_does_not_serialize_diagnostic(self):
        output = io.StringIO()
        with patch("sys.stderr", output):
            align.progress("error", "model load failed at /private/user/model.onnx", code="model")

        payload = json.loads(output.getvalue())
        self.assertEqual(payload["status"], "error")
        self.assertEqual(payload["code"], "model")
        self.assertNotIn("message", payload)
        self.assertNotIn("/private/user", output.getvalue())

    def test_digital_silence_has_no_vocal_segments_and_a_pulse_remains_detectable(self):
        class AudioArray(list):
            @property
            def size(self):
                return len(self)

            def reshape(self, _shape):
                return self

            def __getitem__(self, key):
                value = super().__getitem__(key)
                return AudioArray(value) if isinstance(key, slice) else value

            def __mul__(self, other):
                return AudioArray(left * right for left, right in zip(self, other))

        class RmsArray(list):
            def max(self):
                return max(self, default=0.0)

            def __gt__(self, threshold):
                return [value > threshold for value in self]

        numpy = types.SimpleNamespace(
            float32="float32",
            asarray=lambda values, dtype: AudioArray(values),
            empty=lambda size, dtype: RmsArray([0.0] * size),
            sqrt=math.sqrt,
            mean=lambda values: sum(values) / len(values),
        )
        silent = [0.0] * 32_000
        pulse = silent.copy()
        pulse[7_680:12_000] = [0.5] * 4_320

        with patch.dict(sys.modules, {"numpy": numpy}):
            self.assertEqual(align.detect_vocal_segments(silent), [])
            self.assertTrue(align.detect_vocal_segments(pulse))


class ModelIntegrityTests(unittest.TestCase):
    def test_valid_local_model_is_accepted(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.onnx"
            path.write_bytes(b"abc")
            align.verify_model_file(path, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")

    def test_partial_model_is_rejected_without_replacing_its_contents(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.onnx"
            path.write_bytes(b"partial")
            with self.assertRaisesRegex(ValueError, "checksum"):
                align.verify_model_file(path, "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
            self.assertEqual(path.read_bytes(), b"partial")

    def test_missing_model_requires_explicit_download(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(FileNotFoundError):
                align.verify_model_file(Path(folder) / "missing.onnx", "0" * 64)
            self.assertEqual(list(Path(folder).iterdir()), [])

    def test_onnx_loader_uses_the_exact_bytes_that_passed_checksum_verification(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.onnx"
            path.write_bytes(b"trusted model")
            expected = hashlib.sha256(b"trusted model").hexdigest()

            def loader(verified_path):
                path.write_bytes(b"replacement")
                self.assertEqual(Path(verified_path).read_bytes(), b"trusted model")
                return "loaded verified model"

            model = align.load_verified_onnx_model(path, expected, loader)
            self.assertEqual(model.session, "loaded verified model")
            model.close()

    def test_verified_model_keeps_staging_until_the_loader_releases_its_file(self):
        with tempfile.TemporaryDirectory() as folder:
            source = Path(folder) / "model.onnx"
            source.write_bytes(b"verified model")
            expected = hashlib.sha256(b"verified model").hexdigest()
            loaded_files = []

            def loader(staged_path):
                loaded_files.append(open(staged_path, "rb"))
                return loaded_files[-1]

            model = align.load_verified_onnx_model(source, expected, loader)
            staged_path = Path(loaded_files[0].name)
            try:
                self.assertTrue(staged_path.exists(), "staged model must outlive an open loader handle")
                self.assertEqual(model.session.read(), b"verified model")
                model.close()
                self.assertFalse(staged_path.exists(), "staged model must be removed after the handle closes")
            finally:
                for loaded_file in loaded_files:
                    if not loaded_file.closed:
                        loaded_file.close()

    def test_onnx_checksum_mismatch_never_reaches_loader(self):
        from unittest.mock import Mock
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.onnx"
            path.write_bytes(b"changed model")
            loader = Mock()

            with self.assertRaisesRegex(ValueError, "checksum"):
                align.load_verified_onnx_model(path, "0" * 64, loader)

            loader.assert_not_called()


class AudioArrayOwnershipTests(unittest.TestCase):
    class Array:
        def __init__(self, values, dtype, shape=None, base=None, transposed=False):
            self.values = values
            self.dtype = dtype
            self.shape = shape or (len(values),)
            self.base = base if base is not None else self
            self.transposed = transposed

        @property
        def T(self):
            return type(self)(
                self.values,
                self.dtype,
                tuple(reversed(self.shape)),
                base=self.base,
                transposed=not self.transposed,
            )

        @property
        def flags(self):
            return types.SimpleNamespace(c_contiguous=not self.transposed)

        def copy(self):
            raise AssertionError("a full-size transpose copy is not allowed")

        def astype(self, dtype):
            return type(self)(list(self.values), dtype, self.shape)

        def reshape(self, _rows, channels):
            return type(self)(
                self.values,
                self.dtype,
                (len(self.values) // channels, channels),
                base=self.base,
            )

        def matrix(self):
            rows, columns = self.shape
            values = [self.values[row * columns:(row + 1) * columns] for row in range(rows)]
            return [list(column) for column in zip(*values)] if self.transposed else values

    def load_separate(self, modules):
        separate_spec = importlib.util.spec_from_file_location(
            "lyrical_separate_test", ROOT / "src-tauri/src/separate.py"
        )
        separate = importlib.util.module_from_spec(separate_spec)
        with patch.dict(sys.modules, modules):
            separate_spec.loader.exec_module(separate)
        return separate

    def test_soundfile_waveform_is_transposed_without_a_full_array_copy(self):
        source = self.Array(list(range(24)), "float32", (12, 2))
        fake_torch = types.SimpleNamespace(from_numpy=lambda value: value)
        soundfile = types.SimpleNamespace(read=lambda *args, **kwargs: (source, 48_000))
        numpy = types.SimpleNamespace(float32="float32", int16="int16")
        modules = {"torch": fake_torch, "numpy": numpy, "soundfile": soundfile}
        with patch.dict(sys.modules, modules):
            separate = self.load_separate(modules)
            waveform, sample_rate = separate.load_audio("audio.wav")

        self.assertEqual(sample_rate, 48_000)
        self.assertEqual(waveform.shape, (2, 12))
        self.assertIs(waveform.base, source.base)
        self.assertFalse(waveform.flags.c_contiguous)

    def test_audioread_waveform_reuses_one_float_array_for_the_tensor_view(self):
        class Reader:
            samplerate = 48_000
            channels = 2

            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def __iter__(self):
                yield struct.pack("<hh", 32767, -32768)
                yield struct.pack("<hh", 16384, -16384)

        class Numpy:
            float32 = "float32"
            int16 = "int16"

            @staticmethod
            def frombuffer(value, dtype):
                return AudioArrayOwnershipTests.Array(list(struct.unpack("<" + "h" * (len(value) // 2), value)), dtype)

            @staticmethod
            def concatenate(values):
                combined = [sample for value in values for sample in value.values]
                return AudioArrayOwnershipTests.Array(combined, "int16")

            @staticmethod
            def multiply(array, scalar, out):
                for index, value in enumerate(array.values):
                    out.values[index] = value * scalar
                return out

        tensors = []
        fake_torch = types.SimpleNamespace(from_numpy=lambda value: tensors.append(value) or value)
        soundfile = types.SimpleNamespace(read=lambda *_args, **_kwargs: (_ for _ in ()).throw(ValueError()))
        audioread = types.SimpleNamespace(audio_open=lambda _path: Reader())
        modules = {
            "torch": fake_torch,
            "numpy": Numpy,
            "soundfile": soundfile,
            "audioread": audioread,
        }
        with patch.dict(sys.modules, modules):
            separate = self.load_separate(modules)
            waveform, sample_rate = separate.load_audio("audio.mp3")

        self.assertEqual(sample_rate, 48_000)
        self.assertEqual(waveform.shape, (2, 2))
        self.assertEqual(
            waveform.matrix(),
            [[32767 / 32768, 16384 / 32768], [-1, -16384 / 32768]],
        )
        self.assertEqual(len(tensors), 1)
        self.assertIs(waveform.base, tensors[0].base)
        self.assertFalse(waveform.flags.c_contiguous)

    def test_native_pcm_stream_is_mapped_to_frames_without_a_second_sample_copy(self):
        import numpy as np
        payload = struct.pack("<ffff", 0.25, -0.5, 1.0, -1.0)
        fake_torch = types.SimpleNamespace(from_numpy=lambda value: value)
        modules = {"torch": fake_torch, "numpy": np}
        with patch.dict(sys.modules, modules):
            separate = self.load_separate(modules)
            frames = separate.read_pcm_stream(io.BytesIO(payload), 2, max_bytes=16)

        self.assertEqual(frames.shape, (2, 2))
        self.assertEqual(frames.tolist(), [[0.25, -0.5], [1.0, -1.0]])
        self.assertEqual(frames.dtype, np.dtype("float32"))
        self.assertFalse(frames.flags.owndata)

    def test_native_pcm_stream_rejects_truncated_nonfinite_and_over_budget_payload(self):
        import numpy as np
        modules = {"torch": types.SimpleNamespace(from_numpy=lambda value: value), "numpy": np}
        with patch.dict(sys.modules, modules):
            separate = self.load_separate(modules)
            for payload, channels, limit in (
                (b"\0", 1, 8),
                (struct.pack("<ff", 0.0, float("inf")), 1, 8),
                (b"\0" * 12, 1, 8),
                (b"\0" * 8, 9, 8),
            ):
                with self.subTest(payload=payload, channels=channels, limit=limit):
                    with self.assertRaises(ValueError):
                        separate.read_pcm_stream(io.BytesIO(payload), channels, limit)

    def test_native_pcm_stream_runs_separation_sidecar_and_writes_vocal_output(self):
        import contextlib
        import numpy as np

        class Tensor:
            def __init__(self, values):
                self.values = values

            def unsqueeze(self, axis):
                return Tensor(np.expand_dims(self.values, axis))

            def cpu(self):
                return self

            def numpy(self):
                return self.values

        class Model:
            samplerate = 16_000
            audio_channels = 2
            sources = ["other", "vocals"]

            def eval(self):
                return None

        class Sources:
            def __init__(self, values):
                self.values = values

            def __getitem__(self, index):
                return Tensor(self.values[index])

        model = Model()
        fake_torch = types.SimpleNamespace(
            from_numpy=lambda value: Tensor(value),
            load=lambda *_args, **_kwargs: model,
            no_grad=contextlib.nullcontext,
            cuda=types.SimpleNamespace(is_available=lambda: False),
            backends=types.SimpleNamespace(mps=types.SimpleNamespace(is_available=lambda: False)),
        )
        applied = []

        def apply_model(_model, audio, **_kwargs):
            applied.append(audio.values.copy())
            return Sources(np.stack([audio.values, audio.values], axis=1))

        demucs = types.ModuleType("demucs")
        demucs.__path__ = []
        demucs_apply = types.ModuleType("demucs.apply")
        demucs_apply.apply_model = apply_model
        demucs_audio = types.ModuleType("demucs.audio")
        demucs_audio.convert_audio = lambda audio, *_args: audio

        def write_output(path, audio, sample_rate, **kwargs):
            Path(path).write_bytes(b"synthetic-float-wav")
            self.assertEqual(audio.shape, (4, 2))
            self.assertEqual(sample_rate, 16_000)
            self.assertEqual(kwargs, {"format": "WAV", "subtype": "FLOAT"})

        fake_soundfile = types.SimpleNamespace(write=write_output)
        modules = {
            "torch": fake_torch,
            "numpy": np,
            "demucs": demucs,
            "demucs.apply": demucs_apply,
            "demucs.audio": demucs_audio,
            "soundfile": fake_soundfile,
        }
        payload = struct.pack("<ffffffff", 0.25, -0.5, 1.0, -1.0, 0.5, -0.25, 0.75, -0.75)

        with tempfile.TemporaryDirectory() as folder, patch.dict(sys.modules, modules):
            root = Path(folder)
            checkpoint = root / "model.pth"
            checkpoint.write_bytes(b"verified-model")
            output = root / "vocals.wav"
            stdin = io.TextIOWrapper(io.BytesIO(payload))
            separate = self.load_separate(modules)
            stderr = io.StringIO()
            argv = [
                "separate.py", "--model-path", str(checkpoint),
                "--model-sha256", hashlib.sha256(checkpoint.read_bytes()).hexdigest(),
                "--audio", "-", "--audio-sample-rate", "16000", "--audio-channels", "2",
                "--output", str(output),
            ]
            with patch.object(separate.sys, "argv", argv), patch.object(separate.sys, "stdin", stdin), \
                    contextlib.redirect_stderr(stderr):
                separate.main()

            self.assertTrue(output.is_file())
            self.assertEqual(output.read_bytes(), b"synthetic-float-wav")
            self.assertEqual(len(applied), 1)
            np.testing.assert_array_equal(
                applied[0], np.array([[[0.25, 1.0, 0.5, 0.75], [-0.5, -1.0, -0.25, -0.75]]], dtype=np.float32)
            )
            events = [json.loads(line) for line in stderr.getvalue().splitlines()]
            self.assertEqual(events[-1]["status"], "done")


class CtcBoundaryTests(unittest.TestCase):
    def test_rejects_the_pinned_native_near_boundary_frame_window(self):
        tokens = list(range(60))
        safe, message = align.validate_ctc_native_boundary([[0] * 32 for _ in range(65)], tokens)
        self.assertFalse(safe)
        self.assertIn("66", message)
        self.assertTrue(align.validate_ctc_native_boundary([[0] * 32 for _ in range(66)], tokens)[0])

    def test_includes_required_repeat_frames(self):
        self.assertFalse(align.validate_ctc_native_boundary([[0] * 32 for _ in range(8)], [1, 1])[0])
        self.assertTrue(align.validate_ctc_native_boundary([[0] * 32 for _ in range(9)], [1, 1])[0])


class AlignmentExecutionTests(unittest.TestCase):
    """Run the shipped sidecar with deterministic small substitutes for ML packages."""

    def run_alignment(self, *, short_audio=False, bad_timestamps=False, lyric_lines=None, native_audio=False):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            model = root / "ctc-forced-aligner.onnx"
            model.write_bytes(b"fixture-model")
            (root / "onnxruntime.py").write_text('''
from types import SimpleNamespace
class InferenceSession:
    def __init__(self, path): self.path = path
    def get_inputs(self): return [SimpleNamespace(name="input")]
    def get_outputs(self): return [SimpleNamespace(name="output")]
''', encoding="utf-8")
            # No heavy numpy or ONNX runtime is necessary for this smoke test.
            if native_audio:
                (root / "numpy.py").write_text('''import builtins, math, struct
float32 = "float32"
class Values(list):
    def all(self): return builtins.all(self)
class Matrix(list):
    def mean(self, axis, dtype): return Vector([row[0] for row in self])
class Vector(list):
    size = property(lambda self: len(self))
    def reshape(self, _rows, columns): return Matrix([self[i:i+columns] for i in range(0, len(self), columns)])
def frombuffer(payload, dtype): return Vector(value[0] for value in struct.iter_unpack("<f", payload))
def isfinite(values): return Values(math.isfinite(value) for value in values)
''', encoding="utf-8")
            else:
                (root / "numpy.py").write_text("", encoding="utf-8")
            (root / "librosa.py").write_text('''
def load(path, sr=None, mono=False):
    assert sr == 16000 and mono is True
    return range(16 if "short" in path else 32000), sr
''', encoding="utf-8")
            (root / "ctc_forced_aligner.py").write_text('''
class Tokenizer:
    def encode(self, text): return [ord(c) for c in text]
    def decode(self, tokens): return "".join(chr(t) for t in tokens)
    def get_vocab(self): return {c: i for i, c in enumerate("abcdefghijklmnopqrstuvwxyz <>.")}
def load_audio(path, ret_type=None):
    return range(16 if "short" in path else 32000)
def generate_emissions(session, waveform, batch_size=1):
    return list(range(16)), 0.02
def preprocess_text(text, **kwargs):
    words = text.split()
    return [" ".join(word) for word in words], words
def get_alignments(emissions, tokens, tokenizer):
    assert len(emissions) == 16, "emissions must precede alignment"
    return tokens, [0.0] * len(tokens), 0
def get_spans(tokens, segments, blank_token): return segments
def postprocess_results(text, spans, stride, scores):
    return [{"text": token, "start": float('nan') if "bad" in token else i + 0.2,
             "end": i + 0.8, "score": -0.1}
            for i, token in enumerate(text)]
''', encoding="utf-8")
            lyric = "bad" if bad_timestamps else "hello world"
            payload = lyric_lines if lyric_lines is not None else [{"index": 3, "text": lyric}]
            command = [sys.executable, "-S", str(ROOT / "src-tauri/src/align.py"),
                 "--models-dir", str(root), "--model-sha256", hashlib.sha256(b"fixture-model").hexdigest(),
                 "--audio", "-" if native_audio else ("short.wav" if short_audio else "normal.wav"),
                 "--lines-stdin", "--language", "eng", "--vad", "false"]
            if native_audio:
                command.extend(["--audio-sample-rate", "16000", "--audio-channels", "1"])
                lyrics = json.dumps(payload).encode()
                audio = struct.pack("<" + "f" * 32_000, *([0.1] * 32_000))
                input_data = struct.pack("<I", len(lyrics)) + lyrics + audio
            else:
                input_data = json.dumps(payload)
            return subprocess.run(
                command,
                input=input_data, text=not native_audio,
                capture_output=True, timeout=10, env={**os.environ, "PYTHONPATH": str(root)},
            )

    def test_normal_input_produces_ordered_alignment_with_emissions(self):
        result = self.run_alignment()
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual([line["index"] for line in output["lines"]], [3])
        self.assertEqual([output["lines"][0]["start"], output["lines"][0]["end"]], [0.2, 1.8])
        self.assertEqual(output["lines"][0]["confidence"], 0.5)
        self.assertEqual(output["confidence_unit"], "batch_relative_0_to_1_not_probability")

    def test_native_pcm_stream_runs_alignment_with_framed_lyrics(self):
        result = self.run_alignment(native_audio=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual([line["index"] for line in output["lines"]], [3])
        self.assertEqual([output["lines"][0]["start"], output["lines"][0]["end"]], [0.2, 1.8])

    def test_equal_score_lines_receive_neutral_relative_confidence(self):
        result = self.run_alignment(lyric_lines=[
            {"index": 0, "text": "hello"},
            {"index": 1, "text": "world"},
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual([line["confidence"] for line in output["lines"]], [0.5, 0.5])

    def test_unalignable_lyric_rows_do_not_shift_following_timestamps(self):
        result = self.run_alignment(lyric_lines=[
            {"index": 0, "text": "hello"},
            {"index": 1, "text": "123"},
            {"index": 2, "text": "world"},
        ])
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual([line["index"] for line in output["lines"]], [0, 2])
        self.assertEqual([line["start"] for line in output["lines"]], [0.2, 1.2])

    def test_all_unalignable_lines_return_an_empty_draft_without_native_ctc(self):
        result = self.run_alignment(lyric_lines=[{"index": 1, "text": "..."}])
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout)["lines"], [])

    def test_short_audio_rejected_before_emission_alignment(self):
        result = self.run_alignment(short_audio=True)
        self.assertNotEqual(result.returncode, 0)
        events = [json.loads(line) for line in result.stderr.splitlines()]
        self.assertTrue(any(event.get("code") == "audio_too_short" for event in events))

    def test_nonfinite_sidecar_results_rejected(self):
        result = self.run_alignment(bad_timestamps=True)
        self.assertNotEqual(result.returncode, 0)
        events = [json.loads(line) for line in result.stderr.splitlines()]
        self.assertTrue(any(event.get("code") == "general" for event in events))


class EmbeddedAlignmentExecutionTests(unittest.TestCase):
    """Exercise the actual shipped Python script without a network/model download."""

    def run_alignment(self, models_dir, payload, *, mock_dependencies=None, language="eng"):
        import hashlib
        model = Path(models_dir) / "ctc-forced-aligner.onnx"
        model.write_bytes(b"trusted-model-fixture")
        command = [
            sys.executable, "-S", str(ROOT / "src-tauri/src/align.py"),
            "--models-dir", str(models_dir),
            "--model-sha256", hashlib.sha256(model.read_bytes()).hexdigest(),
            "--audio", str(Path(models_dir) / "short.wav"),
            "--lines-stdin", "--language", language,
        ]
        env = {**os.environ}
        if mock_dependencies is not None:
            env["PYTHONPATH"] = str(mock_dependencies)
            (Path(mock_dependencies) / "librosa.py").write_text(
                "def load(path, sr=None, mono=False):\n"
                " assert sr == 16000 and mono is True\n"
                " return range(32000), sr\n",
                encoding="utf-8",
            )
        return subprocess.run(command, input=payload, capture_output=True, text=True,
                              env=env, timeout=10)

    def test_invalid_json_exits_before_optional_dependency_import(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_alignment(folder, "{invalid json")
            self.assertNotEqual(result.returncode, 0)
            payload = json.loads(result.stderr.strip().splitlines()[0])
            self.assertEqual(payload["status"], "error")
            self.assertEqual(payload["code"], "general")
            self.assertNotIn("message", payload)

    def test_normal_alignment_generates_emissions_before_native_ctc(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            # Minimal synthetic ML boundary: all orchestration is the shipped
            # align.py, while no real model/audio/user file or network is used.
            (root / "onnxruntime.py").write_text(
                "from types import SimpleNamespace\n"
                "class InferenceSession:\n"
                " def __init__(self, path): self.path = path\n"
                " def get_inputs(self): return [SimpleNamespace(name='input')]\n"
                " def get_outputs(self): return [SimpleNamespace(name='output')]\n",
                encoding="utf-8",
            )
            (root / "numpy.py").write_text("", encoding="utf-8")
            package = root / "ctc_forced_aligner"
            package.mkdir()
            (package / "__init__.py").write_text(
                "class Tokenizer:\n"
                " def encode(self, text): return text.split()\n"
                " def decode(self, tokens): return ' '.join(tokens)\n"
                " def get_vocab(self): return {c: i for i, c in enumerate('abcdefghijklmnopqrstuvwxyz <>.')}\n"
                "class FakeAudio:\n"
                " def __len__(self): return 32000\n"
                "def load_audio(*args, **kwargs): return FakeAudio()\n"
                "def generate_emissions(session, audio, batch_size): return (list(range(16)), 0.02)\n"
                "def preprocess_text(text, **kwargs):\n"
                " words = text.split()\n"
                " tokens = []\n"
                " starred_text = []\n"
                " for word in words:\n"
                "  tokens.extend(['<star>', ' '.join(word)])\n"
                "  starred_text.extend(['<star>', word])\n"
                " return tokens, starred_text\n"
                "def get_alignments(emissions, tokens, tokenizer):\n"
                " assert len(emissions) == 16\n"
                " return ('segments', 'scores', 'blank')\n"
                "def get_spans(tokens, segments, blank): return tokens\n"
                "def postprocess_results(text, spans, stride, scores):\n"
                " result = []\n"
                " for word in text:\n"
                "  if word != '<star>':\n"
                "   i = len(result)\n"
                "   result.append(dict(text=word, start=i * 0.2, end=(i + 1) * 0.2, score=-0.1))\n"
                " return result\n",
                encoding="utf-8",
            )
            result = self.run_alignment(
                root,
                json.dumps([
                    {"index": 7, "text": "hello"},
                    {"index": 8, "text": "world"},
                ]),
                mock_dependencies=root,
            )
            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual([line["index"] for line in output["lines"]], [7, 8])
            self.assertEqual(
                [(line["start"], line["end"]) for line in output["lines"]],
                [(0.0, 0.2), (0.2, 0.4)],
            )
            self.assertIn('"status": "analyzing"', result.stderr)
            self.assertEqual(output["confidence_unit"], "batch_relative_0_to_1_not_probability")

    def test_empty_normalized_word_is_rejected_before_native_ctc(self):
        import json
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "onnxruntime.py").write_text(
                "from types import SimpleNamespace\n"
                "class InferenceSession:\n"
                " def __init__(self, path): pass\n"
                " def get_inputs(self): return [SimpleNamespace(name='input')]\n"
                " def get_outputs(self): return [SimpleNamespace(name='output')]\n",
                encoding="utf-8",
            )
            (root / "numpy.py").write_text("", encoding="utf-8")
            package = root / "ctc_forced_aligner"
            package.mkdir()
            (package / "__init__.py").write_text(
                "class Tokenizer:\n"
                " def encode(self, text): return text.split()\n"
                " def decode(self, tokens): return ' '.join(tokens)\n"
                " def get_vocab(self): return {c: i for i, c in enumerate('abcdefghijklmnopqrstuvwxyz <>.')}\n"
                "class FakeAudio:\n"
                " def __len__(self): return 32000\n"
                "def load_audio(*args, **kwargs): return FakeAudio()\n"
                "def generate_emissions(session, audio, batch_size): return (list(range(32)), 0.02)\n"
                "def preprocess_text(text, **kwargs):\n"
                " words = text.split()\n"
                " normalized = ['' if word == '...' else ' '.join(word) for word in words]\n"
                " tokens = []\n"
                " starred_text = []\n"
                " for word, normalized_word in zip(words, normalized):\n"
                "  tokens.extend(['<star>', normalized_word])\n"
                "  starred_text.extend(['<star>', word])\n"
                " return tokens, starred_text\n"
                "def get_alignments(*args, **kwargs): raise AssertionError('native CTC must not run')\n"
                "def get_spans(*args, **kwargs): raise AssertionError('native CTC must not run')\n"
                "def postprocess_results(*args, **kwargs): raise AssertionError('native CTC must not run')\n",
                encoding="utf-8",
            )
            result = self.run_alignment(
                root,
                json.dumps([{"index": 7, "text": "hello ... world"}]),
                mock_dependencies=root,
            )

            self.assertNotEqual(result.returncode, 0)
            events = [json.loads(line) for line in result.stderr.splitlines()]
            self.assertTrue(any(
                event.get("code") == "general"
                for event in events
            ))
            self.assertNotIn("AssertionError: native CTC must not run", result.stderr)
            self.assertEqual(result.stdout, "")

    def test_reserved_star_expansion_is_rejected_before_ctc_can_shift_line_ownership(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "onnxruntime.py").write_text(
                "from types import SimpleNamespace\n"
                "class InferenceSession:\n"
                " def __init__(self, path): pass\n"
                " def get_inputs(self): return [SimpleNamespace(name='input')]\n"
                " def get_outputs(self): return [SimpleNamespace(name='output')]\n",
                encoding="utf-8",
            )
            (root / "numpy.py").write_text("", encoding="utf-8")
            package = root / "ctc_forced_aligner"
            package.mkdir()
            (package / "__init__.py").write_text(
                "class Tokenizer:\n"
                " def encode(self, text): return text.split()\n"
                " def decode(self, tokens): return ' '.join(tokens)\n"
                " def get_vocab(self): return {c: i for i, c in enumerate('abcdefghijklmnopqrstuvwxyz <>.')}\n"
                "class FakeAudio:\n"
                " def __len__(self): return 32000\n"
                "def load_audio(*args, **kwargs): return FakeAudio()\n"
                "def generate_emissions(session, audio, batch_size): return (list(range(16)), 0.02)\n"
                "def preprocess_text(text, **kwargs):\n"
                " tokens = ['<star>', '<star>', '<star>', 'h e l l o']\n"
                " return tokens, ' '.join(tokens)\n"
                "def get_alignments(*args, **kwargs): raise AssertionError('CTC must not run')\n"
                "def get_spans(*args, **kwargs): raise AssertionError('CTC must not run')\n"
                "def postprocess_results(*args, **kwargs): raise AssertionError('CTC must not run')\n",
                encoding="utf-8",
            )
            result = self.run_alignment(
                root,
                json.dumps([
                    {"index": 7, "text": "<star>"},
                    {"index": 8, "text": "hello"},
                ]),
                mock_dependencies=root,
            )

            self.assertNotEqual(result.returncode, 0)
            events = [json.loads(line) for line in result.stderr.splitlines()]
            self.assertTrue(any(
                event.get("code") == "general"
                for event in events
            ))
            self.assertEqual(result.stdout, "")

    def test_cjk_romanization_expansion_is_rejected_before_native_ctc(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "onnxruntime.py").write_text(
                "from types import SimpleNamespace\n"
                "class InferenceSession:\n"
                " def __init__(self, path): pass\n"
                " def get_inputs(self): return [SimpleNamespace(name='input')]\n"
                " def get_outputs(self): return [SimpleNamespace(name='output')]\n",
                encoding="utf-8",
            )
            (root / "numpy.py").write_text("", encoding="utf-8")
            package = root / "ctc_forced_aligner"
            package.mkdir()
            (package / "__init__.py").write_text(
                "class Tokenizer:\n"
                " def encode(self, text): return text.split()\n"
                " def decode(self, tokens): return ' '.join(tokens)\n"
                " def get_vocab(self): return {c: i for i, c in enumerate('abcdefghijklmnopqrstuvwxyz <>')}\n"
                "class FakeAudio:\n"
                " def __len__(self): return 32000\n"
                "def load_audio(*args, **kwargs): return FakeAudio()\n"
                "def generate_emissions(session, audio, batch_size): return (list(range(16)), 0.02)\n"
                "def preprocess_text(text, **kwargs):\n"
                " if text == '日': return ['n i'], ['ni']\n"
                " return ['n i', 'r i'], ['ni', 'ri']\n"
                "def get_alignments(emissions, tokens, tokenizer): return ('segments', 'scores', 'blank')\n"
                "def get_spans(tokens, segments, blank): return tokens\n"
                "def postprocess_results(text, spans, stride, scores):\n"
                " return [dict(text=word, start=i * 0.2, end=(i + 1) * 0.2, score=-0.1) for i, word in enumerate(spans)]\n",
                encoding="utf-8",
            )
            result = self.run_alignment(
                root,
                json.dumps([{"index": 7, "text": "月"}]),
                mock_dependencies=root,
                language="jpn",
            )

            self.assertNotEqual(result.returncode, 0)
            events = [json.loads(line) for line in result.stderr.splitlines()]
            self.assertTrue(any(
                event.get("code") == "general"
                for event in events
            ))
            self.assertEqual(result.stdout, "")

            valid = self.run_alignment(
                root,
                json.dumps([{"index": 7, "text": "日"}]),
                mock_dependencies=root,
                language="jpn",
            )
            self.assertEqual(valid.returncode, 0, valid.stderr)
            self.assertEqual(json.loads(valid.stdout)["lines"][0]["index"], 7)

    def test_unknown_alignment_character_is_rejected_before_native_ctc(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            (root / "onnxruntime.py").write_text(
                "from types import SimpleNamespace\n"
                "class InferenceSession:\n"
                " def __init__(self, path): pass\n"
                " def get_inputs(self): return [SimpleNamespace(name='input')]\n"
                " def get_outputs(self): return [SimpleNamespace(name='output')]\n",
                encoding="utf-8",
            )
            (root / "numpy.py").write_text("", encoding="utf-8")
            package = root / "ctc_forced_aligner"
            package.mkdir()
            (package / "__init__.py").write_text(
                "class Tokenizer:\n"
                " def encode(self, text): return list(text)\n"
                " def decode(self, tokens): return ''.join(tokens)\n"
                " def get_vocab(self): return {c: i for i, c in enumerate('abcdefghijklmnopqrstuvwxyz <>')}\n"
                "class FakeAudio:\n"
                " def __len__(self): return 32000\n"
                "def load_audio(*args, **kwargs): return FakeAudio()\n"
                "def generate_emissions(session, audio, batch_size): return (list(range(16)), 0.02)\n"
                "def preprocess_text(text, **kwargs): return ['h i 🙂'], ['hi🙂']\n"
                "def get_alignments(*args, **kwargs): raise AssertionError('native CTC must not run')\n"
                "def get_spans(*args, **kwargs): raise AssertionError('native CTC must not run')\n"
                "def postprocess_results(*args, **kwargs): raise AssertionError('native CTC must not run')\n",
                encoding="utf-8",
            )
            result = self.run_alignment(
                root,
                json.dumps([{"index": 7, "text": "hi🙂"}]),
                mock_dependencies=root,
            )

            self.assertNotEqual(result.returncode, 0)
            events = [json.loads(line) for line in result.stderr.splitlines()]
            self.assertTrue(any(
                event.get("code") == "unsupported_lyrics" for event in events
            ))
            self.assertEqual(result.stdout, "")


class PlatformSupportTests(unittest.TestCase):
    def test_ctc_patcher_scratch_is_scoped_to_its_owned_stage(self):
        installer = (ROOT / "src-tauri/src/install_ctc.py").read_text(encoding="utf-8")
        native = (ROOT / "src-tauri/src/python_env.rs").read_text(encoding="utf-8")
        arm_builder = (ROOT / "scripts/build_windows_arm64_ai.py").read_text(encoding="utf-8")

        self.assertIn(
            'tempfile.mkdtemp(prefix="ctc_patch_", dir=sys.argv[2])', installer
        )
        self.assertIn('"--isolated"', installer)
        self.assertIn(".arg(stage.path())", native)
        self.assertIn('"--isolated"', native)
        self.assertIn("run(sys.executable,str(patch),str(archive),str(work))", arm_builder)

    def test_build_script_rejects_intel_mac_but_accepts_release_targets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "check.rs"
            tauri_stub = """mod tauri_build {
    pub struct Attributes;
    impl Attributes {
        pub fn new() -> Self { Self }
        pub fn capabilities_path_pattern(self, _: &str) -> Self { self }
        pub fn app_manifest(self, _: AppManifest) -> Self { self }
    }
    pub struct AppManifest;
    impl AppManifest {
        pub fn new() -> Self { Self }
        pub fn commands(self, _: &[&str]) -> Self { self }
    }
    pub fn try_build(_: Attributes) -> Result<(), &'static str> { Ok(()) }
}
"""
            source.write_text(tauri_stub + 'include!(' + repr(str(ROOT / "src-tauri/build.rs")).replace("'", '"') + ');', encoding="utf-8")
            binary = root / ("check.exe" if os.name == "nt" else "check")
            subprocess.run(["rustc", "--edition=2021", str(source), "-o", str(binary)], check=True, capture_output=True)
            for target_os, arch, supported in [("macos", "x86_64", False), ("macos", "aarch64", True), ("windows", "x86_64", True), ("windows", "aarch64", True)]:
                result = subprocess.run([str(binary)], env={**os.environ, "CARGO_CFG_TARGET_OS": target_os, "CARGO_CFG_TARGET_ARCH": arch}, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, supported, result.stderr)

    def test_embedded_runtime_has_no_intel_macos_distribution(self):
        import json
        manifest = json.loads((ROOT / "src-tauri/ai-manifest.json").read_text(encoding="utf-8"))
        self.assertNotIn("x86_64-apple-darwin", manifest["python"])
        self.assertIn("aarch64-apple-darwin", manifest["python"])
        self.assertIn("x86_64-pc-windows-msvc", manifest["python"])


class DemucsIntegrityTests(unittest.TestCase):
    def load(self, path, expected, loader):
        source = ROOT / "src-tauri/src/separate.py"
        module_spec = importlib.util.spec_from_file_location("lyrical_separate", source)
        module = importlib.util.module_from_spec(module_spec)
        # Stub only imports required by the old implementation, never execute pickle.
        import types
        from unittest.mock import patch
        with patch.dict(sys.modules, {"numpy": types.ModuleType("numpy"), "torch": types.ModuleType("torch")}):
            exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"), module.__dict__)
        return module.load_verified_checkpoint(path, expected, loader)

    def test_vocal_intermediate_explicitly_preserves_float_samples(self):
        source = ROOT / "src-tauri/src/separate.py"
        module_spec = importlib.util.spec_from_file_location("lyrical_separate_audio", source)
        module = importlib.util.module_from_spec(module_spec)
        with patch.dict(sys.modules, {"numpy": types.ModuleType("numpy"), "torch": types.ModuleType("torch")}):
            exec(compile(source.read_text(encoding="utf-8"), str(source), "exec"), module.__dict__)
        calls = []
        soundfile = types.SimpleNamespace(write=lambda *args, **kwargs: calls.append((args, kwargs)))
        samples = [[-1.2, 0.5, 1.2]]

        module.write_vocal_audio(soundfile, "vocals.wav", samples, 44_100)

        self.assertEqual(calls, [(("vocals.wav", samples, 44_100), {"format": "WAV", "subtype": "FLOAT"})])

    def test_changed_checkpoint_never_reaches_deserializer(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.th"
            path.write_bytes(b"changed")
            calls = []
            with self.assertRaisesRegex(ValueError, "checksum"):
                self.load(path, "0" * 64, lambda *a, **kw: calls.append(a))
            self.assertEqual(calls, [])

    def test_validated_copy_survives_source_replacement(self):
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.th"
            path.write_bytes(b"trusted")
            def loader(handle, **options):
                path.write_bytes(b"changed")
                self.assertEqual(handle.read(), b"trusted")
                self.assertEqual(options, {"map_location": "cpu", "weights_only": False})
                return "loaded"
            self.assertEqual(self.load(path, hashlib.sha256(b"trusted").hexdigest(), loader), "loaded")

    def test_missing_checkpoint_never_reaches_deserializer(self):
        with tempfile.TemporaryDirectory() as folder:
            with self.assertRaises(FileNotFoundError):
                self.load(Path(folder) / "missing", "0" * 64, lambda *a, **kw: self.fail("loader called"))

    def test_same_size_modification_is_rejected(self):
        import hashlib
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.th"
            path.write_bytes(b"evil")
            with self.assertRaisesRegex(ValueError, "checksum"):
                self.load(path, hashlib.sha256(b"good").hexdigest(), lambda *a, **kw: self.fail("loader called"))


class SourceEncodingTests(unittest.TestCase):
    def test_checkpoint_source_loads_with_a_cp1252_default_locale(self):
        import io
        import hashlib
        from unittest.mock import patch
        original = io.text_encoding
        def cp1252_default(encoding, stacklevel=2):
            return "cp1252" if encoding is None else original(encoding, stacklevel)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "model.th"
            path.write_bytes(b"trusted")
            with patch("io.text_encoding", side_effect=cp1252_default):
                result = DemucsIntegrityTests().load(path, hashlib.sha256(b"trusted").hexdigest(), lambda handle, **_: handle.read())
            self.assertEqual(result, b"trusted")


class PackageProbeTests(unittest.TestCase):
    def environment(self, root):
        # Only the external ML boundary is substituted. Python's import and
        # metadata machinery and the shipped readiness probe run unchanged.
        versions = {"ctc-forced-aligner": "1.0.2", "demucs": "4.0.1", "numpy": "2.5.4", "onnxruntime": "1.31.0", "librosa": "0.10.2.post1", "Unidecode": "1.3.8"}
        versions.update(soxr="1.1.0", torch="2.14.1", torchaudio="2.11.0", setuptools="84.2.1", wheel="0.48.0", pip="26.2.2")
        native_arm = sys.platform == "win32" and sysconfig.get_platform() == "win-arm64"
        if native_arm:
            versions.update(numpy="2.5.4", onnxruntime="1.31.0", torch="2.14.1+cpu", soxr="1.1.0")
        for name, version in versions.items():
            dist = root / (name.replace("-", "_") + "-" + version + ".dist-info")
            dist.mkdir()
            (dist / "METADATA").write_text("Metadata-Version: 2.1\nName: " + name + "\nVersion: " + version + "\n", encoding="utf-8")
        for name in ["onnxruntime", "unidecode", "demucs", "torch", "torchaudio", "librosa"]:
            (root / (name + ".py")).write_text("", encoding="utf-8")
        (root / "torch.py").write_text(
            "from types import SimpleNamespace\nversion = SimpleNamespace(cuda=None)\n__version__ = " + repr(versions["torch"]) + "\n",
            encoding="utf-8",
        )
        package = root / "ctc_forced_aligner"
        package.mkdir()
        exports = ["load_audio", "generate_emissions", "preprocess_text", "get_alignments", "get_spans", "postprocess_results", "Tokenizer"]
        (package / "__init__.py").write_text("\n".join(name + " = None" for name in exports), encoding="utf-8")
        return package

    def run_probe(self, root, optimize=False):
        command = [sys.executable]
        if optimize:
            command.append("-O")
        command.extend(["-S", str(ROOT / "src-tauri/src/probe_ai.py")])
        return subprocess.run(
            command,
            env={
                **os.environ,
                "PYTHONPATH": str(root),
                "LYRICAL_INSTALLED_PACKAGES": str(root / "installed-packages.txt"),
            },
            capture_output=True,
            text=True,
            timeout=10,
        )

    def test_missing_native_extension_is_not_ready_despite_valid_metadata(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            self.environment(root)
            result = self.run_probe(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("ctc_aligner", result.stderr)

    def test_native_loader_failure_is_not_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text('raise OSError("native library cannot load")', encoding="utf-8")
            result = self.run_probe(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("native library cannot load", result.stderr)

    def test_unimportable_required_audio_dependency_is_not_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            (root / "librosa.py").write_text('raise ImportError("audio dependency unavailable")', encoding="utf-8")
            result = self.run_probe(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("audio dependency unavailable", result.stderr)

    def test_optimized_python_cannot_skip_security_version_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            (next(root.glob("torch-*.dist-info")) / "METADATA").write_text("Metadata-Version: 2.1\nName: torch\nVersion: 2.5.1\n", encoding="utf-8")
            result = self.run_probe(root, optimize=True)
            self.assertNotEqual(result.returncode, 0)

    def test_valid_native_loader_and_versions_are_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            result = self.run_probe(root)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_installed_snapshot_rejects_transitive_package_version_drift(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            transitive = root / "model_transitive-1.0.dist-info"
            transitive.mkdir()
            (transitive / "METADATA").write_text(
                "Metadata-Version: 2.1\nName: model_transitive\nVersion: 1.0\n",
                encoding="utf-8",
            )
            snapshot = []
            for metadata_file in root.glob("*.dist-info/METADATA"):
                values = dict(
                    line.split(": ", 1)
                    for line in metadata_file.read_text(encoding="utf-8").splitlines()
                    if line.startswith("Name: ") or line.startswith("Version: ")
                )
                snapshot.append(f"{values['Name']}=={values['Version']}")
            (root / "installed-packages.txt").write_text("\n".join(snapshot) + "\n", encoding="utf-8")
            (transitive / "METADATA").write_text(
                "Metadata-Version: 2.1\nName: model_transitive\nVersion: 2.0\n",
                encoding="utf-8",
            )

            result = self.run_probe(root)
            self.assertNotEqual(result.returncode, 0)

    def test_matching_installed_snapshot_accepts_normalized_names_and_ctc_archive_reference(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            transitive = root / "model_transitive-1.0.dist-info"
            transitive.mkdir()
            (transitive / "METADATA").write_text(
                "Metadata-Version: 2.1\nName: model_transitive\nVersion: 1.0\n",
                encoding="utf-8",
            )
            snapshot = []
            for metadata_file in root.glob("*.dist-info/METADATA"):
                values = dict(
                    line.split(": ", 1)
                    for line in metadata_file.read_text(encoding="utf-8").splitlines()
                    if line.startswith("Name: ") or line.startswith("Version: ")
                )
                if values["Name"] == "ctc-forced-aligner":
                    snapshot.append("CTC_FORCED.ALIGNER @ file:///staging/ctc_forced_aligner.tar.gz")
                else:
                    snapshot.append(f"{values['Name']}=={values['Version']}")
            (root / "installed-packages.txt").write_text("\n".join(snapshot) + "\n", encoding="utf-8")

            result = self.run_probe(root)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_installed_snapshot_rejects_unrecorded_distribution(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            snapshot = []
            for metadata_file in root.glob("*.dist-info/METADATA"):
                values = dict(
                    line.split(": ", 1)
                    for line in metadata_file.read_text(encoding="utf-8").splitlines()
                    if line.startswith("Name: ") or line.startswith("Version: ")
                )
                snapshot.append(f"{values['Name']}=={values['Version']}")
            (root / "installed-packages.txt").write_text("\n".join(snapshot) + "\n", encoding="utf-8")
            extra = root / "unrecorded-1.0.dist-info"
            extra.mkdir()
            (extra / "METADATA").write_text(
                "Metadata-Version: 2.1\nName: unrecorded\nVersion: 1.0\n",
                encoding="utf-8",
            )

            result = self.run_probe(root)
            self.assertNotEqual(result.returncode, 0)

    def test_installed_snapshot_rejects_oversized_input(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            (root / "installed-packages.txt").write_bytes(b"#" * (256 * 1024 + 1))

            result = self.run_probe(root)
            self.assertNotEqual(result.returncode, 0)


if __name__ == "__main__":
    unittest.main()
