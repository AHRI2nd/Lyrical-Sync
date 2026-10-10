fn policy_url(language: &str) -> Result<&'static str, String> {
    match language {
        "ko" => Ok("https://ahri2nd.xyz/posts/lyrical-sync-privacy-policy/"),
        "en" => Ok("https://ahri2nd.xyz/posts/lyrical-sync-privacy-policy-en/"),
        "ja" => Ok("https://ahri2nd.xyz/posts/lyrical-sync-privacy-policy-ja/"),
        _ => Err("Unsupported policy language".into()),
    }
}

#[tauri::command]
pub fn open_privacy_policy(app: tauri::AppHandle, language: String) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url(policy_url(&language)?, None::<&str>)
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn open_microsoft_privacy_policy(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_opener::OpenerExt;
    app.opener()
        .open_url("https://privacy.microsoft.com/privacystatement", None::<&str>)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::policy_url;
    #[test]
    fn only_registered_languages_can_open_a_policy() {
        for language in ["ko", "en", "ja"] {
            assert!(policy_url(language).unwrap().starts_with("https://ahri2nd.xyz/posts/lyrical-sync-privacy-policy"));
        }
        for invalid in ["", "https://example.com", "file:///etc/passwd", "ko/../../"] {
            assert!(policy_url(invalid).is_err());
        }
    }
}
