"""Fail closed on AI package advisories; send only public package names/versions to OSV."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import re
import sys
import tempfile
from urllib.parse import unquote, urlsplit
import urllib.request


def parse_requirements(source):
    packages = []
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = re.fullmatch(r'([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+!-]+)', line)
        if not match:
            raise ValueError('AI requirements must use unconditional exact versions')
        packages.append(match.groups())
    if not packages:
        raise ValueError('No AI packages to audit')
    return packages


def normalize_name(name):
    return re.sub(r'[-_.]+', '-', name).lower()


def parse_install_report(report):
    if not isinstance(report, dict) or report.get('version') != '1' or not isinstance(report.get('install'), list) or not report['install']:
        raise ValueError('Invalid or empty pip install report')
    packages = {}
    for item in report['install']:
        if not isinstance(item, dict):
            raise ValueError('Invalid pip install report entry')
        metadata = item.get('metadata')
        download = item.get('download_info')
        if not isinstance(metadata, dict) or not isinstance(download, dict):
            raise ValueError('Incomplete pip install report entry')
        url = download.get('url')
        if not isinstance(url, str) or not unquote(urlsplit(url).path).lower().endswith('.whl'):
            raise ValueError('Resolved AI dependencies must be wheels')
        name = metadata.get('name')
        version = metadata.get('version')
        if not isinstance(name, str) or not re.fullmatch(r'[A-Za-z0-9_.-]+', name):
            raise ValueError('Invalid package name in pip install report')
        if not isinstance(version, str) or not re.fullmatch(r'[A-Za-z0-9_.+!-]+', version):
            raise ValueError(f'Invalid version for {name} in pip install report')
        archive = download.get('archive_info')
        hashes = archive.get('hashes') if isinstance(archive, dict) else None
        digest = hashes.get('sha256') if isinstance(hashes, dict) else None
        if not isinstance(digest, str) or not re.fullmatch(r'[0-9a-fA-F]{64}', digest):
            raise ValueError(f'Missing or invalid SHA-256 for {name}=={version}')
        package_key = normalize_name(name)
        record = (name, version, digest.lower())
        previous = packages.get(package_key)
        if previous and previous != record:
            raise ValueError(f'Pip install report contains conflicting entries for {name}')
        packages[package_key] = record
    return sorted(packages.values(), key=lambda item: normalize_name(item[0]))


def render_hashed_requirements(packages):
    if not packages:
        raise ValueError('No resolved AI packages to lock')
    return ''.join(f'{name}=={version} --hash=sha256:{digest}\n' for name, version, digest in packages)


def parse_hashed_requirements(source):
    packages = []
    names = set()
    pattern = re.compile(r'([A-Za-z0-9_.-]+)==([A-Za-z0-9_.+!-]+)\s+--hash=sha256:([0-9a-fA-F]{64})')
    for line in source.splitlines():
        line = line.strip()
        if not line or line.startswith('#'):
            continue
        match = pattern.fullmatch(line)
        if not match:
            raise ValueError('AI lock entries must pin one exact version and SHA-256 hash')
        name, version, digest = match.groups()
        key = normalize_name(name)
        if key in names:
            raise ValueError(f'duplicate package in AI lock: {name}')
        names.add(key)
        packages.append((name, version, digest.lower()))
    if not packages:
        raise ValueError('No locked AI packages to audit')
    return packages


def require_direct_requirements(lock_packages, requirements):
    resolved = {(normalize_name(name), version) for name, version, _ in lock_packages}
    missing = [(name, version) for name, version in requirements if (normalize_name(name), version) not in resolved]
    if missing:
        raise ValueError('AI lock omitted direct requirements: ' + ', '.join(f'{name}=={version}' for name, version in missing))


def atomic_write(path, content):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(content)
            handle.flush()
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def query_osv(payload):
    request = urllib.request.Request('https://api.osv.dev/v1/querybatch',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def audit_packages(packages, query=query_osv):
    if not packages:
        raise ValueError('No AI packages to audit')
    packages = [(name, version.split('+', 1)[0] if name.lower().replace('_', '-') in ('torch', 'torchaudio') else version)
                for name, version in packages]
    findings = []
    for start in range(0, len(packages), 100):
        batch = packages[start:start + 100]
        result = query({'queries': [{'package': {'ecosystem': 'PyPI', 'name': name}, 'version': version} for name, version in batch]})
        results = result.get('results') if isinstance(result, dict) else None
        if not isinstance(results, list) or len(results) != len(batch):
            raise ValueError('Incomplete OSV response; installation was not approved')
        for (name, version), item in zip(batch, results):
            if not isinstance(item, dict) or 'error' in item or not isinstance(item.get('vulns', []), list):
                raise ValueError('Invalid OSV response; installation was not approved')
            for vuln in item.get('vulns', []):
                if not isinstance(vuln, dict) or not isinstance(vuln.get('id'), str):
                    raise ValueError('Invalid OSV advisory')
                findings.append(f'{name}=={version}: {vuln["id"]}')
    if findings:
        raise ValueError('AI dependency advisories: ' + '; '.join(findings))
    return {'packages': len(packages), 'vulnerabilities': [], 'source': 'OSV'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--requirements', type=Path)
    group.add_argument('--installed', action='store_true')
    group.add_argument('--report', type=Path)
    group.add_argument('--locked-requirements', type=Path)
    parser.add_argument('--source-requirements', type=Path)
    parser.add_argument('--extra-package', action='append', default=[])
    parser.add_argument('--lock-output', type=Path)
    args = parser.parse_args()
    if args.requirements:
        if args.source_requirements or args.extra_package or args.lock_output:
            raise ValueError('Report/lock options require --report or --locked-requirements')
        packages = parse_requirements(args.requirements.read_text(encoding="utf-8"))
        lock_packages = None
    elif args.locked_requirements:
        if not args.source_requirements or args.lock_output:
            raise ValueError('Static lock audit requires --source-requirements and forbids --lock-output')
        lock_packages = parse_hashed_requirements(args.locked_requirements.read_text(encoding='utf-8'))
        direct = parse_requirements(args.source_requirements.read_text(encoding='utf-8'))
        require_direct_requirements(lock_packages, direct)
        packages = [(name, version) for name, version, _ in lock_packages]
        for requirement in args.extra_package:
            packages.extend(parse_requirements(requirement))
    elif args.report:
        if not args.source_requirements or not args.lock_output:
            raise ValueError('Pip report audit requires --source-requirements and --lock-output')
        report = json.loads(args.report.read_text(encoding='utf-8'))
        lock_packages = parse_install_report(report)
        direct = parse_requirements(args.source_requirements.read_text(encoding='utf-8'))
        require_direct_requirements(lock_packages, direct)
        packages = [(name, version) for name, version, _ in lock_packages]
        for requirement in args.extra_package:
            packages.extend(parse_requirements(requirement))
    else:
        if args.source_requirements or args.extra_package or args.lock_output:
            raise ValueError('Report/lock options require --report or --locked-requirements')
        packages = sorted({(d.metadata['Name'], d.version) for d in importlib.metadata.distributions()})
        lock_packages = None
    result = audit_packages(packages)
    if args.report and lock_packages is not None:
        atomic_write(args.lock_output, render_hashed_requirements(lock_packages))
    print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
