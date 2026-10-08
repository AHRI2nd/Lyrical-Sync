// This runs before Tauri creates threads or a WebView. The MSIX packager
// supplies the complete Fixed Version runtime beside the executable.
pub fn configure() -> Result<(), Box<dyn std::error::Error>> {
    let executable = std::env::current_exe()?;
    let runtime = executable.parent().ok_or("executable has no parent")?.join("WebView2");
    if !runtime.join("msedgewebview2.exe").is_file() {
        return Err("MS Store builds require the bundled WebView2 directory".into());
    }
    std::env::set_var("WEBVIEW2_BROWSER_EXECUTABLE_FOLDER", runtime);
    Ok(())
}
