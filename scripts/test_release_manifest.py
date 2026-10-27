"""Exercise the release manifest consumed by existing and ARM64 updaters."""
import base64
import importlib.util
from pathlib import Path
import unittest
import json
import tempfile
from unittest.mock import patch

SCRIPT = Path(__file__).with_name('assemble_updater.py')


class ReleaseManifestTests(unittest.TestCase):
    def setUp(self):
        self.names = [
            'Lyrical.Sync_0.7.0_x64-setup.exe',
            'Lyrical.Sync_0.7.0_x64.msi',
            'Lyrical.Sync_0.7.0_arm64-setup.exe',
            'Lyrical.Sync_aarch64.app.tar.gz',
        ]
        self.assets = [{'name': n} for name in self.names for n in (name, name + '.sig')]
        self.signatures = {n + '.sig': base64.b64encode(
            b'untrusted comment: fixture\n' + n.encode()
        ).decode() for n in self.names}

    def assemble(self, assets=None, signatures=None):
        self.assertTrue(SCRIPT.is_file(), 'Architecture-safe release assembly is missing')
        spec = importlib.util.spec_from_file_location('assemble_updater', SCRIPT)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.module = module
        return module.assemble_manifest('0.7.0', 'AHRI2nd/Lyrical-Sync',
            self.assets if assets is None else assets,
            self.signatures if signatures is None else signatures,
            '2026-10-23T00:00:00Z')

    def test_windows_clients_receive_only_their_architecture_and_installer(self):
        assets = [{'name':a['name'].replace('_x64.msi','_x64_setup.msi')} for a in self.assets]
        signatures = {name.replace('_x64.msi','_x64_setup.msi'): signature
            for name, signature in self.signatures.items()}
        platforms = self.assemble(assets, signatures)['platforms']
        self.assertEqual(platforms['windows-x86_64']['url'],
            'https://github.com/AHRI2nd/Lyrical-Sync/releases/download/v0.7.0/Lyrical.Sync_0.7.0_x64_setup.msi')
        self.assertTrue(platforms['windows-x86_64-nsis']['url'].endswith('_x64-setup.exe'))
        self.assertTrue(platforms['windows-x86_64-msi']['url'].endswith('_x64_setup.msi'))
        self.assertTrue(platforms['windows-aarch64']['url'].endswith('_arm64-setup.exe'))
        self.assertEqual(platforms['windows-aarch64'], platforms['windows-aarch64-nsis'])
        self.assertNotIn('windows-aarch64-msi', platforms)
        self.assertTrue(platforms['darwin-aarch64']['url'].endswith('_aarch64.app.tar.gz'))
        self.assertEqual(platforms['darwin-aarch64'], platforms['darwin-aarch64-app'])

    def test_final_publication_renames_unlocalized_x64_msi_and_preserves_both_architectures(self):
        self.assemble()
        assets = [{'id':i+1,'name':a['name']} for i,a in enumerate(self.assets)]
        draft = {'id':99,'tag_name':'v0.7.0','draft':True,'assets':assets}
        uploaded = []
        def fake_gh(*args, binary=False):
            if args[0]=='release':
                uploaded.append(json.loads(Path(args[3]).read_text()))
                return ''
            if args[0]=='api' and '--paginate' in args:
                self.assertIn('repos/AHRI2nd/Lyrical-Sync/releases?per_page=100', args)
                self.assertIn('.[] | select(.tag_name == "v0.7.0" and .draft == true)', args)
                return json.dumps(draft)
            if args[0]=='api' and '/releases/tags/' in args[1]:
                self.fail('Draft releases must not be looked up with the published-release endpoint')
            if '--method' in args:
                asset_id=int(next(arg for arg in args if '/releases/assets/' in arg).split('/')[-1])
                method=args[args.index('--method')+1]
                if method == 'DELETE':
                    assets.remove(next(a for a in assets if a['id']==asset_id))
                    return '{}'
                name=args[-1].removeprefix('name=')
                next(a for a in assets if a['id']==asset_id)['name']=name
                return '{}'
            asset_id=int(args[1].split('/')[-1])
            name=next(a for a in assets if a['id']==asset_id)['name']
            return base64.b64encode(b'untrusted comment: fixture\n' + name.encode())
        with tempfile.TemporaryDirectory() as directory, patch.object(self.module,'gh',fake_gh):
            self.module.publish('AHRI2nd/Lyrical-Sync','0.7.0',Path(directory)/'latest.json')
        self.assertEqual(len(uploaded),1)
        self.assertTrue(uploaded[0]['platforms']['windows-x86_64-msi']['url'].endswith('_x64_setup.msi'))
        self.assertTrue(uploaded[0]['platforms']['windows-aarch64']['url'].endswith('_arm64-setup.exe'))
        final_names = {a['name'] for a in assets}
        self.assertIn('Lyrical.Sync_0.7.0_x64_setup.msi.sig',final_names)
        self.assertNotIn('Lyrical.Sync_0.7.0_x64.msi',final_names)
        self.assertNotIn('Lyrical.Sync_0.7.0_x64.msi.sig',final_names)

    def test_legacy_locale_msi_is_still_renamed_for_existing_release_workflows(self):
        self.assemble()
        assets = [{'id':i+1,'name':a['name'].replace('_x64.msi','_x64_en-US.msi')} for i,a in enumerate(self.assets)]
        draft = {'id':99,'tag_name':'v0.7.0','draft':True,'assets':assets}
        uploaded = []
        def fake_gh(*args, binary=False):
            if args[0]=='release':
                uploaded.append(json.loads(Path(args[3]).read_text()))
                return ''
            if args[0]=='api' and '--paginate' in args:
                return json.dumps(draft)
            if args[0]=='api' and '/releases/tags/' in args[1]:
                self.fail('Draft releases must not be looked up with the published-release endpoint')
            if '--method' in args:
                asset_id=int(next(arg for arg in args if '/releases/assets/' in arg).split('/')[-1])
                method=args[args.index('--method')+1]
                if method == 'DELETE':
                    assets.remove(next(a for a in assets if a['id']==asset_id))
                    return '{}'
                name=args[-1].removeprefix('name=')
                next(a for a in assets if a['id']==asset_id)['name']=name
                return '{}'
            asset_id=int(args[1].split('/')[-1])
            name=next(a for a in assets if a['id']==asset_id)['name']
            return base64.b64encode(b'untrusted comment: fixture\n' + name.encode())
        with tempfile.TemporaryDirectory() as directory, patch.object(self.module,'gh',fake_gh):
            self.module.publish('AHRI2nd/Lyrical-Sync','0.7.0',Path(directory)/'latest.json')
        self.assertEqual(len(uploaded),1)
        self.assertTrue(uploaded[0]['platforms']['windows-x86_64-msi']['url'].endswith('_x64_setup.msi'))
        self.assertNotIn('Lyrical.Sync_0.7.0_x64_en-US.msi',{a['name'] for a in assets})

    def test_rebuild_drops_duplicate_msi_when_canonical_pair_already_exists(self):
        self.assemble()
        names = [
            'Lyrical.Sync_0.7.0_x64_setup.msi',
            'Lyrical.Sync_0.7.0_x64_setup.msi.sig',
            *[a['name'] for a in self.assets],
        ]
        assets = [{'id':i+1,'name':name} for i,name in enumerate(names)]
        draft = {'id':99,'tag_name':'v0.7.0','draft':True,'assets':assets}
        uploaded = []
        def fake_gh(*args, binary=False):
            if args[0]=='release':
                uploaded.append(json.loads(Path(args[3]).read_text()))
                return ''
            if args[0]=='api' and '--paginate' in args:
                return json.dumps(draft)
            if '--method' in args:
                asset_id=int(next(arg for arg in args if '/releases/assets/' in arg).split('/')[-1])
                assets.remove(next(a for a in assets if a['id']==asset_id))
                return '{}'
            asset_id=int(args[1].split('/')[-1])
            name=next(a for a in assets if a['id']==asset_id)['name']
            return base64.b64encode(b'untrusted comment: fixture\n' + name.encode())
        with tempfile.TemporaryDirectory() as directory, patch.object(self.module,'gh',fake_gh):
            self.module.publish('AHRI2nd/Lyrical-Sync','0.7.0',Path(directory)/'latest.json')
        remaining = {a['name'] for a in assets}
        self.assertNotIn('Lyrical.Sync_0.7.0_x64.msi',remaining)
        self.assertNotIn('Lyrical.Sync_0.7.0_x64.msi.sig',remaining)
        self.assertIn('Lyrical.Sync_0.7.0_x64_setup.msi',remaining)
        self.assertTrue(uploaded[0]['platforms']['windows-x86_64-msi']['url'].endswith('_x64_setup.msi'))

    def test_missing_arm_artifact_never_falls_back_to_x64(self):
        assets = [a for a in self.assets if '_arm64-' not in a['name']]
        with self.assertRaisesRegex(ValueError, 'windows-aarch64-nsis'):
            self.assemble(assets)

    def test_duplicate_architecture_artifact_is_rejected(self):
        with self.assertRaisesRegex(ValueError, 'Duplicate'):
            self.assemble(self.assets + [self.assets[0]])

    def test_missing_or_malformed_signature_prevents_publication(self):
        for signature in (None, '', 'not a signature'):
            sigs = self.signatures.copy()
            if signature is None:
                sigs.pop(self.names[0] + '.sig')
            else:
                sigs[self.names[0] + '.sig'] = signature
            with self.subTest(signature=signature), self.assertRaises(ValueError):
                self.assemble(signatures=sigs)

    def test_foreign_version_does_not_satisfy_release(self):
        assets = [{'name':a['name'].replace('0.7.0', '0.6.3')} for a in self.assets]
        with self.assertRaises(ValueError):
            self.assemble(assets)

    def test_unsupported_arm_msi_is_not_published_as_an_update(self):
        with self.assertRaisesRegex(ValueError, 'ARM64 MSI'):
            self.assemble(self.assets + [{'name':'Lyrical.Sync_0.7.0_arm64_setup.msi'}])


if __name__ == '__main__':
    unittest.main()
