use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

/// Maximum bytes to accumulate from child stdout/stderr before aborting.
/// 64 MiB provides ample headroom for normal alignment output while preventing OOM.
const MAX_CHILD_OUTPUT_BYTES: usize = 64 * 1024 * 1024;

/// Drain both pipes while checking cancellation independently of process output.
/// Every return path reaps the child and releases the stdout reader.
pub async fn run_child(
    child: tokio::process::Child,
    cancel: Arc<AtomicBool>,
    progress: impl FnMut(&str) -> Result<(), String>,
) -> Result<String, String> {
    run_child_with_output_limit(child, cancel, progress, MAX_CHILD_OUTPUT_BYTES).await
}

async fn run_child_with_output_limit(
    mut child: tokio::process::Child,
    cancel: Arc<AtomicBool>,
    mut progress: impl FnMut(&str) -> Result<(), String>,
    output_limit: usize,
) -> Result<String, String> {
    let process_id = child.id();
    let stdout = child.stdout.take();
    let (output_error_sender, mut output_error_receiver) = tokio::sync::oneshot::channel();
    let mut output = tokio::spawn(async move {
        let result = async {
            let mut bytes = Vec::new();
            if let Some(stdout) = stdout {
                let mut limited = stdout.take(output_limit.saturating_add(1) as u64);
                limited.read_to_end(&mut bytes).await.map_err(|e| e.to_string())?;
                if bytes.len() > output_limit {
                    return Err("Child stdout exceeded maximum allowed output size".into());
                }
            }
            String::from_utf8(bytes).map_err(|e| e.to_string())
        }.await;
        if let Err(error) = &result {
            let _ = output_error_sender.send(error.clone());
        }
        result
    });
    let stderr_limit = output_limit.saturating_add(1) as u64;
    let mut stderr = child
        .stderr
        .take()
        .map(|pipe| BufReader::new(pipe).take(stderr_limit));
    let mut stderr_bytes = 0usize;
    let result = async {
        let status;
        loop {
            if cancel.load(Ordering::Relaxed) { return Err("cancelled".into()); }
            if let Ok(error) = output_error_receiver.try_recv() {
                return Err(error);
            }
            // Try to read stderr first, then check exit status
            if let Some(reader) = stderr.as_mut() {
                let mut line = Vec::new();
                match tokio::time::timeout(Duration::from_millis(50), reader.read_until(b'\n', &mut line)).await {
                    Err(_) => (),
                    Ok(Ok(0)) => stderr = None,
                    Ok(Ok(bytes_read)) => {
                        stderr_bytes += bytes_read;
                        if stderr_bytes > output_limit {
                            return Err("Child stderr exceeded maximum allowed output size".into());
                        }
                        if line.last() == Some(&b'\n') { line.pop(); }
                        if line.last() == Some(&b'\r') { line.pop(); }
                        progress(&String::from_utf8_lossy(&line))?;
                    },
                    Ok(Err(error)) => return Err(error.to_string()),
                }
            }
            // Check if process has exited
            if let Some(status_) = child.try_wait().map_err(|e| e.to_string())? {
                status = Some(status_);
                break;
            }
            tokio::time::sleep(Duration::from_millis(50)).await;
        };
        // After loop, drain any remaining stderr
        if let Some(reader) = stderr.as_mut() {
            let deadline = tokio::time::Instant::now() + Duration::from_millis(500);
            let drained = tokio::time::timeout_at(
                deadline,
                async {
                    loop {
                        let mut line = Vec::new();
                        let bytes_read = reader.read_until(b'\n', &mut line).await.map_err(|e| e.to_string())?;
                        if bytes_read == 0 { break; }
                        stderr_bytes += bytes_read;
                        if stderr_bytes > output_limit {
                            return Err("Child stderr exceeded maximum allowed output size".into());
                        }
                        if line.last() == Some(&b'\n') { line.pop(); }
                        if line.last() == Some(&b'\r') { line.pop(); }
                        progress(&String::from_utf8_lossy(&line))?;
                    }
                    Ok::<(), String>(())
                }
            ).await;
            match drained {
                Ok(result) => result?,
                Err(_) => return Err("Python stderr did not close".into()),
            }
        }
        let status = status.unwrap_or_else(|| {
    let wait_result = tokio::task::block_in_place(|| {
        tokio::runtime::Handle::current().block_on(child.wait())
    });
    wait_result.map_err(|e| e.to_string()).unwrap()
});
        if !status.success() {
            let stdout_diagnostic = match tokio::time::timeout(Duration::from_millis(500), &mut output).await {
                Ok(Ok(Ok(stdout))) => {
                    let diagnostic: String = stdout.trim().chars().take(4096).collect();
                    (!diagnostic.is_empty()).then_some(diagnostic)
                }
                _ => None,
            };
            return Err(match stdout_diagnostic {
                Some(diagnostic) => format!("Python exited with status {status}: {diagnostic}"),
                None => format!("Python exited with status {status}"),
            });
        }
        let deadline = tokio::time::Instant::now() + Duration::from_millis(500);
        tokio::time::timeout_at(deadline, &mut output).await
            .map_err(|_| "Python output did not close".to_string())?
            .map_err(|e| e.to_string())?
    }.await;
    if result.is_err() {
        if let Some(pid) = process_id {
            terminate_process_tree(pid).await;
        }
        let _ = child.kill().await;
        let _ = child.wait().await;
    }
    output.abort();
    result
}

