fn main() {
    let os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let arch = std::env::var("CARGO_CFG_TARGET_ARCH").unwrap_or_default();
    assert!(os != "macos" || arch == "aarch64", "Lyrical Sync supports Apple Silicon Macs only; Intel macOS is unsupported.");
    
    // Watch for changes in permissions and capabilities directories
    println!("cargo:rerun-if-changed=permissions");
    println!("cargo:rerun-if-changed=capabilities");
    
    tauri_build::build()
}
