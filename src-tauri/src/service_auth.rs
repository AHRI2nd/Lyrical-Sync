use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::{AppHandle, Manager, Emitter};

static OAUTH_LISTENING: AtomicBool = AtomicBool::new(false);

fn token_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir()
        .map(|d| d.join("spotify_token.dat"))
        .map_err(|e| e.to_string())
}

const KEYRING_SERVICE: &str = "Lyrical Sync";
const KEYRING_USER: &str = "spotify_refresh_token";

fn keyring_entry() -> Result<keyring::Entry, keyring::Error> {
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
}

/// Returned to TypeScript via Tauri (camelCase)
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: u64,
}

/// Spotify API response (snake_case)
#[derive(Deserialize)]
struct SpotifyApiToken {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

impl From<SpotifyApiToken> for TokenResponse {
    fn from(t: SpotifyApiToken) -> Self {
        TokenResponse {
            access_token: t.access_token,
            refresh_token: t.refresh_token,
            expires_in: t.expires_in,
        }
    }
}

#[tauri::command]
pub async fn exchange_spotify_token(
    code: String,
    code_verifier: String,
    client_id: String,
    redirect_uri: String,
) -> Result<TokenResponse, String> {
    let client = Client::new();
    let mut params = HashMap::new();
    params.insert("grant_type", "authorization_code");
    params.insert("code", code.as_str());
    params.insert("redirect_uri", redirect_uri.as_str());
    params.insert("client_id", client_id.as_str());
    params.insert("code_verifier", code_verifier.as_str());

    let resp = client
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("토큰 요청 실패: {e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("토큰 발급 실패: {text}"));
    }

    resp.json::<SpotifyApiToken>()
        .await
        .map(TokenResponse::from)
        .map_err(|e| format!("응답 파싱 실패: {e}"))
}

#[tauri::command]
pub async fn refresh_spotify_token(
    refresh_token: String,
    client_id: String,
) -> Result<TokenResponse, String> {
    let client = Client::new();
    let mut params = HashMap::new();
    params.insert("grant_type", "refresh_token");
    params.insert("refresh_token", refresh_token.as_str());
    params.insert("client_id", client_id.as_str());

    let resp = client
        .post("https://accounts.spotify.com/api/token")
        .form(&params)
        .send()
        .await
        .map_err(|e| format!("토큰 갱신 요청 실패: {e}"))?;

    if !resp.status().is_success() {
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("토큰 갱신 실패: {text}"));
    }

    resp.json::<SpotifyApiToken>()
        .await
        .map(TokenResponse::from)
        .map_err(|e| format!("응답 파싱 실패: {e}"))
}

// 평문 파일 저장 (OS 키체인 사용 불가 시 폴백). unix는 0600.
fn save_token_file(app: &AppHandle, token: &str) -> Result<(), String> {
    let path = token_path(app)?;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&path, token.as_bytes()).map_err(|e| format!("토큰 저장 실패: {e}"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

#[tauri::command]
pub fn save_refresh_token(token: String, app: AppHandle) -> Result<(), String> {
    // 1순위: OS 키체인(암호화 저장). 성공 시 기존 평문 파일은 제거(마이그레이션).
    if let Ok(entry) = keyring_entry() {
        if entry.set_password(&token).is_ok() {
            if let Ok(path) = token_path(&app) {
                let _ = std::fs::remove_file(path);
            }
            return Ok(());
        }
    }
    // 폴백: 0600 평문 파일
    save_token_file(&app, &token)
}

#[tauri::command]
pub fn load_refresh_token(app: AppHandle) -> Result<Option<String>, String> {
    // 1순위: 키체인
    if let Ok(entry) = keyring_entry() {
        match entry.get_password() {
            Ok(t) => {
                let trimmed = t.trim().to_string();
                return Ok(if trimmed.is_empty() { None } else { Some(trimmed) });
            }
            Err(keyring::Error::NoEntry) => {} // 키체인에 없음 → 레거시 파일 확인
            Err(_) => {}                        // 키체인 사용 불가 → 파일 폴백
        }
    }
    // 폴백/레거시: 평문 파일
    let path = token_path(&app)?;
    if !path.exists() {
        return Ok(None);
    }
    let token = std::fs::read_to_string(&path).map_err(|e| format!("토큰 읽기 실패: {e}"))?;
    let trimmed = token.trim().to_string();
    Ok(if trimmed.is_empty() { None } else { Some(trimmed) })
}

/// Binds a one-shot HTTP server on port 8888 and waits for the Spotify OAuth callback.
/// On success, emits a "spotify-callback" event with the full callback URL string.
#[tauri::command]
pub async fn start_oauth_listener(app: AppHandle) -> Result<(), String> {
    // Already listening — reuse existing listener instead of double-binding
    if OAUTH_LISTENING.swap(true, Ordering::SeqCst) {
        return Ok(());
    }

    let listener = match TcpListener::bind("127.0.0.1:8888") {
        Ok(l) => l,
        Err(e) => {
            OAUTH_LISTENING.store(false, Ordering::SeqCst);
            return Err(format!("포트 8888 사용 불가: {e}\n다른 프로그램이 해당 포트를 사용 중입니다."));
        }
    };

    tokio::task::spawn_blocking(move || {
        if let Ok((mut stream, _)) = listener.accept() {
            let mut buf = vec![0u8; 4096];
            let n = stream.read(&mut buf).unwrap_or(0);
            let request = String::from_utf8_lossy(&buf[..n]).to_string();

            // Parse path from "GET /callback?code=...&state=... HTTP/1.1"
            let path = request.split_whitespace().nth(1).unwrap_or("/callback");
            let callback_url = format!("http://127.0.0.1:8888{path}");

            let body = "<html><body style='font-family:sans-serif;text-align:center;padding:60px;background:#111;color:#eee'>\
                <h2 style='color:#1db954'>✅ 연결 완료</h2>\
                <p>이 창을 닫고 Lyrical Sync로 돌아가세요.</p>\
                </body></html>";
            let response = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n\r\n{}",
                body.len(), body
            );
            let _ = stream.write_all(response.as_bytes());

            let _ = app.emit("spotify-callback", callback_url);
        }
        OAUTH_LISTENING.store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
pub fn clear_refresh_token(app: AppHandle) -> Result<(), String> {
    // 키체인 + 레거시 파일 모두 제거
    if let Ok(entry) = keyring_entry() {
        let _ = entry.delete_credential();
    }
    let path = token_path(&app)?;
    if path.exists() {
        std::fs::remove_file(&path).map_err(|e| format!("토큰 삭제 실패: {e}"))?;
    }
    Ok(())
}
