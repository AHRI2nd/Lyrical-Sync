import unittest
from unittest.mock import patch

import prepare_release_retry as retry


class RetryTests(unittest.TestCase):
    def test_removes_only_known_candidate_assets_and_stale_manifest(self):
        assets = [{'id': index, 'name': name} for index, name in enumerate([
            'Lyrical.Sync_0.7.2_x64_en-US.msi',
            'Lyrical.Sync_0.7.2_x64_setup.msi',
            'Lyrical.Sync_0.7.2_x64_setup.msi.sig',
            'latest.json', 'notes.txt',
        ])]
        files = ['Lyrical Sync_0.7.2_x64_en-US.msi', 'Lyrical Sync_0.7.2_x64_en-US.msi.sig']
        with patch.object(retry, 'get_draft_release', return_value={'draft': True, 'assets': assets}), \
             patch.object(retry, 'gh') as gh:
            retry.prepare('owner/repo', 'v0.7.2', files)
        self.assertEqual([call.args[-1] for call in gh.call_args_list],
                         [f'repos/owner/repo/releases/assets/{index}' for index in range(4)])

    def test_rejects_published_release(self):
        with patch.object(retry, 'get_draft_release', return_value={'draft': False, 'assets': []}), \
             patch.object(retry, 'gh') as gh:
            with self.assertRaises(ValueError):
                retry.prepare('owner/repo', 'v0.7.2', [])
            gh.assert_not_called()

    def test_manifest_only_retry_preserves_installers(self):
        assets = [{'id': 1, 'name': 'latest.json'}, {'id': 2, 'name': 'Lyrical.Sync_0.7.2_x64-setup.exe'}]
        with patch.object(retry, 'get_draft_release', return_value={'draft': True, 'assets': assets}), \
             patch.object(retry, 'gh') as gh:
            retry.prepare('owner/repo', 'v0.7.2', [])
        gh.assert_called_once_with('api', '--method', 'DELETE', 'repos/owner/repo/releases/assets/1')


if __name__ == '__main__':
    unittest.main()
