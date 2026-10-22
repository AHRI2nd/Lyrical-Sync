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


class PlatformSupportTests(unittest.TestCase):
    def test_build_script_rejects_intel_mac_but_accepts_release_targets(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            source = root / "check.rs"
            source.write_text('mod tauri_build { pub fn build() {} }\ninclude!(' + repr(str(ROOT / "src-tauri/build.rs")).replace("'", '"') + ');')
            binary = root / ("check.exe" if os.name == "nt" else "check")
            subprocess.run(["rustc", "--edition=2021", str(source), "-o", str(binary)], check=True, capture_output=True)
            for target_os, arch, supported in [("macos", "x86_64", False), ("macos", "aarch64", True), ("windows", "x86_64", True)]:
                result = subprocess.run([str(binary)], env={**os.environ, "CARGO_CFG_TARGET_OS": target_os, "CARGO_CFG_TARGET_ARCH": arch}, capture_output=True, text=True)
                self.assertEqual(result.returncode == 0, supported, result.stderr)

    def test_embedded_runtime_has_no_intel_macos_distribution(self):
        import json
        manifest = json.loads((ROOT / "src-tauri/ai-manifest.json").read_text())
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
            exec(compile(source.read_text(), str(source), "exec"), module.__dict__)
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


class PackageProbeTests(unittest.TestCase):
    def environment(self, root):
        # Only the external ML boundary is substituted. Python's import and
        # metadata machinery and the shipped readiness probe run unchanged.
        versions = {"ctc-forced-aligner": "1.0.2", "demucs": "4.0.1", "numpy": "1.26.4", "onnxruntime": "1.20.1", "librosa": "0.10.2.post1", "Unidecode": "1.3.8"}
        import platform
        versions.update(torch="2.14.1", torchaudio="2.11.0", setuptools="84.2.1", wheel="0.48.0", pip="26.2.2")
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

    def test_optimized_python_cannot_skip_security_version_checks(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("")
            (root / "torch-2.14.1.dist-info/METADATA").write_text("Metadata-Version: 2.1\nName: torch\nVersion: 2.5.1\n")
            result = subprocess.run([sys.executable, "-O", "-S", str(ROOT / "src-tauri/src/probe_ai.py")], env={**os.environ, "PYTHONPATH": str(root)}, capture_output=True, text=True, timeout=10)
            self.assertNotEqual(result.returncode, 0)

    def test_valid_native_loader_and_versions_are_ready(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            package = self.environment(root)
            (package / "ctc_aligner.py").write_text("")
            result = self.run_probe(root)
            self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == "__main__":
    unittest.main()
