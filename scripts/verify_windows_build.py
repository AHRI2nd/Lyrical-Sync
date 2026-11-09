"""Verify the compiled app architecture before exposing a Windows installer."""
import argparse
import hashlib
import json
from pathlib import Path
import re
import shutil
import struct
import subprocess
import tempfile


def pe_machine(path):
    with path.open('rb') as source:
        header=source.read(64)
        if len(header)!=64 or header[:2]!=b'MZ':raise ValueError('Invalid Windows executable')
        offset=struct.unpack_from('<I',header,0x3c)[0]
        source.seek(offset);coff=source.read(6)
    if len(coff)!=6 or coff[:4]!=b'PE\0\0':raise ValueError('Invalid Windows PE header')
    return struct.unpack_from('<H',coff,4)[0]


def extract_installer_app(installer, destination):
    extractor=shutil.which('7z') or shutil.which('7z.exe')
    if not extractor:raise ValueError('7-Zip is required to inspect the Windows installer payload')
    result=subprocess.run([extractor,'x',str(installer),f'-o{destination}','-y'],capture_output=True,text=True)
    if result.returncode!=0:raise ValueError(f'Could not extract Windows installer payload: {result.stderr.strip()}')
    applications=[path for path in destination.rglob('*') if path.is_file() and path.name.lower()=='lyrical-sync.exe']
    if len(applications)!=1:raise ValueError('Expected exactly one application executable inside the installer')
    return applications[0]


def verify(binary, installer, architecture, version, installer_app=None):
    expected={'arm64':0xaa64,'x64':0x8664}[architecture]
    machine=pe_machine(binary)
    if machine!=expected:raise ValueError('Application architecture does not match release target')
    pattern=r'Lyrical[ .]Sync_'+re.escape(version)+'_'+architecture+r'-setup\.exe'
    if not re.fullmatch(pattern,installer.name):raise ValueError('Installer name does not match release target/version')
    bootstrap=pe_machine(installer)
    # Tauri NSIS uses an x86 bootstrapper for both native application architectures.
    if bootstrap!=0x14c:raise ValueError('Unexpected NSIS bootstrap architecture')
    if installer_app is None:
        with tempfile.TemporaryDirectory(prefix='lyrical-sync-nsis-') as temporary:
            extracted=extract_installer_app(installer,Path(temporary))
            return verify(binary,installer,architecture,version,extracted)
    embedded_machine=pe_machine(installer_app)
    if embedded_machine!=expected:raise ValueError('Installer-contained application architecture does not match release target')
    binary_data=binary.read_bytes()
    installer_data=installer_app.read_bytes()
    unpatched_marker=b'__TAURI_BUNDLE_TYPE_VAR_UNK'
    nsis_marker=b'__TAURI_BUNDLE_TYPE_VAR_NSS'
    if (binary_data.count(unpatched_marker)!=1 or binary_data.count(nsis_marker)!=0
            or installer_data.count(unpatched_marker)!=0 or installer_data.count(nsis_marker)!=1):
        raise ValueError('Unexpected Tauri NSIS bundle marker')
    normalized_installer=installer_data.replace(nsis_marker,unpatched_marker,1)
    if hashlib.sha256(binary_data).digest()!=hashlib.sha256(normalized_installer).digest():
        raise ValueError('Installer does not contain the verified build application')
    return {'application':binary.name,'application_machine':hex(machine),
            'installer':installer.name,'installer_machine':hex(bootstrap),
            'installer_application':installer_app.name,'installer_application_machine':hex(embedded_machine),
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
