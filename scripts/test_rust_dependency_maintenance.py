"""Guard supported Rust target graphs against the unmaintained paste registry crate."""
import subprocess
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / 'src-tauri/Cargo.toml'
TARGETS = (
    'aarch64-apple-darwin',
    'x86_64-pc-windows-msvc',
    'aarch64-pc-windows-msvc',
)


class RustDependencyMaintenanceTests(unittest.TestCase):
    def test_supported_targets_resolve_the_local_maintained_paste_implementation(self):
        for target in TARGETS:
            with self.subTest(target=target):
                result = subprocess.run(
                    [
                        'cargo', 'tree', '--manifest-path', str(MANIFEST),
                        '--locked', '--offline', '--target', target,
                        '--edges', 'all', '-i', 'paste',
                    ],
                    text=True,
                    capture_output=True,
                    check=True,
                )
                self.assertIn('src-tauri/vendor/paste', result.stdout)


if __name__ == '__main__':
    unittest.main()
