use serde::Serialize;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const PYTHON_EXTRACTION_TIMEOUT: Duration = Duration::from_secs(10 * 60);
const MAX_VERIFIED_DOWNLOAD_BYTES: u64 = 2 * 1024 * 1024 * 1024;

// A verified self-contained Python is downloaded into an architecture-specific directory.
// This removes any dependency on the user's system Python / conda / pyenv.

pub fn embedded_python_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|d| {
            crate::platform_profile::python_root(&d, std::env::consts::OS, std::env::consts::ARCH)
        })
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
    isolate_python_environment(&mut cmd);
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW: prevents a black CMD console from flashing during Python subprocess spawns.
        cmd.creation_flags(0x08000000);
    }
    #[cfg(unix)]
    cmd.process_group(0);
    cmd
}

/// Like `python_cmd`, but additionally sets ABOVE_NORMAL_PRIORITY_CLASS on Windows.
/// On Intel hybrid CPUs (Alder Lake+), the Windows 11 scheduler and Intel Thread Director
/// use priority class as a hint: ABOVE_NORMAL causes P-cores to be preferred over E-cores,
/// preventing ML inference from being silently throttled to efficiency cores.
pub fn python_cmd_inference(python: impl AsRef<std::ffi::OsStr>) -> tokio::process::Command {
    #[allow(unused_mut)]
    let mut cmd = tokio::process::Command::new(python);
    isolate_python_environment(&mut cmd);
    #[cfg(target_os = "windows")]
    {
        // CREATE_NO_WINDOW (0x08000000) | ABOVE_NORMAL_PRIORITY_CLASS (0x00008000)
        cmd.creation_flags(0x08008000);
    }
    #[cfg(unix)]
    cmd.process_group(0);
    cmd
}

fn isolate_python_environment(command: &mut tokio::process::Command) {
    for variable in [
        "PYTHONHOME",
        "PYTHONPATH",
        "PYTHONUSERBASE",
        "PYTHONSTARTUP",
        "PYTHONEXECUTABLE",
        "PYTHONWARNINGS",
    ] {
        command.env_remove(variable);
    }
    command
        .env("PYTHONNOUSERSITE", "1")
        .env("PYTHONSAFEPATH", "1");
}

use crate::python_runtime::{
    publish_runtime, recover_runtime, runtime_complete, runtime_exe, try_lock_environment, MANIFEST,
    READY_MARKER, RUNTIME_ID,
};
use sha2::{Digest, Sha256};
use std::path::Path;
const INSTALL_STEP_TIMEOUT: Duration = Duration::from_secs(60 * 60);
const MAX_PROGRESS_LINE_BYTES: usize = 4096;

fn bounded_progress_line(line: &str) -> String {
    if line.len() <= MAX_PROGRESS_LINE_BYTES {
        return line.to_owned();
    }
    let mut end = MAX_PROGRESS_LINE_BYTES;
    while !line.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}... [truncated]", &line[..end])
}

#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
const REQUIREMENTS: &str = include_str!("../requirements-ai.txt");
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const REQUIREMENTS: &str = include_str!("../requirements-ai-windows-arm64.txt");
#[cfg(target_os = "macos")]
const RUNTIME_PROBE: &str = concat!("EXPECTED_PLATFORM = 'macos-arm64'\n", include_str!("probe_runtime.py"));
#[cfg(all(target_os = "windows", target_arch = "x86_64"))]
const RUNTIME_PROBE: &str = concat!("EXPECTED_PLATFORM = 'win-amd64'\n", include_str!("probe_runtime.py"));
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const RUNTIME_PROBE: &str = concat!("EXPECTED_PLATFORM = 'win-arm64'\n", include_str!("probe_runtime.py"));
#[cfg(not(any(target_os = "macos", target_os = "windows")))]
const RUNTIME_PROBE: &str = "raise RuntimeError('Unsupported embedded Python platform')";
#[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
const PACKAGE_PROBE: &str = include_str!("probe_ai.py");
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const PACKAGE_PROBE: &str = concat!(
    r#"import sys, sysconfig
if sys.platform != "win32" or sysconfig.get_platform() != "win-arm64":
    raise RuntimeError("Windows ARM64 requires a native interpreter")
"#,
    include_str!("probe_ai.py")
);

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

pub async fn packages_ready(python: &Path) -> bool {
    probe(python, RUNTIME_PROBE).await && probe(python, PACKAGE_PROBE).await
}

async fn probe(python: &Path, source: &str) -> bool {
    let mut command = python_cmd(python);
    command
        .args(["-c", source])
        .kill_on_drop(true)
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null());
    let child = match command.spawn() {
        Ok(child) => child,
        Err(_) => return false,
    };
    wait_probe_child(child, Duration::from_secs(90)).await
}

