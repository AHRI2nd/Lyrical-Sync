"""Compare final draft assets with verified candidates and check provenance."""
import argparse
import re
import subprocess
import tempfile
from pathlib import Path

from assemble_updater import get_draft_release, gh
from verify_release_candidates import sha256_file, verify


def final_name(name):
    if name.startswith('Lyrical Sync'):
        name = 'Lyrical.Sync' + name[len('Lyrical Sync'):]
    return re.sub(r'_x64(?:_[a-z]{2}-[A-Z]{2})?\.msi$', '_x64_setup.msi', name)


def check_downloads(directory, expected):
    normalized = {final_name(name): digest for name, digest in expected.items()}
    if len(normalized) != len(expected):
        raise ValueError('Candidate names collide after normalization')
    actual = {p.name: p for p in directory.iterdir() if p.is_file()}
    if set(actual) != set(normalized):
        raise ValueError('Final installer set does not match candidates')
    for name, digest in normalized.items():
        if sha256_file(actual[name]) != digest:
            raise ValueError(f'Final installer hash mismatch: {name}')


def verify_attestation(path, repo, source_sha):
    subprocess.run(['gh', 'attestation', 'verify', str(path), '--repo', repo,
                    '--signer-workflow', f'{repo}/.github/workflows/release.yml',
                    '--source-digest', source_sha], check=True)


def verify_draft(root, version, source_sha, repo):
    candidates = [path for path in verify(root, version, source_sha) if not path.name.endswith('.sig')]
    expected = {path.name: sha256_file(path) for path in candidates}
    normalized = {final_name(name) for name in expected}
    release = get_draft_release(repo, 'v' + version)
    assets = release['assets']
    installer_assets = [asset for asset in assets if asset['name'].endswith(('.dmg', '.exe', '.msi', '.app.tar.gz'))]
    if len(installer_assets) != len(normalized) or {asset['name'] for asset in installer_assets} != normalized:
        raise ValueError('Draft installer set does not match candidates')
    with tempfile.TemporaryDirectory(prefix='release-provenance-') as temp:
        directory = Path(temp)
        for asset in installer_assets:
            gh('api', f'repos/{repo}/releases/assets/{asset["id"]}',
               '-H', 'Accept: application/octet-stream', output=directory / asset['name'])
        check_downloads(directory, expected)
        for name in sorted(normalized):
            verify_attestation(directory / name, repo, source_sha)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--repo', required=True)
    args = parser.parse_args()
    verify_draft(args.root, args.version, args.source_sha, args.repo)


if __name__ == '__main__':
    main()
