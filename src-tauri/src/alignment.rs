use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use serde::Serialize;

use crate::models::{models_dir, ModelsDirState};
use crate::python_env::{embedded_python_exe, python_cmd_inference};

// Python scripts embedded at compile time
const ALIGN_SCRIPT: &str = include_str!("align.py");
const SEPARATE_SCRIPT: &str = include_str!("separate.py");

/// Cancel flag for the currently running alignment process.
pub struct AlignmentState {
    cancel_flag: Mutex<Arc<AtomicBool>>,
}

impl Default for AlignmentState {
    fn default() -> Self {
        Self { cancel_flag: Mutex::new(Arc::new(AtomicBool::new(false))) }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct AlignmentProgressEvent {
    status: String,
    message: String,
    percent: f32,
}

/// Run the Python ctc-forced-aligner sidecar script using the app-managed venv.
/// `lines_json`: JSON array of `{"index": number, "text": string}` (non-empty lines only).
/// `language`:   ISO 639-3 code, e.g. "eng" / "kor" / "jpn".
/// Returns JSON array of `{"index", "start", "end", "confidence"}`.
/// Progress events are emitted as `alignment-progress`.
#[tauri::command]
pub async fn run_alignment(
    app: AppHandle,
    dir_state: tauri::State<'_, ModelsDirState>,
    al_state: tauri::State<'_, AlignmentState>,
    audio_path: String,
    lines_json: String,
    language: String,
    use_separation: bool,
    use_vad: bool,
) -> Result<String, String> {
    // Use the app-embedded Python (downloaded once via Settings > AI Models)
    let python_exe = embedded_python_exe(&app)?;
    if !python_exe.exists() {
        return Err(
            "Python이 설정되지 않았습니다. 설정 > AI 모델 탭에서 Python을 다운로드하세요.".to_string()
        );
    }
    let python_str = python_exe.to_string_lossy().into_owned();

    // Fresh cancel flag for this run
    let cancel = {
        let new_flag = Arc::new(AtomicBool::new(false));
        *al_state.cancel_flag.lock().unwrap() = new_flag.clone();
        new_flag
    };

    // Write the embedded Python scripts to temp files
    let align_script_path = std::env::temp_dir().join("lyrical_sync_align.py");
    tokio::fs::write(&align_script_path, ALIGN_SCRIPT)
        .await
        .map_err(|e| format!("스크립트 쓰기 실패: {e}"))?;

    let models_dir_path = models_dir(&app, &dir_state)?;
    let models_dir_str = models_dir_path.to_string_lossy().into_owned();

    use tokio::io::{AsyncBufReadExt, AsyncReadExt, BufReader as ABufReader};

    // ── Vocal separation (Demucs) if model is available ──────────────────────
    let demucs_model = models_dir_path.join("demucs").join("htdemucs.th");
    let vocals_tmp_path = std::env::temp_dir().join("lyrical_sync_vocals.wav");
    let audio_for_align: String;

    if use_separation && demucs_model.exists() {
        let sep_script_path = std::env::temp_dir().join("lyrical_sync_separate.py");
        tokio::fs::write(&sep_script_path, SEPARATE_SCRIPT)
            .await
            .map_err(|e| format!("스크립트 쓰기 실패: {e}"))?;

        let mut sep_child = python_cmd_inference(&python_str)
            .args([
                sep_script_path.to_string_lossy().as_ref(),
                "--model-path", &demucs_model.to_string_lossy(),
                "--audio",      &audio_path,
                "--output",     &vocals_tmp_path.to_string_lossy().as_ref(),
            ])
            .stdout(std::process::Stdio::null())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .map_err(|e| format!("Python 실행 실패: {e}"))?;

        let sep_stderr = sep_child.stderr.take().unwrap();
        let mut sep_reader = ABufReader::new(sep_stderr).lines();
        let mut sep_error: Option<String> = None;

        while let Ok(Some(line)) = sep_reader.next_line().await {
            if cancel.load(Ordering::Relaxed) {
                let _ = sep_child.kill().await;
                return Err("cancelled".into());
            }
            if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
                let status  = val["status"].as_str().unwrap_or("").to_string();
                let message = val["message"].as_str().unwrap_or("").to_string();
                let percent = val["percent"].as_f64().unwrap_or(0.0) as f32;
                let _ = app.emit("alignment-progress", AlignmentProgressEvent {
                    status: status.clone(), message: message.clone(), percent,
                });
                if status == "error" {
                    sep_error = Some(message);
                    let _ = sep_child.kill().await;
                    break;
                }
            }
        }

        if let Some(err) = sep_error {
            return Err(err);
        }
        let _ = sep_child.wait().await;
        audio_for_align = vocals_tmp_path.to_string_lossy().into_owned();
    } else {
        audio_for_align = audio_path.clone();
    }

    let script_str = align_script_path.to_string_lossy().into_owned();
    // VAD on the audio is only meaningful when it's the isolated vocal stem
    let separated_flag = if audio_for_align != audio_path { "true" } else { "false" };
    let vad_flag = if use_vad { "true" } else { "false" };
    let mut child = python_cmd_inference(&python_str)
        .args([
            script_str.as_str(),
            "--models-dir", &models_dir_str,
            "--audio",      &audio_for_align,
            "--lines",      &lines_json,
            "--language",   &language,
            "--separated",  separated_flag,
            "--vad",        vad_flag,
        ])
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Python 실행 실패: {e}"))?;

    let stderr = child.stderr.take().unwrap();
    let stdout = child.stdout.take().unwrap();

    // Stream stderr line by line for progress events
    let mut stderr_reader = ABufReader::new(stderr).lines();
    let mut last_error: Option<String> = None;

    while let Ok(Some(line)) = stderr_reader.next_line().await {
        if cancel.load(Ordering::Relaxed) {
            let _ = child.kill().await;
            return Err("cancelled".into());
        }
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&line) {
            let status = val["status"].as_str().unwrap_or("").to_string();
            let message = val["message"].as_str().unwrap_or("").to_string();
            let percent = val["percent"].as_f64().unwrap_or(0.0) as f32;

            let _ = app.emit("alignment-progress", AlignmentProgressEvent {
                status: status.clone(),
                message: message.clone(),
                percent,
            });

            if status == "error" {
                last_error = Some(message);
                let _ = child.kill().await;
                break;
            }
        }
    }

    if let Some(err) = last_error {
        return Err(err);
    }

    // Collect stdout (final JSON result)
    let mut stdout_data = String::new();
    ABufReader::new(stdout)
        .read_to_string(&mut stdout_data)
        .await
        .map_err(|e| e.to_string())?;

    let status = child.wait().await.map_err(|e| e.to_string())?;

    // Clean up temp vocals file
    if audio_for_align != audio_path {
        let _ = tokio::fs::remove_file(&vocals_tmp_path).await;
    }

    if !status.success() {
        return Err(format!(
            "정렬 스크립트 오류 (exit {})",
            status.code().unwrap_or(-1)
        ));
    }

    Ok(stdout_data.trim().to_string())
}

#[tauri::command]
pub fn cancel_alignment(al_state: tauri::State<'_, AlignmentState>) {
    al_state.cancel_flag.lock().unwrap().store(true, Ordering::Relaxed);
}
