fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let target_arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    assert!(
        target_os != "macos" || target_arch == "aarch64",
        "Lyrical Sync supports Apple Silicon Macs only; Intel macOS is unsupported."
    );
    println!("cargo:rerun-if-changed=windows-app.manifest");
    let manifest = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("windows-app.manifest");
    let manifest_path = manifest.to_string_lossy().replace('\\', "\\\\");
    // Embed the file verbatim; inline RC strings add padding before the XML declaration.
    let windows = tauri_build::WindowsAttributes::new_without_app_manifest()
        .append_rc_content(format!("1 24 \"{manifest_path}\""));
    let attributes = tauri_build::Attributes::new().windows_attributes(windows);
    tauri_build::try_build(attributes).expect("failed to build Tauri application resources");
}
