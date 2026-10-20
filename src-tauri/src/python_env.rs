use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};

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

use crate::python_runtime::{
    publish_runtime, runtime_complete, runtime_exe, ENV_LOCK, MANIFEST, READY_MARKER, RUNTIME_ID,
};
use sha2::{Digest, Sha256};
use std::path::Path;
use std::time::Duration;

const REQUIREMENTS: &str = include_str!("../requirements-ai.txt");
const RUNTIME_PROBE: &str = "import ssl, ensurepip, venv, ctypes, sqlite3; import sys; assert sys.version_info[:3] == (3, 11, 10)";
const PACKAGE_PROBE: &str = include_str!("probe_ai.py");

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

async fn probe(python: &Path, source: &str) -> bool {
    tokio::time::timeout(
        Duration::from_secs(90),
        python_cmd(python)
            .args(["-c", source])
            .kill_on_drop(true)
            .stdin(std::process::Stdio::null())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .status(),
    )
    .await
    .map(|result| result.map(|status| status.success()).unwrap_or(false))
    .unwrap_or(false)
}

#[tauri::command]
pub async fn get_python_env_info(app: AppHandle) -> Result<PythonEnvInfo, String> {
    let _environment = ENV_LOCK.try_lock().map_err(|_| "AI environment is busy")?;
    let python = embedded_python_exe(&app)?;
    // Legacy runtimes must prove they work; executable existence alone is insufficient.
    let python_ready = python.is_file() && probe(&python, RUNTIME_PROBE).await;
    let packages_ready = python_ready && probe(&python, PACKAGE_PROBE).await;
    Ok(PythonEnvInfo {
        python_ready,
        packages_ready,
        pip_install_cmd: "Install the verified package set using Settings > AI Models".into(),
        python_path: python.to_string_lossy().into_owned(),
    })
}

fn manifest() -> Result<serde_json::Value, String> {
    serde_json::from_str(MANIFEST).map_err(|e| e.to_string())
}
fn platform_key() -> &'static str {
    if cfg!(all(target_os = "macos", target_arch = "aarch64")) {
        "aarch64-apple-darwin"
    } else if cfg!(all(target_os = "macos", target_arch = "x86_64")) {
        "x86_64-apple-darwin"
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else {
        "unsupported"
    }
}

async fn download_verified(
    app: &AppHandle,
    spec: &serde_json::Value,
    path: &Path,
    show_progress: bool,
) -> Result<(), String> {
    use tokio::io::AsyncWriteExt;
    let url = spec["url"].as_str().ok_or("Missing download URL")?;
    let expected = spec["sha256"].as_str().ok_or("Missing download checksum")?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(30))
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client
        .get(url)
        .send()
        .await
        .map_err(|e| e.to_string())?
        .error_for_status()
        .map_err(|e| e.to_string())?;
    let total = response.content_length();
    let mut downloaded = 0u64;
    let mut digest = Sha256::new();
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| e.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        digest.update(&chunk);
        downloaded += chunk.len() as u64;
        file.write_all(&chunk).await.map_err(|e| e.to_string())?;
        if show_progress {
            let percent = total
                .filter(|n| *n > 0)
                .map(|n| (downloaded * 100 / n).min(99) as u32)
                .unwrap_or(0);
            let _ = app.emit(
                "python-download-progress",
                PythonDownloadProgress {
                    percent,
                    done: false,
                },
            );
        }
    }
    if total.is_some_and(|total| total != downloaded)
        || format!("{:x}", digest.finalize()) != expected
    {
        return Err("Download checksum or length mismatch".into());
    }
    file.sync_all().await.map_err(|e| e.to_string())
}

