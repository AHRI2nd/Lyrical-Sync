"""Standard-library regressions for sidecar boundaries; no ML runtime required."""
import importlib.util
import hashlib
import json
import tempfile
import subprocess
import sys
import os
import sysconfig
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("lyrical_align", ROOT / "src-tauri/src/align.py")
align = importlib.util.module_from_spec(spec)
spec.loader.exec_module(align)


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


class AlignmentExecutionTests(unittest.TestCase):
    """Run the shipped sidecar with deterministic small substitutes for ML packages."""

    def run_alignment(self, *, short_audio=False, bad_timestamps=False):
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
            (root / "numpy.py").write_text("", encoding="utf-8")
            (root / "ctc_forced_aligner.py").write_text('''
class Tokenizer:
    def encode(self, text): return [ord(c) for c in text]
    def decode(self, tokens): return "".join(chr(t) for t in tokens)
def load_audio(path, ret_type=None):
    return range(16 if "short" in path else 32000)
def generate_emissions(session, waveform, batch_size=1):
    return [1, 2, 3], 0.02
def preprocess_text(text, **kwargs):
    tokens = text.split()
    return tokens, tokens
def get_alignments(emissions, tokens, tokenizer):
    assert emissions == [1, 2, 3], "emissions must precede alignment"
    return tokens, [0.0] * len(tokens), 0
def get_spans(tokens, segments, blank_token): return segments
def postprocess_results(text, spans, stride, scores):
    return [{"text": token, "start": float('nan') if "bad" in token else i + 0.2,
             "end": i + 0.8, "score": -0.1}
            for i, token in enumerate(text)]
''', encoding="utf-8")
            lyric = "bad" if bad_timestamps else "hello world"
            return subprocess.run(
                [sys.executable, "-S", str(ROOT / "src-tauri/src/align.py"),
                 "--models-dir", str(root), "--model-sha256", hashlib.sha256(b"fixture-model").hexdigest(),
                 "--audio", "short.wav" if short_audio else "normal.wav",
                 "--lines-stdin", "--language", "eng", "--vad", "false"],
                input=json.dumps([{"index": 3, "text": lyric}]), text=True,
                capture_output=True, timeout=10, env={**os.environ, "PYTHONPATH": str(root)},
            )

    def test_normal_input_produces_ordered_alignment_with_emissions(self):
        result = self.run_alignment()
        self.assertEqual(result.returncode, 0, result.stderr)
        output = json.loads(result.stdout)
        self.assertEqual([line["index"] for line in output["lines"]], [3])
        self.assertEqual([output["lines"][0]["start"], output["lines"][0]["end"]], [0.2, 1.8])
        self.assertEqual(output["confidence_unit"], "normalized_0_to_1_and_percent")

    def test_short_audio_rejected_before_emission_alignment(self):
        result = self.run_alignment(short_audio=True)
        self.assertNotEqual(result.returncode, 0)
        events = [json.loads(line) for line in result.stderr.splitlines()]
        self.assertTrue(any("오디오가 너무 짧습니다" in event["message"] for event in events))

    def test_nonfinite_sidecar_results_rejected(self):
        result = self.run_alignment(bad_timestamps=True)
        self.assertNotEqual(result.returncode, 0)
        events = [json.loads(line) for line in result.stderr.splitlines()]
        self.assertTrue(any("유효하지 않은 타임스탬프" in event["message"] for event in events))


class EmbeddedAlignmentExecutionTests(unittest.TestCase):
    """Exercise the actual shipped Python script without a network/model download."""

    def run_alignment(self, models_dir, payload, *, mock_dependencies=None):
        import hashlib
        model = Path(models_dir) / "ctc-forced-aligner.onnx"
        model.write_bytes(b"trusted-model-fixture")
        command = [
            sys.executable, "-S", str(ROOT / "src-tauri/src/align.py"),
            "--models-dir", str(models_dir),
            "--model-sha256", hashlib.sha256(model.read_bytes()).hexdigest(),
            "--audio", str(Path(models_dir) / "short.wav"),
            "--lines-stdin", "--language", "eng",
        ]
        env = {**os.environ}
        if mock_dependencies is not None:
            env["PYTHONPATH"] = str(mock_dependencies)
        return subprocess.run(command, input=payload, capture_output=True, text=True,
                              env=env, timeout=10)

    def test_invalid_json_exits_before_optional_dependency_import(self):
        with tempfile.TemporaryDirectory() as folder:
            result = self.run_alignment(folder, "{invalid json")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("Invalid lines JSON", result.stderr)

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
                "class FakeAudio:\n"
                " def __len__(self): return 32000\n"
                "def load_audio(*args, **kwargs): return FakeAudio()\n"
                "def generate_emissions(session, audio, batch_size): return ('emissions', 0.02)\n"
                "def preprocess_text(text, **kwargs):\n"
                " return text.split(), text.split()\n"
                "def get_alignments(emissions, tokens, tokenizer):\n"
                " assert emissions == 'emissions'\n"
                " return ('segments', 'scores', 'blank')\n"
                "def get_spans(tokens, segments, blank): return tokens\n"
                "def postprocess_results(text, spans, stride, scores):\n"
                " return [dict(text=word, start=i * 0.2, end=(i + 1) * 0.2, score=-0.1)"
                " for i, word in enumerate(spans)]\n",
                encoding="utf-8",
            )
            result = self.run_alignment(root, json.dumps([{"index": 7, "text": "hello world"}]),
                                        mock_dependencies=root)
            self.assertEqual(result.returncode, 0, result.stderr)
            output = json.loads(result.stdout)
            self.assertEqual(len(output["lines"]), 1)
            self.assertEqual(output["lines"][0]["index"], 7)
            self.assertEqual((output["lines"][0]["start"], output["lines"][0]["end"]),
                             (0.0, 0.4))
            self.assertIn('"status": "analyzing"', result.stderr)
            self.assertEqual(output["confidence_unit"], "normalized_0_to_1_and_percent")


class PlatformSupportTests(unittest.TestCase):
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
        for name in ["onnxruntime", "unidecode", "demucs", "torch", "torchaudio"]:
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

    def run_probe(self, root):
        return subprocess.run([sys.executable, "-S", str(ROOT / "src-tauri/src/probe_ai.py")], env={**os.environ, "PYTHONPATH": str(root)}, capture_output=True, text=True, timeout=10)

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

    def test_optimized_python_cannot_skip_security_version_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            (next(root.glob("torch-*.dist-info")) / "METADATA").write_text("Metadata-Version: 2.1\nName: torch\nVersion: 2.5.1\n", encoding="utf-8")
            result = subprocess.run([sys.executable, "-O", "-S", str(ROOT / "src-tauri/src/probe_ai.py")], env={**os.environ, "PYTHONPATH": str(root)}, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)

    def test_valid_native_loader_and_versions_are_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("", encoding="utf-8")
            result = self.run_probe(root)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
