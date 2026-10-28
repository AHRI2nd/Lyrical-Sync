"""Publish one complete, architecture-specific updater manifest after all builds."""
import argparse
import base64
from datetime import datetime, timezone
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import quote


def assemble_manifest(version, repo, assets, signatures, published_at):
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?', version):
        raise ValueError('Invalid application version')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', repo):
        raise ValueError('Invalid repository')
    windows = re.compile(r'Lyrical[ .]Sync_' + re.escape(version)
        + r'_(x64|arm64|aarch64)(-setup\.exe|_setup\.msi|\.msi|_[a-z]{2}-[A-Z]{2}\.msi)')
    macos = re.compile(r'Lyrical[ .]Sync(?:_' + re.escape(version)
        + r')?_(?:aarch64|arm64)\.app\.tar\.gz')
    platforms = {}
    names = [asset['name'] for asset in assets]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate release asset')
    for name in names:
        match = windows.fullmatch(name)
        if match:
            arch = 'x86_64' if match[1] == 'x64' else 'aarch64'
            installer = 'nsis' if match[2] == '-setup.exe' else 'msi'
            if arch == 'aarch64' and installer == 'msi':
                raise ValueError('ARM64 MSI is not a supported release artifact')
            key = f'windows-{arch}-{installer}'
        elif macos.fullmatch(name):
            key = 'darwin-aarch64'
        else:
            continue
        if key in platforms:
            raise ValueError(f'Duplicate updater target: {key}')
        signature = signatures.get(name + '.sig', '').strip()
        if name + '.sig' not in names:
            raise ValueError(f'Missing signature asset: {name}')
        try:
            decoded = base64.b64decode(signature, validate=True)
        except (ValueError, TypeError) as error:
            raise ValueError(f'Invalid signature: {name}') from error
        if not decoded.startswith(b'untrusted comment:'):
            raise ValueError(f'Invalid signature: {name}')
        platforms[key] = {
            'url': f'https://github.com/{repo}/releases/download/v{version}/{quote(name, safe="")}',
            'signature': signature,
        }
    required = {'darwin-aarch64', 'windows-x86_64-nsis',
                'windows-x86_64-msi', 'windows-aarch64-nsis'}
    missing = required - platforms.keys()
    if missing:
        raise ValueError('Missing updater targets: ' + ', '.join(sorted(missing)))
    # Preserve the legacy x64 generic MSI route and each installer's explicit route.
    platforms['darwin-aarch64-app'] = platforms['darwin-aarch64'].copy()
    platforms['windows-x86_64'] = platforms['windows-x86_64-msi'].copy()
    platforms['windows-aarch64'] = platforms['windows-aarch64-nsis'].copy()
    return {'version': version, 'notes': f'Lyrical Sync v{version}',
            'pub_date': published_at, 'platforms': platforms}


def gh(*args, binary=False):
    return subprocess.check_output(['gh', *args], text=not binary)


def get_draft_release(repo, tag):
    # GitHub's /releases/tags/{tag} endpoint only returns published releases.
    # Draft releases must be found through the authenticated releases list.
    query = f'.[] | select(.tag_name == {json.dumps(tag)} and .draft == true)'
    result = gh('api', '--paginate', f'repos/{repo}/releases?per_page=100',
        '--jq', query)
    if not result.strip():
        raise ValueError(f'No draft release found for tag {tag}')
    return json.loads(result)


def publish(repo, version, output):
    tag = 'v' + version
    release = get_draft_release(repo, tag)
    if not release.get('draft'):
        raise ValueError('Updater assembly only modifies a draft release')
    # Normalize this version's x64 MSI name, retaining compatibility with older locale-suffixed builds.
    old_pattern = re.compile(r'(Lyrical[ .]Sync_' + re.escape(version)
                             + r'_x64)(?:_[a-z]{2}-[A-Z]{2})?\.msi')
    source_names = set()
    for asset in release['assets']:
        name = asset['name'][:-4] if asset['name'].endswith('.sig') else asset['name']
        if old_pattern.fullmatch(name):
            source_names.add(name)
    if len(source_names) > 1:
        raise ValueError('Ambiguous legacy MSI assets; refusing to rename or delete assets')

    assets_by_name = {asset['name']: asset for asset in release['assets']}
    for source_name in source_names:
        match = old_pattern.fullmatch(source_name)
        new_name = match[1] + '_setup.msi'
        source_signature = source_name + '.sig'
        new_signature = new_name + '.sig'
        old_installer = source_name in assets_by_name
        old_signature = source_signature in assets_by_name
        new_installer = new_name in assets_by_name
        new_signature_exists = new_signature in assets_by_name

        if new_installer and new_signature_exists:
            if old_installer or old_signature:
                raise ValueError(f'Ambiguous duplicate MSI asset pair: {new_name}')
            continue
        if old_installer and old_signature and not new_installer and not new_signature_exists:
            renames = [(source_name, new_name), (source_signature, new_signature)]
        elif new_installer and old_signature and not old_installer and not new_signature_exists:
            renames = [(source_signature, new_signature)]
        elif old_installer and new_signature_exists and not old_signature and not new_installer:
            renames = [(source_name, new_name)]
        else:
            raise ValueError(f'Incomplete or ambiguous MSI asset pair: {new_name}')

        for source, destination in renames:
            asset = assets_by_name[source]
            gh('api', '--method', 'PATCH',
               f'repos/{repo}/releases/assets/{asset["id"]}',
               '-f', f'name={destination}')
            asset['name'] = destination
            del assets_by_name[source]
            assets_by_name[destination] = asset
    release = get_draft_release(repo, tag)
    signatures = {}
    for asset in release['assets']:
        if asset['name'].endswith('.sig'):
            signatures[asset['name']] = gh('api',
                f'repos/{repo}/releases/assets/{asset["id"]}',
                '-H', 'Accept: application/octet-stream', binary=True).decode('utf-8')
    manifest = assemble_manifest(version, repo, release['assets'], signatures,
        datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))
    output.write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    gh('release', 'upload', tag, str(output), '--repo', repo, '--clobber')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--repo', required=True)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, default=Path('latest.json'))
    args = parser.parse_args()
    publish(args.repo, args.version, args.output)


if __name__ == '__main__':
    main()
