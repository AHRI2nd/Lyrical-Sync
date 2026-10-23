import importlib.metadata as metadata
import platform
import sys
import onnxruntime, unidecode, demucs
# Public CTC exports load the native wrapper lazily during alignment.
import ctc_forced_aligner.ctc_aligner
from ctc_forced_aligner import load_audio, generate_emissions, preprocess_text, get_alignments, get_spans, postprocess_results, Tokenizer
import torch, torchaudio

expected = {
    'ctc-forced-aligner': '1.0.2', 'demucs': '4.0.1', 'numpy': '1.26.4',
    'onnxruntime': '1.20.1', 'librosa': '0.10.2.post1', 'Unidecode': '1.3.8',
    'torch': '2.14.1', 'torchaudio': '2.11.0', 'setuptools': '84.2.1',
    'wheel': '0.48.0', 'pip': '26.2.2',
}
if sys.platform == 'win32' and platform.machine().upper() == 'ARM64':
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
