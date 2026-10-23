"""Reject mislabeled or cross-architecture Windows build outputs."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]


def pe_file(path, machine):
    data=bytearray(128);data[:2]=b'MZ';struct.pack_into('<I',data,0x3c,64)
    data[64:68]=b'PE\0\0';struct.pack_into('<H',data,68,machine)
    path.write_bytes(data)


class WindowsBuildTests(unittest.TestCase):
    def verify(self, binary, installer, arch):
        path=ROOT/'scripts/verify_windows_build.py'
        self.assertTrue(path.is_file(),'Windows artifact architecture verification is missing')
        spec=importlib.util.spec_from_file_location('windows_build',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module.verify(binary,installer,arch,'0.7.0')

    def test_native_arm_app_and_x86_installer_bootstrap_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'lyrical-sync.exe';installer=root/'Lyrical Sync_0.7.0_arm64-setup.exe'
            pe_file(binary,0xaa64);pe_file(installer,0x14c)
            self.assertEqual(self.verify(binary,installer,'arm64')['application_machine'],'0xaa64')

    def test_existing_x64_app_and_installer_contract_are_accepted(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'lyrical-sync.exe';installer=root/'Lyrical Sync_0.7.0_x64-setup.exe'
            pe_file(binary,0x8664);pe_file(installer,0x14c)
            self.assertEqual(self.verify(binary,installer,'x64')['application_machine'],'0x8664')

    def test_arm_label_cannot_hide_an_x64_application(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'lyrical-sync.exe';installer=root/'Lyrical Sync_0.7.0_arm64-setup.exe'
            pe_file(binary,0x8664);pe_file(installer,0x14c)
            with self.assertRaisesRegex(ValueError,'architecture'):self.verify(binary,installer,'arm64')

    def test_arm_binary_cannot_be_published_with_x64_installer_name(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'lyrical-sync.exe';installer=root/'Lyrical Sync_0.7.0_x64-setup.exe'
            pe_file(binary,0xaa64);pe_file(installer,0x14c)
            with self.assertRaisesRegex(ValueError,'name'):self.verify(binary,installer,'arm64')


if __name__=='__main__':unittest.main()
