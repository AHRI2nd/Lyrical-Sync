use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const MAX_GRANTS: usize = 16;
const MAX_STORE_BYTES: u64 = 64 * 1024;

/// Native-owned exact-file grants for entries selected through the OS picker or drop handler.
pub struct RecentFileGrants {
    store_path: PathBuf,
    paths: Mutex<Vec<PathBuf>>,
}

impl RecentFileGrants {
    pub fn open(store_path: PathBuf) -> Result<Self, String> {
        let parent = store_path
            .parent()
            .ok_or_else(|| "Recent file grant store has no parent directory".to_string())?;
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        let store_path = fs::canonicalize(parent)
            .map_err(|error| error.to_string())?
            .join(
                store_path
                    .file_name()
                    .ok_or_else(|| "Recent file grant store has no file name".to_string())?,
            );

        let mut paths = Vec::new();
        let mut rewrite = false;
        match fs::symlink_metadata(&store_path) {
            Ok(metadata) => {
                if !metadata.is_file() || metadata.file_type().is_symlink() {
                    return Err("Recent file grant store is not a regular file".into());
                }
                if metadata.len() > MAX_STORE_BYTES {
                    rewrite = true;
                } else {
                    let bytes = fs::read(&store_path).map_err(|error| error.to_string())?;
                    match serde_json::from_slice::<Vec<String>>(&bytes) {
                        Ok(saved) => {
                            let mut seen = Vec::new();
                            for raw in saved.into_iter().rev() {
                                let candidate = PathBuf::from(raw);
                                if !is_canonical_regular_file(&candidate)
                                    || seen.contains(&candidate)
                                {
                                    rewrite = true;
                                    continue;
                                }
                                seen.push(candidate);
                                if seen.len() == MAX_GRANTS {
                                    rewrite |= seen.len() < bytes_grant_count(&bytes);
                                    break;
                                }
                            }
                            seen.reverse();
                            paths = seen;
                        }
                        Err(_) => rewrite = true,
                    }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.to_string()),
        }

        let grants = Self {
            store_path,
            paths: Mutex::new(paths),
        };
        if rewrite {
            grants.persist_locked()?;
        }
        grants.restrict_store_permissions()?;
        Ok(grants)
    }

    /// Remember a path only after the caller has verified a live native filesystem grant.
    pub fn remember(&self, path: &Path) -> Result<(), String> {
        let canonical = canonical_grant_candidate(path)?;

        let mut paths = self.paths.lock().unwrap_or_else(|error| error.into_inner());
        let previous = paths.clone();
        paths.retain(|existing| existing != &canonical);
        paths.push(canonical);
        if paths.len() > MAX_GRANTS {
            let excess = paths.len() - MAX_GRANTS;
            paths.drain(0..excess);
        }
        if let Err(error) = self.persist_locked_with(&paths) {
            *paths = previous;
            return Err(error);
        }
        Ok(())
    }

    /// Check exact canonical paths only. The caller must validate/canonicalize first.
    pub fn allows(&self, path: &Path) -> bool {
        self.paths
            .lock()
            .unwrap_or_else(|error| error.into_inner())
            .iter()
            .any(|granted| granted == path)
    }

    pub fn clear(&self) -> Result<(), String> {
        let mut paths = self.paths.lock().unwrap_or_else(|error| error.into_inner());
        let previous = std::mem::take(&mut *paths);
        if let Err(error) = self.persist_locked_with(&paths) {
            *paths = previous;
            return Err(error);
        }
        Ok(())
    }

    fn persist_locked(&self) -> Result<(), String> {
        let paths = self.paths.lock().unwrap_or_else(|error| error.into_inner());
        self.persist_locked_with(&paths)
    }

    fn persist_locked_with(&self, paths: &[PathBuf]) -> Result<(), String> {
        let serialized = serde_json::to_string(
            &paths
                .iter()
                .map(|path| path.to_string_lossy().into_owned())
                .collect::<Vec<_>>(),
        )
        .map_err(|error| error.to_string())?;
        crate::atomic_write::write_atomic(&self.store_path, &serialized)
            .map_err(|error| error.to_string())?;
        self.restrict_store_permissions()
    }

    fn restrict_store_permissions(&self) -> Result<(), String> {
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let metadata = match fs::symlink_metadata(&self.store_path) {
                Ok(metadata) => metadata,
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(()),
                Err(error) => return Err(error.to_string()),
            };
            if !metadata.is_file() || metadata.file_type().is_symlink() {
                return Err("Recent file grant store is not a regular file".into());
            }
            let permissions = fs::Permissions::from_mode(0o600);
            fs::set_permissions(&self.store_path, permissions)
                .map_err(|error| error.to_string())?;
        }
        Ok(())
    }
}

