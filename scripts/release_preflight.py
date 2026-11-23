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
    create_from_main = (os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch'
                        and ref_type == 'branch'
                        and os.environ.get('GITHUB_REF') == 'refs/heads/main'
                        and os.environ.get('RELEASE_CREATE_TAG') == 'true')
    if ref_type != 'tag' and not create_from_main:
        fail('Select an existing tag, or select main and enable tag creation.')
    tag = supplied if create_from_main else ref
    if not re.fullmatch(r'v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?', tag):
        fail('Invalid tag format; expected vMAJOR.MINOR.PATCH.')
    if '..' in tag or tag.endswith('.'):
        fail('Invalid release tag.')
    if not create_from_main and os.environ.get('GITHUB_EVENT_NAME') == 'workflow_dispatch' and supplied != ref:
        fail(f'The entered release tag {json.dumps(supplied)} must match the selected tag {json.dumps(ref)}.')
    root = Path(__file__).resolve().parents[1]
    version = json.loads((root / 'src-tauri' / 'tauri.conf.json').read_text(encoding='utf-8'))['version']
    if tag != f'v{version}':
        fail(f'The release tag {json.dumps(tag)} does not match application version {json.dumps(version)}.')
    head = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=root, text=True).strip()
    if head != os.environ.get('GITHUB_SHA', ''):
        fail('Checkout does not match the source commit being signed.')
    print(f'Release preflight passed for {tag} at {head}')


if __name__ == '__main__':
    main()
