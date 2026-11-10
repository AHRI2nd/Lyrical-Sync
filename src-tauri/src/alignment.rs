use serde::Serialize;
use std::collections::VecDeque;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, WebviewWindow};

use crate::alignment_process::run_child;
use crate::models::{models_dir, ModelsDirState};
use crate::python_env::{embedded_python_exe, python_cmd_inference};

// Python scripts embedded at compile time
const ALIGN_SCRIPT: &str = include_str!("align.py");
const SEPARATE_SCRIPT: &str = include_str!("separate.py");

fn validate_alignment_audio(path: &Path) -> Result<(), String> {
    let metadata = std::fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err(crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR.into());
    }
    crate::audio_resource::inspect_audio_file(path).map(|_| ())
}

/// The active run owns its cancellation flag until its child has been reaped.
const MAX_PENDING_ALIGNMENT_CANCELLATIONS: usize = 64;

#[derive(Default)]
struct AlignmentStateInner {
    active: Option<(String, Arc<AtomicBool>)>,
    pending_cancellations: VecDeque<String>,
}

#[derive(Default)]
pub struct AlignmentState {
    inner: Mutex<AlignmentStateInner>,
}
struct AlignmentRun<'a> {
    state: &'a AlignmentState,
    cancel: Arc<AtomicBool>,
}
impl AlignmentState {
    fn begin(&self, id: String) -> Result<AlignmentRun<'_>, String> {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if inner.active.is_some() {
            return Err("Alignment is still running or cancelling".into());
        }
        let cancelled_early = inner
            .pending_cancellations
            .iter()
            .any(|pending_id| pending_id == &id);
        inner
            .pending_cancellations
            .retain(|pending_id| pending_id != &id);
        let cancel = Arc::new(AtomicBool::new(cancelled_early));
        inner.active = Some((id, cancel.clone()));
        Ok(AlignmentRun {
            state: self,
            cancel,
        })
    }
    fn cancel(&self, id: &str) {
        let mut inner = self.inner.lock().unwrap_or_else(|e| e.into_inner());
        if let Some((active_id, flag)) = &inner.active {
            if active_id == id {
                flag.store(true, Ordering::Relaxed);
                return;
            }
        }
        if inner
            .pending_cancellations
            .iter()
            .any(|pending_id| pending_id == id)
        {
            return;
        }
        if inner.pending_cancellations.len() == MAX_PENDING_ALIGNMENT_CANCELLATIONS {
            inner.pending_cancellations.pop_front();
        }
        inner.pending_cancellations.push_back(id.to_owned());
    }
}
impl Drop for AlignmentRun<'_> {
    fn drop(&mut self) {
        self.state
            .inner
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .active = None;
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AlignmentProgressEvent {
    run_id: String,
    status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    code: Option<String>,
    percent: f32,
}

fn canonical_ai_error_code(code: Option<&str>) -> &'static str {
    match code {
        Some("packages") => "packages",
        Some("model") => "model",
        Some("audio") => "audio",
        Some("audio_too_short") => "audio_too_short",
        Some("unsupported_lyrics") => "unsupported_lyrics",
        _ => "general",
    }
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
    window: WebviewWindow,
    run_id: String,
    dir_state: tauri::State<'_, ModelsDirState>,
    al_state: tauri::State<'_, AlignmentState>,
    audio_path: String,
    lines_json: String,
    language: String,
    use_separation: bool,
    use_vad: bool,
) -> Result<String, String> {
    let audio_path = crate::path_validation::validate_safe_path(&audio_path)?;
    crate::authorize_window_path(&window, &audio_path)?;
    validate_alignment_audio(&audio_path)?;
    let audio_path = audio_path.to_string_lossy().into_owned();
    let run = al_state.begin(run_id.clone())?;
    let cancel = run.cancel.clone();
    if cancel.load(Ordering::Relaxed) {
        return Err("cancelled".into());
    }
    let runtime_root = crate::python_env::embedded_python_dir(&app)?;
    let _environment = crate::python_runtime::try_lock_environment(&runtime_root)?;
    crate::python_runtime::recover_runtime(&runtime_root)
        .map_err(|error| error.to_string())?;
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
            let code = if status == "error" {
                Some(canonical_ai_error_code(val["code"].as_str()).to_string())
            } else {
                None
            };
            let percent = val["percent"].as_f64().unwrap_or(0.0) as f32;
            let _ = app.emit(
                "alignment-progress",
                AlignmentProgressEvent {
                    run_id: run_id.clone(),
                    status: status.clone(),
                    code: code.clone(),
                    percent,
                },
            );
            if status == "error" {
                return Err(format!("AI_SYNC_ERROR:{}", code.as_deref().unwrap_or("general")));
            }
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

    let process_id = child.id();
    use tokio::io::AsyncWriteExt;
    let mut stdin = child.stdin.take().ok_or("Python stdin is unavailable")?;
    let input = lines_json.into_bytes();
    let input_task = tokio::spawn(async move {
        stdin.write_all(&input).await.map_err(|error| error.to_string())
    });
    let output = run_child(child, cancel, progress).await;
    match output {
        Ok(output) => {
            match crate::alignment_process::finish_stdin_writer(
                input_task,
                std::time::Duration::from_millis(500),
            )
            .await
            {
                Ok(()) => Ok(output.trim().to_string()),
                Err(error) => {
                    if let Some(pid) = process_id {
                        crate::alignment_process::terminate_process_tree(pid).await;
                    }
                    Err(error)
                }
            }
        }
        Err(error) => {
            input_task.abort();
            let _ = input_task.await;
            Err(error)
        }
    }
}