pub(crate) async fn terminate_process_tree(pid: u32) {
    #[cfg(unix)]
    unsafe {
        // Production Python commands start in their own process group.
        libc::kill(-(pid as i32), libc::SIGKILL);
    }
    #[cfg(windows)]
    {
        let pid = pid.to_string();
        let _ = tokio::time::timeout(
            Duration::from_secs(5),
            tokio::process::Command::new("taskkill")
                .args(["/PID", &pid, "/T", "/F"])
                .creation_flags(0x08000000)
                .stdout(std::process::Stdio::null())
                .stderr(std::process::Stdio::null())
                .status(),
        )
        .await;
    }
}

pub async fn run_child_with_timeout(
    child: tokio::process::Child,
    cancel: Arc<AtomicBool>,
    timeout: Duration,
    progress: impl FnMut(&str) -> Result<(), String>,
) -> Result<String, String> {
    let run = run_child(child, cancel.clone(), progress);
    tokio::pin!(run);
    match tokio::time::timeout(timeout, &mut run).await {
        Ok(result) => result,
        Err(_) => {
            cancel.store(true, Ordering::Relaxed);
            let _ = run.await;
            Err("Python process timed out".into())
        }
    }
}

pub async fn finish_stdin_writer(
    mut writer: tokio::task::JoinHandle<Result<(), String>>,
    timeout: Duration,
) -> Result<(), String> {
    match tokio::time::timeout(timeout, &mut writer).await {
        Ok(Ok(result)) => result,
        Ok(Err(error)) => Err(error.to_string()),
        Err(_) => {
            writer.abort();
            let _ = writer.await;
            Err("Python stdin writer timed out".into())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn stdin_writer_timeout_aborts_the_detached_write_task() {
        struct DropFlag(Arc<AtomicBool>);
        impl Drop for DropFlag {
            fn drop(&mut self) {
                self.0.store(true, Ordering::Relaxed);
            }
        }

        let dropped = Arc::new(AtomicBool::new(false));
        let writer_dropped = dropped.clone();
        let writer = tokio::spawn(async move {
            let _drop_flag = DropFlag(writer_dropped);
            std::future::pending::<()>().await;
            Ok(())
        });

        let result = finish_stdin_writer(writer, Duration::from_millis(10)).await;

        assert_eq!(result.unwrap_err(), "Python stdin writer timed out");
        assert!(dropped.load(Ordering::Relaxed));
    }

    #[tokio::test]
    async fn completed_stdin_writer_preserves_its_result() {
        let writer = tokio::spawn(async { Ok(()) });
        finish_stdin_writer(writer, Duration::from_secs(1)).await.unwrap();
    }

    #[tokio::test]
    async fn blocked_pipe_writer_times_out_and_owned_child_is_reaped() {
        use tokio::io::AsyncWriteExt;

        let mut child = child_with_stdin("silent");
        let process_id = child.id().expect("child process must have a PID");
        let mut stdin = child.stdin.take().expect("child stdin must be piped");
        let writer = tokio::spawn(async move {
            let input = vec![b'x'; 8 * 1024 * 1024];
            stdin.write_all(&input).await.map_err(|error| error.to_string())
        });

        let result = finish_stdin_writer(writer, Duration::from_millis(50)).await;
        assert_eq!(result.unwrap_err(), "Python stdin writer timed out");

        terminate_process_tree(process_id).await;
        let _ = child.kill().await;
        let status = tokio::time::timeout(Duration::from_secs(2), child.wait())
            .await
            .expect("child termination must be bounded")
            .unwrap();
        assert!(!status.success());
    }
    use std::io::Write;
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
    use std::time::{Duration, Instant};

    #[test]
    fn child_fixture() {
        match std::env::var("LYRICAL_PROCESS_FIXTURE").as_deref() {
            Ok("silent") => std::thread::sleep(Duration::from_secs(60)),
            Ok("output") => {
                std::io::stdout().write_all(&vec![b'x'; 262144]).unwrap();
                eprintln!("progress");
            }
            Ok("stdout_sized") => {
                let size: usize = std::env::var("LYRICAL_PROCESS_OUTPUT_BYTES").unwrap().parse().unwrap();
                std::io::stdout().write_all(&vec![b'x'; size]).unwrap();
            }
            Ok("stdout_overflow_hang") => {
                std::io::stdout().write_all(&vec![b'x'; 2048]).unwrap();
                std::thread::sleep(Duration::from_secs(60));
            }
            Ok("stderr_sized") => {
                let size: usize = std::env::var("LYRICAL_PROCESS_OUTPUT_BYTES").unwrap().parse().unwrap();
                let line = "x".repeat(128);
                for _ in 0..size / (line.len() + 1) {
                    eprintln!("{line}");
                }
            }
            Ok("stderr_raw_sized") => {
                let size: usize = std::env::var("LYRICAL_PROCESS_OUTPUT_BYTES").unwrap().parse().unwrap();
                std::io::stderr().write_all(&vec![b'x'; size]).unwrap();
            }
            Ok(mode @ ("inherited" | "inherited_stdout")) => {
                // Windows inherits other inheritable handles even when the new
                // standard stdout is NUL. Keep this fixture stderr-only.
                #[cfg(windows)]
                if mode == "inherited" { unsafe {
                    use std::ffi::c_void;
                    #[link(name = "kernel32")]
                    extern "system" {
                        fn GetStdHandle(kind: u32) -> *mut c_void;
                        fn SetHandleInformation(handle: *mut c_void, mask: u32, flags: u32) -> i32;
                    }
                    assert_ne!(SetHandleInformation(GetStdHandle(-11i32 as u32), 1, 0), 0);
                } }
                std::process::Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "alignment_process::tests::child_fixture", "--nocapture"])
                    .env("LYRICAL_PROCESS_FIXTURE", "inherited_hold")
                    .stdout(if mode == "inherited" { std::process::Stdio::null() } else { std::process::Stdio::inherit() })
                    .stderr(if mode == "inherited" { std::process::Stdio::inherit() } else { std::process::Stdio::null() })
                    .spawn().unwrap();
            }
            Ok("inherited_hold") => std::thread::sleep(Duration::from_secs(2)),
            Ok("failure") => std::process::exit(7),
            Ok("failure_stdout") => {
                println!("dependency conflict details");
                std::process::exit(7);
            },
            Ok("stderr_invalid_utf8") => {
                std::io::stderr().write_all(b"progress\xff\n").unwrap();
                println!("ok");
            }
            _ => (),
        }
    }
    fn child(mode: &str) -> tokio::process::Child {
        child_with_output_bytes(mode, None)
    }
    fn child_with_stdin(mode: &str) -> tokio::process::Child {
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "alignment_process::tests::child_fixture", "--nocapture"])
            .env("LYRICAL_PROCESS_FIXTURE", mode)
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::null())
            .kill_on_drop(true);
        #[cfg(unix)]
        command.process_group(0);
        command.spawn().unwrap()
    }
    fn child_with_output_bytes(mode: &str, output_bytes: Option<usize>) -> tokio::process::Child {
        let mut command = tokio::process::Command::new(std::env::current_exe().unwrap());
        command
            .args(["--exact", "alignment_process::tests::child_fixture", "--nocapture"])
            .env("LYRICAL_PROCESS_FIXTURE", mode)
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
            .kill_on_drop(true);
        if let Some(output_bytes) = output_bytes {
            command.env("LYRICAL_PROCESS_OUTPUT_BYTES", output_bytes.to_string());
        }
        #[cfg(unix)]
        command.process_group(0);
        command.spawn().unwrap()
    }
    #[test]
    fn cancels_and_reaps_a_silent_process_without_waiting_for_a_log_line() {
        let rt = tokio::runtime::Runtime::new().unwrap();
        rt.block_on(async {
            let cancel = Arc::new(AtomicBool::new(false));
            let trigger = cancel.clone();
            let worker = std::thread::spawn(move || { std::thread::sleep(Duration::from_millis(100)); trigger.store(true, Ordering::Relaxed); });
            let start = Instant::now();
            let result = tokio::time::timeout(Duration::from_secs(3), run_child(child("silent"), cancel, |_| Ok(()))).await;
            worker.join().unwrap();
            assert_eq!(result.unwrap().unwrap_err(), "cancelled");
            assert!(start.elapsed() < Duration::from_secs(2));
        });
    }

    #[test]
    fn times_out_and_reaps_a_hung_child() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let cancel = Arc::new(AtomicBool::new(false));
            let result = tokio::time::timeout(
                Duration::from_secs(2),
                run_child_with_timeout(child("silent"), cancel.clone(), Duration::from_millis(50), |_| Ok(())),
            ).await.unwrap();
            assert_eq!(result.unwrap_err(), "Python process timed out");
            assert!(cancel.load(Ordering::Relaxed));
        });
    }
    #[test]
    fn drains_large_stdout_concurrently_with_progress() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut progress = false;
            let output = tokio::time::timeout(Duration::from_secs(3), run_child(child("output"), Arc::new(AtomicBool::new(false)), |line| {
                if line == "progress" { progress = true; } Ok(())
            })).await.unwrap().unwrap();
            assert!(progress);
            assert!(output.contains(&"x".repeat(262144)));
        });
    }
    #[test]
    fn decodes_non_utf8_stderr_lossily_without_failing_a_successful_child() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut progress = Vec::new();
            let output = run_child(
                child("stderr_invalid_utf8"),
                Arc::new(AtomicBool::new(false)),
                |line| { progress.push(line.to_owned()); Ok(()) },
            ).await.unwrap();

            assert!(output.lines().any(|line| line == "ok"));
            assert_eq!(progress, ["progress�"]);
        });
    }
    #[test]
    fn rejects_stdout_and_stderr_above_the_configured_limit() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let stdout_result = tokio::time::timeout(
                Duration::from_secs(3),
                run_child_with_output_limit(
                    child_with_output_bytes("stdout_sized", Some(4096)),
                    Arc::new(AtomicBool::new(false)),
                    |_| Ok(()),
                    1024,
                ),
            )
            .await
            .expect("stdout overflow should not hang");
            assert!(stdout_result.is_err());

            let stderr_result = tokio::time::timeout(
                Duration::from_secs(3),
                run_child_with_output_limit(
                    child_with_output_bytes("stderr_sized", Some(2048)),
                    Arc::new(AtomicBool::new(false)),
                    |_| Ok(()),
                    1024,
                ),
            )
            .await
            .expect("stderr overflow should not hang");
            assert_eq!(
                stderr_result.unwrap_err(),
                "Child stderr exceeded maximum allowed output size"
            );
        });
    }

    #[test]
    fn accepts_stdout_at_the_limit_and_rejects_one_byte_over() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let baseline = run_child(
                child("baseline"),
                Arc::new(AtomicBool::new(false)),
                |_| Ok(()),
            ).await.unwrap().len();
            assert!(baseline < 1024);
            let exact = run_child_with_output_limit(
                child_with_output_bytes("stdout_sized", Some(1024 - baseline)),
                Arc::new(AtomicBool::new(false)),
                |_| Ok(()),
                1024,
            ).await.unwrap();
            assert_eq!(exact.len(), 1024);

            let over = run_child_with_output_limit(
                child_with_output_bytes("stdout_sized", Some(1025 - baseline)),
                Arc::new(AtomicBool::new(false)),
                |_| Ok(()),
                1024,
            ).await;
            assert_eq!(over.unwrap_err(), "Child stdout exceeded maximum allowed output size");
        });
    }

    #[test]
    fn stdout_overflow_terminates_a_child_that_keeps_running() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let result = tokio::time::timeout(
                Duration::from_secs(2),
                run_child_with_output_limit(
                    child("stdout_overflow_hang"),
                    Arc::new(AtomicBool::new(false)),
                    |_| Ok(()),
                    1024,
                ),
            ).await;
            assert_eq!(
                result.expect("stdout overflow must fail before child exits").unwrap_err(),
                "Child stdout exceeded maximum allowed output size"
            );
        });
    }

    #[test]
    fn newline_free_stderr_overflow_is_bounded_and_fails() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let exact = run_child_with_output_limit(
                child_with_output_bytes("stderr_raw_sized", Some(1024)),
                Arc::new(AtomicBool::new(false)),
                |_| Ok(()),
                1024,
            ).await.unwrap();
            assert!(exact.contains("child_fixture"));

            let over = tokio::time::timeout(
                Duration::from_secs(2),
                run_child_with_output_limit(
                    child_with_output_bytes("stderr_raw_sized", Some(1025)),
                    Arc::new(AtomicBool::new(false)),
                    |_| Ok(()),
                    1024,
                ),
            ).await.expect("newline-free stderr overflow should be bounded");
            assert_eq!(over.unwrap_err(), "Child stderr exceeded maximum allowed output size");
        });
    }
    #[test]
    fn observes_parent_exit_even_when_a_descendant_keeps_stderr_open() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let child = child("inherited");
            #[cfg(unix)]
            let process_group = child.id().expect("child process must have a PID");
            let result = tokio::time::timeout(Duration::from_millis(1500),
                run_child(child, Arc::new(AtomicBool::new(false)), |_| Ok(()))).await;
            assert_eq!(result.expect("stderr drain must be bounded").unwrap_err(), "Python stderr did not close");
            #[cfg(unix)]
            {
                for _ in 0..20 {
                    if unsafe { libc::kill(-(process_group as i32), 0) } == -1 { break; }
                    tokio::time::sleep(Duration::from_millis(10)).await;
                }
                assert_eq!(unsafe { libc::kill(-(process_group as i32), 0) }, -1, "owned descendants must be terminated after the output drain deadline");
            }
        });
    }
    #[test]
    fn rejects_incomplete_output_when_a_descendant_keeps_stdout_open() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let result = tokio::time::timeout(Duration::from_millis(1500),
                run_child(child("inherited_stdout"), Arc::new(AtomicBool::new(false)), |_| Ok(()))).await;
            assert_eq!(result.expect("inherited stdout must have a bounded wait").unwrap_err(), "Python output did not close");
        });
    }
    #[test]
    fn reports_unsuccessful_exit() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let result = run_child(child("failure"), Arc::new(AtomicBool::new(false)), |_| Ok(())).await;
            assert!(result.unwrap_err().contains('7'));
        });
    }

    #[test]
    fn includes_bounded_stdout_diagnostics_for_nonzero_exit() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let result = run_child(child("failure_stdout"), Arc::new(AtomicBool::new(false)), |_| Ok(())).await;
            let error = result.unwrap_err();
            assert!(error.contains("exit status: 7"));
            assert!(error.contains("dependency conflict details"));
        });
    }

    #[test]
    fn pre_exited_child_stderr_is_captured() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let mut captured_stderr = String::new();
            let child = tokio::process::Command::new("sh")
                .arg("-c")
                .arg("echo stderr_output >&2; exit 7")
                .stdout(std::process::Stdio::piped())
                .stderr(std::process::Stdio::piped())
                .spawn()
                .expect("spawn failed");
            let result = run_child(
                child,
                Arc::new(AtomicBool::new(false)),
                |line| {
                    captured_stderr.push_str(line);
                    captured_stderr.push('\n');
                    Ok(())
                },
            ).await;
            assert!(result.is_err());
            let err = result.unwrap_err();
            // The error format is "Python exited with status exit status: 7"
            assert!(err.contains("exit status: 7"));
            assert!(captured_stderr.contains("stderr_output"));
        });
    }
}
