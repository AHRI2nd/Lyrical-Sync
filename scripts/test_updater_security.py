"""Guard the updater's archive attack surface in resolved dependency features."""
import json
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]


class UpdaterSecurityTests(unittest.TestCase):
    def test_windows_updater_does_not_resolve_zip_extraction(self):
        result = subprocess.run(
            ['cargo', 'tree', '--manifest-path', str(ROOT / 'src-tauri/Cargo.toml'),
             '--locked', '--target', 'x86_64-pc-windows-msvc',
             '-e', 'features', '-p', 'tauri-plugin-updater'],
            text=True, capture_output=True, check=True,
        )
        self.assertNotRegex(result.stdout, r'\bzip v[0-9]', 'ZIP extraction must not be resolved')
        self.assertIn('rustls v', result.stdout)

    def test_macos_updater_keeps_tar_gzip_support(self):
        result = subprocess.run(
            ['cargo', 'tree', '--manifest-path', str(ROOT / 'src-tauri/Cargo.toml'),
             '--locked', '--target', 'aarch64-apple-darwin',
             '-e', 'features', '-p', 'tauri-plugin-updater'],
            text=True, capture_output=True, check=True,
        )
        self.assertIn('tar v', result.stdout)
        self.assertIn('flate2 v', result.stdout)

    def test_release_uses_current_raw_installer_artifacts(self):
        config = json.loads((ROOT / 'src-tauri/tauri.updater.conf.json').read_text(encoding="utf-8"))
        self.assertIs(config['bundle']['createUpdaterArtifacts'], True)


if __name__ == '__main__':
    unittest.main()
