import hashlib
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import verify_release_provenance as provenance


class ReleaseProvenanceTests(unittest.TestCase):
    def test_normalized_asset_names_and_hashes_must_match_candidates(self):
        files = {'a.app.tar.gz': b'app', 'a.dmg': b'dmg', 'a_x64-setup.exe': b'x64',
                 'a_x64_en-US.msi': b'msi', 'a_arm64-setup.exe': b'arm'}
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            expected = {name: hashlib.sha256(data).hexdigest() for name, data in files.items()}
            for name, data in files.items():
                (root / name.replace('_en-US.msi', '_setup.msi')).write_bytes(data)
            provenance.check_downloads(root, expected)
            (root / 'a_x64_setup.msi').write_bytes(b'changed')
            with self.assertRaisesRegex(ValueError, 'hash'):
                provenance.check_downloads(root, expected)

    def test_missing_or_extra_installers_fail(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            expected = {'a.dmg': hashlib.sha256(b'x').hexdigest()}
            with self.assertRaises(ValueError):
                provenance.check_downloads(root, expected)
            (root / 'a.dmg').write_bytes(b'x')
            (root / 'extra.exe').write_bytes(b'x')
            with self.assertRaises(ValueError):
                provenance.check_downloads(root, expected)

    def test_verification_failure_is_not_suppressed(self):
        with patch.object(provenance.subprocess, 'run', side_effect=provenance.subprocess.CalledProcessError(1, 'gh')):
            with self.assertRaises(provenance.subprocess.CalledProcessError):
                provenance.verify_attestation(Path('candidate.exe'), 'owner/repo', 'a' * 40)

    def test_verification_constrains_repository_workflow_and_commit(self):
        with patch.object(provenance.subprocess, 'run') as run:
            provenance.verify_attestation(Path('candidate.exe'), 'owner/repo', 'a' * 40)
        run.assert_called_once_with([
            'gh', 'attestation', 'verify', 'candidate.exe', '--repo', 'owner/repo',
            '--signer-workflow', 'owner/repo/.github/workflows/release.yml',
            '--source-digest', 'a' * 40,
        ], check=True)

    def test_draft_requires_exact_assets_before_download(self):
        with tempfile.TemporaryDirectory() as temp:
            candidate = Path(temp) / 'candidate.dmg'
            candidate.write_bytes(b'candidate')
            with patch.object(provenance, 'verify', return_value=[candidate]), \
                 patch.object(provenance, 'get_draft_release', return_value={'assets': []}), \
                 patch.object(provenance, 'gh') as download:
                with self.assertRaisesRegex(ValueError, 'installer set'):
                    provenance.verify_draft(Path(temp), '0.7.2', 'a' * 40, 'owner/repo')
                download.assert_not_called()


if __name__ == '__main__':
    unittest.main()
