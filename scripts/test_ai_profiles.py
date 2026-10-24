"""Execute the package probe with controlled interpreter/package metadata."""
from pathlib import Path
import subprocess
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
COMMON = {'ctc-forced-aligner':'1.0.2','demucs':'4.0.1','numpy':'2.5.4',
    'onnxruntime':'1.31.0','librosa':'0.10.2.post1','Unidecode':'1.3.8',
    'torch':'2.14.1','torchaudio':'2.11.0','setuptools':'84.2.1','wheel':'0.48.0','pip':'26.2.2','soxr':'1.1.0'}
LEGACY = {**COMMON,'numpy':'1.26.4','onnxruntime':'1.20.1'}
ARM = {**COMMON,'numpy':'2.5.4','onnxruntime':'1.31.0','torch':'2.14.1+cpu','soxr':'1.1.0'}


def run_probe(machine, versions, cuda=None, interpreter=None):
    source = '''import importlib.metadata as metadata, platform, runpy, sys, sysconfig, types
for name in ['onnxruntime','unidecode','demucs','ctc_forced_aligner','ctc_forced_aligner.ctc_aligner','torch','torchaudio']:
    sys.modules[name]=types.ModuleType(name)
ctc=sys.modules['ctc_forced_aligner']
for name in ['load_audio','generate_emissions','preprocess_text','get_alignments','get_spans','postprocess_results','Tokenizer']:
    setattr(ctc,name,object())
sys.modules['torch'].version=types.SimpleNamespace(cuda=CUDA)
sys.modules['torch'].__version__=VERSIONS['torch']
metadata.version=lambda name:VERSIONS[name]
platform.machine=lambda:MACHINE
sysconfig.get_platform=lambda:INTERPRETER
sys.platform='win32'
runpy.run_path(PROBE)
'''.replace('CUDA',repr(cuda)).replace('VERSIONS',repr(versions)).replace('MACHINE',repr(machine)).replace('INTERPRETER',repr(interpreter or ('win-arm64' if machine == 'ARM64' else 'win-amd64'))).replace('PROBE',repr(str(ROOT/'src-tauri/src/probe_ai.py')))
    return subprocess.run([sys.executable,'-c',source],capture_output=True,text=True)


class AIProfileTests(unittest.TestCase):
    def test_common_windows_x64_package_set_is_accepted(self):
        result=run_probe('AMD64',COMMON)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_emulated_x64_on_arm_host_keeps_x64_profile(self):
        result=run_probe('ARM64',COMMON,interpreter='win-amd64')
        self.assertEqual(result.returncode,0,result.stderr)

    def test_emulated_x64_on_arm_host_accepts_cpu_variant(self):
        self.assertEqual(run_probe('ARM64',ARM,interpreter='win-amd64').returncode,0)

    def test_native_arm_package_set_is_accepted(self):
        result=run_probe('ARM64',ARM)
        self.assertEqual(result.returncode,0,result.stderr)

    def test_arm_interpreter_cannot_adopt_legacy_x64_package_versions(self):
        self.assertNotEqual(run_probe('ARM64',LEGACY).returncode,0)

    def test_x64_interpreter_rejects_stale_package_versions(self):
        self.assertNotEqual(run_probe('AMD64',LEGACY).returncode,0)

    def test_arm_cuda_variant_is_not_the_verified_cpu_runtime(self):
        self.assertNotEqual(run_probe('ARM64',ARM,'13.4').returncode,0)


if __name__ == '__main__':
    unittest.main()
