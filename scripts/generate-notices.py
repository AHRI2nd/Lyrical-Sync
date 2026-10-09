#!/usr/bin/env python3
"""Generate deterministic notices from locked production dependency graphs."""
import hashlib
import json
from pathlib import Path
import subprocess
import tarfile

ROOT = Path(__file__).resolve().parent.parent
TARGETS = {'macOS ARM64': 'aarch64-apple-darwin', 'Windows x64': 'x86_64-pc-windows-msvc'}


def digest(data):
    return hashlib.sha256(data).hexdigest()


def documents(root):
    return sorted(p for p in root.iterdir() if p.is_file() and
                  p.name.lower().startswith(('license', 'licence', 'notice', 'copying', 'copyright')))


def normal_packages(metadata):
    nodes = {n['id']: n for n in metadata['resolve']['nodes']}
    packages = {p['id']: p for p in metadata['packages']}
    seen, pending = set(), [metadata['resolve']['root']]
    while pending:
        key = pending.pop()
        if key in seen:
            continue
        seen.add(key)
        pending.extend(d['pkg'] for d in nodes[key]['deps']
                       if any(k['kind'] is None for k in d['dep_kinds']))
    return [packages[key] for key in seen if packages[key].get('source')]


def main():
    upstream = json.loads((ROOT / 'packaging/licenses/upstream-index.json').read_text())
    inputs = {p: digest((ROOT / p).read_bytes()) for p in (
        'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock', 'package.json', 'package-lock.json',
        'scripts/generate-notices.py', 'packaging/licenses/upstream-index.json')}
    texts, entries = {}, {}

    def add_document(path):
        content = path.read_text(encoding='utf-8').replace('\r\n', '\n').strip() + '\n'
        key = digest(content.encode())
        texts[key] = content
        return key

    for target, triple in TARGETS.items():
        command = ['cargo', 'metadata', '--manifest-path', 'src-tauri/Cargo.toml',
                   '--format-version', '1', '--locked', '--offline', '--filter-platform', triple]
        if target == 'Windows x64':
            command.extend(['--features', 'msstore'])
        metadata = json.loads(subprocess.check_output(command, cwd=ROOT))
        for package in normal_packages(metadata):
            name, version = package['name'], package['version']
            key = f'cargo:{name}@{version}'
            if key in entries:
                entries[key]['targets'].append(target)
                continue
            root = Path(package['manifest_path']).parent
            refs = []
            for path in documents(root):
                refs.append({'text': add_document(path), 'file': path.name})
            for doc in upstream.get(f'{name}@{version}', []):
                path = ROOT / doc['file']
                inputs[doc['file']] = digest(path.read_bytes())
                refs.append({'text': add_document(path), 'source': doc['url']})
            if not refs:
                raise ValueError(f'Missing license text for {key}; add a pinned upstream record')
            vcs = root / '.cargo_vcs_info.json'
            provenance = json.loads(vcs.read_text()) if vcs.exists() else {}
            entries[key] = {'ecosystem': 'cargo', 'name': name, 'version': version,
                            'license': package['license'], 'targets': [target], 'documents': refs,
                            'sourceArchive': f'https://crates.io/api/v1/crates/{name}/{version}/download',
                            'repository': package.get('repository'),
                            'sourceCommit': provenance.get('git', {}).get('sha1')}
            # Do not offer unchanged MPL sources if the actual cached sources were patched.
            if package['license'] == 'MPL-2.0':
                archive = root.parents[2] / 'cache' / root.parent.name / f'{name}-{version}.crate'
                with tarfile.open(archive) as handle:
                    for member in handle.getmembers():
                        if not member.isfile():
                            continue
                        relative = Path(member.name).relative_to(f'{name}-{version}')
                        if relative.suffix in ('.rs', '.c', '.h', '.cpp', '.toml'):
                            if (root / relative).read_bytes() != handle.extractfile(member).read():
                                raise ValueError(f'Modified MPL source requires a source offer: {key}/{relative}')

    lock = json.loads((ROOT / 'package-lock.json').read_text())
    for location, package in lock['packages'].items():
        if not location or package.get('dev') or package.get('devOptional'):
            continue
        root = ROOT / location
        metadata = json.loads((root / 'package.json').read_text())
        name, version = metadata['name'], metadata['version']
        if version != package['version']:
            raise ValueError(f'Installed npm version differs from lock: {name}')
        refs = [{'text': add_document(p), 'file': p.name} for p in documents(root)]
        if not refs:
            raise ValueError(f'Missing npm license text: {name}')
        entries[f'npm:{name}@{version}'] = {
            'ecosystem': 'npm', 'name': name, 'version': version, 'license': metadata['license'],
            'targets': ['Bundled frontend'], 'documents': refs, 'sourceArchive': package.get('resolved')}

    ordered = [entries[k] for k in sorted(entries)]
    output = ['Lyrical Sync — Third-party notices',
              'This document covers normal dependencies for the macOS ARM64 and Windows x64 Store builds,',
              'including supporting proc macros reached through normal dependencies, and the production frontend.',
              'Platform-specific entries are identified below; this is not a claim that every entry runs on both OSes.',
              'Upstream license alternatives remain as declared; all supplied notices and license texts are retained.',
              'MPL-2.0 covered source is available at each exact-version Source archive URL below.',
              'The MPL source files used here match those archives. No source modifications to these components are shipped.',
              'The Windows Fixed WebView2 runtime is separately supplied by Microsoft and retains its own license/notices',
              'inside the complete WebView2 runtime directory. System frameworks are supplied by the OS.', '', 'COMPONENTS', '']
    for entry in ordered:
        output.extend([f"{entry['name']} {entry['version']} ({entry['ecosystem']})",
                       f"License: {entry['license']}", f"Scope: {', '.join(entry['targets'])}",
                       f"Source archive: {entry['sourceArchive']}"])
        if entry.get('repository'):
            output.append(f"Repository: {entry['repository']}")
        if entry.get('sourceCommit'):
            output.append(f"Source revision: {entry['sourceCommit']}")
        for doc in entry['documents']:
            output.append(f"License text: {doc['text']} ({doc.get('file', doc.get('source'))})")
        output.append('')
    output.extend(['LICENSE TEXTS (deduplicated by exact text hash)', ''])
    for key, content in sorted(texts.items()):
        output.extend([f'--- {key} ---', content])
    notice = ('\n'.join(output) + '\n').encode()
    (ROOT / 'src-tauri/ThirdPartyNotices.txt').write_bytes(notice)
    inventory = {'schema': 1, 'inputs': inputs, 'noticeSha256': digest(notice), 'components': ordered}
    (ROOT / 'packaging/licenses/inventory.json').write_text(json.dumps(inventory, indent=2, sort_keys=True) + '\n')
    print(f'Generated {len(ordered)} component entries, {len(texts)} distinct texts, {len(notice)} bytes')


if __name__ == '__main__':
    main()
