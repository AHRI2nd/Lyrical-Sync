"""Tests for safe Windows ARM64 wheel build directory handling."""
from pathlib import Path
import importlib.util
import os
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().with_name('build_windows_arm64_ai.py')
SPEC = importlib.util.spec_from_file_location('build_windows_arm64_ai', SCRIPT)
BUILDER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(BUILDER)


def temporary_root():
    candidates = [os.environ.get('RUNNER_TEMP'), '/private/tmp', tempfile.gettempdir(), str(Path.cwd())]
    for candidate in candidates:
        if not candidate:
            continue
        path = Path(candidate)
        if path.is_dir() and ' ' not in str(path) and len(str(path)) < 40:
            return path
    if os.environ.get('GITHUB_ACTIONS') == 'true':
        raise RuntimeError('GitHub Actions must provide a short, space-free temporary directory')
    raise unittest.SkipTest('No short, space-free temporary directory is available')


class BuildDirectoryTests(unittest.TestCase):
    def test_accepts_new_or_empty_separate_directories(self):
        with tempfile.TemporaryDirectory(dir=temporary_root()) as root:
            base = Path(root)
            work, output = BUILDER.prepare_build_dirs(base/'work', base/'output')
            self.assertTrue(work.is_dir())
            self.assertTrue(output.is_dir())
            BUILDER.prepare_build_dirs(work, output)

    def test_rejects_preexisting_wheel_output_without_deleting_it(self):
        with tempfile.TemporaryDirectory(dir=temporary_root()) as root:
            base = Path(root)
            work = base/'work'; output = base/'output'
            output.mkdir(); stale = output/'ctc_forced_aligner-1.0.2-cp313-cp313-win_arm64.whl'
            stale.write_bytes(b'stale wheel')
            with self.assertRaisesRegex(ValueError, 'must be empty'):
                BUILDER.prepare_build_dirs(work, output)
            self.assertEqual(stale.read_bytes(), b'stale wheel')

    def test_rejects_stale_extracted_source_tree_without_deleting_it(self):
        with tempfile.TemporaryDirectory(dir=temporary_root()) as root:
            base = Path(root)
            work = base/'work'; output = base/'output'
            stale = work/'torchaudio'/'old-source.py'
            stale.parent.mkdir(parents=True); stale.write_text('stale source')
            with self.assertRaisesRegex(ValueError, 'must be empty'):
                BUILDER.prepare_build_dirs(work, output)
            self.assertEqual(stale.read_text(), 'stale source')

    def test_rejects_overlapping_work_and_output_directories(self):
        with tempfile.TemporaryDirectory(dir=temporary_root()) as root:
            base = Path(root)
            with self.assertRaisesRegex(ValueError, 'non-overlapping'):
                BUILDER.prepare_build_dirs(base/'build', base/'build'/'output')


if __name__ == '__main__':
    unittest.main()
