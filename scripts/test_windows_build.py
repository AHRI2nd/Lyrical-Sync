"""Reject mislabeled or cross-architecture Windows build outputs."""
import importlib.util
from pathlib import Path
import struct
import tempfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]


def pe_file(path, machine):
    data=bytearray(128);data[:2]=b'MZ';struct.pack_into('<I',data,0x3c,64)
    data[64:68]=b'PE\0\0';struct.pack_into('<H',data,68,machine)
    data.extend(b'__TAURI_BUNDLE_TYPE_VAR_UNK')
    path.write_bytes(data)


def mark_nsis_bundle(path):
    marker=b'__TAURI_BUNDLE_TYPE_VAR_UNK'
    data=path.read_bytes()
    if data.count(marker)!=1:raise AssertionError('Expected one unpatched Tauri marker')
    path.write_bytes(data.replace(marker,b'__TAURI_BUNDLE_TYPE_VAR_NSS',1))


class WindowsBuildTests(unittest.TestCase):
    def load_verifier(self):
        path=ROOT/'scripts/verify_windows_build.py'
        self.assertTrue(path.is_file(),'Windows artifact architecture verification is missing')
        spec=importlib.util.spec_from_file_location('windows_build',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def verify(self, binary, installer, arch, installer_app=None):
        if installer_app is None:
            installer_app=binary.with_name('installer-lyrical-sync.exe')
            installer_app.write_bytes(binary.read_bytes())
            mark_nsis_bundle(installer_app)
        return self.load_verifier().verify(binary,installer,arch,'0.7.0',installer_app)

    def test_extracts_one_application_executable_without_running_installer(self):
        module=self.load_verifier()
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);destination=root/'extracted';installer=root/'setup.exe'
            def extract(args, **kwargs):
                output=Path(next(argument[2:] for argument in args if argument.startswith('-o')))
                output.mkdir(parents=True,exist_ok=True)
                app=output/'Lyrical Sync'/'lyrical-sync.exe';app.parent.mkdir()
                pe_file(app,0xaa64)
                return SimpleNamespace(returncode=0,stderr='')
            with patch.object(module.shutil,'which',return_value='/tools/7z'), patch.object(module.subprocess,'run',side_effect=extract) as run:
                app=module.extract_installer_app(installer,destination)
            self.assertEqual(app.name,'lyrical-sync.exe')
            self.assertEqual(run.call_args.args[0][1],'x')
            self.assertIn(str(installer),run.call_args.args[0])

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

    def test_installer_contained_application_must_match_target_architecture(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'lyrical-sync.exe';embedded=root/'payload'/'lyrical-sync.exe';installer=root/'Lyrical Sync_0.7.0_arm64-setup.exe'
            embedded.parent.mkdir();pe_file(binary,0xaa64);pe_file(embedded,0x8664);pe_file(installer,0x14c)
            mark_nsis_bundle(embedded)
            with self.assertRaisesRegex(ValueError,'contained application architecture'):
                self.verify(binary,installer,'arm64',embedded)

    def test_installer_contained_application_must_match_verified_build_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'lyrical-sync.exe';embedded=root/'payload'/'lyrical-sync.exe';installer=root/'Lyrical Sync_0.7.0_arm64-setup.exe'
            embedded.parent.mkdir();pe_file(binary,0xaa64);pe_file(embedded,0xaa64);pe_file(installer,0x14c)
            mark_nsis_bundle(embedded)
            embedded.write_bytes(embedded.read_bytes()+b'stale payload')
            with self.assertRaisesRegex(ValueError,'does not contain the verified build'):
                self.verify(binary,installer,'arm64',embedded)

    def test_nsis_bundle_marker_is_the_only_allowed_payload_difference(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);binary=root/'lyrical-sync.exe';embedded=root/'payload'/'lyrical-sync.exe';installer=root/'Lyrical Sync_0.7.0_arm64-setup.exe'
            embedded.parent.mkdir();pe_file(binary,0xaa64);pe_file(embedded,0xaa64);pe_file(installer,0x14c)
            mark_nsis_bundle(embedded)
            self.assertEqual(self.verify(binary,installer,'arm64',embedded)['installer_application_machine'],'0xaa64')


if __name__=='__main__':unittest.main()