fn is_canonical_regular_file(path: &Path) -> bool {
    path.is_absolute()
        && path.canonicalize().is_ok_and(|canonical| canonical == path)
        && fs::metadata(path).is_ok_and(|metadata| metadata.is_file())
}

/// Resolve existing selections canonically; Save As may authorize a final path before creation.
/// `open` prunes that pending path on restart if a regular file was never published there.
fn canonical_grant_candidate(path: &Path) -> Result<PathBuf, String> {
    match path.canonicalize() {
        Ok(canonical) if is_canonical_regular_file(&canonical) => Ok(canonical),
        Ok(_) => Err("Recent file grant must identify a canonical regular file".into()),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            let parent = path
                .parent()
                .ok_or_else(|| "Recent file grant has no parent directory".to_string())?;
            let filename = path
                .file_name()
                .ok_or_else(|| "Recent file grant has no file name".to_string())?;
            let canonical_parent = parent.canonicalize().map_err(|error| error.to_string())?;
            if !canonical_parent.is_dir() {
                return Err("Recent file grant parent is not a directory".into());
            }
            let candidate = canonical_parent.join(filename);
            match fs::symlink_metadata(&candidate) {
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(candidate),
                Ok(_) => Err("Recent file grant path changed while it was being authorized".into()),
                Err(error) => Err(error.to_string()),
            }
        }
        Err(error) => Err(error.to_string()),
    }
}

