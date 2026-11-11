import importlib.metadata as metadata
import os
import re
import sysconfig
import sys
from pathlib import Path
import librosa, onnxruntime, unidecode, demucs
# Public CTC exports load the native wrapper lazily during alignment.
import ctc_forced_aligner.ctc_aligner
from ctc_forced_aligner import load_audio, generate_emissions, preprocess_text, get_alignments, get_spans, postprocess_results, Tokenizer
import torch, torchaudio

expected = {
    'ctc-forced-aligner': '1.0.2', 'demucs': '4.0.1', 'numpy': '2.5.4',
    'onnxruntime': '1.31.0', 'librosa': '0.10.2.post1', 'Unidecode': '1.3.8',
    'torch': '2.14.1', 'torchaudio': '2.11.0', 'setuptools': '84.2.1',
    'wheel': '0.48.0', 'pip': '26.2.2', 'soxr': '1.1.0',
}
MAX_PACKAGE_SNAPSHOT_BYTES = 256 * 1024
if sys.platform == 'win32' and sysconfig.get_platform() == 'win-arm64':
    expected.update({'numpy': '2.5.4', 'onnxruntime': '1.31.0', 'soxr': '1.1.0'})
    if torch.version.cuda is not None or torch.__version__ != '2.14.1+cpu':
        raise RuntimeError('Windows ARM64 requires the verified CPU PyTorch build')
for package, version in expected.items():
    # Assertions are disabled by PYTHONOPTIMIZE and must never enforce security policy.
    installed = metadata.version(package)
    if package in ('torch', 'torchaudio'):
        installed = installed.split('+')[0]
    if installed != version:
        raise RuntimeError(f'Unsupported AI package version: {package}')


def normalize_distribution_name(name):
    if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*', name):
        raise RuntimeError('Invalid installed AI package name')
    return re.sub(r'[-_.]+', '-', name).lower()


def verify_installed_package_snapshot():
    snapshot_location = os.environ.get('LYRICAL_INSTALLED_PACKAGES')
    if not snapshot_location:
        raise RuntimeError('Installed AI package snapshot path is unavailable')
    snapshot_path = Path(snapshot_location)
    try:
        with snapshot_path.open('rb') as snapshot_file:
            snapshot_bytes = snapshot_file.read(MAX_PACKAGE_SNAPSHOT_BYTES + 1)
    except FileNotFoundError:
        # Older runtimes predate the snapshot; keep their existing import/version checks.
        return
    if len(snapshot_bytes) > MAX_PACKAGE_SNAPSHOT_BYTES:
        raise RuntimeError('Installed AI package snapshot exceeds its size limit')
    snapshot_text = snapshot_bytes.decode('utf-8')

    expected_graph = {}
    required_versions = {normalize_distribution_name(name): version for name, version in expected.items()}
    for raw_line in snapshot_text.splitlines():
        line = raw_line.strip()
        if not line or line.startswith('#'):
            continue
        if ' @ ' in line:
            name, reference = line.split(' @ ', 1)
            normalized_name = normalize_distribution_name(name)
            # pip freeze records a local archive URL for the separately installed CTC package.
            # Its exact version is already enforced by the required package version check above.
            version = required_versions.get(normalized_name)
            if not reference or version is None:
                raise RuntimeError('Unsupported direct reference in installed AI package snapshot')
        else:
            separator = '===' if '===' in line else '=='
            if separator not in line:
                raise RuntimeError('Invalid installed AI package snapshot')
            name, version = line.rsplit(separator, 1)
            if not version:
                raise RuntimeError('Invalid installed AI package snapshot')
            normalized_name = normalize_distribution_name(name)
        if normalized_name in expected_graph:
            raise RuntimeError('Duplicate package in installed AI package snapshot')
        expected_graph[normalized_name] = version

    if not expected_graph:
        raise RuntimeError('Empty installed AI package snapshot')

    installed_graph = {}
    for distribution in metadata.distributions():
        name = distribution.metadata.get('Name')
        if not name:
            raise RuntimeError('Installed AI package has no distribution name')
        normalized_name = normalize_distribution_name(name)
        if normalized_name in installed_graph:
            raise RuntimeError('Duplicate installed AI package distribution')
        installed_graph[normalized_name] = distribution.version

    if installed_graph != expected_graph:
        raise RuntimeError('Installed AI package graph differs from its recorded snapshot')


verify_installed_package_snapshot()
