import importlib.metadata as m, sys, platform
import onnxruntime, unidecode, demucs
# Public CTC exports load the native wrapper lazily during alignment.
import ctc_forced_aligner.ctc_aligner
from ctc_forced_aligner import load_audio, generate_emissions, preprocess_text, get_alignments, get_spans, postprocess_results, Tokenizer
expected = {'ctc-forced-aligner': '1.0.2', 'demucs': '4.0.1', 'numpy': '1.26.4', 'onnxruntime': '1.20.1', 'librosa': '0.10.2.post1', 'Unidecode': '1.3.8'}
for package, version in expected.items():
    assert m.version(package) == version, package
import torch, torchaudio
assert m.version('torch').split('+')[0] == '2.14.1'
assert m.version('torchaudio').split('+')[0] == '2.11.0'
assert m.version('setuptools') == '84.2.1'
assert m.version('wheel') == '0.48.0'

assert m.version('pip') == '26.2.2'
