use std::io;
use std::path::{Path, PathBuf};
pub const READY_MARKER: &str = ".lyrical-runtime-ready";
pub const RUNTIME_ID: &str = "cpython-3.11.10-20241016-v1";
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
    let backup = tempfile::tempdir_in(parent)?;
    let previous = backup.path().join("previous");
    let had_previous = destination.exists();
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
}
