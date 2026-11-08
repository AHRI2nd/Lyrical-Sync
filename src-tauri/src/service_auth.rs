use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::path::Path;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

static OAUTH_SERVER: crate::oauth_listener::OAuthServer = crate::oauth_listener::OAuthServer::new();
static PENDING_REFRESH_TOKENS: OnceLock<Mutex<HashMap<String, (String, std::time::Instant)>>> =
    OnceLock::new();
static ACTIVE_OAUTH_STATE: OnceLock<Mutex<Option<String>>> = OnceLock::new();
const PENDING_REFRESH_TOKEN_TTL: Duration = Duration::from_secs(120);
const MAX_PENDING_REFRESH_TOKENS: usize = 8;
const MAX_LEGACY_TOKEN_BYTES: u64 = 64 * 1024;

fn token_path(app: &AppHandle) -> Result<std::path::PathBuf, String> {
    app.path().app_data_dir()
        .map(|d| d.join("spotify_token.dat"))
        .map_err(|e| e.to_string())
}

const KEYRING_SERVICE: &str = "Lyrical Sync";
const KEYRING_USER: &str = "spotify_refresh_token";
const TOKEN_REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
const MAX_OAUTH_ERROR_BODY_BYTES: usize = 16 * 1024;

#[derive(Deserialize)]
struct SpotifyOAuthError {
    error: String,
}

fn is_invalid_grant_error_body(body: &[u8]) -> bool {
    if body.len() > MAX_OAUTH_ERROR_BODY_BYTES {
        return false;
    }
    serde_json::from_slice::<SpotifyOAuthError>(body)
        .is_ok_and(|error| error.error == "invalid_grant")
}

async fn response_is_invalid_grant(mut response: reqwest::Response) -> bool {
    if response
        .content_length()
        .is_some_and(|length| length > MAX_OAUTH_ERROR_BODY_BYTES as u64)
    {
        return false;
    }
    let mut body = Vec::new();
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(chunk)) => chunk,
            Ok(None) => break,
            Err(_) => return false,
        };
        let Some(next_length) = body.len().checked_add(chunk.len()) else {
            return false;
        };
        if next_length > MAX_OAUTH_ERROR_BODY_BYTES {
            return false;
        }
        body.extend_from_slice(&chunk);
    }
    is_invalid_grant_error_body(&body)
}

fn token_client() -> Result<Client, String> {
    Client::builder()
        .timeout(TOKEN_REQUEST_TIMEOUT)
        .build()
        .map_err(|e| format!("Spotify token client initialization failed: {e}"))
}

// `npm run tauri dev`는 재빌드마다 서명(identity)이 바뀌어 매번 키체인 접근 허가를
// 새로 물어봄 → 개발 빌드에서는 키체인을 건너뛰고 평문 파일로만 저장(배포용 release
// 빌드는 서명이 안정적이므로 키체인을 그대로 사용).
fn keyring_entry() -> Result<keyring::Entry, keyring::Error> {
    if cfg!(debug_assertions) {
        return Err(keyring::Error::NoEntry);
    }
    keyring::Entry::new(KEYRING_SERVICE, KEYRING_USER)
}

/// Returned to TypeScript via Tauri (camelCase)
#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TokenResponse {
    pub access_token: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub refresh_token_handle: Option<String>,
    pub expires_in: u64,
}

/// Spotify API response (snake_case)
#[derive(Deserialize)]
struct SpotifyApiToken {
    access_token: String,
    refresh_token: Option<String>,
    expires_in: u64,
}

fn register_pending_refresh_token(token: String) -> Result<String, String> {
    let now = std::time::Instant::now();
    use base64::Engine;
    let mut random = [0u8; 32];
    getrandom::fill(&mut random).map_err(|error| format!("Could not create a secure credential handle: {error}"))?;
    let handle = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(random);
    let pending = PENDING_REFRESH_TOKENS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
    pending.retain(|_, (_, expires_at)| *expires_at > now);
    if pending.len() >= MAX_PENDING_REFRESH_TOKENS {
        return Err("Too many pending Spotify login credentials".into());
    }
    pending.insert(handle.clone(), (token, now + PENDING_REFRESH_TOKEN_TTL));
    Ok(handle)
}

