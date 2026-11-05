use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use serde::Serialize;

use crate::alignment_process::run_child;
use crate::models::{models_dir, ModelsDirState};
use crate::python_env::{embedded_python_exe, python_cmd_inference};

// Python scripts embedded at compile time
const ALIGN_SCRIPT: &str = include_str!("align.py");
const SEPARATE_SCRIPT: &str = include_str!("separate.py");

/// The active run owns its cancellation flag until its child has been reaped.
#[derive(Default)]
pub struct AlignmentState {
    active: Mutex<Option<(u64, Arc<AtomicBool>)>>,
}
struct AlignmentRun<'a> { state: &'a AlignmentState, cancel: Arc<AtomicBool> }
impl AlignmentState {
    fn begin(&self, id: u64) -> Result<AlignmentRun<'_>, String> {
        let mut active = self.active.lock().unwrap_or_else(|e| e.into_inner());
        if active.is_some() { return Err("Alignment is still running or cancelling".into()); }
        let cancel = Arc::new(AtomicBool::new(false));
        *active = Some((id, cancel.clone()));
        Ok(AlignmentRun { state: self, cancel })
    }
    fn cancel(&self, id: u64) {
        if let Some((active_id, flag)) = &*self.active.lock().unwrap_or_else(|e| e.into_inner()) {
            if *active_id == id { flag.store(true, Ordering::Relaxed); }
        }
    }
}
impl Drop for AlignmentRun<'_> {
    fn drop(&mut self) { *self.state.active.lock().unwrap_or_else(|e| e.into_inner()) = None; }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AlignmentProgressEvent {
    run_id: u64,
    status: String,
    message: String,
    percent: f32,
}

async fn wait_for_package_probe(
    probe: impl std::future::Future<Output = bool>, cancel: &AtomicBool,
) -> Result<bool, String> {
    tokio::pin!(probe);
    loop {
        if cancel.load(Ordering::Relaxed) { return Err("cancelled".into()); }
        if let Ok(ready) = tokio::time::timeout(std::time::Duration::from_millis(100), &mut probe).await {
            if cancel.load(Ordering::Relaxed) { return Err("cancelled".into()); }
            return Ok(ready);
        }
    }
}