fn bytes_grant_count(bytes: &[u8]) -> usize {
    serde_json::from_slice::<Vec<String>>(bytes)
        .map(|paths| paths.len())
        .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::{RecentFileGrants, MAX_GRANTS};
    use std::fs;
    use std::path::Path;

    #[test]
    fn exact_native_grant_survives_reopening_the_store() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("selected.wav");
        fs::write(&file, b"synthetic audio").unwrap();
        let canonical = file.canonicalize().unwrap();
        let store_path = dir.path().join("recent-file-grants.json");

        let initial = RecentFileGrants::open(store_path.clone()).unwrap();
        initial.remember(&canonical).unwrap();
        assert!(initial.allows(&canonical));
        let reopened = RecentFileGrants::open(store_path).unwrap();

        assert!(reopened.allows(&canonical));
        assert!(!reopened.allows(&dir.path().join("other.wav")));
    }

    #[cfg(unix)]
    #[test]
    fn symlink_retarget_does_not_authorize_the_new_target() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let first = dir.path().join("first.wav");
        let second = dir.path().join("second.wav");
        let selected = dir.path().join("selected.wav");
        fs::write(&first, b"first").unwrap();
        fs::write(&second, b"second").unwrap();
        symlink(&first, &selected).unwrap();
        let store_path = dir.path().join("recent-file-grants.json");
        let grants = RecentFileGrants::open(store_path.clone()).unwrap();
        grants.remember(&selected.canonicalize().unwrap()).unwrap();

        fs::remove_file(&selected).unwrap();
        symlink(&second, &selected).unwrap();
        let reopened = RecentFileGrants::open(store_path).unwrap();

        assert!(!reopened.allows(&selected.canonicalize().unwrap()));
    }

    #[test]
    fn missing_saved_paths_are_pruned() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("selected.wav");
        fs::write(&file, b"synthetic audio").unwrap();
        let canonical = file.canonicalize().unwrap();
        let store_path = dir.path().join("recent-file-grants.json");
        let grants = RecentFileGrants::open(store_path.clone()).unwrap();
        grants.remember(&canonical).unwrap();
        assert!(grants.allows(&canonical));
        fs::remove_file(&file).unwrap();

        let reopened = RecentFileGrants::open(store_path).unwrap();

        assert!(!reopened.allows(&canonical));
    }

    #[test]
    fn unpublished_selected_path_is_pruned_after_restart() {
        let dir = tempfile::tempdir().unwrap();
        let selected = dir.path().join("not-published.lrc");
        let selected_canonical = selected
            .parent()
            .unwrap()
            .canonicalize()
            .unwrap()
            .join(selected.file_name().unwrap());
        let store_path = dir.path().join("recent-file-grants.json");
        let grants = RecentFileGrants::open(store_path.clone()).unwrap();

        grants.remember(&selected).unwrap();
        assert!(grants.allows(&selected_canonical));

        let reopened = RecentFileGrants::open(store_path.clone()).unwrap();

        assert!(!reopened.allows(&selected_canonical));
        assert_eq!(fs::read(store_path).unwrap(), b"[]");
    }

    #[cfg(unix)]
    #[test]
    fn unpublished_selected_path_does_not_authorize_a_later_symlink_target() {
        use std::os::unix::fs::symlink;

        let dir = tempfile::tempdir().unwrap();
        let selected = dir.path().join("new-song.lrc");
        let other = dir.path().join("other.lrc");
        let store_path = dir.path().join("recent-file-grants.json");
        let grants = RecentFileGrants::open(store_path.clone()).unwrap();
        grants.remember(&selected).unwrap();
        fs::write(&other, "unselected").unwrap();
        symlink(&other, &selected).unwrap();

        let reopened = RecentFileGrants::open(store_path).unwrap();

        assert!(!reopened.allows(&other.canonicalize().unwrap()));
    }

    #[test]
    fn clear_removes_persisted_grants() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("selected.wav");
        fs::write(&file, b"synthetic audio").unwrap();
        let canonical = file.canonicalize().unwrap();
        let store_path = dir.path().join("recent-file-grants.json");
        let grants = RecentFileGrants::open(store_path.clone()).unwrap();
        grants.remember(&canonical).unwrap();
        assert!(grants.allows(&canonical));

        grants.clear().unwrap();

        assert!(!RecentFileGrants::open(store_path)
            .unwrap()
            .allows(&canonical));
    }

    #[test]
    fn grant_count_never_exceeds_the_bound() {
        let dir = tempfile::tempdir().unwrap();
        let store_path = dir.path().join("recent-file-grants.json");
        let grants = RecentFileGrants::open(store_path.clone()).unwrap();
        let mut files = Vec::new();
        for index in 0..=MAX_GRANTS {
            let file = dir.path().join(format!("{index}.wav"));
            fs::write(&file, b"synthetic audio").unwrap();
            let canonical = file.canonicalize().unwrap();
            grants.remember(&canonical).unwrap();
            files.push(canonical);
        }
        let reopened = RecentFileGrants::open(store_path.clone()).unwrap();

        assert!(!reopened.allows(&files[0]));
        assert!(files[1..].iter().all(|file| reopened.allows(file)));
        assert_eq!(
            serde_json::from_slice::<Vec<String>>(&fs::read(store_path).unwrap())
                .unwrap()
                .len(),
            MAX_GRANTS
        );
    }

    #[test]
    fn malformed_store_fails_closed_and_is_replaced_with_empty_list() {
        let dir = tempfile::tempdir().unwrap();
        let store_path = dir.path().join("recent-file-grants.json");
        fs::write(&store_path, b"not-json").unwrap();

        let grants = RecentFileGrants::open(store_path.clone()).unwrap();

        assert!(!grants.allows(Path::new("/tmp/arbitrary.wav")));
        assert_eq!(fs::read(store_path).unwrap(), b"[]");
    }
}