#[tauri::command]
pub fn cancel_alignment(al_state: tauri::State<'_, AlignmentState>, run_id: String) {
    al_state.cancel(&run_id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ai_error_codes_are_allowlisted_and_unknown_values_fail_closed() {
        assert_eq!(canonical_ai_error_code(Some("packages")), "packages");
        assert_eq!(canonical_ai_error_code(Some("model")), "model");
        assert_eq!(canonical_ai_error_code(Some("audio")), "audio");
        assert_eq!(
            canonical_ai_error_code(Some("audio_too_short")),
            "audio_too_short"
        );
        assert_eq!(
            canonical_ai_error_code(Some("unsupported_lyrics")),
            "unsupported_lyrics"
        );
        assert_eq!(
            canonical_ai_error_code(Some("path=/private/user")),
            "general"
        );
        assert_eq!(canonical_ai_error_code(None), "general");
    }

    #[test]
    fn alignment_progress_event_serializes_the_code_without_sidecar_diagnostics() {
        let event = AlignmentProgressEvent {
            run_id: "run-7".into(),
            status: "error".to_string(),
            code: Some("model".to_string()),
            percent: 0.0,
        };

        let value = serde_json::to_value(event).unwrap();
        assert_eq!(value["code"], "model");
        assert!(value.get("message").is_none());
    }

    #[test]
    fn ai_audio_validation_enforces_the_shared_file_resource_budget() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("oversized-audio.wav");
        let file = std::fs::File::create(&path).unwrap();
        file.set_len(crate::audio_resource::MAX_AUDIO_FILE_BYTES + 1).unwrap();

        assert_eq!(
            validate_alignment_audio(&path).unwrap_err(),
            crate::audio_resource::AUDIO_RESOURCE_LIMIT_ERROR,
        );
    }

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
        let first = state.begin("run-1".into()).unwrap();
        state.cancel("run-1");
        assert!(first.cancel.load(Ordering::Relaxed));
        assert!(state.begin("run-2".into()).is_err());
        drop(first);
        let second = state.begin("run-2".into()).unwrap();
        state.cancel("run-1");
        assert!(!second.cancel.load(Ordering::Relaxed));
    }

    #[test]
    fn cancellation_before_native_run_registration_is_applied_when_run_begins() {
        let state = AlignmentState::default();
        state.cancel("run-a");

        let run = state.begin("run-a".into()).unwrap();

        assert!(run.cancel.load(Ordering::Relaxed));
    }

    #[test]
    fn early_cancellation_is_kept_for_its_run_without_cancelling_another_run() {
        let state = AlignmentState::default();
        state.cancel("run-b");

        let first = state.begin("run-a".into()).unwrap();
        assert!(!first.cancel.load(Ordering::Relaxed));
        drop(first);

        let second = state.begin("run-b".into()).unwrap();
        assert!(second.cancel.load(Ordering::Relaxed));
    }

    #[test]
    fn stale_cancellation_does_not_cancel_a_later_unique_run() {
        let state = AlignmentState::default();
        drop(state.begin("run-old".into()).unwrap());
        state.cancel("run-old");

        let current = state.begin("run-current".into()).unwrap();
        assert!(!current.cancel.load(Ordering::Relaxed));
    }

    #[test]
    fn pending_cancellation_memory_is_bounded() {
        let state = AlignmentState::default();
        for index in 0..100 {
            state.cancel(&format!("run-{index}"));
        }

        assert_eq!(
            state.inner.lock().unwrap().pending_cancellations.len(),
            MAX_PENDING_ALIGNMENT_CANCELLATIONS
        );
    }

    #[test]
    fn embedded_sidecar_is_single_parseable_source_without_legacy_nul_bytes() {
        // The Python test suite separately compiles and executes this exact
        // source with a synthetic model boundary (no model download required).
        assert!(!ALIGN_SCRIPT.as_bytes().contains(&0), "Python source contains a NUL byte");
        assert_eq!(ALIGN_SCRIPT.matches("if __name__ == \"__main__\":").count(), 1);
        assert!(ALIGN_SCRIPT.contains("emissions, stride = generate_emissions("));
        assert!(ALIGN_SCRIPT.contains("segments, scores, blank_token = get_alignments("));
    }
}
