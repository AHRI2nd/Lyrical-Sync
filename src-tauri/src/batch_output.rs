use std::io::Write;
use std::path::Path;

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
    // The temporary file and destination share a filesystem. Dropping an unsuccessful
    // write/persist removes its temporary file; completion never replaces any path.
    let mut temporary =
        tempfile::NamedTempFile::new_in(output_dir).map_err(|error| error.to_string())?;
    temporary
        .write_all(content.as_bytes())
        .map_err(|error| error.to_string())?;
    temporary
        .as_file()
        .sync_all()
        .map_err(|error| error.to_string())?;
    temporary
        .persist_noclobber(output_dir.join(name))
        .map_err(|error| error.to_string())?;
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
