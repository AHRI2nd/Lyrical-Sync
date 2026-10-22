"""Fail closed on AI package advisories; send only public package names/versions to OSV."""
import argparse
import importlib.metadata
import json
from pathlib import Path
import re
import sys
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


def query_osv(payload):
    request = urllib.request.Request('https://api.osv.dev/v1/querybatch',
        data=json.dumps(payload).encode(), headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def audit_packages(packages, query=query_osv):
    if not packages:
        raise ValueError('No AI packages to audit')
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
    args = parser.parse_args()
    if args.requirements:
        packages = parse_requirements(args.requirements.read_text())
    else:
        packages = sorted({(d.metadata['Name'], d.version) for d in importlib.metadata.distributions()})
    print(json.dumps(audit_packages(packages)))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
