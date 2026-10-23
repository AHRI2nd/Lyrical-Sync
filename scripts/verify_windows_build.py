"""Verify the compiled app architecture before exposing a Windows installer."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import struct


def pe_machine(path):
    with path.open('rb') as source:
        header=source.read(64)
        if len(header)!=64 or header[:2]!=b'MZ':raise ValueError('Invalid Windows executable')
        offset=struct.unpack_from('<I',header,0x3c)[0]
        source.seek(offset);coff=source.read(6)
    if len(coff)!=6 or coff[:4]!=b'PE\0\0':raise ValueError('Invalid Windows PE header')
    return struct.unpack_from('<H',coff,4)[0]


def verify(binary, installer, architecture, version):
    expected={'arm64':0xaa64,'x64':0x8664}[architecture]
    machine=pe_machine(binary)
    if machine!=expected:raise ValueError('Application architecture does not match release target')
    pattern=r'Lyrical[ .]Sync_'+re.escape(version)+'_'+architecture+r'-setup\.exe'
    if not re.fullmatch(pattern,installer.name):raise ValueError('Installer name does not match release target/version')
    bootstrap=pe_machine(installer)
    # Tauri NSIS uses an x86 bootstrapper for both native application architectures.
    if bootstrap!=0x14c:raise ValueError('Unexpected NSIS bootstrap architecture')
    return {'application':binary.name,'application_machine':hex(machine),
            'installer':installer.name,'installer_machine':hex(bootstrap),
            'installer_sha256':hashlib.sha256(installer.read_bytes()).hexdigest()}


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--binary',type=Path,required=True)
    parser.add_argument('--installer-dir',type=Path,required=True)
    parser.add_argument('--architecture',choices=['arm64','x64'],required=True)
    parser.add_argument('--version',required=True)
    args=parser.parse_args()
    installers=list(args.installer_dir.glob('*.exe'))
    if len(installers)!=1:raise ValueError('Expected one NSIS artifact for this target')
    print(json.dumps(verify(args.binary,installers[0],args.architecture,args.version),indent=2))
