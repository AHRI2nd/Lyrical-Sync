//! Model filesystem authority is an opened directory, never an ambient joined path.
use cap_std::fs::Dir;
use std::ffi::OsString;
use std::io;
use std::path::Path;

pub struct ModelStore {
    root: Dir,
}

fn relative(name: &str) -> io::Result<&Path> {
    if name.is_empty()
        || name.contains(['\\', ':'])
        || name
            .split('/')
            .any(|s| s.is_empty() || s == "." || s == "..")
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid model filename",
        ));
    }
    let path = Path::new(name);
    if path
        .components()
        .any(|c| !matches!(c, std::path::Component::Normal(_)))
    {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            "Invalid model filename",
        ));
    }
    Ok(path)
}

impl ModelStore {
    pub fn open(root: &Path) -> io::Result<Self> {
        Ok(Self {
            root: Dir::open_ambient_dir(root, cap_std::ambient_authority())?,
        })
    }
    pub fn read(&self, name: &str) -> io::Result<std::fs::File> {
        let file = self.root.open(relative(name)?)?;
        if !file.metadata()?.is_file() {
            return Err(io::Error::other("Model is not a regular file"));
        }
        Ok(file.into_std())
    }
    pub fn remove(&self, name: &str) -> io::Result<()> {
        match self.root.remove_file(relative(name)?) {
            Err(e) if e.kind() == io::ErrorKind::NotFound => Ok(()),
            result => result,
        }
    }
    pub fn destination(&self, name: &str) -> io::Result<(Dir, OsString)> {
        let path = relative(name)?;
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or(Path::new("."));
        self.root.create_dir_all(parent)?;
        Ok((
            self.root.open_dir(parent)?,
            path.file_name().unwrap().to_owned(),
        ))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    #[test]
    fn traversal_and_platform_ambiguous_names_are_rejected() {
        let root = tempfile::tempdir().unwrap();
        let store = ModelStore::open(root.path()).unwrap();
        for name in [
            "",
            "../model",
            "/model",
            "a/../model",
            "a//model",
            "a\\model",
            "model:stream",
        ] {
            assert!(store.destination(name).is_err(), "{name}");
            assert!(store.remove(name).is_err(), "{name}");
        }
    }
    #[test]
    fn failed_or_cancelled_staging_preserves_installed_model() {
        let root = tempfile::tempdir().unwrap();
        let store = ModelStore::open(root.path()).unwrap();
        let (dir, name) = store.destination("demucs/model.th").unwrap();
        dir.write(&name, b"original").unwrap();
        {
            let mut stage = cap_tempfile::TempFile::new(&dir).unwrap();
            stage.write_all(b"partial").unwrap();
        }
        assert_eq!(dir.read(&name).unwrap(), b"original");
        assert_eq!(dir.entries().unwrap().count(), 1);
        let mut stage = cap_tempfile::TempFile::new(&dir).unwrap();
        stage.write_all(b"verified").unwrap();
        stage.replace(&name).unwrap();
        assert_eq!(dir.read(&name).unwrap(), b"verified");
    }
    #[cfg(unix)]
    #[test]
    fn parent_symlinks_cannot_read_write_or_delete_outside() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("model.th"), b"preserve").unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("demucs")).unwrap();
        let store = ModelStore::open(root.path()).unwrap();
        assert!(store.read("demucs/model.th").is_err());
        assert!(store.remove("demucs/model.th").is_err());
        assert!(store.destination("demucs/model.th").is_err());
        assert_eq!(
            std::fs::read(outside.path().join("model.th")).unwrap(),
            b"preserve"
        );
    }
    #[cfg(unix)]
    #[test]
    fn open_destination_survives_parent_link_swap() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let store = ModelStore::open(root.path()).unwrap();
        let (dir, name) = store.destination("demucs/model.th").unwrap();
        std::fs::rename(root.path().join("demucs"), root.path().join("original")).unwrap();
        std::os::unix::fs::symlink(outside.path(), root.path().join("demucs")).unwrap();
        let mut stage = cap_tempfile::TempFile::new(&dir).unwrap();
        stage.write_all(b"verified").unwrap();
        stage.replace(&name).unwrap();
        assert!(!outside.path().join("model.th").exists());
        assert_eq!(
            std::fs::read(root.path().join("original/model.th")).unwrap(),
            b"verified"
        );
    }
    #[cfg(unix)]
    #[test]
    fn replacing_a_leaf_symlink_does_not_modify_its_target() {
        let root = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        let target = outside.path().join("model.th");
        std::fs::write(&target, b"preserve").unwrap();
        std::os::unix::fs::symlink(&target, root.path().join("model.th")).unwrap();
        let store = ModelStore::open(root.path()).unwrap();
        assert!(store.read("model.th").is_err());
        let (dir, name) = store.destination("model.th").unwrap();
        let mut stage = cap_tempfile::TempFile::new(&dir).unwrap();
        stage.write_all(b"verified").unwrap();
        stage.replace(&name).unwrap();
        assert_eq!(std::fs::read(target).unwrap(), b"preserve");
    }
}
