"""Prevent signed qualification builds from mutating public releases."""
from pathlib import Path
import importlib.util
import tempfile
import io
import hashlib
import json
import plistlib
import tarfile
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

    def test_release_upload_waits_for_all_verified_build_artifacts(self):
        source=(ROOT/'.github/workflows/release.yml').read_text()
        self.assertIn('publish-release:',source)
        self.assertIn('needs: release',source)
        self.assertIn('scripts/verify_release_candidates.py',source)
        self.assertIn('gh release upload',source)
        self.assertIn('actions/upload-artifact@v4',source)
        self.assertNotRegex(source,r'(?m)^\s*tagName:')
        self.assertNotRegex(source,r'(?m)^\s*releaseName:')
        self.assertLess(source.index('Verify Windows artifact architecture'),source.index('actions/upload-artifact@v4'))
        self.assertLess(source.index('Record exact source and signed candidate hashes'),source.index('actions/upload-artifact@v4'))

    def test_registered_build_can_dispatch_candidate_without_changing_main(self):
        source=(ROOT/'.github/workflows/build.yml').read_text()
        self.assertIn('signed_candidate:',source)
        self.assertIn('type: boolean',source)
        self.assertIn('default: false',source)
        self.assertIn('contents: read',source)
        self.assertIn("if: ${{ inputs.signed_candidate == true }}",source)
        self.assertIn("if: ${{ inputs.signed_candidate != true }}",source)
        self.assertIn('uses: ./.github/workflows/candidate.yml',source)
        self.assertIn('secrets: inherit',source)
        self.assertIn('workflow_call:',(ROOT/'.github/workflows/candidate.yml').read_text())

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
            self.assertTrue(all(x['signatureVerification'].startswith('Presence and hash only') for x in row['installers']))
            (root/'Lyrical Sync_0.7.0_x64_en-US.msi').unlink()
            with self.assertRaisesRegex(ValueError,'MSI'):
                self.recorder().record(root,'x86_64-pc-windows-msvc','b'*40,'0.7.0')

    def mac_candidate(self, root, version):
        archive=root/'Lyrical Sync_aarch64.app.tar.gz'
        plist=plistlib.dumps({'CFBundleShortVersionString':version})
        with tarfile.open(archive,'w:gz') as output:
            member=tarfile.TarInfo('Lyrical Sync.app/Contents/Info.plist')
            member.size=len(plist)
            output.addfile(member,io.BytesIO(plist))
        (root/(archive.name+'.sig')).write_text('fixture updater signature')
        (root/'Lyrical Sync_aarch64.dmg').write_bytes(b'dmg')

    def test_mac_updater_archive_version_is_read_from_app_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.mac_candidate(root,'0.7.0')
            row=self.recorder().record(root,'aarch64-apple-darwin','c'*40,'0.7.0')
            app=next(item for item in row['installers'] if item['kind']=='app')
            self.assertEqual(app['signatureVerification'],'Presence and hash only; cryptographic verification is not performed here')
            self.assertIn('no cryptographic',row['qualification'])

    def test_mac_updater_archive_with_stale_app_version_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);self.mac_candidate(root,'0.6.3')
            with self.assertRaisesRegex(ValueError,'version'):
                self.recorder().record(root,'aarch64-apple-darwin','c'*40,'0.7.0')

    def test_release_candidate_aggregation_rechecks_files_and_requires_all_targets(self):
        path=ROOT/'scripts/verify_release_candidates.py'
        spec=importlib.util.spec_from_file_location('release_candidates',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);targets={
                'aarch64-apple-darwin':[('app','Lyrical Sync_aarch64.app.tar.gz',True),('dmg','Lyrical Sync_aarch64.dmg',False)],
                'x86_64-pc-windows-msvc':[('nsis','Lyrical Sync_0.7.0_x64-setup.exe',True),('msi','Lyrical Sync_0.7.0_x64_en-US.msi',True)],
                'aarch64-pc-windows-msvc':[('nsis','Lyrical Sync_0.7.0_arm64-setup.exe',True)],
            }
            for target,items in targets.items():
                bundle=root/target;bundle.mkdir()
                rows=[]
                for kind,name,has_sig in items:
                    artifact=bundle/name;artifact.write_bytes(name.encode())
                    row={'kind':kind,'path':name,'bytes':artifact.stat().st_size,
                         'sha256':hashlib.sha256(artifact.read_bytes()).hexdigest()}
                    if has_sig:
                        sig=Path(str(artifact)+'.sig');sig.write_text('fixture signature')
                        row.update(signaturePath=sig.name,signatureSha256=hashlib.sha256(sig.read_bytes()).hexdigest())
                    rows.append(row)
                (bundle/'candidate-record.json').write_text(json.dumps({'target':target,'version':'0.7.0','sourceSha':'a'*40,'installers':rows}))
            self.assertEqual(len(module.verify(root,'0.7.0','a'*40)),9)
            record=root/'aarch64-pc-windows-msvc/candidate-record.json'
            record.unlink()
            with self.assertRaisesRegex(ValueError,'matrix is incomplete'):
                module.verify(root,'0.7.0','a'*40)

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
