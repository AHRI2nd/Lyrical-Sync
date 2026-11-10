use std::path::{Path, PathBuf};

const PROVENANCE: &str = include_str!("../resources/ai-common/provenance.json");
const DEMUCS_WHEEL: (&str, &[u8]) = (
    "demucs-4.0.1-py3-none-any.whl",
    include_bytes!("../resources/ai-common/demucs-4.0.1-py3-none-any.whl"),
);

fn stage_wheel(path: &Path, bytes: &[u8], expected: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    if format!("{:x}", Sha256::digest(bytes)) != expected {
        return Err("Bundled AI wheel checksum mismatch".into());
    }
    std::fs::write(path, bytes).map_err(|error| error.to_string())
}

pub fn stage_common_ai_wheels(root: &Path) -> Result<Vec<PathBuf>, String> {
    let provenance: serde_json::Value =
        serde_json::from_str(PROVENANCE).map_err(|error| error.to_string())?;
    let wheel = &provenance["wheel"];
    if wheel["file"].as_str() != Some(DEMUCS_WHEEL.0) {
        return Err("Invalid common AI wheel inventory".into());
    }
    let expected = wheel["sha256"].as_str().ok_or("Missing AI wheel digest")?;
    std::fs::create_dir_all(root).map_err(|error| error.to_string())?;
    let path = root.join(DEMUCS_WHEEL.0);
    stage_wheel(&path, DEMUCS_WHEEL.1, expected)?;
    Ok(vec![path])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn altered_common_wheel_is_rejected_before_writing_staged_packages() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("wheel.whl");
        assert!(stage_wheel(&path, b"changed payload", &"0".repeat(64)).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn pinned_common_wheel_is_staged_with_its_expected_filename() {
        let root = tempfile::tempdir().unwrap();
        let files = stage_common_ai_wheels(root.path()).unwrap();
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].file_name().unwrap(), DEMUCS_WHEEL.0);
        assert!(files[0].is_file());
    }
}
