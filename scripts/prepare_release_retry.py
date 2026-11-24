"""Remove only candidate assets from an existing draft before a retry."""
import argparse
import json
from pathlib import Path

from assemble_updater import get_draft_release, gh
from verify_release_provenance import final_name


def prepare(repo, tag, files):
    release = get_draft_release(repo, tag)
    if not release.get('draft'):
        raise ValueError('Only draft releases can be refreshed')
    names = {'latest.json'}
    for path in files:
        name = Path(path).name
        signature = name.endswith('.sig')
        base = name[:-4] if signature else name
        suffix = '.sig' if signature else ''
        names.add(base.replace('Lyrical Sync', 'Lyrical.Sync', 1) + suffix)
        names.add(final_name(base) + suffix)
    for asset in release['assets']:
        if asset['name'] in names:
            gh('api', '--method', 'DELETE', f'repos/{repo}/releases/assets/{asset["id"]}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--tag', required=True)
    parser.add_argument('--files', type=Path)
    args = parser.parse_args()
    files = json.loads(args.files.read_text(encoding='utf-8'))['files'] if args.files else []
    prepare(args.repo, args.tag, files)


if __name__ == '__main__':
    main()
