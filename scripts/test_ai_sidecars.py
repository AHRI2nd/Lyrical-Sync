"""Standard-library regressions for sidecar boundaries; no ML runtime required."""
import importlib.util
import tempfile
import subprocess
import sys
import os
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


class PackageProbeTests(unittest.TestCase):
    def environment(self, root):
        # Only the external ML boundary is substituted. Python's import and
        # metadata machinery and the shipped readiness probe run unchanged.
        versions = {"ctc-forced-aligner": "1.0.2", "demucs": "4.0.1", "numpy": "1.26.4", "onnxruntime": "1.20.1", "librosa": "0.10.2.post1", "Unidecode": "1.3.8"}
        import platform
        version = "2.2.2" if sys.platform == "darwin" and platform.machine() == "x86_64" else "2.5.1"
        versions.update(torch=version, torchaudio=version)
        for name, version in versions.items():
            dist = root / (name.replace("-", "_") + "-" + version + ".dist-info")
            dist.mkdir()
            (dist / "METADATA").write_text("Metadata-Version: 2.1\nName: " + name + "\nVersion: " + version + "\n")
        for name in ["onnxruntime", "unidecode", "demucs", "torch", "torchaudio"]:
            (root / (name + ".py")).write_text("")
        package = root / "ctc_forced_aligner"
        package.mkdir()
        exports = ["load_audio", "generate_emissions", "preprocess_text", "get_alignments", "get_spans", "postprocess_results", "Tokenizer"]
        (package / "__init__.py").write_text("\n".join(name + " = None" for name in exports))
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
            (package / "ctc_aligner.py").write_text('raise OSError("native library cannot load")')
            result = self.run_probe(root)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("native library cannot load", result.stderr)

    def test_valid_native_loader_and_versions_are_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("")
            result = self.run_probe(root)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
