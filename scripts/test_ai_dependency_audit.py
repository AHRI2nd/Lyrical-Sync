"""Offline regressions for the AI dependency audit boundary."""
import importlib.util
import io
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('audit_ai', ROOT / 'scripts/audit_ai_dependencies.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


class AuditTests(unittest.TestCase):
    def test_native_installer_audits_the_selected_static_lock_before_hash_locked_install(self):
        source = (ROOT / 'src-tauri/src/python_env.rs').read_text(encoding='utf-8')
        start = source.index('async fn install_python_packages_unlocked')
        end = source.index('\n#[cfg(test)]', start)
        flow = source[start:end]
        audit = flow.index('--locked-requirements')
        audit_gate = flow.index('install_step(&app, &mut audit_command).await?;')
        install = flow.index('"--require-hashes"')
        pip_check = flow.index('"check"')
        package_probe = flow.index('probe(&python, PACKAGE_PROBE)')
        self.assertLess(audit, audit_gate)
        self.assertLess(audit_gate, install)
        self.assertLess(install, pip_check)
        self.assertLess(pip_check, package_probe)
        self.assertNotIn('"--dry-run"', flow)
        self.assertNotIn('"--report"', flow)
        self.assertIn('"--only-binary=:all:"', flow)

    def test_hashed_lock_parser_requires_one_exact_version_and_sha256_per_package(self):
        parsed = audit.parse_hashed_requirements(
            'numpy==2.5.4 --hash=sha256:' + 'a' * 64 + '\n'
            'torch==2.14.1+cpu --hash=sha256:' + 'b' * 64 + '\n'
        )
        self.assertEqual(parsed, [('numpy', '2.5.4', 'a' * 64), ('torch', '2.14.1+cpu', 'b' * 64)])
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            audit.parse_hashed_requirements('numpy==2.5.4\n')
        with self.assertRaisesRegex(ValueError, 'duplicate'):
            audit.parse_hashed_requirements(
                'NumPy==2.5.4 --hash=sha256:' + 'a' * 64 + '\n'
                'numpy==2.5.4 --hash=sha256:' + 'a' * 64 + '\n'
            )

    def test_static_lock_audit_fails_when_any_direct_requirement_is_missing(self):
        import tempfile
        from unittest.mock import patch
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            lock_path = root / 'lock.txt'
            source_path = root / 'requirements.txt'
            lock_path.write_text('numpy==2.5.4 --hash=sha256:' + 'a' * 64 + '\n', encoding='utf-8')
            source_path.write_text('numpy==2.5.4\ntorch==2.14.1\n', encoding='utf-8')
            args = ['audit', '--locked-requirements', str(lock_path), '--source-requirements', str(source_path)]
            with patch('sys.argv', args), patch.object(audit, 'audit_packages') as check, patch('sys.stderr', new_callable=io.StringIO):
                with self.assertRaisesRegex(ValueError, 'omitted direct requirements'):
                    audit.main()
            check.assert_not_called()

    def test_ci_runs_the_common_wheel_and_profile_lock_regressions(self):
        workflow = (ROOT / '.github/workflows/test.yml').read_text(encoding='utf-8')
        self.assertIn('python scripts/test_ai_common_wheel.py', workflow)
        self.assertIn('python scripts/test_ai_profile_locks.py', workflow)

    def test_install_report_requires_and_exports_every_resolved_artifact_hash(self):
        report = {
            'version': '1',
            'install': [
                {
                    'metadata': {'name': 'numpy', 'version': '2.5.4'},
                    'download_info': {
                        'url': 'https://files.pythonhosted.org/numpy.whl',
                        'archive_info': {'hashes': {'sha256': 'a' * 64}},
                    },
                },
                {
                    'metadata': {'name': 'torch', 'version': '2.14.1+cpu'},
                    'download_info': {
                        'url': 'https://files.pythonhosted.org/torch.whl',
                        'archive_info': {'hashes': {'sha256': 'b' * 64}},
                    },
                },
            ],
        }
        packages = audit.parse_install_report(report)
        self.assertEqual(
            audit.render_hashed_requirements(packages),
            f'numpy==2.5.4 --hash=sha256:{"a" * 64}\n'
            f'torch==2.14.1+cpu --hash=sha256:{"b" * 64}\n',
        )

    def test_install_report_fails_closed_on_missing_hash_or_conflicting_versions(self):
        missing_hash = {
            'version': '1',
            'install': [{
                'metadata': {'name': 'numpy', 'version': '2.5.4'},
                'download_info': {'url': 'https://example.test/numpy.whl', 'archive_info': {}},
            }],
        }
        with self.assertRaisesRegex(ValueError, 'SHA-256'):
            audit.parse_install_report(missing_hash)

        conflicting = {
            'version': '1',
            'install': [
                {'metadata': {'name': 'numpy', 'version': '2.5.4'}, 'download_info': {'url': 'https://example.test/numpy.whl', 'archive_info': {'hashes': {'sha256': 'a' * 64}}}},
                {'metadata': {'name': 'NumPy', 'version': '2.5.3'}, 'download_info': {'url': 'https://example.test/numpy.whl', 'archive_info': {'hashes': {'sha256': 'b' * 64}}}},
            ],
        }
        with self.assertRaisesRegex(ValueError, 'conflicting'):
            audit.parse_install_report(conflicting)

        source_archive = {
            'version': '1',
            'install': [{
                'metadata': {'name': 'numpy', 'version': '2.5.4'},
                'download_info': {
                    'url': 'https://files.pythonhosted.org/numpy.tar.gz',
                    'archive_info': {'hashes': {'sha256': 'a' * 64}},
                },
            }],
        }
        with self.assertRaisesRegex(ValueError, 'must be wheels'):
            audit.parse_install_report(source_archive)

    def test_report_audit_writes_hash_lock_only_after_advisory_success(self):
        import tempfile
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            report_path = root / 'report.json'
            requirements_path = root / 'requirements.txt'
            lock_path = root / 'resolved-requirements.txt'
            report_path.write_text(json.dumps({'version': '1', 'install': [{
                'metadata': {'name': 'numpy', 'version': '2.5.4'},
                'download_info': {'url': 'https://example.test/numpy.whl', 'archive_info': {'hashes': {'sha256': 'c' * 64}}},
            }]}), encoding='utf-8')
            requirements_path.write_text('numpy==2.5.4\n', encoding='utf-8')
            args = ['audit', '--report', str(report_path), '--source-requirements', str(requirements_path), '--lock-output', str(lock_path), '--extra-package', 'ctc-forced-aligner==1.0.2']
            with patch('sys.argv', args), patch.object(audit, 'audit_packages', return_value={'vulnerabilities': []}) as check, patch('sys.stdout', new_callable=io.StringIO):
                audit.main()
            check.assert_called_once_with([('numpy', '2.5.4'), ('ctc-forced-aligner', '1.0.2')])
            self.assertEqual(lock_path.read_text(encoding='utf-8'), f'numpy==2.5.4 --hash=sha256:{"c" * 64}\n')

            lock_path.unlink()
            with patch('sys.argv', args), patch.object(audit, 'audit_packages', side_effect=ValueError('advisory')), patch('sys.stdout', new_callable=io.StringIO):
                with self.assertRaisesRegex(ValueError, 'advisory'):
                    audit.main()
            self.assertFalse(lock_path.exists())

    def test_report_must_contain_every_direct_requirement(self):
        import tempfile
        from unittest.mock import patch

        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            report_path = root / 'report.json'
            requirements_path = root / 'requirements.txt'
            lock_path = root / 'resolved-requirements.txt'
            report_path.write_text(json.dumps({'version': '1', 'install': [{
                'metadata': {'name': 'numpy', 'version': '2.5.4'},
                'download_info': {'url': 'https://example.test/numpy.whl', 'archive_info': {'hashes': {'sha256': 'd' * 64}}},
            }]}), encoding='utf-8')
            requirements_path.write_text('numpy==2.5.4\ntorch==2.14.1\n', encoding='utf-8')
            args = ['audit', '--report', str(report_path), '--source-requirements', str(requirements_path), '--lock-output', str(lock_path)]
            with patch('sys.argv', args), patch.object(audit, 'audit_packages') as check, patch('sys.stdout', new_callable=io.StringIO):
                with self.assertRaisesRegex(ValueError, 'omitted direct requirements'):
                    audit.main()
            check.assert_not_called()
            self.assertFalse(lock_path.exists())

    def test_requirements_file_uses_utf8_with_a_cp1252_default_locale(self):
        import io
        import tempfile
        from unittest.mock import patch
        original = io.text_encoding
        def cp1252_default(encoding, stacklevel=2):
            return "cp1252" if encoding is None else original(encoding, stacklevel)
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "requirements.txt"
            path.write_text("# 음성 모델\ntorch==2.14.1\n", encoding="utf-8")
            with patch("io.text_encoding", side_effect=cp1252_default), patch("sys.argv", ["audit", "--requirements", str(path)]), patch.object(audit, "audit_packages", return_value={}) as check, patch("sys.stdout", new_callable=io.StringIO):
                audit.main()
            check.assert_called_once_with([("torch", "2.14.1")])

    def test_all_declared_dependencies_require_exact_versions(self):
        self.assertEqual(audit.parse_requirements('torch==2.14.1\n# comment\nwheel==0.48.0'), [('torch', '2.14.1'), ('wheel', '0.48.0')])
        for text in ['torch>=2', 'https://example.test/pkg.whl', 'torch==2; os_name=="nt"']:
            with self.assertRaises(ValueError): audit.parse_requirements(text)

    def test_public_package_metadata_is_the_only_query_payload(self):
        def query(payload):
            self.assertEqual(payload, {'queries': [{'package': {'ecosystem': 'PyPI', 'name': 'torch'}, 'version': '2.14.1'}]})
            return {'results': [{}]}
        self.assertEqual(audit.audit_packages([('torch', '2.14.1')], query)['vulnerabilities'], [])

    def test_cpu_wheel_local_version_cannot_hide_a_base_version_advisory(self):
        def query(payload):
            version = payload['queries'][0]['version']
            return {'results': [{'vulns': [{'id':'GHSA-test'}]}] if version == '2.5.1' else [{}]}
        with self.assertRaisesRegex(ValueError, 'GHSA-test'):
            audit.audit_packages([('torch','2.5.1+cpu')],query)

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
