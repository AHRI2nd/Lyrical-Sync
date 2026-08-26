use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use serde::Serialize;

// A self-contained Python 3.11 is downloaded once into the app data directory.
// This removes any dependency on the user's system Python / conda / pyenv.

pub fn embedded_python_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| d.join("embedded_python"))
        .map_err(|e| e.to_string())
}

pub fn embedded_python_exe(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = embedded_python_dir(app)?;
    Ok(if cfg!(target_os = "windows") {
        dir.join("python").join("python.exe")
    } else {
        dir.join("python").join("bin").join("python3")
    })
}

/// Creates a Command for the embedded Python, pre-configured to suppress console windows on Windows.
fn python_cmd(python: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(python);
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW: prevents a black CMD console from flashing during Python subprocess spawns.
        cmd.creation_flags(0x08000000);
    }
    cmd
}

/// Like `python_cmd`, but additionally sets ABOVE_NORMAL_PRIORITY_CLASS on Windows.
/// On Intel hybrid CPUs (Alder Lake+), the Windows 11 scheduler and Intel Thread Director
/// use priority class as a hint: ABOVE_NORMAL causes P-cores to be preferred over E-cores,
/// preventing ML inference from being silently throttled to efficiency cores.
pub fn python_cmd_inference(python: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(python);
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW (0x08000000) | ABOVE_NORMAL_PRIORITY_CLASS (0x00008000)
        cmd.creation_flags(0x08008000);
    }
    cmd
}

