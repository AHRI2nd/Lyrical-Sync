"""Exercise the embedded interpreter boundary, including stale and wrong-ABI runtimes."""
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parents[1]

class RuntimePolicyTests(unittest.TestCase):
    def policy(self):
        path=ROOT/'src-tauri/src/probe_runtime.py'
        self.assertTrue(path.is_file(),'A shared runtime version/ABI policy is required')
        spec=importlib.util.spec_from_file_location('runtime_policy',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module.validate_runtime

    def test_latest_common_interpreter_works_on_all_supported_architectures(self):
        validate=self.policy()
        for tag in ['macosx-14.0-arm64','win-amd64','win-arm64']:
            validate((3,13,17),tag,False)

    def test_native_and_emulated_interpreters_cannot_cross_app_profiles(self):
        validate=self.policy()
        validate((3,13,17),'win-amd64',False,'win-amd64')
        for tag,expected in [('win-amd64','win-arm64'),('win-arm64','win-amd64'),('macosx-14.0-arm64','win-arm64')]:
            with self.assertRaises(RuntimeError):validate((3,13,17),tag,False,expected)

    def test_stale_newer_incompatible_and_free_threaded_runtimes_are_rejected(self):
        validate=self.policy()
        for version,tag,free in [((3,11,10),'win-amd64',False),((3,12,15),'win-arm64',False),((3,14,9),'win-arm64',False),((3,13,17),'win-arm64',True),((3,13,17),'macosx-14.0-x86_64',False)]:
            with self.subTest(version=version,tag=tag,free=free),self.assertRaises(RuntimeError):validate(version,tag,free)

if __name__=='__main__':unittest.main()
