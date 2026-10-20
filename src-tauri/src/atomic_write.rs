use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

pub fn write_atomic(path: &Path, content: &str) -> io::Result<()> {
    write_with(path, |file| file.write_all(content.as_bytes()))
}

fn write_with(path: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    // Follow an existing symlink, as the previous direct write did, but never
    // replace a dangling link or bypass a read-only destination by renaming.
    let (target, permissions) = match fs::symlink_metadata(path) {
        Ok(_) => {
            let target = fs::canonicalize(path)?;
            let existing = OpenOptions::new().write(true).open(&target)?;
            let metadata = existing.metadata()?;
            if !metadata.is_file() {
                return Err(io::Error::other("Destination is not a regular file"));
            }
            (target, Some(metadata.permissions()))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => (PathBuf::from(path), None),
        Err(error) => return Err(error),
    };
    let parent = target.parent().filter(|p| !p.as_os_str().is_empty()).unwrap_or(Path::new("."));
    let mut stage = tempfile::NamedTempFile::new_in(parent)?;
    write(stage.as_file_mut())?;
    if let Some(permissions) = permissions { stage.as_file().set_permissions(permissions)?; }
    stage.as_file_mut().flush()?;
    stage.as_file().sync_all()?;
    stage.persist(&target).map_err(|error| error.error)?;
    // A successful return includes directory durability on Unix. A sync failure
    // after the rename is reported as uncertain durability, never as success.
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    #[test]
    fn interrupted_write_preserves_original_and_removes_stage() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("song.lrc");
        std::fs::write(&path, "original").unwrap();
        let result = write_with(&path, |file| {
            file.write_all(b"partial")?;
            Err(std::io::Error::other("simulated disk full"))
        });
        assert!(result.is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn creates_and_replaces_complete_documents() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("song.lrc");
        write_atomic(&path, "first").unwrap();
        write_atomic(&path, "second").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "second");
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn failed_commit_keeps_existing_directory_intact() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("folder");
        std::fs::create_dir(&target).unwrap();
        assert!(write_atomic(&target, "no").is_err());
        assert!(target.is_dir());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn follows_symlink_without_replacing_link_and_preserves_permissions() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("real.lrc");
        let link = dir.path().join("linked.lrc");
        std::fs::write(&target, "old").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o640)).unwrap();
        symlink(&target, &link).unwrap();
        write_atomic(&link, "updated").unwrap();
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "updated");
        assert_eq!(std::fs::metadata(&target).unwrap().permissions().mode() & 0o777, 0o640);
    }

    #[cfg(unix)]
    #[test]
    fn does_not_replace_read_only_file_or_dangling_link() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("readonly.lrc");
        std::fs::write(&target, "old").unwrap();
        std::fs::set_permissions(&target, std::fs::Permissions::from_mode(0o400)).unwrap();
        assert!(write_atomic(&target, "updated").is_err());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "old");
        let link = dir.path().join("dangling.lrc");
        symlink(dir.path().join("missing.lrc"), &link).unwrap();
        assert!(write_atomic(&link, "updated").is_err());
        assert!(std::fs::symlink_metadata(&link).unwrap().file_type().is_symlink());
    }
}
