"""Validate the exact GitHub Actions release ref before running the test matrix."""
import json
import os
import re
import subprocess
import sys
from pathlib import Path


def fail(message: str) -> None:
    print(f'::error::{message}', file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    ref_type = os.environ.get('GITHUB_REF_TYPE', '')
    ref = os.environ.get('GITHUB_REF_NAME', '')
    supplied = os.environ.get('RELEASE_INPUT_TAG', '')
    if ref_type != 'tag':
        fail('Select the release tag as the workflow ref, not a branch.')
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?', ref):
        fail('Invalid tag format; expected vMAJOR.MINOR.PATCH.')
    if '..' in ref or ref.endswith('.'):
        fail('Invalid release tag.')
    if os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and supplied != ref:
        fail(f'The entered release tag {json.dumps(supplied)} must match the selected tag {json.dumps(ref)}.')
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'src-tauri' / 'tauri.conf.json').read_text(encoding='utf-8'))['version']
    if ref != f'v{version}':
        fail(f'The selected tag {json.dumps(ref)} does not match application version {json.dumps(version)}.')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if head != os.environ.get('GITHUB_SHA', ''):
        fail('Checkout does not match the source commit being signed.')
    print(f'Release preflight passed for {ref} at {head}')


if __name__ == '__main__':
    main()
