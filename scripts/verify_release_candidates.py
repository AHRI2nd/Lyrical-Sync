"""Verify every matrix candidate and its recorded file hashes before release upload."""
import argparse
import hashlib
import json
from pathlib import Path


EXPECTED = {
    'aarch64-apple-darwin': {'app', 'dmg'},
    'x86_64-pc-windows-msvc': {'nsis', 'msi'},
    'aarch64-pc-windows-msvc': {'nsis'},
}


def confined_candidate_file(directory, value, label):
    """Resolve a recorded file without allowing it outside its candidate bundle."""
    if not isinstance(value, str) or not value:
        raise ValueError(f'Invalid candidate {label} path')
    relative = Path(value)
    if relative.is_absolute() or '..' in relative.parts:
        raise ValueError(f'Candidate {label} path escapes candidate directory: {value}')
    try:
        # Resolve both file and parent symlinks before hashing or uploading.
        resolved = (directory / relative).resolve()
    except (OSError, RuntimeError) as exc:
        raise ValueError(f'Invalid candidate {label} path: {value}') from exc
    if not resolved.is_relative_to(directory):
        raise ValueError(f'Candidate {label} path escapes candidate directory: {value}')
    return resolved


def verify(root, version, source_sha):
    root = Path(root).resolve()
    records = list(root.rglob('candidate-record.json'))
    by_target = {}
    selected_files = []
    names = set()
    for record_path in records:
        if not record_path.resolve().is_relative_to(root):
            raise ValueError(f'Candidate record escapes release root: {record_path}')
        directory = record_path.parent.resolve()
        record = json.loads(record_path.read_text(encoding='utf-8'))
        target = record.get('target')
        if target not in EXPECTED or target in by_target:
            raise ValueError(f'Unexpected or duplicate candidate target: {target}')
        if record.get('version') != version or record.get('sourceSha') != source_sha:
            raise ValueError(f'Candidate version or source commit mismatch: {target}')
        rows = record.get('installers')
        if (not isinstance(rows, list) or len(rows) != len(EXPECTED[target])
                or any(not isinstance(row, dict) or not isinstance(row.get('kind'), str) for row in rows)
                or {row['kind'] for row in rows} != EXPECTED[target]):
            raise ValueError(f'Candidate artifact set is incomplete: {target}')
        for row in rows:
            artifact = confined_candidate_file(directory, row['path'], 'artifact')
            if not artifact.is_file() or artifact.stat().st_size != row.get('bytes'):
                raise ValueError(f'Missing or changed candidate artifact: {row.get("path")}')
            if hashlib.sha256(artifact.read_bytes()).hexdigest() != row.get('sha256'):
                raise ValueError(f'Candidate artifact hash mismatch: {row["path"]}')
            if artifact.name in names:
                raise ValueError(f'Duplicate release artifact filename: {artifact.name}')
            names.add(artifact.name)
            selected_files.append(artifact)
            if row['kind'] != 'dmg':
                signature = confined_candidate_file(directory, row.get('signaturePath'), 'signature')
                if (not signature.is_file() or not signature.read_text(encoding='utf-8').strip()
                        or hashlib.sha256(signature.read_bytes()).hexdigest() != row.get('signatureSha256')):
                    raise ValueError(f'Missing or changed updater signature sidecar: {row["path"]}')
                if signature.name in names:
                    raise ValueError(f'Duplicate release artifact filename: {signature.name}')
                names.add(signature.name)
                selected_files.append(signature)
        by_target[target] = record
    if set(by_target) != set(EXPECTED):
        raise ValueError('Release matrix is incomplete: ' + ', '.join(sorted(set(EXPECTED) - set(by_target))))
    return sorted(selected_files)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', type=Path, required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--source-sha', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    files = verify(args.root, args.version, args.source_sha)
    args.output.write_text(json.dumps({'files': [str(path) for path in files]}, indent=2) + '\n', encoding='utf-8')
    print(f'Verified {len(files)} release files from {len(EXPECTED)} signed build candidates')


if __name__ == '__main__':
    main()
