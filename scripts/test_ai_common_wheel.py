"""Validate the shared pure-Python Demucs wheel shipped with every AI profile."""
import hashlib
import json
from pathlib import Path
import unittest
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / "src-tauri/resources/ai-common"
WHEEL_NAME = "demucs-4.0.1-py3-none-any.whl"


class CommonAIWheelTests(unittest.TestCase):
    def test_pinned_demucs_release_is_shipped_as_a_verified_universal_wheel(self):
        manifest = json.loads((ASSETS / "provenance.json").read_text(encoding="utf-8"))
        wheel_path = ASSETS / WHEEL_NAME
        wheel_hash = hashlib.sha256(wheel_path.read_bytes()).hexdigest()
        self.assertEqual(manifest["wheel"]["file"], WHEEL_NAME)
        self.assertEqual(manifest["wheel"]["sha256"], wheel_hash)
        self.assertEqual(len(manifest["source"]["sha256"]), 64)
        self.assertTrue(manifest["source"]["url"].startswith("https://files.pythonhosted.org/"))
        self.assertEqual(manifest["build"]["sourceDateEpoch"], 315532800)
        self.assertIn("setuptools==84.2.1", manifest["build"]["installBuildTools"])
        with ZipFile(wheel_path) as archive:
            metadata_path = next(name for name in archive.namelist() if name.endswith(".dist-info/METADATA"))
            wheel_metadata_path = next(name for name in archive.namelist() if name.endswith(".dist-info/WHEEL"))
            metadata = archive.read(metadata_path).decode("utf-8")
            tags = [line.removeprefix("Tag: ") for line in archive.read(wheel_metadata_path).decode("utf-8").splitlines() if line.startswith("Tag: ")]
        self.assertIn("Name: demucs\n", metadata)
        self.assertIn("Version: 4.0.1\n", metadata)
        self.assertEqual(tags, ["py3-none-any"])

    def test_runtime_stages_the_verified_wheel_for_every_platform_install(self):
        source = (ROOT / "src-tauri/src/python_env.rs").read_text(encoding="utf-8")
        installer = source[source.index("async fn install_python_packages_unlocked"):]
        self.assertIn("stage_common_ai_wheels", installer)
        self.assertIn('packages.args(["--find-links"]).arg(&wheels);', installer)
        self.assertIn('"--require-hashes"', installer)


if __name__ == "__main__":
    unittest.main()
