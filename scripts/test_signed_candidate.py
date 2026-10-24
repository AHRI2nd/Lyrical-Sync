"""Prevent signed qualification builds from mutating public releases."""
from pathlib import Path
import importlib.util
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]

class SignedCandidateTests(unittest.TestCase):
    def test_workflow_is_manual_read_only_and_does_not_publish(self):
        path=ROOT/'.github/workflows/candidate.yml'
        self.assertTrue(path.is_file(), 'A non-publishing signed candidate workflow is required')
        source=path.read_text()
        self.assertIn('workflow_dispatch:',source)
        self.assertIn('contents: read',source)
        self.assertNotRegex(source,r'(?m)^\s*(?:push|pull_request|tagName|releaseName|releaseId|releaseDraft|releaseCommitish):')
        self.assertNotIn('contents: write',source)
        self.assertNotRegex(source,r'gh\s+release|git\s+push|assemble_updater\.py')
        for target in ['aarch64-apple-darwin','x86_64-pc-windows-msvc','aarch64-pc-windows-msvc']:
            self.assertIn(target,source)
        self.assertIn('TAURI_SIGNING_PRIVATE_KEY:',source)
        self.assertIn('actions/upload-artifact@v4',source)
        self.assertIn('scripts/record_signed_candidate.py',source)

    def recorder(self):
        path=ROOT/'scripts/record_signed_candidate.py'
        self.assertTrue(path.is_file())
        spec=importlib.util.spec_from_file_location('candidate_record',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def test_missing_signature_is_rejected_before_upload(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);(root/'Lyrical Sync_0.7.0_arm64-setup.exe').write_bytes(b'installer')
            with self.assertRaisesRegex(ValueError,'signature'):
                self.recorder().record(root,'aarch64-pc-windows-msvc','a'*40,'0.7.0')

    def test_x64_requires_both_installers_and_preserves_exact_hashes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in ['Lyrical Sync_0.7.0_x64-setup.exe','Lyrical Sync_0.7.0_x64_en-US.msi']:
                (root/name).write_bytes(b'installer');(root/(name+'.sig')).write_text('signature')
            row=self.recorder().record(root,'x86_64-pc-windows-msvc','b'*40,'0.7.0')
            self.assertEqual(row['sourceSha'],'b'*40)
            self.assertEqual(len(row['installers']),2)
            self.assertTrue(all(len(x['sha256'])==64 for x in row['installers']))
            (root/'Lyrical Sync_0.7.0_x64_en-US.msi').unlink()
            with self.assertRaisesRegex(ValueError,'MSI'):
                self.recorder().record(root,'x86_64-pc-windows-msvc','b'*40,'0.7.0')

    def test_mixed_architecture_or_version_bundle_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);name='Lyrical Sync_0.7.0_arm64-setup.exe'
            (root/name).write_bytes(b'installer');(root/(name+'.sig')).write_text('signature')
            (root/'Lyrical Sync_0.7.0_x64-setup.exe').write_bytes(b'wrong installer')
            with self.assertRaisesRegex(ValueError,'architecture or version'):
                self.recorder().record(root,'aarch64-pc-windows-msvc','a'*40,'0.7.0')

    def test_unbound_source_sha_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            with self.assertRaisesRegex(ValueError,'exact commit SHA'):
                self.recorder().record(Path(tmp),'aarch64-pc-windows-msvc','dev-next','0.7.0')

if __name__=='__main__':unittest.main()
