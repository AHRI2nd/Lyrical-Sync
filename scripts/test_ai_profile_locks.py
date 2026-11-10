"""Check immutable hash locks and installer selection for each AI runtime profile."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("audit_ai", ROOT / "scripts/audit_ai_dependencies.py")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)
LOCKS = ROOT / "src-tauri/requirements-lock"
PROFILES = {
    "macos-arm64": ("requirements-ai.txt", "macos-arm64.txt", "2.14.1"),
    "windows-x64": ("requirements-ai.txt", "windows-x64.txt", "2.14.1"),
    "windows-arm64": ("requirements-ai-windows-arm64.txt", "windows-arm64.txt", "2.14.1+cpu"),
}


class AIProfileLockTests(unittest.TestCase):
    def test_each_platform_lock_is_complete_hash_pinned_and_matches_direct_requirements(self):
        provenance = json.loads((ROOT / "src-tauri/resources/ai-common/provenance.json").read_text())
        for profile, (requirements_file, lock_file, torch_version) in PROFILES.items():
            with self.subTest(profile=profile):
                source = ROOT / "src-tauri" / requirements_file
                requirements = audit.parse_requirements(source.read_text(encoding="utf-8"))
                locked = audit.parse_hashed_requirements((LOCKS / lock_file).read_text(encoding="utf-8"))
                lock_map = {(audit.normalize_name(name), version): digest for name, version, digest in locked}
                for name, version in requirements:
                    self.assertIn((audit.normalize_name(name), version), lock_map)
                self.assertEqual(lock_map[("torch", torch_version)] is not None, True)
                self.assertEqual(lock_map[("demucs", "4.0.1")], provenance["wheel"]["sha256"])

    def test_static_locks_have_expected_profile_count_and_no_conflicting_package_versions(self):
        for profile, (_, lock_file, _) in PROFILES.items():
            with self.subTest(profile=profile):
                packages = audit.parse_hashed_requirements((LOCKS / lock_file).read_text(encoding="utf-8"))
                names = [audit.normalize_name(name) for name, _, _ in packages]
                self.assertEqual(len(names), len(set(names)))
                self.assertGreaterEqual(len(packages), 55)
                self.assertTrue(all(len(digest) == 64 for _, _, digest in packages))

    def test_installer_audits_selected_static_lock_before_install_without_dynamic_resolution(self):
        source = (ROOT / "src-tauri/src/python_env.rs").read_text(encoding="utf-8")
        start = source.index("async fn install_python_packages_unlocked")
        end = source.index("\n#[cfg(test)]", start)
        flow = source[start:end]
        audit = flow.index("--locked-requirements")
        audit_gate = flow.index("install_step(&app, &mut audit_command).await?;")
        install = flow.index('"--require-hashes"')
        self.assertLess(audit, audit_gate)
        self.assertLess(audit_gate, install)
        self.assertIn("requirements-lock/macos-arm64.txt", source)
        self.assertIn("requirements-lock/windows-x64.txt", source)
        self.assertIn("requirements-lock/windows-arm64.txt", source)
        self.assertNotIn('"--dry-run"', flow)
        self.assertNotIn('"--report"', flow)


if __name__ == "__main__":
    unittest.main()
