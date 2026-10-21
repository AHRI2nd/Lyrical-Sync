use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader};

/// Drain both pipes while checking cancellation independently of process output.
/// Every return path reaps the child and releases the stdout reader.
pub async fn run_child(
    mut child: tokio::process::Child,
    cancel: Arc<AtomicBool>,
    mut progress: impl FnMut(&str) -> Result<(), String>,
) -> Result<String, String> {
    let stdout = child.stdout.take();
    let mut output = tokio::spawn(async move {
        let mut bytes = String::new();
        if let Some(mut stdout) = stdout {
            stdout.read_to_string(&mut bytes).await.map_err(|e| e.to_string())?;
        }
        Ok::<_, String>(bytes)
    });
    let mut stderr = child.stderr.take().map(|pipe| BufReader::new(pipe).lines());
    let result = async {
        let status = loop {
            if cancel.load(Ordering::Relaxed) { return Err("cancelled".into()); }
            // Child exit is independent of EOF: descendants can inherit pipes.
            if let Some(status) = child.try_wait().map_err(|e| e.to_string())? { break status; }
            if let Some(lines) = stderr.as_mut() {
                match tokio::time::timeout(Duration::from_millis(50), lines.next_line()).await {
                    Err(_) => (),
                    Ok(Ok(Some(line))) => progress(&line)?,
                    Ok(Ok(None)) => stderr = None,
                    Ok(Err(error)) => return Err(error.to_string()),
                }
            } else {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        };
        if !status.success() { return Err(format!("Python exited with status {status}")); }
        let deadline = tokio::time::Instant::now() + Duration::from_millis(500);
        if let Some(mut lines) = stderr {
            // Drain already emitted progress, then release inherited handles.
            let drained = tokio::time::timeout_at(deadline, async {
                while let Some(line) = lines.next_line().await.map_err(|e| e.to_string())? { progress(&line)?; }
                Ok::<(), String>(())
            }).await;
            if let Ok(result) = drained { result?; }
        }
        tokio::time::timeout_at(deadline, &mut output).await
            .map_err(|_| "Python output did not close".to_string())?
            .map_err(|e| e.to_string())?
    }.await;
    if result.is_err() { let _ = child.kill().await; let _ = child.wait().await; }
    output.abort();
    result
}

#[cfg(test)]
mod tests {
    use super::*;
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
            _ => (),
        }
    }
    fn child(mode: &str) -> tokio::process::Child {
        tokio::process::Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "alignment_process::tests::child_fixture", "--nocapture"])
            .env("LYRICAL_PROCESS_FIXTURE", mode)
            .stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
            .kill_on_drop(true).spawn().unwrap()
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
    fn observes_parent_exit_even_when_a_descendant_keeps_stderr_open() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let result = tokio::time::timeout(Duration::from_millis(1500),
                run_child(child("inherited"), Arc::new(AtomicBool::new(false)), |_| Ok(()))).await;
            assert!(result.is_ok(), "inherited stderr must not hide parent exit");
            result.unwrap().expect("parent exit must release inherited stderr without an output error");
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
}
