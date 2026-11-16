"""Regression tests for the Windows-only Tauri test manifest runner."""
import importlib.util
from pathlib import Path
import subprocess
import unittest

ROOT = Path(__file__).resolve().parents[1]
RUNNER_PATH = ROOT / 'scripts/windows_manifest_test_runner.py'
SPEC = importlib.util.spec_from_file_location('windows_manifest_test_runner', RUNNER_PATH)


def load_runner(test_case):
    test_case.assertTrue(RUNNER_PATH.is_file(), 'Windows test runner has not been implemented')
    runner = importlib.util.module_from_spec(SPEC)
    SPEC.loader.exec_module(runner)
    return runner


class WindowsManifestTestRunnerTests(unittest.TestCase):
    def test_manifest_enables_common_controls_v6(self):
        manifest_path = ROOT / 'scripts/windows-test-manifest.xml'
        self.assertTrue(manifest_path.is_file(), 'Windows test manifest has not been added')
        manifest = manifest_path.read_text(encoding='utf-8')

        self.assertIn('Microsoft.Windows.Common-Controls', manifest)
        self.assertIn('version="6.0.0.0"', manifest)

    def test_cargo_runner_is_scoped_to_windows_targets(self):
        runner = load_runner(self)
        command = runner.cargo_test_command()
        config = command[command.index('--config') + 1]

        self.assertIn("target.'cfg(windows)'.runner=", config)
        self.assertIn('--manifest-path', command)
        self.assertIn('--locked', command)
        self.assertIn('--run-test', config)

    def test_embeds_manifest_before_forwarding_test_binary_arguments(self):
        runner = load_runner(self)
        calls = []

        def run(command, **kwargs):
            calls.append((command, kwargs))
            return subprocess.CompletedProcess(command, 0)

        result = runner.run_test_binary(
            [r'C:\build\lyrical_sync_lib-test.exe', '--list', '--format', 'terse'],
            mt_executable=r'C:\Windows Kits\mt.exe',
            run=run,
        )

        self.assertEqual(result, 0)
        self.assertEqual(len(calls), 2)
        self.assertEqual(calls[0][0][0], r'C:\Windows Kits\mt.exe')
        self.assertIn('-manifest', calls[0][0])
        self.assertTrue(any(arg.endswith(r'lyrical_sync_lib-test.exe;#1') for arg in calls[0][0]))
        self.assertEqual(calls[1][0], [r'C:\build\lyrical_sync_lib-test.exe', '--list', '--format', 'terse'])

    def test_does_not_launch_test_binary_when_manifest_embedding_fails(self):
        runner = load_runner(self)
        calls = []

        def run(command, **kwargs):
            calls.append(command)
            return subprocess.CompletedProcess(command, 23 if len(calls) == 1 else 0)

        result = runner.run_test_binary(
            [r'C:\build\lyrical_sync_lib-test.exe'],
            mt_executable='mt.exe',
            run=run,
        )

        self.assertEqual(result, 23)
        self.assertEqual(len(calls), 1)


if __name__ == '__main__':
    unittest.main()