fn set_active_oauth_state(state: String) {
    let active = ACTIVE_OAUTH_STATE.get_or_init(|| Mutex::new(None));
    *active.lock().unwrap_or_else(|error| error.into_inner()) = Some(state);
}

fn active_oauth_state_matches(state: &str) -> bool {
    ACTIVE_OAUTH_STATE
        .get_or_init(|| Mutex::new(None))
        .lock()
        .unwrap_or_else(|error| error.into_inner())
        .as_deref()
        == Some(state)
}

#[tauri::command]
pub async fn exchange_spotify_token(
    code: String,
    code_verifier: String,
    client_id: String,
    redirect_uri: String,
    state: String,
) -> Result<TokenResponse, String> {
    if !active_oauth_state_matches(&state) {
        return Err("oauth_state_expired".into());
    }
    let client = token_client()?;
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
        return Err(format!("Spotify token exchange failed ({})", resp.status()));
    }

    let token = resp
        .json::<SpotifyApiToken>()
        .await
        .map_err(|e| format!("응답 파싱 실패: {e}"))?;
    let active = ACTIVE_OAUTH_STATE.get_or_init(|| Mutex::new(None));
    let mut active = active.lock().unwrap_or_else(|error| error.into_inner());
    if active.as_deref() != Some(state.as_str()) {
        return Err("oauth_state_expired".into());
    }
    let refresh_token_handle = token
        .refresh_token
        .map(register_pending_refresh_token)
        .transpose()?;
    *active = None;
    Ok(TokenResponse {
        access_token: token.access_token,
        refresh_token_handle,
        expires_in: token.expires_in,
    })
}

#[tauri::command]
pub async fn refresh_spotify_token(
    client_id: String,
    app: AppHandle,
) -> Result<TokenResponse, String> {
    let refresh_token = load_refresh_token_value(&app)?.ok_or("no_refresh_token")?;
    let client = token_client()?;
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
        let status = resp.status();
        if response_is_invalid_grant(resp).await {
            return Err("invalid_grant".into());
        }
        return Err(format!("Spotify token refresh failed ({status})"));
    }

    let token = resp
        .json::<SpotifyApiToken>()
        .await
        .map_err(|e| format!("응답 파싱 실패: {e}"))?;
    if let Some(rotated) = token.refresh_token.as_deref() {
        save_refresh_token_value(&app, rotated)?;
    }
    Ok(TokenResponse {
        access_token: token.access_token,
        refresh_token_handle: None,
        expires_in: token.expires_in,
    })
}

// 평문 파일 저장 (OS 키체인 사용 불가 시 폴백). unix는 0600, windows는 icacls로
// 현재 사용자 전용 ACL(상속 제거 후 재부여)을 건다.
fn save_token_file(app: &AppHandle, token: &str) -> Result<(), String> {
    let path = token_path(app)?;
    write_restricted_token_file(&path, token)
}

fn write_restricted_token_file(path: &Path, token: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let parent = path.parent().ok_or("토큰 경로에 부모 디렉터리가 없습니다")?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|e| format!("토큰 임시 파일 생성 실패: {e}"))?;

    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o600))
            .map_err(|e| format!("토큰 파일 권한 설정 실패: {e}"))?;
    }
    #[cfg(windows)]
    {
        let path_str = temp.path().to_str().ok_or("토큰 경로를 Windows 형식으로 변환할 수 없습니다")?;
        let user = std::env::var("USERNAME").map_err(|e| format!("현재 Windows 사용자를 확인할 수 없습니다: {e}"))?;
        let domain = std::env::var("USERDOMAIN").unwrap_or_default();
        let identity = if domain.is_empty() { user } else { format!("{domain}\\{user}") };
        let grant_user = format!("{identity}:F");
        let output = std::process::Command::new("icacls")
            .args([path_str, "/inheritance:r", "/grant:r", grant_user.as_str(), "SYSTEM:F"])
            .output()
            .map_err(|e| format!("토큰 파일 ACL 도구 실행 실패: {e}"))?;
        if !output.status.success() {
            return Err(format!("토큰 파일 ACL 설정 실패: {}", String::from_utf8_lossy(&output.stderr).trim()));
        }
    }

    // Do not place secret bytes in the staging file until its access policy is set.
    temp.write_all(token.as_bytes())
        .map_err(|e| format!("토큰 저장 실패: {e}"))?;
    temp.as_file().sync_all().map_err(|e| format!("토큰 저장 실패: {e}"))?;

    temp.persist(path).map_err(|e| format!("토큰 파일 확정 실패: {}", e.error))?;
    Ok(())
}