async fn prepare_runtime(app: &AppHandle, stage: &Path) -> Result<(), String> {
    let data = manifest()?;
    let archive = stage.join("python.tar.gz");
    download_verified(app, &data["python"][platform_key()], &archive, true).await?;
    let status = tokio::process::Command::new("tar")
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(stage)
        .kill_on_drop(true)
        .status()
        .await
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err("Python extraction failed".into());
    }
    tokio::fs::remove_file(&archive)
        .await
        .map_err(|e| e.to_string())?;
    if !probe(&runtime_exe(stage), RUNTIME_PROBE).await {
        return Err("Python validation failed".into());
    }
    tokio::fs::write(stage.join(READY_MARKER), RUNTIME_ID)
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn download_embedded_python(app: AppHandle) -> Result<(), String> {
    let _environment = ENV_LOCK.try_lock().map_err(|_| "AI environment is busy")?;
    let destination = embedded_python_dir(&app)?;
    let python = runtime_exe(&destination);
    if python.is_file() && probe(&python, RUNTIME_PROBE).await {
        // Adopt a complete legacy installation without deleting its packages.
        if !runtime_complete(&destination) {
            tokio::fs::write(destination.join(READY_MARKER), RUNTIME_ID)
                .await
                .map_err(|e| e.to_string())?;
        }
    } else {
        let parent = destination.parent().ok_or("Missing data directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let stage = tempfile::tempdir_in(parent).map_err(|e| e.to_string())?;
        prepare_runtime(&app, stage.path()).await?;
        publish_runtime(stage.path(), &destination).map_err(|e| e.to_string())?;
    }
    let _ = app.emit(
        "python-download-progress",
        PythonDownloadProgress {
            percent: 100,
            done: true,
        },
    );
    Ok(())
}

async fn install_step(
    app: &AppHandle,
    command: &mut tokio::process::Command,
) -> Result<(), String> {
    let child = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| e.to_string())?;
    crate::alignment_process::run_child(
        child,
        std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        |line| {
            let _ = app.emit(
                "pip-install-progress",
                PipInstallProgress {
                    line: line.to_owned(),
                    done: false,
                    success: false,
                },
            );
            Ok(())
        },
    )
    .await?;
    Ok(())
}

#[tauri::command]
pub async fn install_python_packages(app: AppHandle) -> Result<(), String> {
    let _environment = ENV_LOCK.try_lock().map_err(|_| "AI environment is busy")?;
    let result = async {
        let destination = embedded_python_dir(&app)?;
        let parent = destination.parent().ok_or("Missing data directory")?;
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        let stage = tempfile::tempdir_in(parent).map_err(|e| e.to_string())?;
        // Build an isolated environment; pip failure never mutates the live runtime.
        prepare_runtime(&app, stage.path()).await?;
        let python = runtime_exe(stage.path());
        let requirements = stage.path().join("requirements-ai.txt");
        tokio::fs::write(&requirements, REQUIREMENTS)
            .await
            .map_err(|e| e.to_string())?;
        install_step(
            &app,
            python_cmd(&python)
                .args([
                    "-m",
                    "pip",
                    "install",
                    "--prefer-binary",
                    "--disable-pip-version-check",
                    "-r",
                ])
                .arg(&requirements),
        )
        .await?;
        let archive = stage.path().join("ctc_forced_aligner-1.0.2.tar.gz");
        download_verified(&app, &manifest()?["aligner"], &archive, false).await?;
        #[cfg(windows)]
        {
            let patch = stage.path().join("install_ctc.py");
            tokio::fs::write(&patch, include_str!("install_ctc.py"))
                .await
                .map_err(|e| e.to_string())?;
            install_step(&app, python_cmd(&python).arg(&patch).arg(&archive)).await?;
        }
        #[cfg(not(windows))]
        install_step(
            &app,
            python_cmd(&python)
                .args(["-m", "pip", "install", "--no-build-isolation", "--no-deps"])
                .arg(&archive),
        )
        .await?;
        install_step(&app, python_cmd(&python).args(["-m", "pip", "check"])).await?;
        if !probe(&python, PACKAGE_PROBE).await {
            return Err("AI package validation failed; previous installation was retained".into());
        }
        let graph = python_cmd(&python)
            .args(["-m", "pip", "freeze", "--all"])
            .kill_on_drop(true)
            .output()
            .await
            .map_err(|e| e.to_string())?;
        if !graph.status.success() {
            return Err("Cannot record installed package versions".into());
        }
        tokio::fs::write(stage.path().join("installed-packages.txt"), graph.stdout)
            .await
            .map_err(|e| e.to_string())?;
        publish_runtime(stage.path(), &destination).map_err(|e| e.to_string())
    }
    .await;
    let _ = app.emit(
        "pip-install-progress",
        PipInstallProgress {
            line: result.as_ref().err().cloned().unwrap_or_default(),
            done: true,
            success: result.is_ok(),
        },
    );
    result
}
