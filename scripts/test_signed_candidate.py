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
    def test_release_tag_inputs_are_data_not_shell_source(self):
        source = (ROOT / '.github/workflows/release.yml').read_text(encoding='utf-8')
        self.assertEqual(source.count('RELEASE_REF_NAME: ${{ github.ref_name }}'), 2)
        self.assertEqual(source.count('RELEASE_INPUT_TAG: ${{ github.event.inputs.tag }}'), 2)
        self.assertIn('TAG_NAME="$RELEASE_REF_NAME"', source)
        self.assertIn('REF_NAME="$RELEASE_REF_NAME"', source)
        # GitHub expressions must not be spliced into the shell's quoted strings.
        self.assertNotRegex(source, r'(?m)^\s*(TAG_NAME|REF_NAME)="\$\{\{')
        self.assertNotRegex(source, r'(?m)^\s*if \[ -n "\$\{\{')

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
        self.assertRegex(source,r'needs:\s*\[\s*release\s*,\s*test-gate\s*\]')
        self.assertIn('scripts/verify_release_candidates.py',source)
        self.assertIn('gh release upload',source)
        self.assertIn('actions/upload-artifact@v4',source)
        self.assertNotRegex(source,r'(?m)^\s*tagName:')
        self.assertNotRegex(source,r'(?m)^\s*releaseName:')
        self.assertLess(source.index('Verify Windows artifact architecture'),source.index('actions/upload-artifact@v4'))
        self.assertLess(source.index('Record exact source and signed candidate hashes'),source.index('actions/upload-artifact@v4'))

    def test_signed_candidate_rejects_untrusted_refs_before_running_build_code(self):
        source=(ROOT/'.github/workflows/candidate.yml').read_text()
        guard=source.index('Verify signed candidate source')
        self.assertIn('CANDIDATE_REF: ${{ github.ref }}',source)
        self.assertIn('CANDIDATE_REF_TYPE: ${{ github.ref_type }}',source)
        self.assertIn('CANDIDATE_SHA: ${{ github.sha }}',source)
        self.assertIn('refs/heads/main',source)
        self.assertIn(r"'^v[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$'",source)
        self.assertIn('git rev-parse HEAD',source)
        self.assertLess(guard,source.index('Setup Node.js'))
        self.assertLess(guard,source.index('Install frontend deps'))
        self.assertLess(guard,source.index('Import Apple certificate'))
        self.assertLess(guard,source.index('Build signed macOS candidate'))

    def test_signing_depends_on_tests_and_never_interpolates_untrusted_ref_into_shell(self):
        source=(ROOT/'.github/workflows/release.yml').read_text()
        self.assertRegex(source,r'(?m)^  release:\n(?:    #[^\n]*\n)*    needs: test-gate[ \t]*$')
        self.assertIn('python scripts/test_ai_sidecars.py',source)
        self.assertIn('python scripts/test_signed_candidate.py',source)
        self.assertIn('RELEASE_REF_NAME: ${{ github.ref_name }}',source)
        self.assertIn('GITHUB_REF_TYPE',source)
        self.assertIn('$(git rev-parse HEAD)',source)
        self.assertNotIn('TAG_NAME="${{ github.ref_name }}"',source)
        self.assertNotIn('REF_NAME="${{ github.ref_name }}"',source)
        self.assertNotIn('TAG_NAME="${{ github.event.inputs.tag }}"',source)
        self.assertIn('existing_target=$(gh api',source)
        self.assertIn('git fetch --depth=1 origin "refs/tags/$TAG"',source)
        for workflow in ('release.yml','candidate.yml'):
            signed=(ROOT/'.github/workflows'/workflow).read_text()
            self.assertNotIn('run: echo "${{ secrets.APPLE_API_KEY }}"',signed)
            self.assertNotIn('codesign --force --sign "${{ secrets.APPLE_SIGNING_IDENTITY }}"',signed)
            self.assertIn('APPLE_API_KEY_P8: ${{ secrets.APPLE_API_KEY }}',signed)
            self.assertIn('printf \'%s\' "$APPLE_API_KEY_P8"',signed)

    def test_signed_workflow_targets_match_verified_candidate_contract(self):
        for workflow in ('release.yml','candidate.yml'):
            source=(ROOT/'.github/workflows'/workflow).read_text()
            for target in ('aarch64-apple-darwin','x86_64-pc-windows-msvc',
                           'aarch64-pc-windows-msvc'):
                self.assertIn('target: '+target,source)
            self.assertIn('bundleArgs: "--bundles nsis,msi"',source)
            self.assertIn('os: windows-11-arm',source)

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

    def release_candidate_verifier(self):
        path=ROOT/'scripts/verify_release_candidates.py'
        spec=importlib.util.spec_from_file_location('release_candidates',path)
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        return module

    def release_candidate_matrix(self, root):
        targets={
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

    def update_mac_candidate_path(self, root, field, path):
        record_path=root/'aarch64-apple-darwin/candidate-record.json'
        record=json.loads(record_path.read_text())
        record['installers'][0][field]=path
        record_path.write_text(json.dumps(record))

    def test_release_candidate_aggregation_rechecks_files_and_requires_all_targets(self):
        module=self.release_candidate_verifier()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.release_candidate_matrix(root)
            self.assertEqual(len(module.verify(root,'0.7.0','a'*40)),9)
            record=root/'aarch64-pc-windows-msvc/candidate-record.json'
            record.unlink()
            with self.assertRaisesRegex(ValueError,'matrix is incomplete'):
                module.verify(root,'0.7.0','a'*40)

    def test_release_candidate_nested_paths_remain_valid(self):
        module=self.release_candidate_verifier()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            self.release_candidate_matrix(root)
            bundle=root/'aarch64-apple-darwin'
            nested=bundle/'nested';nested.mkdir()
            archive=bundle/'Lyrical Sync_aarch64.app.tar.gz'
            signature=Path(str(archive)+'.sig')
            archive.rename(nested/archive.name)
            signature.rename(nested/signature.name)
            self.update_mac_candidate_path(root,'path','nested/'+archive.name)
            self.update_mac_candidate_path(root,'signaturePath','nested/'+signature.name)

            files=module.verify(root,'0.7.0','a'*40)
            self.assertEqual(len(files),9)
            self.assertIn((nested/archive.name).resolve(),files)
            self.assertIn((nested/signature.name).resolve(),files)

    def test_release_candidate_rejects_absolute_and_parent_traversal_paths(self):
        module=self.release_candidate_verifier()
        for field in ('path','signaturePath'):
            for mode in ('absolute','parent','normalized_parent'):
                with self.subTest(field=field,mode=mode), tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp)/'release';root.mkdir()
                    self.release_candidate_matrix(root)
                    bundle=root/'aarch64-apple-darwin'
                    original=bundle/('Lyrical Sync_aarch64.app.tar.gz'+('.sig' if field=='signaturePath' else ''))
                    if mode=='normalized_parent':
                        bad_path='nested/../'+original.name
                    else:
                        outside=(Path(tmp) if mode=='absolute' else root)/('outside-'+original.name)
                        outside.write_bytes(original.read_bytes())
                        bad_path=str(outside) if mode=='absolute' else '../'+outside.name
                    self.update_mac_candidate_path(root,field,bad_path)
                    with self.assertRaisesRegex(ValueError,'escapes candidate directory'):
                        module.verify(root,'0.7.0','a'*40)

    def test_release_candidate_rejects_artifact_and_signature_symlink_escape(self):
        module=self.release_candidate_verifier()
        for field in ('path','signaturePath'):
            for mode in ('leaf','directory'):
                with self.subTest(field=field,mode=mode), tempfile.TemporaryDirectory() as tmp:
                    root=Path(tmp)/'release';root.mkdir()
                    self.release_candidate_matrix(root)
                    bundle=root/'aarch64-apple-darwin'
                    original=bundle/('Lyrical Sync_aarch64.app.tar.gz'+('.sig' if field=='signaturePath' else ''))
                    external=Path(tmp)/'external';external.mkdir()
                    outside=external/original.name;outside.write_bytes(original.read_bytes())
                    try:
                        if mode=='leaf':
                            (bundle/'escaped-file').symlink_to(outside)
                            bad_path='escaped-file'
                        else:
                            (bundle/'escaped-parent').symlink_to(external,target_is_directory=True)
                            bad_path='escaped-parent/'+outside.name
                    except (OSError,NotImplementedError) as exc:
                        self.skipTest(f'Symlink creation unavailable: {exc}')
                    self.update_mac_candidate_path(root,field,bad_path)
                    with self.assertRaisesRegex(ValueError,'escapes candidate directory'):
                        module.verify(root,'0.7.0','a'*40)

    def test_release_candidate_rejects_record_symlink_escape(self):
        module=self.release_candidate_verifier()
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/'release';root.mkdir()
            self.release_candidate_matrix(root)
            record=root/'aarch64-apple-darwin/candidate-record.json'
            external=Path(tmp)/'outside-record.json'
            external.write_bytes(record.read_bytes())
            record.unlink()
            try:
                record.symlink_to(external)
            except (OSError,NotImplementedError) as exc:
                self.skipTest(f'Symlink creation unavailable: {exc}')
            with self.assertRaisesRegex(ValueError,'Candidate record escapes release root'):
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
