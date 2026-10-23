use std::path::{Path, PathBuf};

pub fn python_root(base: &Path, os: &str, arch: &str) -> PathBuf {
    base.join(if os == "windows" && arch == "aarch64" {
        "embedded_python_arm64"
    } else {
        "embedded_python"
    })
}

pub fn ytdlp_root(base: &Path, os: &str, arch: &str) -> PathBuf {
    base.join(if os == "windows" && arch == "aarch64" {
        "ytdlp-arm64"
    } else {
        "ytdlp"
    })
}

pub fn ytdlp_asset(os: &str, arch: &str) -> (&'static str, &'static str) {
    if os == "windows" {
        (
            if arch == "aarch64" {
                "yt-dlp_arm64.exe"
            } else {
                "yt-dlp.exe"
            },
            "yt-dlp.exe",
        )
    } else {
        ("yt-dlp_macos", "yt-dlp")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn arm_python_installation_cannot_overwrite_existing_x64_runtime() {
        let data = tempfile::tempdir().unwrap();
        let x64 = python_root(data.path(), "windows", "x86_64");
        let arm = python_root(data.path(), "windows", "aarch64");
        std::fs::create_dir_all(&x64).unwrap();
        std::fs::write(x64.join("interpreter"), "x64 runtime").unwrap();
        std::fs::create_dir_all(&arm).unwrap();
        std::fs::write(arm.join("interpreter"), "ARM runtime").unwrap();
        assert_eq!(
            std::fs::read_to_string(x64.join("interpreter")).unwrap(),
            "x64 runtime"
        );
        assert_ne!(x64, arm);
    }

    #[test]
    fn arm_ytdlp_installation_cannot_replace_existing_x64_helper() {
        let data = tempfile::tempdir().unwrap();
        let x64 = ytdlp_root(data.path(), "windows", "x86_64");
        let arm = ytdlp_root(data.path(), "windows", "aarch64");
        std::fs::create_dir_all(&x64).unwrap();
        std::fs::write(x64.join("yt-dlp.exe"), "x64 helper").unwrap();
        std::fs::create_dir_all(&arm).unwrap();
        std::fs::write(arm.join("yt-dlp.exe"), "ARM helper").unwrap();
        assert_eq!(
            std::fs::read_to_string(x64.join("yt-dlp.exe")).unwrap(),
            "x64 helper"
        );
        assert_eq!(ytdlp_asset("windows", "aarch64").0, "yt-dlp_arm64.exe");
    }

    #[test]
    fn x64_and_macos_keep_existing_paths_and_assets() {
        let root = Path::new("application-data");
        for (os, arch) in [("windows", "x86_64"), ("macos", "aarch64")] {
            assert_eq!(python_root(root, os, arch), root.join("embedded_python"));
            assert_eq!(ytdlp_root(root, os, arch), root.join("ytdlp"));
        }
        assert_eq!(
            ytdlp_asset("windows", "x86_64"),
            ("yt-dlp.exe", "yt-dlp.exe")
        );
        assert_eq!(ytdlp_asset("macos", "aarch64"), ("yt-dlp_macos", "yt-dlp"));
    }
}
