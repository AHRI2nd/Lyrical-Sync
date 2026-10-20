import subprocess, sys, os, tarfile, shutil, tempfile, glob

sys.stderr.write("[ctc] patch script started\n")
sys.stderr.flush()

def run_pip(*args):
    proc = subprocess.Popen(
        [sys.executable, "-m", "pip"] + list(args),
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        text=True,
        encoding="utf-8",
        errors="replace",
    )
    for line in proc.stdout:
        sys.stderr.write(line)
        sys.stderr.flush()
    proc.wait()
    return proc.returncode

tmpdir = tempfile.mkdtemp(prefix="ctc_patch_")
try:
    sys.stderr.write("[ctc] downloading source...\n")
    sys.stderr.flush()
    ret = 0  # Rust supplies an already verified source archive.
    if ret != 0:
        sys.stderr.write("[ctc] download failed\n")
        sys.stderr.flush()
        sys.exit(1)

    tarballs = [sys.argv[1]]
    if not tarballs:
        sys.stderr.write("[ctc] no source tarball found\n")
        sys.stderr.flush()
        sys.exit(1)

    extract_dir = os.path.join(tmpdir, "src")
    os.makedirs(extract_dir, exist_ok=True)
    with tarfile.open(tarballs[0], "r:gz") as t:
        t.extractall(extract_dir, filter="data")

    subdirs = [d for d in os.listdir(extract_dir)
               if os.path.isdir(os.path.join(extract_dir, d))]
    if not subdirs:
        sys.stderr.write("[ctc] no source subdirectory found after extraction\n")
        sys.stderr.flush()
        sys.exit(1)
    src_dir = os.path.join(extract_dir, subdirs[0])
    sys.stderr.write("[ctc] source extracted to: " + src_dir + "\n")
    sys.stderr.flush()

    # Patch 1: setup.py — use /std:c++17 for MSVC
    sys.stderr.write("[ctc] patching setup.py...\n")
    sys.stderr.flush()
    p = os.path.join(src_dir, "setup.py")
    txt = open(p, encoding="utf-8").read()
    patched = txt.replace(
        'extra_compile_args=["-std=c++17"],',
        'extra_compile_args=["/std:c++17"] if __import__("sys").platform == "win32" else ["-std=c++17"],'
    )
    if patched == txt:
        raise RuntimeError("setup.py patch target not found")
        sys.stderr.flush()
    open(p, "w", encoding="utf-8").write(patched)

    # Patch 2: main.cpp — add PyInit stub so MSVC linker finds the required export symbol
    sys.stderr.write("[ctc] patching main.cpp...\n")
    sys.stderr.flush()
    p = os.path.join(src_dir, "ctc_forced_aligner", "main.cpp")
    txt = open(p, encoding="utf-8").read()
    stub = ('\n#ifdef _WIN32\n'
            'extern "C" __declspec(dllexport) void* PyInit_align_ops(void) { return (void*)0; }\n'
            '#endif\n')
    open(p, "w", encoding="utf-8").write(txt + stub)

    # Patch 3: ctc_aligner.py — support .pyd extension on Windows
    sys.stderr.write("[ctc] patching ctc_aligner.py...\n")
    sys.stderr.flush()
    p = os.path.join(src_dir, "ctc_forced_aligner", "ctc_aligner.py")
    txt = open(p, encoding="utf-8").read()
    patched = txt.replace(
        'lib_pattern = os.path.join(lib_dir, "align_ops.*.so")  # Matches align_ops.cpython-*.so',
        ('lib_pattern = os.path.join(lib_dir, "align_ops*.pyd") if os.name == "nt" '
         'else os.path.join(lib_dir, "align_ops.*.so")  # .pyd on Windows, .so on Unix')
    )
    if patched == txt:
        raise RuntimeError("ctc_aligner.py patch target not found")
        sys.stderr.flush()
    open(p, "w", encoding="utf-8").write(patched)

    sys.stderr.write("[ctc] building and installing (this may take several minutes)...\n")
    sys.stderr.flush()
    ret = run_pip("install", "--no-build-isolation", "--no-deps", src_dir)
    if ret != 0:
        sys.stderr.write("[ctc] install failed (see above for compiler errors)\n")
        sys.stderr.flush()
        sys.exit(1)

    sys.stderr.write("[ctc] install complete!\n")
    sys.stderr.flush()
except Exception as e:
    import traceback
    sys.stderr.write("[ctc] error: " + str(e) + "\n")
    sys.stderr.flush()
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
finally:
    shutil.rmtree(tmpdir, ignore_errors=True)
