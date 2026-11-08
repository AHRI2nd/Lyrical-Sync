"""Exercise Minisign verification against valid and tampered fixtures."""
import base64
import json
import subprocess
import tempfile
from pathlib import Path
import unittest


ROOT = Path(__file__).resolve().parents[1]
VERIFIER = ROOT / 'scripts/verify_minisign_signature.mjs'
CONFIGURED_PUBLIC_KEY = json.loads(
    (ROOT / 'src-tauri/tauri.conf.json').read_text(encoding='utf-8')
)['plugins']['updater']['pubkey']
FIXTURE_PUBLIC_KEY = (
    'untrusted comment: minisign public key: 1FE8B442180F62E7\n'
    'RWQf6LRCGA9i53mlYecO4IzT51TGPpvWucNSCh1CBM0QTaLn73Y7GFO3\n'
)
FIXTURE_SIGNATURE = '\n'.join((
    'untrusted comment: signature from minisign secret key',
    'RUQf6LRCGA9i559r3g7V1qNyJDApGip8MfqcadIgT9CuhV3EMhHoN1mGTkUidF/z7SrlQgXdy8ofjb7bNJJylDOocrCo8KLzZwo=',
    'trusted comment: timestamp:1633700835\tfile:test\tprehashed',
    'wLMDjy9FLAuxZ3q4NlEvkgtyhrr0gtTu6KC4KBJdITbbOeAi1zBIYo0v4iTgt8jJpIidRJnp94ABQkJAgAooBQ==',
)) + '\n'


class MinisignVerifierTests(unittest.TestCase):
    def run_verifier(self, artifact, signature, public_key=FIXTURE_PUBLIC_KEY):
        envelope = base64.b64encode(public_key.encode()).decode()
        return subprocess.run(
            ['node', str(VERIFIER), str(artifact), str(signature), envelope],
            text=True, capture_output=True, check=False,
        )

    def test_accepts_valid_prehashed_signature_and_trusted_comment(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'artifact.bin'
            signature = Path(directory) / 'artifact.sig'
            artifact.write_bytes(b'test')
            signature.write_text(FIXTURE_SIGNATURE, encoding='utf-8')
            result = self.run_verifier(artifact, signature)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_rejects_tampered_artifact(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'artifact.bin'
            signature = Path(directory) / 'artifact.sig'
            artifact.write_bytes(b'test changed')
            signature.write_text(FIXTURE_SIGNATURE, encoding='utf-8')
            result = self.run_verifier(artifact, signature)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('artifact signature verification failed', result.stderr)

    def test_rejects_signature_from_a_different_public_key(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'artifact.bin'
            signature = Path(directory) / 'artifact.sig'
            artifact.write_bytes(b'test')
            signature.write_text(FIXTURE_SIGNATURE, encoding='utf-8')
            key_bytes = bytearray(base64.b64decode(FIXTURE_PUBLIC_KEY.splitlines()[1]))
            key_bytes[2] ^= 0x01
            wrong_key = FIXTURE_PUBLIC_KEY.splitlines()[0] + '\n' + base64.b64encode(key_bytes).decode() + '\n'
            result = self.run_verifier(artifact, signature, wrong_key)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('key ID does not match', result.stderr)

    def test_configured_application_key_is_parsed_and_rejects_unrelated_fixture(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'artifact.bin'
            signature = Path(directory) / 'artifact.sig'
            artifact.write_bytes(b'test')
            signature.write_text(FIXTURE_SIGNATURE, encoding='utf-8')
            result = subprocess.run(
                ['node', str(VERIFIER), str(artifact), str(signature), CONFIGURED_PUBLIC_KEY],
                text=True, capture_output=True, check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('key ID does not match', result.stderr)

    def test_rejects_tampered_trusted_comment_signature(self):
        with tempfile.TemporaryDirectory() as directory:
            artifact = Path(directory) / 'artifact.bin'
            signature = Path(directory) / 'artifact.sig'
            artifact.write_bytes(b'test')
            altered = FIXTURE_SIGNATURE.replace('file:test', 'file:other')
            signature.write_text(altered, encoding='utf-8')
            result = self.run_verifier(artifact, signature)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn('trusted comment signature verification failed', result.stderr)


if __name__ == '__main__':
    unittest.main()