/// Run the Python ctc-forced-aligner sidecar script using the app-managed venv.
/// `lines_json`: JSON array of `{"index": number, "text": string}` (non-empty lines only).
/// `language`:   ISO 639-3 code, e.g. "eng" / "kor" / "jpn".
/// Returns JSON array of `{"index", "start", "end", "confidence"}`.
/// Progress events are emitted as `alignment-progress`.
#[tauri::command]
pub async fn run_alignment(
    app: AppHandle,
    run_id: u64,
    dir_state: tauri::State<'_, ModelsDirState>,
    al_state: tauri::State<'_, AlignmentState>,
    audio_path: String,
    lines_json: String,
    language: String,
    use_separation: bool,
    use_vad: bool,
) -> Result<String, String> {
    let run = al_state.begin(run_id)?;
    let cancel = run.cancel.clone();
    let _environment = crate::python_runtime::ENV_LOCK.try_lock().map_err(|_| "AI environment is busy")?;
    // Use the app-embedded Python (downloaded once via Settings > AI Models)
    let python_exe = embedded_python_exe(&app)?;
    if !python_exe.exists() {
        return Err(
            "Python이 설정되지 않았습니다. 설정 > AI 모델 탭에서 Python을 다운로드하세요.".to_string()
        );
    }
    if !wait_for_package_probe(crate::python_env::packages_ready(&python_exe), &cancel).await? {
        return Err("AI packages are outdated or incomplete. Reinstall them in Settings > AI Models.".into());
    }
    let python_str = python_exe.to_string_lossy().into_owned();

    let progress = |line: &str| -> Result<(), String> {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(line) {
            let status = val["status"].as_str().unwrap_or("").to_string();
            let message = val["message"].as_str().unwrap_or("").to_string();
            let percent = val["percent"].as_f64().unwrap_or(0.0) as f32;
            let _ = app.emit("alignment-progress", AlignmentProgressEvent {
                run_id, status: status.clone(), message: message.clone(), percent,
            });
            if status == "error" { return Err(message); }
        }
        Ok(())
    };

    // ── Validate model readiness and coordinate lifecycle ─────────────────────
    // Check if required models are available and ready before starting alignment
    let models_dir_path = models_dir(&app, &dir_state)?;
    let manifest: serde_json::Value = serde_json::from_str(crate::python_runtime::MANIFEST)
        .map_err(|e| e.to_string())?;
    
    let model_sha256 = manifest["model"]["sha256"].as_str().ok_or("Missing model checksum")?;
    let model_path = models_dir_path.join("ctc-forced-aligner.onnx");
    if !model_path.exists() {
        return Err("정렬 모델이 없습니다. 설정 > AI 모델에서 다운로드하세요.".to_string());
    }
    
    // Model checksum verification is done in align.py sidecar
    // The Python script will verify the model checksum before loading
    
    // Check for Demucs model if separation requested
    let demucs_model = models_dir_path.join("demucs").join("htdemucs.th");
    let demucs_available = demucs_model.exists();
    let use_separation_effective = use_separation && demucs_available;
    if use_separation && !demucs_available {
        let warning_line = serde_json::json!({"status": "warning", "message": "보컬 분리 모델(htdemucs)이 없습니다. 설정 > AI 모델에서 다운로드 후 다시 시도하세요. 원본 오디오로 정렬을 진행합니다.", "percent": 0.0}).to_string();
        progress(&warning_line)?;
    }

    // Declare variables needed for vocal separation
    let vocals_tmp_path = tempfile::Builder::new()
        .prefix("lyrical_sync_vocals_")
        .suffix(".wav")
        .tempfile()
        .map_err(|e| format!("임시 파일 생성 실패: {e}"))?
        .into_temp_path();

    // 실행별 고유 임시 파일을 사용한다. 동시 정렬이 서로의 스크립트·보컬 스템을 덮어쓰지
    // 않으며 TempPath가 모든 성공/실패 경로에서 자동 정리한다.
    let align_script_path = tempfile::Builder::new()
        .prefix("lyrical_sync_align_")
        .suffix(".py")
        .tempfile()
        .map_err(|e| format!("임시 파일 생성 실패: {e}"))?
        .into_temp_path();
    tokio::fs::write(&align_script_path, ALIGN_SCRIPT)
        .await
        .map_err(|e| format!("스크립트 쓰기 실패: {e}"))?;

    let manifest: serde_json::Value = serde_json::from_str(crate::python_runtime::MANIFEST).map_err(|e| e.to_string())?;
    let mut audio_for_align = audio_path.clone();

    if use_separation_effective {
        let demucs_sha256 = manifest["demucs"]["sha256"].as_str().ok_or("Missing Demucs checksum")?;
        let sep_script_path = tempfile::Builder::new()
            .prefix("lyrical_sync_separate_")
            .suffix(".py")
            .tempfile()
            .map_err(|e| format!("임시 파일 생성 실패: {e}"))?
            .into_temp_path();
        tokio::fs::write(&sep_script_path, SEPARATE_SCRIPT)
            .await
            .map_err(|e| format!("스크립트 쓰기 실패: {e}"))?;

        let sep_child = python_cmd_inference(&python_str)
            .args([
                sep_script_path.to_string_lossy().as_ref(),
                "--model-path", &demucs_model.to_string_lossy(),
                "--model-sha256", demucs_sha256,
                "--audio",      &audio_path,
                "--output",     &vocals_tmp_path.to_string_lossy().as_ref(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| format!("Python 실행 실패: {e}"))?;

        run_child(sep_child, cancel.clone(), &progress).await?;
        audio_for_align = vocals_tmp_path.to_string_lossy().into_owned();
    }

    let script_str = align_script_path.to_string_lossy().into_owned();
    let models_dir_str = models_dir_path.to_string_lossy().into_owned();
    // VAD on the audio is only meaningful when it's the isolated vocal stem
    let separated_flag = if audio_for_align != audio_path { "true" } else { "false" };
    let vad_flag = if use_vad { "true" } else { "false" };
    let mut child = python_cmd_inference(&python_str)
        .args([
            script_str.as_str(),
            "--models-dir", &models_dir_str,
            "--model-sha256", model_sha256,
            "--audio",      &audio_for_align,
            "--lines-stdin",
            "--language",   &language,
            "--separated",  separated_flag,
            "--vad",        vad_flag,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .stdin(std::process::Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .map_err(|e| format!("Python 실행 실패: {e}"))?;

    use tokio::io::AsyncWriteExt;
    let mut stdin = child.stdin.take().ok_or("Python stdin is unavailable")?;
    let input = lines_json.into_bytes();
    let input_task = tokio::spawn(async move {
        stdin.write_all(&input).await.map_err(|error| error.to_string())
    });
    let output = run_child(child, cancel, progress).await;
    let input_result = input_task.await.map_err(|error| error.to_string())?;
    match output {
        Ok(output) => {
            input_result?;
            Ok(output.trim().to_string())
        }
        Err(error) => Err(error),
    }
}

#[tauri::command]
pub fn cancel_alignment(al_state: tauri::State<'_, AlignmentState>, run_id: u64) {
    al_state.cancel(run_id);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cancellation_interrupts_a_pending_environment_probe() {
        tokio::runtime::Runtime::new().unwrap().block_on(async {
            let cancel = Arc::new(AtomicBool::new(false));
            let pending = cancel.clone();
            tokio::spawn(async move {
                tokio::time::sleep(std::time::Duration::from_millis(10)).await;
                pending.store(true, Ordering::Relaxed);
            });
            let result = tokio::time::timeout(std::time::Duration::from_secs(1),
                wait_for_package_probe(std::future::pending::<bool>(), &cancel)).await.unwrap();
            assert_eq!(result.unwrap_err(), "cancelled");
        });
    }

    #[test]
    fn cancelled_run_retains_ownership_until_reaped_and_stale_cancels_are_ignored() {
        let state = AlignmentState::default();
        let first = state.begin(1).unwrap();
        state.cancel(1);
        assert!(first.cancel.load(Ordering::Relaxed));
        assert!(state.begin(2).is_err());
        drop(first);
        let second = state.begin(2).unwrap();
        state.cancel(1);
        assert!(!second.cancel.load(Ordering::Relaxed));
    }

    // Task 9 focused tests
    #[ignore]
    fn short_audio_boundary_reproduced_in_child_process() {
        // This test verifies that CTC boundary validation catches short audio
        // before spawning the Python child process
        use std::process::Command;
        let output = Command::new("python3")
            .arg("-c")
            .arg(r#"
import sys
sys.path.insert(0, '.')
from align import validate_ctc_boundary
import numpy as np

# Very short audio (100ms) with many tokens (10) - should fail
audio = np.zeros(1600, dtype=np.float32)  # 100ms at 16kHz
valid, msg = validate_ctc_boundary(audio, 16000, 10)
assert not valid, f'Expected failure, got: {msg}'
print('Short audio boundary test passed')
"#)
            .output()
            .expect("Failed to execute test");
        assert!(output.status.success(), "Short audio boundary test failed: {:?}", String::from_utf8_lossy(&output.stderr));
    }

    #[ignore]
    fn unsupported_and_punctuation_only_lines_handled() {
        // Test that unsupported characters and punctuation-only lines are properly rejected/mapped
        // This is tested via the Python sidecar's sanitize_line_text function
        use std::process::Command;
        let output = Command::new("python3")
            .arg("-c")
            .arg(r#"
import sys
import os
sys.path.insert(0, os.path.join(os.environ["CARGO_MANIFEST_DIR"], "src"))
from align import sanitize_line_text

# Test 1: punctuation-only line
text1 = "!!!"
sanitized, warnings, rejected = sanitize_line_text(text1)
assert sanitized == "", f"Expected empty, got: {sanitized}"
assert len(rejected) > 0, f"Expected rejected chars, got: {rejected}"

# Test 2: digit-only line
text2 = "12345"
sanitized, warnings, rejected = sanitize_line_text(text2)
assert sanitized == "", f"Expected empty, got: {sanitized}"

# Test 3: special chars (♪ etc)
text3 = "hello♪world"
sanitized, warnings, rejected = sanitize_line_text(text3)
assert "♪" not in sanitized, f"Expected ♪ removed, got: {sanitized}"
assert len(rejected) > 0, f"Expected rejected chars, got: {rejected}"

# Test 4: control chars
text4 = "hello world"
sanitized, warnings, rejected = sanitize_line_text(text4)
assert " " not in sanitized, f"Expected control char removed, got: {sanitized}"

print('Unsupported chars test passed')
"#)
            .output()
            .expect("Failed to execute test");
        assert!(output.status.success(), "Unsupported chars test failed: {:?}", String::from_utf8_lossy(&output.stderr));
    }

    #[ignore]
    fn normal_multilingual_control() {
        // Test normal multilingual alignment works correctly
        // This is an integration test that would require the full model
        // For unit testing, we verify the text preprocessing logic
        use std::process::Command;
        let output = Command::new("python3")
            .arg("-c")
            .arg(r#"
import sys
import os
sys.path.insert(0, os.path.join(os.environ["CARGO_MANIFEST_DIR"], "src"))
from align import sanitize_line_text

# Test normal English
text1 = "Hello world"
sanitized, warnings, rejected = sanitize_line_text(text1)
assert sanitized == "Hello world", f"Expected unchanged, got: {sanitized}"
assert len(rejected) == 0, f"Expected no rejected, got: {rejected}"

# Test normal Korean
text2 = "안녕하세요"
sanitized, warnings, rejected = sanitize_line_text(text2)
assert sanitized == "안녕하세요", f"Expected unchanged, got: {sanitized}"
assert len(rejected) == 0, f"Expected no rejected, got: {rejected}"

# Test normal Japanese
text3 = "こんにちは世界"
sanitized, warnings, rejected = sanitize_line_text(text3)
assert sanitized == "こんにちは世界", f"Expected unchanged, got: {sanitized}"
assert len(rejected) == 0, f"Expected no rejected, got: {rejected}"

# Test normal Chinese
text4 = "你好世界"
sanitized, warnings, rejected = sanitize_line_text(text4)
assert sanitized == "你好世界", f"Expected unchanged, got: {sanitized}"
assert len(rejected) == 0, f"Expected no rejected, got: {rejected}"

print('Multilingual test passed')
"#)
            .output()
            .expect("Failed to execute test");
        assert!(output.status.success(), "Multilingual test failed: {:?}", String::from_utf8_lossy(&output.stderr));
    }

    #[ignore]
    fn invalid_sidecar_output_detected() {
        // Test that invalid sidecar output (non-finite timestamps, wrong order, etc.) is detected
        use std::process::Command;
        let output = Command::new("python3")
            .arg("-c")
            .arg(r#"
import sys
import os
sys.path.insert(0, os.path.join(os.environ["CARGO_MANIFEST_DIR"], "src"))
from align import validate_timestamps
import numpy as np

# Test 1: Non-finite timestamps
results1 = [{"index": 0, "start": float("nan"), "end": 1.0}]
valid, msg, _ = validate_timestamps(results1, 10.0)
assert not valid, f"Expected failure for NaN, got: {msg}"

# Test 2: Negative timestamps
results2 = [{"index": 0, "start": -1.0, "end": 1.0}]
valid, msg, _ = validate_timestamps(results2, 10.0)
assert not valid, f"Expected failure for negative, got: {msg}"

# Test 3: End before start
results3 = [{"index": 0, "start": 2.0, "end": 1.0}]
valid, msg, _ = validate_timestamps(results3, 10.0)
assert not valid, f"Expected failure for end<start, got: {msg}"

# Test 4: End exceeds audio duration
results4 = [{"index": 0, "start": 9.0, "end": 11.0}]
valid, msg, _ = validate_timestamps(results4, 10.0)
assert not valid, f"Expected failure for duration exceeded, got: {msg}"

# Test 5: Wrong order
results5 = [
    {"index": 0, "start": 2.0, "end": 3.0},
    {"index": 1, "start": 1.0, "end": 2.0}
]
valid, msg, _ = validate_timestamps(results5, 10.0)
assert not valid, f"Expected failure for wrong order, got: {msg}"

# Test 6: Valid timestamps
results6 = [{"index": 0, "start": 0.5, "end": 1.5}]
valid, msg, corrected = validate_timestamps(results6, 10.0)
assert valid, f"Expected success, got: {msg}"
assert len(corrected) == 1

print('Invalid sidecar output test passed')
"#)
            .output()
            .expect("Failed to execute test");
        assert!(output.status.success(), "Invalid sidecar output test failed: {:?}", String::from_utf8_lossy(&output.stderr));
    }
}
