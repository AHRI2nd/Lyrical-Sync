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

/// Validates a URL for yt-dlp to prevent SSRF attacks
pub fn validate_ytdlp_url(url: &str) -> Result<(), String> {
    let parsed = url::Url::parse(url).map_err(|_| "Invalid URL")?;
    
    if parsed.scheme() != "https" {
        return Err("Only HTTPS YouTube URLs are allowed".into());
    }
    
    let host = parsed.host_str().ok_or("URL host is required")?;
    if is_private_ip(host) {
        return Err("Restricted IP addresses are not allowed".into());
    }

    let normalized_host = host.trim_end_matches('.').to_ascii_lowercase();
    if normalized_host == "localhost"
        || normalized_host.ends_with(".localhost")
        || normalized_host.ends_with(".local")
        || normalized_host.ends_with(".internal")
        || normalized_host == "home.arpa"
        || normalized_host.ends_with(".home.arpa")
    {
        return Err("Local host names are not allowed".into());
    }
    let is_youtube_host = normalized_host == "youtube.com"
        || normalized_host
            .strip_suffix(".youtube.com")
            .is_some_and(|prefix| !prefix.is_empty() && !prefix.ends_with('.'))
        || normalized_host == "youtu.be";
    if !is_youtube_host {
        return Err("Only YouTube video URLs are supported".into());
    }
    
    Ok(())
}

pub fn require_filesystem_scope(
    path: &Path,
    is_allowed: impl FnOnce(&Path) -> bool,
) -> Result<(), String> {
    if is_allowed(path) {
        Ok(())
    } else {
        Err("Path is outside the granted filesystem scope".into())
    }
}

fn is_private_ip(host: &str) -> bool {
    let host = host.trim_start_matches('[').trim_end_matches(']');
    if let Ok(ip) = host.parse::<std::net::IpAddr>() {
        match ip {
            std::net::IpAddr::V4(ipv4) => {
                let octets = ipv4.octets();
                return octets[0] == 0
                    || octets[0] == 10
                    || (octets[0] == 100 && (64..=127).contains(&octets[1]))
                    || octets[0] == 127
                    || (octets[0] == 169 && octets[1] == 254)
                    || (octets[0] == 172 && (16..=31).contains(&octets[1]))
                    || (octets[0] == 192 && octets[1] == 0 && octets[2] <= 2)
                    || (octets[0] == 192 && octets[1] == 88 && octets[2] == 99)
                    || (octets[0] == 192 && octets[1] == 168)
                    || (octets[0] == 198 && (18..=19).contains(&octets[1]))
                    || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100)
                    || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113)
                    || octets[0] >= 224;
            }
            std::net::IpAddr::V6(ipv6) => {
                let segments = ipv6.segments();
                return ipv6.is_unspecified()
                    || ipv6.is_loopback()
                    || ipv6.is_multicast()
                    || ipv6.is_unique_local()
                    || ipv6.is_unicast_link_local()
                    || ipv6.to_ipv4().is_some()
                    || segments[0] & 0xe000 != 0x2000
                    || (segments[0] == 0x2001 && segments[1] == 0x0db8)
                    || (segments[0] == 0x3fff && segments[1] & 0xf000 == 0)
                    || segments[0] == 0x2002
                    || (segments[0] == 0x2001 && segments[1] == 0);
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

#[cfg(test)]
mod ytdlp_url_tests {
    use super::validate_ytdlp_url;

    #[test]
    fn rejects_non_global_ip_literals_and_local_host_names() {
        let denied = [
            "http://0.1.2.3/video",
            "http://100.64.0.1/video",
            "http://192.0.2.1/video",
            "http://198.18.0.1/video",
            "http://224.0.0.1/video",
            "http://255.255.255.255/video",
            "http://[::]/video",
            "http://[::ffff:127.0.0.1]/video",
            "http://[2001:db8::1]/video",
            "http://[3fff::1]/video",
            "http://[2002:7f00:1::]/video",
            "http://localhost./video",
            "http://printer.local/video",
            "http://service.internal/video",
        ];

        for url in denied {
            assert!(validate_ytdlp_url(url).is_err(), "accepted {url}");
        }
    }

    #[test]
    fn accepts_https_youtube_urls_and_rejects_public_non_youtube_hosts() {
        assert!(validate_ytdlp_url("https://www.youtube.com/watch?v=abc").is_ok());
        assert!(validate_ytdlp_url("https://youtu.be/abc").is_ok());
        assert!(validate_ytdlp_url("http://www.youtube.com/watch?v=abc").is_err());
        assert!(validate_ytdlp_url("https://203.0.114.1/video").is_err());
    }

    #[test]
    fn only_accepts_secure_youtube_video_hosts() {
        assert!(validate_ytdlp_url("https://youtube.com/watch?v=abc").is_ok());
        assert!(validate_ytdlp_url("https://music.youtube.com/watch?v=abc").is_ok());
        assert!(validate_ytdlp_url("https://youtu.be/abc").is_ok());
        assert!(validate_ytdlp_url("https://example.com/video").is_err());
        assert!(validate_ytdlp_url("https://youtube.com.example.org/watch?v=abc").is_err());
        assert!(validate_ytdlp_url("https://.youtube.com/watch?v=abc").is_err());
        assert!(validate_ytdlp_url("http://www.youtube.com/watch?v=abc").is_err());
    }
}

#[cfg(test)]
mod filesystem_scope_tests {
    use super::require_filesystem_scope;
    use std::path::Path;

    #[test]
    fn requires_an_explicit_native_filesystem_grant() {
        let selected = Path::new("/picked/audio.wav");
        assert!(require_filesystem_scope(selected, |path| path == selected).is_ok());
        assert_eq!(
            require_filesystem_scope(selected, |_| false).unwrap_err(),
            "Path is outside the granted filesystem scope"
        );
    }
}
