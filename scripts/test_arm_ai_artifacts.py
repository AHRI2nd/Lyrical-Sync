"""Validate the actual bundled wheel payloads rather than their labels."""
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import struct
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
BUNDLED = ROOT/'src-tauri/resources/windows-arm64-ai'


class ARMArtifactsTests(unittest.TestCase):
    def verify(self, root):
        script=ROOT/'scripts/verify_windows_arm64_ai.py'
        self.assertTrue(script.is_file(), 'Native wheel payload verification is missing')
        spec=importlib.util.spec_from_file_location('verify_arm_ai',script)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module.verify(root)

    def test_committed_native_wheels_have_valid_digests_machine_types_and_licenses(self):
        self.assertEqual(len(self.verify(BUNDLED)),3)

    def test_bundled_wheel_tags_are_installable_by_the_embedded_interpreter(self):
        from zipfile import ZipFile
        for wheel in BUNDLED.glob('*.whl'):
            with ZipFile(wheel) as archive:
                metadata=next(name for name in archive.namelist() if name.endswith('.dist-info/WHEEL'))
                tags=[line.removeprefix('Tag: ') for line in archive.read(metadata).decode().splitlines() if line.startswith('Tag: ')]
            compatible=any(tag=='cp313-cp313-win_arm64' or tag=='cp312-abi3-win_arm64' for tag in tags)
            self.assertTrue(compatible,f'{wheel.name} cannot be installed by standard-GIL CPython3.13 ARM64')

    def test_changed_wheel_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'bundle';shutil.copytree(BUNDLED,root)
            wheel=next(root.glob('*.whl'));wheel.write_bytes(b'changed bytes')
            with self.assertRaisesRegex(ValueError,'checksum'):self.verify(root)

    def test_x64_extension_with_arm_filename_and_updated_digest_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)/'bundle';shutil.copytree(BUNDLED,root)
            wheel=next(root.glob('*.whl'))
            with zipfile.ZipFile(wheel) as archive:
                files={name:archive.read(name) for name in archive.namelist()}
            name=next(name for name in files if name.endswith('.pyd'))
            data=bytearray(files[name]);offset=struct.unpack_from('<I',data,0x3c)[0]
            struct.pack_into('<H',data,offset+4,0x8664);files[name]=data
            with zipfile.ZipFile(wheel,'w') as archive:
                for name,data in files.items():archive.writestr(name,data)
            manifest=json.loads((root/'provenance.json').read_text())
            next(e for e in manifest['wheels'] if e['file']==wheel.name)['sha256']=hashlib.sha256(wheel.read_bytes()).hexdigest()
            (root/'provenance.json').write_text(json.dumps(manifest))
            with self.assertRaisesRegex(ValueError,'ARM64'):self.verify(root)


if __name__=='__main__':unittest.main()
