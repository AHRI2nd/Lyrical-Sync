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
