// Path validation utilities to prevent path traversal attacks
use std::path::{Path, PathBuf};

/// Validates that a path is safe to access (no traversal, within allowed directories)
pub fn validate_safe_path(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    
    // Check for path traversal attempts
    if path.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Path traversal not allowed".into());
    }
    
    // Ensure path is absolute
    if !path.is_absolute() {
        return Err("Relative paths not allowed".into());
    }
    
    // Canonicalize to resolve any symlinks
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    
    Ok(canonical)
}

/// Validate a lyric save destination. Unlike reads, Save As may target a file
/// that does not yet exist; only its parent directory must already exist.
/// Resolve existing files (including symlinks) exactly as read paths do.
pub fn validate_write_path(path: &str) -> Result<PathBuf, String> {
    let destination = Path::new(path);
    if destination.components().any(|c| matches!(c, std::path::Component::ParentDir)) {
        return Err("Path traversal not allowed".into());
    }
    if !destination.is_absolute() {
        return Err("Relative paths not allowed".into());
    }

    match destination.symlink_metadata() {
        // An existing symlink must resolve to an existing target. In particular,
        // never reinterpret a dangling symlink as a new, writable filename.
        Ok(_) => destination.canonicalize().map_err(|e| e.to_string()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = destination.parent().ok_or("Missing parent directory")?;
            let filename = destination.file_name().ok_or("Missing destination filename")?;
            let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
            if !canonical_parent.is_dir() {
                return Err("Destination parent is not a directory".into());
            }
            Ok(canonical_parent.join(filename))
        }
        Err(error) => Err(error.to_string()),
    }
}

/// Validates that a path is within the allowed audio directories
pub fn validate_audio_path(path: &str) -> Result<PathBuf, String> {
    let path = validate_safe_path(path)?;
    
    // Check if path is within common audio directories
    let allowed_dirs = [
        dirs::audio_dir(),
        dirs::download_dir(),
        dirs::document_dir(),
        dirs::desktop_dir(),
    ];
    
    let mut is_allowed = false;
    for dir in allowed_dirs.iter().flatten() {
        if path.starts_with(dir) {
            is_allowed = true;
            break;
        }
    }
    
    // Also allow temp directory for processing
    if let Some(temp_dir) = std::env::temp_dir().canonicalize().ok() {
        if path.starts_with(&temp_dir) {
            is_allowed = true;
        }
    }
    
    if !is_allowed {
        return Err("Path not in allowed directory".into());
    }
    
    Ok(path)
}

/// Validates a URL for yt-dlp to prevent SSRF attacks
pub fn validate_ytdlp_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL")?;
    
    // Only allow http/https schemes
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err("Only HTTP/HTTPS URLs allowed".into());
    }
    
    // Block private IP ranges to prevent SSRF
    if let Some(host) = parsed.host_str() {
        if is_private_ip(host) {
            return Err("Private IP addresses not allowed".into());
        }
        
        // Block localhost
        if host == "localhost" || host == "127.0.0.1" || host == "::1" {
            return Err("Localhost not allowed".into());
        }
    }
    
    Ok(())
}

fn is_private_ip(host: &str) -> bool {
    // Check for private IP ranges
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();
                // 10.0.0.0/8
                if octets[0] == 10 { return true; }
                // 172.16.0.0/12
                if octets[0] == 172 && octets[1] >= 16 && octets[1] <= 31 { return true; }
                // 192.168.0.0/16
                if octets[0] == 192 && octets[1] == 168 { return true; }
                // 127.0.0.0/8 (loopback)
                if octets[0] == 127 { return true; }
                // 169.254.0.0/16 (link-local)
                if octets[0] == 169 && octets[1] == 254 { return true; }
            }
            std::net::IpAddr::V6(ipv6) => {
                let segments = ipv6.segments();
                // ::1 (loopback)
                if ipv6.is_loopback() { return true; }
                // fe80::/10 (link-local)
                if segments[0] & 0xffc0 == 0xfe80 { return true; }
                // fc00::/7 (unique local)
                if segments[0] & 0xfe00 == 0xfc00 { return true; }
            }
        }
    }
    false
}

