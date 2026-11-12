#[cfg(unix)]
use std::ffi::OsString;
use std::io::{self, Write};
use std::path::Path;

const OUTPUT_DURABILITY_UNCERTAIN_CODE: &str = "BATCH_OUTPUT_DURABILITY_UNCERTAIN";

#[cfg(target_os = "macos")]
fn rename_noclobber_in_directory(
    directory: &cap_std::fs::Dir,
    source: &std::ffi::OsStr,
    destination: &str,
) -> io::Result<bool> {
    use std::ffi::CString;
    use std::os::fd::AsRawFd;
    use std::os::unix::ffi::OsStrExt;

    let source = CString::new(source.as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in staging filename"))?;
    let destination = CString::new(destination)
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "NUL in batch filename"))?;
    let fd = directory.as_raw_fd();
    let status = unsafe {
        libc::renameatx_np(
            fd,
            source.as_ptr(),
            fd,
            destination.as_ptr(),
            libc::RENAME_EXCL,
        )
    };
    if status == 0 {
        return Ok(true);
    }
    let error = io::Error::last_os_error();
    if matches!(
        error.raw_os_error(),
        Some(libc::ENOTSUP | libc::EINVAL | libc::ENOSYS)
    ) {
        return Ok(false);
    }
    Err(error)
}

#[cfg(unix)]
fn open_batch_output_dir(path: &Path) -> io::Result<cap_std::fs::Dir> {
    #[cfg(target_os = "macos")]
    {
        use std::os::unix::fs::OpenOptionsExt;

        // Batch creation needs search + write, not read/list permission on the parent.
        let file = std::fs::OpenOptions::new()
            .read(true)
            .custom_flags(libc::O_SEARCH)
            .open(path)?;
        Ok(cap_std::fs::Dir::from_std_file(file))
    }
    #[cfg(not(target_os = "macos"))]
    {
        cap_std::fs::Dir::open_ambient_dir(path, cap_std::ambient_authority())
    }
}

#[cfg(unix)]
struct BatchStage<'a> {
    directory: &'a cap_std::fs::Dir,
    filename: Option<OsString>,
    file: cap_std::fs::File,
}

#[cfg(unix)]
impl Drop for BatchStage<'_> {
    fn drop(&mut self) {
        if let Some(filename) = self.filename.take() {
            let _ = self.directory.remove_file(filename);
        }
    }
}

#[cfg(unix)]
fn stage_in<'a>(directory: &'a cap_std::fs::Dir, hint: &Path) -> io::Result<BatchStage<'a>> {
    use cap_std::fs::{OpenOptions, OpenOptionsExt};

    let mut options = OpenOptions::new();
    options.read(true).write(true).create_new(true).mode(0o600);
    let mut builder = tempfile::Builder::new();
    builder.prefix(".tmp").disable_cleanup(true);
    let temporary = builder.make_in(hint, |path| {
        let filename = path.file_name().ok_or_else(|| {
            io::Error::new(io::ErrorKind::InvalidInput, "Missing staging filename")
        })?;
        directory.open_with(filename, &options)
    })?;
    let filename = temporary
        .path()
        .file_name()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "Missing staging filename"))?
        .to_owned();
    Ok(BatchStage {
        directory,
        filename: Some(filename),
        file: temporary.into_file(),
    })
}

#[tauri::command]
pub async fn write_batch_output(
    output_dir: String,
    output_bookmark: Option<String>,
    name: String,
    content: String,
) -> Result<(), String> {
    let access = crate::file_access::FileAccess::open(output_dir, output_bookmark)?;
    write_new_output(&access.path(), &name, &content)
}

fn write_new_output(output_dir: &Path, name: &str, content: &str) -> Result<(), String> {
    write_new_output_with(output_dir, name, content, || Ok(()))
}

fn write_new_output_with(
    output_dir: &Path,
    name: &str,
    content: &str,
    before_publish: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    write_new_output_with_hooks(output_dir, name, content, before_publish, || Ok(()))
}

#[cfg(test)]
fn write_new_output_with_directory_sync(
    output_dir: &Path,
    name: &str,
    content: &str,
    sync_directory: impl FnOnce(&Path) -> io::Result<()>,
) -> Result<(), String> {
    write_new_output_with_hooks(
        output_dir,
        name,
        content,
        || Ok(()),
        || sync_directory(output_dir),
    )
}