async fn wait_probe_child(mut child: tokio::process::Child, timeout: Duration) -> bool {
    let pid = child.id();
    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => status.success(),
        Ok(Err(_)) | Err(_) => {
            if let Some(pid) = pid {
                crate::alignment_process::terminate_process_tree(pid).await;
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            false
        }
    }
}

#[tauri::command]
pub async fn get_python_env_info(app: AppHandle) -> Result<PythonEnvInfo, String> {
    let runtime_root = embedded_python_dir(&app)?;
    let _environment = try_lock_environment(&runtime_root)?;
    recover_runtime(&runtime_root).map_err(|error| error.to_string())?;
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
    } else if cfg!(all(target_os = "windows", target_arch = "x86_64")) {
        "x86_64-pc-windows-msvc"
    } else if cfg!(all(target_os = "windows", target_arch = "aarch64")) {
        "aarch64-pc-windows-msvc"
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
    if total.is_some_and(|total| total > MAX_VERIFIED_DOWNLOAD_BYTES) {
        return Err(format!(
            "Verified AI artifact exceeds the {MAX_VERIFIED_DOWNLOAD_BYTES}-byte size limit"
        ));
    }
    let mut downloaded = 0u64;
    let mut digest = Sha256::new();
    let mut file = tokio::fs::File::create(path)
        .await
        .map_err(|e| e.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        let chunk_size = u64::try_from(chunk.len())
            .map_err(|_| "AI artifact chunk size overflow".to_string())?;
        downloaded = checked_verified_download_bytes(downloaded, chunk_size)?;
        digest.update(&chunk);
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

fn checked_verified_download_bytes(current: u64, additional: u64) -> Result<u64, String> {
    let total = current
        .checked_add(additional)
        .ok_or_else(|| "AI artifact download size overflow".to_string())?;
    if total > MAX_VERIFIED_DOWNLOAD_BYTES {
        return Err(format!(
            "Verified AI artifact exceeds the {MAX_VERIFIED_DOWNLOAD_BYTES}-byte size limit"
        ));
    }
    Ok(total)
}

async fn prepare_runtime(app: &AppHandle, stage: &Path) -> Result<(), String> {
    let data = manifest()?;
    let archive = stage.join("python.tar.gz");
    download_verified(app, &data["python"][platform_key()], &archive, true).await?;
    let mut command = tokio::process::Command::new("tar");
    command
        .arg("-xzf")
        .arg(&archive)
        .arg("-C")
        .arg(stage)
        .kill_on_drop(true);
    #[cfg(unix)]
    command.process_group(0);
    #[cfg(windows)]
    command.creation_flags(0x08000000);
    let child = command.spawn().map_err(|error| error.to_string())?;
    let status = wait_for_runtime_extraction(child, PYTHON_EXTRACTION_TIMEOUT).await?;
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

async fn wait_for_runtime_extraction(
    mut child: tokio::process::Child,
    timeout: Duration,
) -> Result<std::process::ExitStatus, String> {
    let pid = child.id();
    match tokio::time::timeout(timeout, child.wait()).await {
        Ok(Ok(status)) => Ok(status),
        Ok(Err(error)) => {
            if let Some(pid) = pid {
                crate::alignment_process::terminate_process_tree(pid).await;
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err(format!("Python extraction failed: {error}"))
        }
        Err(_) => {
            if let Some(pid) = pid {
                crate::alignment_process::terminate_process_tree(pid).await;
            }
            let _ = child.kill().await;
            let _ = child.wait().await;
            Err("Python extraction timed out".into())
        }
    }
}

#[tauri::command]
pub async fn download_embedded_python(app: AppHandle) -> Result<(), String> {
    let destination = embedded_python_dir(&app)?;
    let _environment = try_lock_environment(&destination)?;
    recover_runtime(&destination).map_err(|error| error.to_string())?;
    let python = runtime_exe(&destination);
    if python.is_file() && probe(&python, RUNTIME_PROBE).await {
        // Adopt a complete legacy installation without deleting its packages.
        if !runtime_complete(&destination) {
            tokio::fs::write(destination.join(READY_MARKER), RUNTIME_ID)
                .await
                .map_err(|e| e.to_string())?;
        }
    } else {
        // Upgrade the interpreter and packages together; never publish a bare replacement.
        install_python_packages_unlocked(app.clone()).await?;
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
    let cancel = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    crate::alignment_process::run_child_with_timeout(
        child,
        cancel.clone(),
        INSTALL_STEP_TIMEOUT,
        |line| {
            let _ = app.emit(
                "pip-install-progress",
                PipInstallProgress {
                    line: bounded_progress_line(line),
                    done: false,
                    success: false,
                },
            );
            Ok(())
        },
    )
    .await
    .map_err(|error| if error == "Python process timed out" {
        "Python package installation step timed out; the previous runtime was retained".into()
    } else {
        error
    })?;
    Ok(())
}

#[tauri::command]
pub async fn install_python_packages(app: AppHandle) -> Result<(), String> {
    let runtime_root = embedded_python_dir(&app)?;
    let _environment = try_lock_environment(&runtime_root)?;
    recover_runtime(&runtime_root).map_err(|error| error.to_string())?;
    install_python_packages_unlocked(app).await
}

// The caller holds the environment lock for the entire staging, validation and publication transaction.
async fn install_python_packages_unlocked(app: AppHandle) -> Result<(), String> {
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
        let mut packages = python_cmd(&python);
        packages
            .args([
                "-m",
                "pip",
                "--isolated",
                "install",
                "--prefer-binary",
                "--disable-pip-version-check",
                "-r",
            ])
            .arg(&requirements);
        #[cfg(all(target_os = "windows", target_arch = "aarch64"))]
        {
            // Explicit local wheel inputs cannot be substituted by an index candidate.
            let wheels = stage.path().join("verified-wheels");
            let bundled = crate::arm_ai::stage_bundled_wheels(&wheels)?;
            let data = manifest()?;
            let torch = wheels.join("torch-2.14.1+cpu-cp313-cp313-win_arm64.whl");
            download_verified(&app, &data["windowsArm64Torch"], &torch, false).await?;
            packages.args(&bundled).arg(&torch);
        }
        install_step(&app, &mut packages).await?;
        #[cfg(not(all(target_os = "windows", target_arch = "aarch64")))]
        {
            let archive = stage.path().join("ctc_forced_aligner-1.0.2.tar.gz");
            download_verified(&app, &manifest()?["aligner"], &archive, false).await?;
            #[cfg(windows)]
            {
                let patch = stage.path().join("install_ctc.py");
                tokio::fs::write(&patch, include_str!("install_ctc.py"))
                    .await
                    .map_err(|e| e.to_string())?;
                install_step(
                    &app,
                    python_cmd(&python)
                        .arg(&patch)
                        .arg(&archive)
                        .arg(stage.path()),
                )
                .await?;
            }
            #[cfg(not(windows))]
            install_step(
                &app,
                python_cmd(&python)
                    .args(["-m", "pip", "install", "--no-build-isolation", "--no-deps"])
                    .arg(&archive),
            )
            .await?;
        }
        install_step(
            &app,
            python_cmd(&python).args(["-m", "pip", "--isolated", "check"]),
        )
        .await?;
        if !probe(&python, PACKAGE_PROBE).await {
            return Err("AI package validation failed; previous installation was retained".into());
        }
        // Approve the complete resolved graph before replacing the live runtime.
        let audit = stage.path().join("audit_ai_dependencies.py");
        tokio::fs::write(
            &audit,
            include_str!("../../scripts/audit_ai_dependencies.py"),
        )
        .await
        .map_err(|e| e.to_string())?;
        install_step(&app, python_cmd(&python).arg(&audit).arg("--installed")).await?;
        let graph = tokio::time::timeout(
            INSTALL_STEP_TIMEOUT,
            python_cmd(&python)
                .args(["-m", "pip", "--isolated", "freeze", "--all"])
            .kill_on_drop(true)
            .output(),
        )
            .await
            .map_err(|_| "Python package installation step timed out; the previous runtime was retained")?
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

#[cfg(test)]
mod progress_line_tests {
    use super::{bounded_progress_line, MAX_PROGRESS_LINE_BYTES};

    #[test]
    fn progress_line_truncation_preserves_utf8_boundaries() {
        let input = format!("{}x", "한".repeat(MAX_PROGRESS_LINE_BYTES / 3 + 1));
        let output = bounded_progress_line(&input);
        assert!(output.is_char_boundary(output.len()));
        assert!(output.ends_with("... [truncated]"));
        assert!(output.len() <= MAX_PROGRESS_LINE_BYTES + "... [truncated]".len());
    }

    #[test]
    fn progress_line_under_limit_is_unchanged() {
        assert_eq!(bounded_progress_line("ready"), "ready");
    }
}

#[cfg(test)]
mod isolated_python_environment_tests {
    use super::{python_cmd, python_cmd_inference};

    #[test]
    fn embedded_python_commands_remove_inherited_python_paths() {
        for command in [python_cmd("python"), python_cmd_inference("python")] {
            for key in [
                "PYTHONHOME",
                "PYTHONPATH",
                "PYTHONUSERBASE",
                "PYTHONSTARTUP",
                "PYTHONEXECUTABLE",
                "PYTHONWARNINGS",
            ] {
                assert!(command.as_std().get_envs().any(|(name, value)| {
                    name == key && value.is_none()
                }), "{key} must be removed from embedded Python children");
            }
            assert!(command.as_std().get_envs().any(|(name, value)| {
                name == "PYTHONNOUSERSITE" && value == Some("1".as_ref())
            }));
            assert!(command.as_std().get_envs().any(|(name, value)| {
                name == "PYTHONSAFEPATH" && value == Some("1".as_ref())
            }));
        }
    }
}

#[cfg(test)]
mod verified_download_limit_tests {
    use super::{checked_verified_download_bytes, MAX_VERIFIED_DOWNLOAD_BYTES};

    #[test]
    fn verified_download_byte_count_enforces_limit_and_overflow() {
        assert_eq!(
            checked_verified_download_bytes(MAX_VERIFIED_DOWNLOAD_BYTES - 1, 1).unwrap(),
            MAX_VERIFIED_DOWNLOAD_BYTES
        );
        assert!(checked_verified_download_bytes(MAX_VERIFIED_DOWNLOAD_BYTES, 1).is_err());
        assert!(checked_verified_download_bytes(u64::MAX, 1).is_err());
    }
}

#[cfg(test)]
mod extraction_timeout_tests {
    use super::wait_for_runtime_extraction;
    use std::process::Stdio;
    use std::time::Duration;

    #[test]
    fn extractor_child_fixture() {
        if std::env::var("LYRICAL_EXTRACT_FIXTURE").as_deref() == Ok("hang") {
            std::thread::sleep(Duration::from_secs(60));
        }
    }

    #[tokio::test]
    async fn extraction_timeout_terminates_the_child_process() {
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "python_env::extraction_timeout_tests::extractor_child_fixture",
                "--nocapture",
            ])
            .env("LYRICAL_EXTRACT_FIXTURE", "hang")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);

        let child = command.spawn().unwrap();
        let error = wait_for_runtime_extraction(child, Duration::from_millis(50))
            .await
            .unwrap_err();
        assert!(error.contains("timed out"));
    }

    #[tokio::test]
    async fn extraction_wait_returns_a_successful_child_status() {
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args([
                "--exact",
                "python_env::extraction_timeout_tests::extractor_child_fixture",
                "--nocapture",
            ])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);

        let child = command.spawn().unwrap();
        let status = wait_for_runtime_extraction(child, Duration::from_secs(2))
            .await
            .unwrap();
        assert!(status.success());
    }
}

#[cfg(all(test, unix))]
mod readiness_probe_process_tests {
    use super::{python_cmd, wait_probe_child};
    use std::time::Duration;

    #[test]
    fn readiness_child_fixture() {
        match std::env::var("LYRICAL_PROBE_FIXTURE").as_deref() {
            Ok("grandchild") => std::thread::sleep(Duration::from_secs(60)),
            Ok("parent") => {
                let marker = std::env::var("LYRICAL_PROBE_PID_FILE").unwrap();
                let child = std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "python_env::readiness_probe_process_tests::readiness_child_fixture", "--nocapture"])
                    .env("LYRICAL_PROBE_FIXTURE", "grandchild")
                    .stdout(std::process::Stdio::null())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                    .unwrap();
                std::fs::write(marker, child.id().to_string()).unwrap();
                std::thread::sleep(Duration::from_secs(60));
            }
            _ => {}
        }
    }

    #[tokio::test]
    async fn readiness_timeout_terminates_descendants() {
        let temp = tempfile::tempdir().unwrap();
        let marker = temp.path().join("grandchild.pid");
        let mut command = python_cmd(std::env::current_exe().unwrap());
        command
            .args(["--exact", "python_env::readiness_probe_process_tests::readiness_child_fixture", "--nocapture"])
            .env("LYRICAL_PROBE_FIXTURE", "parent")
            .env("LYRICAL_PROBE_PID_FILE", &marker)
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let child = command.spawn().unwrap();
        tokio::time::timeout(Duration::from_secs(3), async {
            while !marker.exists() {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("fixture should publish its descendant PID");
        let grandchild: i32 = std::fs::read_to_string(marker).unwrap().parse().unwrap();
        assert_eq!(unsafe { libc::kill(grandchild, 0) }, 0);

        assert!(!wait_probe_child(child, Duration::from_millis(50)).await);
        tokio::time::timeout(Duration::from_secs(2), async {
            while unsafe { libc::kill(grandchild, 0) } == 0 {
                tokio::time::sleep(Duration::from_millis(10)).await;
            }
        })
        .await
        .expect("timed-out readiness descendant should be gone");
    }

    #[tokio::test]
    async fn readiness_probe_accepts_a_clean_child_exit() {
        let mut command = python_cmd(std::env::current_exe().unwrap());
        command
            .args(["--exact", "python_env::readiness_probe_process_tests::readiness_child_fixture", "--nocapture"])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null());
        let child = command.spawn().unwrap();
        assert!(wait_probe_child(child, Duration::from_secs(2)).await);
    }
}
