"""Inventory signed candidate files without creating tags or releases."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re


def record(root, target, source_sha, version):
    root=Path(root)
    if not re.fullmatch(r'[0-9a-f]{40}',source_sha):
        raise ValueError('Candidate source must be an exact commit SHA')
    if not re.fullmatch(r'\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?',version):
        raise ValueError('Invalid candidate version')
    files=[p for p in root.rglob('*') if p.is_file()]
    installers=[]
    def add(path,kind,require_signature=True):
        row={'path':path.relative_to(root).as_posix(),'kind':kind,'bytes':path.stat().st_size,
             'sha256':hashlib.sha256(path.read_bytes()).hexdigest()}
        if require_signature:
            sig=Path(str(path)+'.sig')
            if not sig.is_file() or not sig.read_text().strip():
                raise ValueError(f'Missing candidate updater signature: {path.name}')
            row['signaturePath']=sig.relative_to(root).as_posix()
            row['signatureSha256']=hashlib.sha256(sig.read_bytes()).hexdigest()
        installers.append(row)
    if target=='aarch64-apple-darwin':
        archives=[p for p in files if p.name.endswith('.app.tar.gz')]
        dmgs=[p for p in files if p.suffix=='.dmg']
        if len(archives)!=1 or len(dmgs)!=1:
            raise ValueError('Expected exactly one Mac updater archive and DMG')
        add(archives[0],'app');add(dmgs[0],'dmg',False)
    elif target in ('x86_64-pc-windows-msvc','aarch64-pc-windows-msvc'):
        arch='x64' if target.startswith('x86_64') else 'arm64'
        prefix=r'Lyrical[ .]Sync_'+re.escape(version)+'_'+arch
        nsis=[p for p in files if re.fullmatch(prefix+r'-setup\.exe',p.name)]
        if len(nsis)!=1:raise ValueError('Expected exactly one matching NSIS installer')
        add(nsis[0],'nsis')
        if arch=='x64':
            msi=[p for p in files if re.fullmatch(prefix+r'(?:_[a-z]{2}-[A-Z]{2}|_setup)\.msi',p.name)]
            if len(msi)!=1:raise ValueError('Expected exactly one x64 MSI installer')
            add(msi[0],'msi')
    else:
        raise ValueError('Unsupported candidate target')
    if target.endswith('windows-msvc'):
        selected={row['path'] for row in installers}
        unexpected=[p for p in files if re.fullmatch(r'Lyrical[ .]Sync_.*(?:-setup\.exe|\.msi)',p.name)
                    and p.relative_to(root).as_posix() not in selected]
        if unexpected:raise ValueError('Unexpected architecture or version installer in candidate bundle')
    return {'sourceSha':source_sha,'version':version,'target':target,'installers':installers,
            'qualification':'Updater signature presence and hashes only; cryptographic and OS signature acceptance must be verified separately'}


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--target',required=True)
    args=p.parse_args()
    repo=Path(__file__).resolve().parents[1]
    version=json.loads((repo/'src-tauri/tauri.conf.json').read_text())['version']
    root=repo/'src-tauri/target'/args.target/'release/bundle'
    result=record(root,args.target,os.environ['GITHUB_SHA'],version)
    (root/'candidate-record.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps({'sourceSha':result['sourceSha'],'target':args.target,'installers':len(result['installers'])}))

if __name__=='__main__':main()