fn save_refresh_token_value(app: &AppHandle, token: &str) -> Result<(), String> {
    // 1순위: OS 키체인(암호화 저장). 성공 후 기존 평문 파일 제거도 확인한다.
    let entry = match keyring_entry() {
        Ok(entry) => Some(entry),
        Err(keyring::Error::NoEntry) => None,
        Err(error) => return Err(format!("Spotify keyring is unavailable for save: {error}")),
    };
    if let Some(entry) = entry {
        entry
            .set_password(token)
            .map_err(|e| format!("Spotify keyring save failed: {e}"))?;
        let path = token_path(app)?;
        match std::fs::remove_file(path) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(format!("Legacy Spotify token cleanup failed: {error}")),
        }
        return Ok(());
    }
    // 폴백: 0600 평문 파일
    save_token_file(app, token)
}

fn load_refresh_token_value(app: &AppHandle) -> Result<Option<String>, String> {
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
    let path = token_path(app)?;
    let Some(token) = read_legacy_token_file(&path).map_err(|e| format!("토큰 읽기 실패: {e}"))? else {
        return Ok(None);
    };
    let trimmed = token.trim().to_string();
    Ok(if trimmed.is_empty() { None } else { Some(trimmed) })
}

fn read_legacy_token_file(path: &Path) -> Result<Option<String>, String> {
    let entry = match std::fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !entry.file_type().is_file() || entry.len() > MAX_LEGACY_TOKEN_BYTES {
        return Err("Legacy Spotify token must be a bounded regular file".into());
    }

    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
    }
    let file = options.open(path).map_err(|error| error.to_string())?;
    let metadata = file.metadata().map_err(|error| error.to_string())?;
    if !metadata.file_type().is_file() || metadata.len() > MAX_LEGACY_TOKEN_BYTES {
        return Err("Legacy Spotify token must be a bounded regular file".into());
    }

    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take(MAX_LEGACY_TOKEN_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| error.to_string())?;
    if bytes.len() as u64 > MAX_LEGACY_TOKEN_BYTES {
        return Err("Legacy Spotify token exceeds the size limit".into());
    }
    String::from_utf8(bytes)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn has_refresh_token(app: AppHandle) -> Result<bool, String> {
    load_refresh_token_value(&app).map(|token| token.is_some())
}

#[tauri::command]
pub fn persist_pending_refresh_token(handle: String, app: AppHandle) -> Result<(), String> {
    let pending = PENDING_REFRESH_TOKENS.get_or_init(|| Mutex::new(HashMap::new()));
    let mut pending = pending.lock().unwrap_or_else(|error| error.into_inner());
    let now = std::time::Instant::now();
    pending.retain(|_, (_, expires_at)| *expires_at > now);
    let Some((token, _)) = pending.get(&handle) else {
        return Err("Pending Spotify credential is missing or expired".into());
    };
    save_refresh_token_value(&app, token)?;
    pending.remove(&handle);
    Ok(())
}

/// Replace any pending login with a bounded listener authenticated by its random state.
#[tauri::command]
pub async fn start_oauth_listener(app: AppHandle, state: String) -> Result<(), String> {
    clear_pending_refresh_tokens();
    set_active_oauth_state(state.clone());
    let result = OAUTH_SERVER
        .start("127.0.0.1:8888", state, move |url| {
            let _ = app.emit("spotify-callback", url);
        })
        .await;
    if let Err(error) = result {
        clear_pending_refresh_tokens();
        return Err(format!("OAuth listener failed: {error}"));
    }
    Ok(())
}

#[tauri::command]
pub async fn cancel_oauth_listener() {
    OAUTH_SERVER.cancel().await;
    clear_pending_refresh_tokens();
}

fn clear_pending_refresh_tokens() {
    if let Some(active) = ACTIVE_OAUTH_STATE.get() {
        *active.lock().unwrap_or_else(|error| error.into_inner()) = None;
    }
    if let Some(pending) = PENDING_REFRESH_TOKENS.get() {
        pending
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .clear();
    }
}

