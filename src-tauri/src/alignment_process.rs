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
    let stderr = child.stderr.take();
    let result = async {
        if let Some(stderr) = stderr {
            let mut lines = BufReader::new(stderr).lines();
            loop {
                if cancel.load(Ordering::Relaxed) { return Err("cancelled".into()); }
                match tokio::time::timeout(Duration::from_millis(50), lines.next_line()).await {
                    Err(_) => continue,
                    Ok(Ok(Some(line))) => progress(&line)?,
                    Ok(Ok(None)) => break,
                    Ok(Err(error)) => return Err(error.to_string()),
                }
            }
        }
        let status = loop {
            if cancel.load(Ordering::Relaxed) { return Err("cancelled".into()); }
            match tokio::time::timeout(Duration::from_millis(50), child.wait()).await {
                Err(_) => continue,
                Ok(result) => break result.map_err(|e| e.to_string())?,
            }
        };
        if !status.success() { return Err(format!("Python exited with status {status}")); }
        // A descendant must not keep an inherited pipe alive indefinitely.
        tokio::time::timeout(Duration::from_millis(500), &mut output).await
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
    fn reports_unsuccessful_exit() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let result = run_child(child("failure"), Arc::new(AtomicBool::new(false)), |_| Ok(())).await;
            assert!(result.unwrap_err().contains('7'));
        });
    }
}
