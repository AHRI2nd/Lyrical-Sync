"""Load the application's updater key and verify a detached Minisign signature."""
import json
from pathlib import Path
import subprocess


ROOT = Path(__file__).resolve().parents[1]
PUBLIC_KEY_CONFIG = ROOT / 'src-tauri/tauri.conf.json'
NODE_VERIFIER = ROOT / 'scripts/verify_minisign_signature.mjs'


def configured_public_key():
    config = json.loads(PUBLIC_KEY_CONFIG.read_text(encoding='utf-8'))
    key = config['plugins']['updater']['pubkey']
    if not isinstance(key, str) or not key:
        raise ValueError('Updater public key is missing from tauri.conf.json')
    return key


def verify_signature(artifact, signature, public_key=None):
    key = public_key or configured_public_key()
    result = subprocess.run(
        ['node', str(NODE_VERIFIER), str(artifact), str(signature), key],
        text=True, capture_output=True, check=False,
    )
    if result.returncode:
        message = result.stderr.strip() or 'Minisign signature verification failed'
        raise ValueError(f'{Path(artifact).name}: {message}')
