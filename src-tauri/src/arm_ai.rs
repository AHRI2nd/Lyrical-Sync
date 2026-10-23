use std::path::{Path, PathBuf};

const PROVENANCE: &str = include_str!("../resources/windows-arm64-ai/provenance.json");
const WHEELS: &[(&str, &[u8])] = &[
    (
        "torchaudio-2.11.0-cp312-cp312-win_arm64.whl",
        include_bytes!("../resources/windows-arm64-ai/torchaudio-2.11.0-cp312-cp312-win_arm64.whl"),
    ),
    (
        "soxr-1.1.0-cp312-abi3-win_arm64.whl",
        include_bytes!("../resources/windows-arm64-ai/soxr-1.1.0-cp312-abi3-win_arm64.whl"),
    ),
    (
        "ctc_forced_aligner-1.0.2-cp312-cp312-win_arm64.whl",
        include_bytes!(
            "../resources/windows-arm64-ai/ctc_forced_aligner-1.0.2-cp312-cp312-win_arm64.whl"
        ),
    ),
];

fn stage_wheel(path: &Path, bytes: &[u8], expected: &str) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    if format!("{:x}", Sha256::digest(bytes)) != expected {
        return Err("Bundled Windows ARM64 wheel checksum mismatch".into());
    }
    std::fs::write(path, bytes).map_err(|e| e.to_string())
}

pub fn stage_bundled_wheels(root: &Path) -> Result<Vec<PathBuf>, String> {
    let provenance: serde_json::Value =
        serde_json::from_str(PROVENANCE).map_err(|e| e.to_string())?;
    let specs = provenance["wheels"]
        .as_array()
        .ok_or("Missing wheel provenance")?;
    if specs.len() != WHEELS.len() {
        return Err("Invalid wheel inventory".into());
    }
    std::fs::create_dir_all(root).map_err(|e| e.to_string())?;
    let mut paths = Vec::new();
    for (name, bytes) in WHEELS {
        let spec = specs
            .iter()
            .find(|spec| spec["file"].as_str() == Some(name))
            .ok_or("Missing wheel digest")?;
        let expected = spec["sha256"].as_str().ok_or("Missing wheel digest")?;
        let path = root.join(name);
        stage_wheel(&path, bytes, expected)?;
        paths.push(path);
    }
    Ok(paths)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn altered_wheel_is_rejected_before_writing_staged_packages() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("wheel.whl");
        assert!(stage_wheel(&path, b"changed payload", &"0".repeat(64)).is_err());
        assert!(!path.exists());
    }

    #[test]
    fn complete_bundled_wheel_inventory_is_staged() {
        let root = tempfile::tempdir().unwrap();
        let files = stage_bundled_wheels(root.path()).unwrap();
        assert_eq!(files.len(), 3);
        assert!(files.iter().all(|file| file.is_file()));
    }
}
