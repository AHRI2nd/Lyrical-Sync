"""Rebuild native CPU helper wheels from the reviewed source provenance."""
import argparse
import hashlib
import importlib.metadata as metadata
import json
import os
from pathlib import Path
import sysconfig
import subprocess
import sys
import tarfile
import urllib.request

REPO=Path(__file__).resolve().parents[1]


def run(*args):
    subprocess.run(list(args),check=True)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--work-dir',type=Path,required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if sys.platform!='win32' or sysconfig.get_platform()!='win-arm64' or sys.version_info[:2]!=(3,13):
        raise RuntimeError('Run under native Windows ARM64 CPython 3.13')
    for name,version in {'torch':'2.14.1+cpu','numpy':'2.5.4','setuptools':'84.2.1','wheel':'0.48.0'}.items():
        if metadata.version(name)!=version:raise RuntimeError(f'Unsupported build dependency: {name}')
    work=args.work_dir.resolve();output=args.output.resolve()
    if ' ' in str(work) or len(str(work))>50:
        raise ValueError('Use a short, space-free build directory, e.g. C:\\ls-arm-ai')
    if output==REPO/'src-tauri/resources/windows-arm64-ai':
        raise ValueError('Rebuild outside the reviewed vendored wheel directory')
    work.mkdir(parents=True,exist_ok=True);output.mkdir(parents=True,exist_ok=True)
    os.environ.update(USE_CUDA='0',USE_ROCM='0',BUILD_CUDA_CTC_DECODER='0',
        BUILD_VERSION='2.11.0',PYTORCH_VERSION='2.14.1',MAX_JOBS='2',CMAKE_BUILD_PARALLEL_LEVEL='2')
    os.environ['PATH']=str(Path(sys.executable).parent/'Scripts')+os.pathsep+os.environ.get('PATH','')
    run('cmd.exe','/c','chcp','65001')
    provenance=json.loads((REPO/'src-tauri/resources/windows-arm64-ai/provenance.json').read_text(encoding='utf-8'))
    for entry in provenance['wheels']:
        name=entry['file'].split('-')[0];source=entry['source'];archive=work/(name+'.tar.gz')
        if not archive.exists():
            with urllib.request.urlopen(source['url'],timeout=90) as response,archive.open('wb') as out:
                while chunk:=response.read(1024*1024):out.write(chunk)
        if hashlib.sha256(archive.read_bytes()).hexdigest()!=source['sha256']:
            raise ValueError(f'Source checksum mismatch: {name}')
        if name=='ctc_forced_aligner':
            # Retain the app's reviewed Windows patches; only preserve the built wheel.
            script=(REPO/'src-tauri/src/install_ctc.py').read_text(encoding='utf-8')
            old='ret = run_pip("install", "--no-build-isolation", "--no-deps", src_dir)'
            if script.count(old)!=1:raise ValueError('CTC build script changed; review required')
            replacement='ret = run_pip("wheel", "--no-build-isolation", "--no-deps", "--wheel-dir", '+repr(str(output))+', src_dir)'
            patch=work/'build_ctc.py';patch.write_text(script.replace(old,replacement),encoding='utf-8')
            run(sys.executable,str(patch),str(archive))
        else:
            folder=work/name;folder.mkdir(exist_ok=True)
            with tarfile.open(archive) as tar:tar.extractall(folder,filter='data')
            source_dir=next(p for p in folder.iterdir() if p.is_dir())
            if name=='torchaudio':
                helper=source_dir/'tools/setup_helpers/extension.py'
                text=helper.read_text(encoding='utf-8')
                fix='\n# cl runs under the explicit UTF-8 console selected above.\nimport torch.utils.cpp_extension\ntorch.utils.cpp_extension.SUBPROCESS_DECODE_ARGS = ("utf-8",)\n'
                if fix not in text:helper.write_text(text+fix,encoding='utf-8')
            run(sys.executable,'-m','pip','wheel','--no-build-isolation','--no-deps','--wheel-dir',str(output),str(source_dir))
        wheel=output/entry['file']
        if not wheel.is_file():raise ValueError(f'Expected ARM64 wheel was not built: {wheel.name}')
        entry['sha256']=hashlib.sha256(wheel.read_bytes()).hexdigest()
    (output/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n',encoding='utf-8')
    print('Review new wheel digests before replacing any vendored release artifacts.')


if __name__=='__main__':main()