#[cfg(test)]
mod write_path_tests {
    use super::{validate_safe_path, validate_write_path};
    use crate::atomic_write::write_atomic;
    use std::fs;

    #[test]
    fn new_save_as_requires_existing_parent_but_not_existing_file() {
        let root = tempfile::tempdir().unwrap();
        let new_path = root.path().join("new-song.lrc");
        let new_path_str = new_path.to_str().unwrap();

        assert!(validate_safe_path(new_path_str).is_err()); // Reading still requires a file.
        let resolved = validate_write_path(new_path_str).unwrap();
        assert_eq!(resolved, root.path().canonicalize().unwrap().join("new-song.lrc"));
        write_atomic(&resolved, "[00:01.00]First").unwrap();
        assert_eq!(fs::read_to_string(&new_path).unwrap(), "[00:01.00]First");

        // Existing-file saves continue to resolve normally and replace its content.
        let existing = validate_write_path(new_path_str).unwrap();
        assert_eq!(existing, resolved);
        write_atomic(&existing, "[00:02.00]Second").unwrap();
        assert_eq!(fs::read_to_string(&new_path).unwrap(), "[00:02.00]Second");
    }

    #[test]
    fn rejects_traversal_relative_paths_and_missing_parents_without_writing() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("original.lrc");
        fs::write(&original, "original bytes").unwrap();

        assert!(validate_write_path("relative.lrc").is_err());
        assert!(validate_write_path(&root.path().join("../outside.lrc").to_string_lossy()).is_err());
        assert!(validate_write_path(&root.path().join("missing/child.lrc").to_string_lossy()).is_err());
        // A directory must not become a file even if path resolution succeeds.
        let directory = validate_write_path(root.path().to_str().unwrap()).unwrap();
        assert!(write_atomic(&directory, "not a lyric").is_err());
        assert_eq!(fs::read_to_string(&original).unwrap(), "original bytes");
        assert!(!root.path().join("missing").exists());
    }

    #[test]
    fn validation_does_not_create_or_modify_an_existing_file() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("existing.lrc");
        fs::write(&original, "original bytes").unwrap();
        assert_eq!(validate_write_path(original.to_str().unwrap()).unwrap(), original.canonicalize().unwrap());
        assert_eq!(fs::read_to_string(&original).unwrap(), "original bytes");
    }

    #[cfg(unix)]
    #[test]
    fn resolves_existing_symlink_and_symlinked_parent_but_rejects_dangling_leaf() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let actual = root.path().join("actual");
        fs::create_dir(&actual).unwrap();
        let alias = root.path().join("alias");
        symlink(&actual, &alias).unwrap();
        let target = actual.join("saved.lrc");
        fs::write(&target, "before").unwrap();
        let link = alias.join("link.lrc");
        symlink(&target, &link).unwrap();

        let resolved = validate_write_path(link.to_str().unwrap()).unwrap();
        assert_eq!(resolved, target.canonicalize().unwrap());
        write_atomic(&resolved, "after").unwrap();
        assert!(fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(fs::read_to_string(&target).unwrap(), "after");

        let new_path = alias.join("another.lrc");
        assert_eq!(validate_write_path(new_path.to_str().unwrap()).unwrap(), actual.canonicalize().unwrap().join("another.lrc"));

        let dangling = actual.join("dangling.lrc");
        symlink(actual.join("missing-target.lrc"), &dangling).unwrap();
        assert!(validate_write_path(dangling.to_str().unwrap()).is_err());
        assert!(fs::symlink_metadata(&dangling).unwrap().file_type().is_symlink());
        assert!(!actual.join("missing-target.lrc").exists());
    }
}