fn python_standalone_url() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-aarch64-apple-darwin-install_only.tar.gz"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-x86_64-apple-darwin-install_only.tar.gz"
    } else if cfg!(target_os = "windows") {
        "https://github.com/indygreg/python-build-standalone/releases/download/20241016/cpython-3.11.10+20241016-x86_64-pc-windows-msvc-install_only.tar.gz"
    } else {
        "unsupported"
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PythonDownloadProgress {
    percent: u32,
    done: bool,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PipInstallProgress {
    line: String,
    done: bool,
    success: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PythonEnvInfo {
    python_ready: bool,
    packages_ready: bool,
    pip_install_cmd: String,
    python_path: String,
}

#[tauri::command]
pub async fn get_python_env_info(app: AppHandle) -> Result<PythonEnvInfo, String> {
    let python = embedded_python_exe(&app)?;

    let python_ready = python.exists();
    let packages_ready = if python_ready {
        python_cmd(&python)
            .args(["-c", "import onnxruntime, unidecode, demucs; from ctc_forced_aligner import load_audio, generate_emissions, preprocess_text, get_alignments, get_spans, postprocess_results, ensure_onnx_model, Tokenizer"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false)
    } else {
        false
    };

    Ok(PythonEnvInfo {
        python_ready,
        packages_ready,
        pip_install_cmd: format!("\"{}\" -m pip install torch \"ctc-forced-aligner<2\"", python.to_string_lossy()),
        python_path: python.to_string_lossy().into_owned(),
    })
}

/// Downloads python-build-standalone (~20 MB) and extracts it into the app data directory.
/// Emits `python-download-progress` events while downloading.
#[tauri::command]
pub async fn download_embedded_python(app: AppHandle) -> Result<(), String> {
    let python_exe = embedded_python_exe(&app)?;
    if python_exe.exists() {
        return Ok(());
    }

    let dir = embedded_python_dir(&app)?;
    tokio::fs::create_dir_all(&dir).await.map_err(|e| e.to_string())?;

    let url = python_standalone_url();
    if url == "unsupported" {
        return Err("이 플랫폼은 지원되지 않습니다.".to_string());
    }

    // Stream download with progress events
    let tarball_path = dir.join("python.tar.gz");
    let client = reqwest::Client::new();
    let mut resp = client.get(url).send().await.map_err(|e| format!("다운로드 실패: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let total = resp.content_length().unwrap_or(0);
    let mut downloaded: u64 = 0;

    use tokio::io::AsyncWriteExt;
    let mut file = tokio::fs::File::create(&tarball_path).await.map_err(|e| e.to_string())?;
    while let Some(chunk) = resp.chunk().await.map_err(|e| e.to_string())? {
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        downloaded += chunk.len() as u64;
        if total > 0 {
            let _ = app.emit("python-download-progress", PythonDownloadProgress {
                percent: (downloaded * 100 / total) as u32,
                done: false,
            });
        }
    }
    file.flush().await.map_err(|e| e.to_string())?;
    drop(file);

    // Extract tarball
    let status = tokio::process::Command::new("tar")
        .arg("-xzf").arg(&tarball_path).arg("-C").arg(&dir)
        .status()
        .await
        .map_err(|e| e.to_string())?;
    let _ = tokio::fs::remove_file(&tarball_path).await;

    if !status.success() {
        return Err("압축 해제 실패".to_string());
    }

    // Remove macOS quarantine so the binary runs without Gatekeeper prompts
    #[cfg(target_os = "macos")]
    {
        let _ = tokio::process::Command::new("xattr")
            .arg("-rd").arg("com.apple.quarantine").arg(&dir)
            .status()
            .await;
    }

    let _ = app.emit("python-download-progress", PythonDownloadProgress { percent: 100, done: true });
    Ok(())
}

// On Windows, ctc-forced-aligner 1.0.2 has three bugs that prevent a clean install:
//   1. setup.py uses `-std=c++17` (GCC syntax) — MSVC requires `/std:c++17`
//   2. main.cpp has no PyInit_align_ops symbol — MSVC linker emits LNK2001 and aborts
//   3. ctc_aligner.py globs `align_ops.*.so` only — misses the `.pyd` file on Windows
// This script is written to a temp file and executed with the embedded Python to apply
// all three patches to the downloaded source before building and installing.
#[cfg(target_os = "windows")]
const CTC_PATCH_SCRIPT: &str = r#"
import subprocess, sys, os, tarfile, shutil, tempfile, glob

sys.stdout.write("[ctc] patch script started\n")
sys.stdout.flush()

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
        sys.stdout.write(line)
        sys.stdout.flush()
    proc.wait()
    return proc.returncode

tmpdir = tempfile.mkdtemp(prefix="ctc_patch_")
try:
    sys.stdout.write("[ctc] downloading source...\n")
    sys.stdout.flush()
    ret = run_pip("download", "ctc-forced-aligner<2", "--no-deps", "-d", tmpdir)
    if ret != 0:
        sys.stderr.write("[ctc] download failed\n")
        sys.stderr.flush()
        sys.exit(1)

    tarballs = glob.glob(os.path.join(tmpdir, "ctc_forced_aligner-*.tar.gz"))
    if not tarballs:
        sys.stderr.write("[ctc] no source tarball found\n")
        sys.stderr.flush()
        sys.exit(1)

    extract_dir = os.path.join(tmpdir, "src")
    os.makedirs(extract_dir, exist_ok=True)
    with tarfile.open(tarballs[0], "r:gz") as t:
        t.extractall(extract_dir)

    subdirs = [d for d in os.listdir(extract_dir)
               if os.path.isdir(os.path.join(extract_dir, d))]
    if not subdirs:
        sys.stderr.write("[ctc] no source subdirectory found after extraction\n")
        sys.stderr.flush()
        sys.exit(1)
    src_dir = os.path.join(extract_dir, subdirs[0])
    sys.stdout.write("[ctc] source extracted to: " + src_dir + "\n")
    sys.stdout.flush()

    # Patch 1: setup.py — use /std:c++17 for MSVC
    sys.stdout.write("[ctc] patching setup.py...\n")
    sys.stdout.flush()
    p = os.path.join(src_dir, "setup.py")
    txt = open(p, encoding="utf-8").read()
    patched = txt.replace(
        'extra_compile_args=["-std=c++17"],',
        'extra_compile_args=["/std:c++17"] if __import__("sys").platform == "win32" else ["-std=c++17"],'
    )
    if patched == txt:
        sys.stdout.write("[ctc] WARNING: setup.py patch target not found\n")
        sys.stdout.flush()
    open(p, "w", encoding="utf-8").write(patched)

    # Patch 2: main.cpp — add PyInit stub so MSVC linker finds the required export symbol
    sys.stdout.write("[ctc] patching main.cpp...\n")
    sys.stdout.flush()
    p = os.path.join(src_dir, "ctc_forced_aligner", "main.cpp")
    txt = open(p, encoding="utf-8").read()
    stub = ('\n#ifdef _WIN32\n'
            'extern "C" __declspec(dllexport) void* PyInit_align_ops(void) { return (void*)0; }\n'
            '#endif\n')
    open(p, "w", encoding="utf-8").write(txt + stub)

    # Patch 3: ctc_aligner.py — support .pyd extension on Windows
    sys.stdout.write("[ctc] patching ctc_aligner.py...\n")
    sys.stdout.flush()
    p = os.path.join(src_dir, "ctc_forced_aligner", "ctc_aligner.py")
    txt = open(p, encoding="utf-8").read()
    patched = txt.replace(
        'lib_pattern = os.path.join(lib_dir, "align_ops.*.so")  # Matches align_ops.cpython-*.so',
        ('lib_pattern = os.path.join(lib_dir, "align_ops*.pyd") if os.name == "nt" '
         'else os.path.join(lib_dir, "align_ops.*.so")  # .pyd on Windows, .so on Unix')
    )
    if patched == txt:
        sys.stdout.write("[ctc] WARNING: ctc_aligner.py patch target not found\n")
        sys.stdout.flush()
    open(p, "w", encoding="utf-8").write(patched)

    sys.stdout.write("[ctc] building and installing (this may take several minutes)...\n")
    sys.stdout.flush()
    ret = run_pip("install", "--prefer-binary", src_dir)
    if ret != 0:
        sys.stderr.write("[ctc] install failed (see above for compiler errors)\n")
        sys.stderr.flush()
        sys.exit(1)

    sys.stdout.write("[ctc] install complete!\n")
    sys.stdout.flush()
except Exception as e:
    import traceback
    sys.stderr.write("[ctc] error: " + str(e) + "\n")
    sys.stderr.flush()
    traceback.print_exc(file=sys.stderr)
    sys.exit(1)
finally:
    shutil.rmtree(tmpdir, ignore_errors=True)
"#;

/// Streams piped stdout/stderr from a child process as `pip-install-progress` events.
/// Only streams whichever handles are actually piped (Some). Returns true on success.
/// On Windows, grandchild processes may inherit pipe write handles and block EOF;
/// we abort readers 500 ms after process exit to avoid hanging.
async fn stream_pip_child(app: AppHandle, mut child: tokio::process::Child) -> bool {
    use tokio::io::{AsyncBufReadExt, BufReader};

    fn spawn_reader(
        app: AppHandle,
        stream: Option<impl tokio::io::AsyncRead + Send + Unpin + 'static>,
    ) -> Option<tokio::task::JoinHandle<()>> {
        stream.map(|s| {
            tokio::spawn(async move {
                let mut lines = BufReader::new(s).lines();
                while let Ok(Some(line)) = lines.next_line().await {
                    let _ = app.emit("pip-install-progress", PipInstallProgress {
                        line, done: false, success: false,
                    });
                }
            })
        })
    }

    let stdout_handle = spawn_reader(app.clone(), child.stdout.take());
    let stderr_handle = spawn_reader(app.clone(), child.stderr.take());

    let ok = child.wait().await.map(|s| s.success()).unwrap_or(false);
    let _ = tokio::time::timeout(
        std::time::Duration::from_millis(500),
        async {
            if let Some(h) = stdout_handle { let _ = h.await; }
            if let Some(h) = stderr_handle { let _ = h.await; }
        },
    ).await;
    ok
}

/// Installs torch and ctc-forced-aligner into the embedded Python.
/// Streams pip output lines via `pip-install-progress` events.
#[tauri::command]
pub async fn install_python_packages(app: AppHandle) -> Result<(), String> {
    let python = embedded_python_exe(&app)?;
    if !python.exists() {
        return Err("Python이 설치되지 않았습니다.".to_string());
    }

    // Upgrade pip first so wheel resolution is up-to-date.
    let _ = python_cmd(&python)
        .args(["-m", "pip", "install", "--upgrade", "pip"])
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .await;

    // Step 1: install packages that have pre-built wheels everywhere.
    // On Windows, ctc-forced-aligner is handled separately in Step 2 via a patched source build.
    #[cfg(target_os = "windows")]
    let step1: &[&str] = &["torch", "unidecode", "demucs"];
    #[cfg(not(target_os = "windows"))]
    let step1: &[&str] = &["torch", "ctc-forced-aligner<2", "unidecode", "demucs"];

    // pip writes all output to stderr in modern versions; stdout is empty.
    // Capturing only stderr eliminates duplicate lines (pip sometimes writes to both).
    // --no-warn-script-location suppresses the "Scripts not on PATH" noise.
    let child1 = python_cmd(&python)
        .args(["-m", "pip", "install", "--prefer-binary", "--no-warn-script-location"])
        .args(step1)
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("pip 실행 실패: {e}"))?;

    let ok1 = stream_pip_child(app.clone(), child1).await;

    // Step 2 (Windows only): patch ctc-forced-aligner source and install.
    #[cfg(target_os = "windows")]
    let ok2 = {
        let _ = app.emit("pip-install-progress", PipInstallProgress {
            line: "── Building ctc-forced-aligner from source. This may take 3-5 minutes... ──".to_string(),
            done: false,
            success: false,
        });

        let script_path = std::env::temp_dir().join("lyrical_sync_ctc_patch.py");
        tokio::fs::write(&script_path, CTC_PATCH_SCRIPT)
            .await
            .map_err(|e| format!("패치 스크립트 쓰기 실패: {e}"))?;

        let child2 = python_cmd(&python)
            .arg("-u")
            .arg(&script_path)
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("패치 스크립트 실행 실패: {e}"))?;

        stream_pip_child(app.clone(), child2).await
    };
    #[cfg(not(target_os = "windows"))]
    let ok2 = true;

    let success = ok1 && ok2;

    // On Windows, pip may return a non-zero exit code due to post-install hook
    // failures or transient file-system locks even when all package files were
    // written successfully.  Verify by actually importing the packages so we
    // don't show a false-positive error to the user.
    #[cfg(target_os = "windows")]
    let success = if success { true } else {
        python_cmd(&python)
            .args(["-c", "import onnxruntime, unidecode, demucs; from ctc_forced_aligner import load_audio, generate_emissions, preprocess_text, get_alignments, get_spans, postprocess_results, ensure_onnx_model, Tokenizer"])
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status()
            .await
            .map(|s| s.success())
            .unwrap_or(false)
    };

    let _ = app.emit("pip-install-progress", PipInstallProgress {
        line: String::new(),
        done: true,
        success,
    });

    if success { Ok(()) } else { Err("패키지 설치에 실패했습니다.".to_string()) }
}