#[tauri::command]
pub fn clear_refresh_token(app: AppHandle) -> Result<(), String> {
    clear_pending_refresh_tokens();
    // 키체인 + 레거시 파일 모두 제거
    let keyring_result = match keyring_entry() {
        Ok(entry) => match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(format!("Spotify keyring cleanup failed: {error}")),
        },
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(format!(
            "Spotify keyring is unavailable for cleanup: {error}"
        )),
    };
    let file_result = token_path(&app).and_then(|path| match std::fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("Legacy Spotify token cleanup failed: {error}")),
    });

    match (keyring_result, file_result) {
        (Ok(()), Ok(())) => Ok(()),
        (Err(keyring_error), Ok(())) => Err(keyring_error),
        (Ok(()), Err(file_error)) => Err(file_error),
        (Err(keyring_error), Err(file_error)) => Err(format!("{keyring_error}; {file_error}")),
    }
}

#[cfg(test)]
mod token_file_tests {
    use super::{
        active_oauth_state_matches, clear_pending_refresh_tokens, register_pending_refresh_token,
        read_legacy_token_file, set_active_oauth_state, write_restricted_token_file,
        TokenResponse, MAX_LEGACY_TOKEN_BYTES,
    };

    #[test]
    fn legacy_refresh_token_reader_accepts_only_bounded_regular_files() {
        let dir = tempfile::tempdir().unwrap();
        let valid = dir.path().join("valid-token");
        std::fs::write(&valid, "legacy-refresh-token\n").unwrap();
        assert_eq!(read_legacy_token_file(&valid).unwrap().as_deref(), Some("legacy-refresh-token\n"));

        let oversized = dir.path().join("oversized-token");
        std::fs::write(&oversized, vec![b'x'; MAX_LEGACY_TOKEN_BYTES as usize + 1]).unwrap();
        assert!(read_legacy_token_file(&oversized).is_err());

        let directory = dir.path().join("directory-token");
        std::fs::create_dir(&directory).unwrap();
        assert!(read_legacy_token_file(&directory).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn legacy_refresh_token_reader_rejects_symlinks() {
        use std::os::unix::fs::symlink;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("target");
        let link = dir.path().join("token-link");
        std::fs::write(&target, "legacy-refresh-token").unwrap();
        symlink(&target, &link).unwrap();
        assert!(read_legacy_token_file(&link).is_err());
    }

    #[test]
    fn superseded_oauth_state_cannot_authorize_token_exchange() {
        clear_pending_refresh_tokens();
        set_active_oauth_state("current-state".into());

        assert!(active_oauth_state_matches("current-state"));
        assert!(!active_oauth_state_matches("previous-state"));
        let first = register_pending_refresh_token("secret-refresh-token".into()).unwrap();
        let second = register_pending_refresh_token("another-refresh-token".into()).unwrap();
        assert_eq!(first.len(), 43);
        assert_ne!(first, second);
        assert!(!first.contains("secret-refresh-token"));
        clear_pending_refresh_tokens();
        assert!(!active_oauth_state_matches("current-state"));
    }

    #[test]
    fn renderer_token_response_never_serializes_a_refresh_token() {
        let response = TokenResponse {
            access_token: "short-lived-access".into(),
            refresh_token_handle: None,
            expires_in: 3600,
        };

        let serialized = serde_json::to_value(response).unwrap();
        assert_eq!(
            serialized,
            serde_json::json!({
                "accessToken": "short-lived-access",
                "expiresIn": 3600,
            })
        );
    }

    #[cfg(unix)]
    #[test]
    fn refresh_token_file_is_created_with_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("token.dat");

        write_restricted_token_file(&path, "secret-token").unwrap();

        assert_eq!(std::fs::metadata(path).unwrap().permissions().mode() & 0o777, 0o600);
    }

    #[test]
    fn refresh_error_recognizes_only_a_bounded_invalid_grant_body() {
        use super::{is_invalid_grant_error_body, MAX_OAUTH_ERROR_BODY_BYTES};

        assert!(is_invalid_grant_error_body(br#"{"error":"invalid_grant"}"#));
        assert!(!is_invalid_grant_error_body(br#"{"error":"invalid_client"}"#));
        assert!(!is_invalid_grant_error_body(b"invalid_grant"));
        assert!(!is_invalid_grant_error_body(&vec![b'x'; MAX_OAUTH_ERROR_BODY_BYTES + 1]));
    }
}
