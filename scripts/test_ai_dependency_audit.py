"""Offline regressions for the AI dependency audit boundary."""
import importlib.util
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit_ai', ROOT / 'scripts/audit_ai_dependencies.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_all_declared_dependencies_require_exact_versions(self):
        self.assertEqual(audit.parse_requirements('torch==2.14.1\n# comment\nwheel==0.48.0'), [('torch', '2.14.1'), ('wheel', '0.48.0')])
        for text in ['torch>=2', 'https://example.test/pkg.whl', 'torch==2; os_name=="nt"']:
            with self.assertRaises(ValueError): audit.parse_requirements(text)

    def test_public_package_metadata_is_the_only_query_payload(self):
        def query(payload):
            self.assertEqual(payload, {'queries': [{'package': {'ecosystem': 'PyPI', 'name': 'torch'}, 'version': '2.14.1'}]})
            return {'results': [{}]}
        self.assertEqual(audit.audit_packages([('torch', '2.14.1')], query)['vulnerabilities'], [])

    def test_vulnerability_blocks_publication(self):
        with self.assertRaisesRegex(ValueError, 'torch.*GHSA-test'):
            audit.audit_packages([('torch', '2.5.1')], lambda _: {'results': [{'vulns': [{'id': 'GHSA-test'}]}]})

    def test_malformed_or_incomplete_service_response_fails_closed(self):
        for response in [{}, {'results': []}, {'results': [{} , {}]}, {'results': [None]}, {'results': [{'vulns': 'bad'}]}, {'results': [{'error': 'unavailable'}]}]:
            with self.assertRaises(ValueError):
                audit.audit_packages([('torch', '2.14.1')], lambda _: response)

    def test_service_error_is_not_interpreted_as_no_advisories(self):
        def unavailable(_): raise OSError('offline')
        with self.assertRaises(OSError): audit.audit_packages([('torch', '2.14.1')], unavailable)


if __name__ == '__main__': unittest.main()
