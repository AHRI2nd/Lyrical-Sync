use std::io;
use std::path::{Path, PathBuf};
pub const READY_MARKER: &str = ".lyrical-runtime-ready";
pub const RUNTIME_ID: &str = "cpython-3.13.17-20261021-v1";
const BACKUP_PREFIX: &str = ".lyrical-python-runtime-backup-";
pub const MANIFEST: &str = include_str!("../ai-manifest.json");
pub static ENV_LOCK: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

pub fn runtime_exe(root: &Path) -> PathBuf {
    if cfg!(windows) {
        root.join("python/python.exe")
    } else {
        root.join("python/bin/python3")
    }
}
pub fn runtime_complete(root: &Path) -> bool {
    runtime_exe(root).is_file()
        && std::fs::read_to_string(root.join(READY_MARKER))
            .ok()
            .as_deref()
            == Some(RUNTIME_ID)
}
pub fn publish_runtime(stage: &Path, destination: &Path) -> io::Result<()> {
    publish_with(stage, destination, |from, to| std::fs::rename(from, to))
}

pub fn recover_runtime(destination: &Path) -> io::Result<()> {
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::other("Missing runtime parent"))?;
    match std::fs::symlink_metadata(destination) {
        Ok(_) => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }

    let entries = match std::fs::read_dir(parent) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) => return Err(error),
    };
    let mut backups = Vec::new();
    for entry in entries {
        let entry = entry?;
        if !entry.file_name().to_string_lossy().starts_with(BACKUP_PREFIX) {
            continue;
        }
        let metadata = entry.file_type()?;
        if !metadata.is_dir() {
            continue;
        }
        let previous = entry.path().join("previous");
        if std::fs::symlink_metadata(&previous).is_ok() {
            backups.push((entry.path(), previous));
        }
    }
    if backups.is_empty() {
        return Ok(());
    }
    if backups.len() != 1 {
        return Err(io::Error::other(
            "Multiple interrupted Python runtime backups require manual recovery",
        ));
    }

    let (backup_dir, previous) = backups.pop().expect("one backup was checked");
    std::fs::rename(&previous, destination)?;
    std::fs::remove_dir(backup_dir)?;
    Ok(())
}

