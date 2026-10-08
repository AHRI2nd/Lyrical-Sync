// Security-scoped bookmarks are an Apple sandbox mechanism.
// Keep the IPC contract available; other platforms persist ordinary file paths.
#[tauri::command]
pub fn create_security_bookmark(path: String) -> Result<Option<String>, String> {
    let _ = path;
    Ok(None)
}

#[tauri::command]
pub fn resolve_security_bookmark(bookmark: String) -> Result<String, String> {
    let _ = bookmark;
    Err("Security-scoped bookmarks are only supported on macOS".into())
}