fn write_new_output_with_hooks(
    output_dir: &Path,
    name: &str,
    content: &str,
    before_publish: impl FnOnce() -> Result<(), String>,
    after_publish: impl FnOnce() -> io::Result<()>,
) -> Result<(), String> {
    let stem = name
        .split('.')
        .next()
        .unwrap_or("")
        .trim_end_matches([' ', '.'])
        .to_ascii_uppercase();
    let reserved = matches!(
        stem.as_str(),
        "CON" | "PRN" | "AUX" | "NUL" | "CONIN$" | "CONOUT$"
    ) || ["COM", "LPT"].iter().any(|prefix| {
        stem.strip_prefix(prefix).is_some_and(|suffix| {
            matches!(
                suffix,
                "1" | "2" | "3" | "4" | "5" | "6" | "7" | "8" | "9" | "¹" | "²" | "³"
            )
        })
    });
    if name.is_empty()
        || name == "."
        || name == ".."
        || name.ends_with(['.', ' '])
        || name.chars().any(|ch| {
            ch.is_control() || matches!(ch, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|')
        })
        || reserved
    {
        return Err("Invalid batch output name.".into());
    }

    #[cfg(unix)]
    {
        use cap_std::fs::MetadataExt;

        let directory = open_batch_output_dir(output_dir).map_err(|error| error.to_string())?;
        let mut temporary = stage_in(&directory, output_dir).map_err(|error| error.to_string())?;
        temporary
            .file
            .write_all(content.as_bytes())
            .map_err(|error| error.to_string())?;
        temporary
            .file
            .sync_all()
            .map_err(|error| error.to_string())?;
        before_publish()?;

        let filename = temporary.filename.as_ref().unwrap();
        let opened = temporary
            .file
            .metadata()
            .map_err(|error| error.to_string())?;
        let staged = directory
            .symlink_metadata(filename)
            .map_err(|error| error.to_string())?;
        if !staged.is_file() || opened.dev() != staged.dev() || opened.ino() != staged.ino() {
            return Err("Batch staging file identity changed before publication".into());
        }

        #[cfg(target_os = "macos")]
        let renamed = rename_noclobber_in_directory(&directory, filename, name)
            .map_err(|error| error.to_string())?;
        #[cfg(not(target_os = "macos"))]
        let renamed = false;
        if !renamed {
            directory
                .hard_link(filename, &directory, name)
                .map_err(|error| error.to_string())?;
            directory
                .remove_file(filename)
                .map_err(|error| error.to_string())?;
        }
        temporary.filename = None;
        directory
            .try_clone()
            .map_err(|error| error.to_string())?
            .into_std_file()
            .sync_all()
            .map_err(|error| format!("{OUTPUT_DURABILITY_UNCERTAIN_CODE}: {error}"))?;
    }
    #[cfg(not(unix))]
    {
        let canonical = std::fs::canonicalize(output_dir).map_err(|error| error.to_string())?;
        let mut temporary =
            tempfile::NamedTempFile::new_in(&canonical).map_err(|error| error.to_string())?;
        temporary
            .write_all(content.as_bytes())
            .map_err(|error| error.to_string())?;
        temporary
            .as_file()
            .sync_all()
            .map_err(|error| error.to_string())?;
        before_publish()?;
        temporary
            .persist_noclobber(canonical.join(name))
            .map_err(|error| error.to_string())?;
    }
    after_publish().map_err(|error| format!("{OUTPUT_DURABILITY_UNCERTAIN_CODE}: {error}"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn new_output_is_created_without_replacing_existing_contents() {
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("song.lrc");
        std::fs::write(&original, "original").unwrap();
        assert!(write_new_output(folder.path(), "song.lrc", "replacement").is_err());
        assert_eq!(std::fs::read_to_string(original).unwrap(), "original");
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn duplicate_completion_keeps_the_first_output() {
        let folder = tempfile::tempdir().unwrap();
        write_new_output(folder.path(), "new.srt", "first").unwrap();
        assert!(write_new_output(folder.path(), "new.srt", "second").is_err());
        assert_eq!(
            std::fs::read_to_string(folder.path().join("new.srt")).unwrap(),
            "first"
        );
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn published_batch_output_keeps_owner_only_permissions() {
        use std::os::unix::fs::PermissionsExt;

        let folder = tempfile::tempdir().unwrap();
        let output = folder.path().join("private.lrc");

        write_new_output(folder.path(), "private.lrc", "private lyrics").unwrap();

        assert_eq!(std::fs::read_to_string(&output).unwrap(), "private lyrics");
        assert_eq!(
            std::fs::metadata(&output).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn retargeting_selected_output_root_before_publish_keeps_original_destination() {
        use std::os::unix::fs::symlink;

        let folder = tempfile::tempdir().unwrap();
        let approved = folder.path().join("approved");
        let alternate = folder.path().join("alternate");
        let selected = folder.path().join("selected");
        std::fs::create_dir(&approved).unwrap();
        std::fs::create_dir(&alternate).unwrap();
        symlink(&approved, &selected).unwrap();

        write_new_output_with(&selected, "song.lrc", "intended lyrics", || {
            std::fs::remove_file(&selected).map_err(|error| error.to_string())?;
            symlink(&alternate, &selected).map_err(|error| error.to_string())?;
            Ok(())
        })
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(approved.join("song.lrc")).unwrap(),
            "intended lyrics"
        );
        assert!(!alternate.join("song.lrc").exists());
        assert_eq!(std::fs::read_dir(&approved).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn relocating_selected_root_does_not_publish_or_clean_a_decoy() {
        use std::os::unix::fs::symlink;

        let folder = tempfile::tempdir().unwrap();
        let approved = folder.path().join("approved");
        let relocated = folder.path().join("relocated");
        let selected = folder.path().join("selected");
        std::fs::create_dir(&approved).unwrap();
        symlink(&approved, &selected).unwrap();

        write_new_output_with(&selected, "song.lrc", "intended lyrics", || {
            let staged = std::fs::read_dir(&approved)
                .map_err(|error| error.to_string())?
                .next()
                .ok_or("missing staging file")?
                .map_err(|error| error.to_string())?
                .file_name();
            std::fs::rename(&approved, &relocated).map_err(|error| error.to_string())?;
            std::fs::create_dir(&approved).map_err(|error| error.to_string())?;
            std::fs::write(approved.join(staged), b"decoy content")
                .map_err(|error| error.to_string())?;
            Ok(())
        })
        .unwrap();

        assert_eq!(
            std::fs::read_to_string(relocated.join("song.lrc")).unwrap(),
            "intended lyrics"
        );
        assert!(!approved.join("song.lrc").exists());
        assert_eq!(std::fs::read_dir(&relocated).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(&approved).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn retargeting_output_root_during_staging_keeps_original_destination() {
        use std::os::unix::fs::symlink;
        use std::time::{Duration, Instant};

        let folder = tempfile::tempdir().unwrap();
        let approved = folder.path().join("approved");
        let alternate = folder.path().join("alternate");
        let selected = folder.path().join("selected");
        std::fs::create_dir(&approved).unwrap();
        std::fs::create_dir(&alternate).unwrap();
        symlink(&approved, &selected).unwrap();

        let watcher_path = selected.clone();
        let watcher_dir = approved.clone();
        let watcher_alternate = alternate.clone();
        let watcher = std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(5);
            loop {
                let has_stage = std::fs::read_dir(&watcher_dir).unwrap().any(|entry| {
                    entry
                        .unwrap()
                        .file_name()
                        .to_string_lossy()
                        .starts_with(".tmp")
                });
                if has_stage {
                    std::fs::remove_file(&watcher_path).unwrap();
                    symlink(&watcher_alternate, &watcher_path).unwrap();
                    return;
                }
                assert!(Instant::now() < deadline, "staging file was never created");
                std::thread::sleep(Duration::from_millis(1));
            }
        });

        let content = "x".repeat(32 * 1024 * 1024);
        let result = write_new_output(&selected, "song.lrc", &content);
        watcher.join().unwrap();

        assert!(
            result.is_ok(),
            "retargeting must not fail the selected output: {result:?}"
        );
        assert_eq!(
            std::fs::read(approved.join("song.lrc")).unwrap(),
            content.as_bytes()
        );
        assert!(!alternate.join("song.lrc").exists());
        assert_eq!(std::fs::read_dir(&approved).unwrap().count(), 1);
        assert_eq!(std::fs::read_dir(&alternate).unwrap().count(), 0);
    }

    #[test]
    fn successful_publication_waits_for_directory_sync() {
        let folder = tempfile::tempdir().unwrap();
        let mut synced = false;
        write_new_output_with_directory_sync(folder.path(), "song.lrc", "lyrics", |path| {
            assert_eq!(path, folder.path());
            synced = true;
            Ok(())
        })
        .unwrap();

        assert!(synced);
        assert_eq!(
            std::fs::read_to_string(folder.path().join("song.lrc")).unwrap(),
            "lyrics"
        );
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn directory_sync_failure_reports_uncertain_durability_after_publication() {
        let folder = tempfile::tempdir().unwrap();
        let error =
            write_new_output_with_directory_sync(folder.path(), "song.lrc", "lyrics", |_| {
                Err(io::Error::other("injected sync failure"))
            })
            .unwrap_err();

        assert!(error.starts_with(OUTPUT_DURABILITY_UNCERTAIN_CODE));
        assert_eq!(
            std::fs::read_to_string(folder.path().join("song.lrc")).unwrap(),
            "lyrics"
        );
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[test]
    fn traversal_and_platform_ambiguous_names_are_rejected_without_creating_files() {
        let folder = tempfile::tempdir().unwrap();
        for name in [
            "",
            ".",
            "..",
            "../escape.lrc",
            "sub/name.lrc",
            "sub\\name.lrc",
            "/absolute.lrc",
            "C:\\song.lrc",
            "song:stream.lrc",
            "song.lrc.",
            "song.lrc ",
            "NUL.lrc",
            "NUL .lrc",
            "COM¹.lrc",
            "CONIN$.lrc",
        ] {
            assert!(
                write_new_output(folder.path(), name, "content").is_err(),
                "{name}"
            );
        }
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 0);
    }

    #[test]
    fn missing_output_folder_is_not_implicitly_created() {
        let folder = tempfile::tempdir().unwrap();
        let missing = folder.path().join("missing");
        assert!(write_new_output(&missing, "song.lrc", "content").is_err());
        assert!(!missing.exists());
    }

    #[cfg(unix)]
    #[test]
    fn staged_name_replacement_fails_without_publishing_wrong_bytes() {
        let folder = tempfile::tempdir().unwrap();
        let result = write_new_output_with(folder.path(), "song.lrc", "intended lyrics", || {
            let staged = std::fs::read_dir(folder.path())
                .map_err(|error| error.to_string())?
                .next()
                .ok_or("missing staging file")?
                .map_err(|error| error.to_string())?
                .path();
            std::fs::remove_file(&staged).map_err(|error| error.to_string())?;
            std::fs::write(&staged, b"substituted bytes").map_err(|error| error.to_string())?;
            Ok(())
        });

        assert!(result.unwrap_err().contains("identity changed"));
        assert!(!folder.path().join("song.lrc").exists());
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 0);
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn writable_search_only_folder_does_not_need_directory_read_permission() {
        use std::os::unix::fs::PermissionsExt;

        let folder = tempfile::tempdir().unwrap();
        let output = folder.path().join("output");
        std::fs::create_dir(&output).unwrap();
        std::fs::set_permissions(&output, std::fs::Permissions::from_mode(0o300)).unwrap();
        let result = write_new_output(&output, "song.lrc", "private lyrics");
        std::fs::set_permissions(&output, std::fs::Permissions::from_mode(0o700)).unwrap();

        assert!(
            result.is_ok(),
            "writable/searchable folder failed: {result:?}"
        );
        assert_eq!(
            std::fs::read_to_string(output.join("song.lrc")).unwrap(),
            "private lyrics"
        );
        assert_eq!(std::fs::read_dir(&output).unwrap().count(), 1);
    }

    #[test]
    fn simultaneous_completion_produces_exactly_one_complete_file() {
        let folder = tempfile::tempdir().unwrap();
        let barrier = std::sync::Arc::new(std::sync::Barrier::new(2));
        let results: Vec<_> = std::thread::scope(|scope| {
            let jobs: Vec<_> = ["first", "second"]
                .into_iter()
                .map(|content| {
                    let barrier = barrier.clone();
                    let folder = folder.path();
                    scope.spawn(move || {
                        barrier.wait();
                        write_new_output(folder, "song.lrc", content)
                    })
                })
                .collect();
            jobs.into_iter().map(|job| job.join().unwrap()).collect()
        });
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let content = std::fs::read_to_string(folder.path().join("song.lrc")).unwrap();
        assert!(content == "first" || content == "second");
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 1);
    }

    #[cfg(unix)]
    #[test]
    fn existing_symlink_is_not_followed_or_replaced() {
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("original.lrc");
        std::fs::write(&original, "original").unwrap();
        std::os::unix::fs::symlink(&original, folder.path().join("song.lrc")).unwrap();
        assert!(write_new_output(folder.path(), "song.lrc", "replacement").is_err());
        assert_eq!(std::fs::read_to_string(original).unwrap(), "original");
        assert!(folder
            .path()
            .join("song.lrc")
            .symlink_metadata()
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_dir(folder.path()).unwrap().count(), 2);
    }
}