fn publish_with(
    stage: &Path,
    destination: &Path,
    mut rename: impl FnMut(&Path, &Path) -> io::Result<()>,
) -> io::Result<()> {
    if !runtime_complete(stage) {
        return Err(io::Error::other("Runtime staging is incomplete"));
    }
    let parent = destination
        .parent()
        .ok_or_else(|| io::Error::other("Missing runtime parent"))?;
    let backup = tempfile::Builder::new()
        .prefix(BACKUP_PREFIX)
        .tempdir_in(parent)?;
    let previous = backup.path().join("previous");
    // Path::exists() follows symlinks. A dangling link still occupies the
    // destination entry and must be backed up before publishing the runtime.
    let had_previous = match std::fs::symlink_metadata(destination) {
        Ok(_) => true,
        Err(error) if error.kind() == io::ErrorKind::NotFound => false,
        Err(error) => return Err(error),
    };
    if had_previous {
        rename(destination, &previous)?;
    }
    if let Err(error) = rename(stage, destination) {
        if had_previous {
            if let Err(restore_error) = rename(&previous, destination) {
                let retained = backup.keep();
                return Err(io::Error::other(format!(
                    "{error}; restore failed: {restore_error}. Previous runtime retained at {}",
                    retained.display()
                )));
            }
        }
        return Err(error);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn incomplete_stage_never_replaces_an_existing_runtime() {
        let root = tempfile::tempdir().unwrap();
        let live = root.path().join("live");
        let stage = root.path().join("stage");
        std::fs::create_dir_all(&live).unwrap();
        std::fs::create_dir_all(&stage).unwrap();
        std::fs::write(live.join("original"), "keep").unwrap();
        assert!(publish_runtime(&stage, &live).is_err());
        assert_eq!(
            std::fs::read_to_string(live.join("original")).unwrap(),
            "keep"
        );
    }
    fn ready_stage(path: &std::path::Path) {
        std::fs::create_dir_all(runtime_exe(path).parent().unwrap()).unwrap();
        std::fs::write(runtime_exe(path), "verified interpreter fixture").unwrap();
        std::fs::write(path.join(READY_MARKER), RUNTIME_ID).unwrap();
    }
    #[test]
    fn only_a_complete_runtime_is_published() {
        let root = tempfile::tempdir().unwrap();
        let live = root.path().join("live");
        let stage = root.path().join("stage");
        ready_stage(&stage);
        publish_runtime(&stage, &live).unwrap();
        assert!(runtime_complete(&live));
        assert!(!stage.exists());
    }
    #[test]
    fn wrong_marker_and_missing_executable_are_not_ready() {
        let root = tempfile::tempdir().unwrap();
        ready_stage(root.path());
        std::fs::write(root.path().join(READY_MARKER), "different release").unwrap();
        assert!(!runtime_complete(root.path()));
        std::fs::write(root.path().join(READY_MARKER), RUNTIME_ID).unwrap();
        std::fs::remove_file(runtime_exe(root.path())).unwrap();
        assert!(!runtime_complete(root.path()));
    }

    #[test]
    fn interrupted_publish_is_recovered_after_process_exit() {
        if let Ok(root) = std::env::var("LYRICAL_RUNTIME_CRASH_FIXTURE") {
            let root = PathBuf::from(root);
            let live = root.join("embedded-python");
            let stage = root.join("stage");
            ready_stage(&live);
            ready_stage(&stage);
            let mut calls = 0;
            let _ = publish_with(&stage, &live, |from, to| {
                calls += 1;
                let result = std::fs::rename(from, to);
                if calls == 1 {
                    std::process::exit(42);
                }
                result
            });
            panic!("fixture must exit between the two runtime renames");
        }

        let root = tempfile::tempdir().unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "python_runtime::tests::interrupted_publish_is_recovered_after_process_exit",
                "--nocapture",
            ])
            .env("LYRICAL_RUNTIME_CRASH_FIXTURE", root.path())
            .status()
            .unwrap();
        assert_eq!(status.code(), Some(42));

        let live = root.path().join("embedded-python");
        assert!(std::fs::symlink_metadata(&live).is_err());
        recover_runtime(&live).unwrap();
        assert!(runtime_complete(&live));
        assert!(!std::fs::read_dir(root.path())
            .unwrap()
            .any(|entry| entry.unwrap().file_name().to_string_lossy().starts_with(BACKUP_PREFIX)));
    }

    #[test]
    fn ambiguous_runtime_backups_are_preserved_for_manual_recovery() {
        let root = tempfile::tempdir().unwrap();
        let live = root.path().join("embedded-python");
        let backups = (0..2)
            .map(|_| {
                tempfile::Builder::new()
                    .prefix(BACKUP_PREFIX)
                    .tempdir_in(root.path())
                    .unwrap()
            })
            .collect::<Vec<_>>();
        for backup in &backups {
            ready_stage(&backup.path().join("previous"));
        }

        let error = recover_runtime(&live).unwrap_err();

        assert!(error.to_string().contains("Multiple interrupted"));
        assert!(!live.exists());
        assert!(backups
            .iter()
            .all(|backup| runtime_complete(&backup.path().join("previous"))));
    }

    #[test]
    fn missing_runtime_parent_is_treated_as_no_recovery_entries() {
        let root = tempfile::tempdir().unwrap();
        let live = root.path().join("not-created").join("embedded-python");

        recover_runtime(&live).unwrap();

        assert!(!live.parent().unwrap().exists());
        assert!(!live.exists());
    }

    #[test]
    fn non_directory_runtime_parent_error_is_preserved() {
        let root = tempfile::tempdir().unwrap();
        let parent_file = root.path().join("not-a-directory");
        std::fs::write(&parent_file, "file").unwrap();
        let live = parent_file.join("embedded-python");

        let error = recover_runtime(&live).unwrap_err();

        assert_ne!(error.kind(), io::ErrorKind::NotFound);
    }

    #[test]
    fn failed_publish_restores_the_previous_directory() {
        let root = tempfile::tempdir().unwrap();
        let live = root.path().join("live");
        let stage = root.path().join("stage");
        ready_stage(&stage);
        std::fs::create_dir(&live).unwrap();
        std::fs::write(live.join("original"), "keep").unwrap();
        let mut calls = 0;
        let result = publish_with(&stage, &live, |from, to| {
            calls += 1;
            if calls == 2 {
                Err(std::io::Error::other("injected rename failure"))
            } else {
                std::fs::rename(from, to)
            }
        });
        assert!(result.is_err());
        assert_eq!(
            std::fs::read_to_string(live.join("original")).unwrap(),
            "keep"
        );
        assert!(runtime_complete(&stage));
    }

    #[cfg(unix)]
    #[test]
    fn a_dangling_runtime_symlink_is_replaced_without_touching_its_external_target() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let live = root.path().join("live");
        let missing = root.path().join("missing-runtime");
        symlink(&missing, &live).unwrap();
        let stage = root.path().join("stage");
        ready_stage(&stage);

        publish_runtime(&stage, &live).unwrap();

        assert!(runtime_complete(&live));
        assert!(!std::fs::symlink_metadata(&live).unwrap().file_type().is_symlink());
        assert!(!missing.exists());
        assert!(!stage.exists());
    }

    #[cfg(unix)]
    #[test]
    fn failed_publish_restores_a_dangling_runtime_symlink() {
        use std::os::unix::fs::symlink;

        let root = tempfile::tempdir().unwrap();
        let live = root.path().join("live");
        let missing = root.path().join("missing-runtime");
        symlink(&missing, &live).unwrap();
        let stage = root.path().join("stage");
        ready_stage(&stage);
        let mut calls = 0;

        let error = publish_with(&stage, &live, |from, to| {
            calls += 1;
            if calls == 2 {
                Err(io::Error::other("injected publication failure"))
            } else {
                std::fs::rename(from, to)
            }
        }).unwrap_err();

        assert!(error.to_string().contains("publication failure"));
        assert_eq!(std::fs::read_link(&live).unwrap(), missing);
        assert!(runtime_complete(&stage));
    }
}
