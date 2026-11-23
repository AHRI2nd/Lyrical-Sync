import os
import json
import subprocess
import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / 'scripts' / 'release_preflight.py'


class ReleasePreflightTests(unittest.TestCase):
    def run_check(self, **changes):
        sha = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip()
        version = json.loads((ROOT / 'src-tauri' / 'tauri.conf.json').read_text(encoding='utf-8'))['version']
        env = {**os.environ, 'GITHUB_REF_TYPE': 'tag', 'GITHUB_REF_NAME': f'v{version}',
               'GITHUB_EVENT_NAME': 'workflow_dispatch', 'RELEASE_INPUT_TAG': f'v{version}', 'GITHUB_SHA': sha, **changes}
        return subprocess.run([sys.executable, str(SCRIPT)], cwd=ROOT, env=env, text=True, capture_output=True)

    def test_matching_tag(self):
        self.assertEqual(self.run_check().returncode, 0)

    def test_rejects_branch(self):
        self.assertNotEqual(self.run_check(GITHUB_REF_TYPE='branch', GITHUB_REF_NAME='main').returncode, 0)

    def test_allows_main_only_with_explicit_tag_creation(self):
        self.assertEqual(self.run_check(GITHUB_REF_TYPE='branch', GITHUB_REF_NAME='main', GITHUB_REF='refs/heads/main', RELEASE_CREATE_TAG='true').returncode, 0)
        self.assertNotEqual(self.run_check(GITHUB_REF_TYPE='branch', GITHUB_REF_NAME='dev-next', GITHUB_REF='refs/heads/dev-next', RELEASE_CREATE_TAG='true').returncode, 0)

    def test_rejects_mismatched_input(self):
        self.assertNotEqual(self.run_check(RELEASE_INPUT_TAG='not-the-selected-tag').returncode, 0)

    def test_rejects_invalid_tag(self):
        self.assertNotEqual(self.run_check(GITHUB_REF_NAME='v0.7.1;bad', RELEASE_INPUT_TAG='v0.7.1;bad').returncode, 0)

    def test_rejects_wrong_version(self):
        self.assertNotEqual(self.run_check(GITHUB_REF_NAME='v999999.999999.999999', RELEASE_INPUT_TAG='v999999.999999.999999').returncode, 0)

    def test_rejects_wrong_commit(self):
        self.assertNotEqual(self.run_check(GITHUB_SHA='0' * 40).returncode, 0)

    def test_tag_push_does_not_require_dispatch_input(self):
        self.assertEqual(self.run_check(GITHUB_EVENT_NAME='push', RELEASE_INPUT_TAG='').returncode, 0)

    def test_release_graph_gates_testing_and_signing(self):
        workflow = (ROOT / '.github' / 'workflows' / 'release.yml').read_text(encoding='utf-8')
        self.assertIn('  test-gate:\n    needs: release-preflight\n    uses:', workflow)
        self.assertIn('    needs: [release-preflight, test-gate]', workflow)
        self.assertIn('python3 scripts/release_preflight.py', workflow)
        self.assertLess(workflow.index('Verify tag matches app version'), workflow.index('Setup Node.js'))


if __name__ == '__main__':
    unittest.main()
