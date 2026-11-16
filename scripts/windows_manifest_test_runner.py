"""Attach Tauri's required Windows common-controls manifest to test binaries."""
import json
import os
import platform
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = Path(__file__).with_name('windows-test-manifest.xml')


def find_mt_executable():
    """Find the Windows SDK manifest tool on standard hosted runner layouts."""
    on_path = shutil.which('mt.exe')
    if on_path:
        return on_path

    machine = platform.machine().lower()
    architectures = ['arm64', 'x64', 'x86'] if 'arm' in machine else ['x64', 'arm64', 'x86']
    roots = []
    sdk_dir = os.environ.get('WindowsSdkDir')
    sdk_bin_path = os.environ.get('WindowsSdkBinPath')
    if sdk_dir:
        roots.append(Path(sdk_dir) / 'bin')
    if sdk_bin_path:
        roots.append(Path(sdk_bin_path))
    program_files_x86 = os.environ.get('ProgramFiles(x86)')
    if program_files_x86:
        roots.append(Path(program_files_x86) / 'Windows Kits' / '10' / 'bin')

    candidates = []
    for root in roots:
        if not root.is_dir():
            continue
        versioned = sorted((path for path in root.iterdir() if path.is_dir()), reverse=True)
        versioned.insert(0, root)
        for version_dir in versioned:
            for architecture in architectures:
                candidate = version_dir / architecture / 'mt.exe'
                if candidate.is_file():
                    candidates.append(candidate)
    if candidates:
        return str(candidates[0])
    raise FileNotFoundError('Windows SDK mt.exe was not found on PATH or in the Windows SDK bin directory')


def run_test_binary(arguments, *, mt_executable=None, run=subprocess.run):
    """Embed Common Controls v6, then run one Cargo test executable."""
    if not arguments:
        raise ValueError('Cargo test runner did not receive a test executable')

    executable = arguments[0]
    mt = mt_executable or find_mt_executable()
    embedded = run(
        [
            mt,
            '-nologo',
            '-manifest',
            str(MANIFEST),
            f'-outputresource:{executable};#1',
        ],
        check=False,
    )
    if embedded.returncode != 0:
        return embedded.returncode

    return run([executable, *arguments[1:]], check=False).returncode


def cargo_test_command():
    runner = [sys.executable, str(Path(__file__).resolve()), '--run-test']
    runner_config = "target.'cfg(windows)'.runner=" + json.dumps(runner)
    return [
        'cargo',
        'test',
        '--config',
        runner_config,
        '--manifest-path',
        str(ROOT / 'src-tauri' / 'Cargo.toml'),
        '--locked',
    ]


def main(arguments):
    if arguments[:1] == ['--run-test']:
        try:
            return run_test_binary(arguments[1:])
        except (FileNotFoundError, ValueError) as error:
            print(f'Windows test manifest runner: {error}', file=sys.stderr)
            return 127
    if arguments == ['--cargo-test']:
        return subprocess.run(cargo_test_command(), cwd=ROOT, check=False).returncode
    print('Usage: windows_manifest_test_runner.py --cargo-test | --run-test <exe> [args...]', file=sys.stderr)
    return 2


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
