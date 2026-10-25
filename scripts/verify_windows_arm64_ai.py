"""Check bundled Windows ARM64 AI wheels, provenance and native payloads."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct
import zipfile

ROOT=Path(__file__).resolve().parents[1]/'src-tauri/resources/windows-arm64-ai'
EXPECTED={'torchaudio-2.11.0-cp313-cp313-win_arm64.whl',
          'soxr-1.1.0-cp312-abi3-win_arm64.whl',
          'ctc_forced_aligner-1.0.2-cp313-cp313-win_arm64.whl'}


def verify(root=ROOT):
    manifest=json.loads((root/'provenance.json').read_text(encoding='utf-8'))
    entries=manifest['wheels']
    if len(entries)!=3 or {e['file'] for e in entries}!=EXPECTED:
        raise ValueError('Unexpected native wheel inventory')
    results=[]
    for entry in entries:
        path=root/entry['file']
        if hashlib.sha256(path.read_bytes()).hexdigest()!=entry['sha256']:
            raise ValueError(f'Wheel checksum mismatch: {path.name}')
        source=entry['source']
        if not source['url'].startswith('https://') or not re.fullmatch('[0-9a-f]{64}',source['sha256']):
            raise ValueError('Missing source provenance')
        with zipfile.ZipFile(path) as archive:
            names=archive.namelist()
            if not any('.dist-info/licenses/' in name for name in names):
                raise ValueError('Wheel license missing')
            extensions=[name for name in names if name.endswith('.pyd')]
            if not extensions:
                raise ValueError('Native ARM64 extension missing')
            for name in extensions:
                data=archive.read(name)
                if len(data)<64 or data[:2]!=b'MZ':raise ValueError('Invalid PE header')
                offset=struct.unpack_from('<I',data,0x3c)[0]
                if offset+6>len(data) or data[offset:offset+4]!=b'PE\0\0':raise ValueError('Invalid PE header')
                if struct.unpack_from('<H',data,offset+4)[0]!=0xaa64:
                    raise ValueError('Native payload is not ARM64')
        results.append({'file':path.name,'sha256':entry['sha256'],'extensions':extensions})
    return results


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root',type=Path,default=ROOT)
    print(json.dumps(verify(parser.parse_args().root),indent=2))
