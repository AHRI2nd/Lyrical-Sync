use std::fs::{self, File, OpenOptions};
use std::io;
#[cfg(any(test, not(target_os = "macos")))]
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn write_atomic(path: &Path, content: &str) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use objc2_foundation::{NSData, NSDataWritingOptions, NSString, NSURL};
        let (target, _) = destination(path)?;
        let path = target
            .to_str()
            .ok_or_else(|| io::Error::other("Invalid file path"))?;
        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        // Foundation's atomic writer is the macOS document-save adapter. The
        // caller retains the security-scoped FileAccess for the whole operation.
        NSData::with_bytes(content.as_bytes())
            .writeToURL_options_error(&url, NSDataWritingOptions::Atomic)
            .map_err(|error| io::Error::other(error.to_string()))?;
        File::open(&target)?.sync_all()?;
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    write_with(path, |file| file.write_all(content.as_bytes()))
}

fn destination(path: &Path) -> io::Result<(PathBuf, Option<fs::Permissions>)> {
    // Follow an existing symlink, as the previous direct write did, but never
    // replace a dangling link or bypass a read-only destination by renaming.
    match fs::symlink_metadata(path) {
        Ok(_) => {
            let target = fs::canonicalize(path)?;
            let existing = OpenOptions::new().write(true).open(&target)?;
            let metadata = existing.metadata()?;
            if !metadata.is_file() {
                return Err(io::Error::other("Destination is not a regular file"));
            }
            Ok((target, Some(metadata.permissions())))
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok((PathBuf::from(path), None)),
        Err(error) => return Err(error),
    }
}

#[cfg(any(test, not(target_os = "macos")))]
fn write_with(path: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    let (target, permissions) = destination(path)?;
    #[cfg(windows)]
    let replace_existing = permissions.is_some();
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let mut stage = tempfile::NamedTempFile::new_in(parent)?;
    write(stage.as_file_mut())?;
    if let Some(permissions) = permissions {
        stage.as_file().set_permissions(permissions)?;
    }
    stage.as_file_mut().flush()?;
    stage.as_file().sync_all()?;
    #[cfg(windows)]
    persist_windows(stage, &target, replace_existing)?;
    #[cfg(not(windows))]
    stage.persist(&target).map_err(|error| error.error)?;
    // A successful return includes directory durability on Unix. A sync failure
    // after the rename is reported as uncertain durability, never as success.
    #[cfg(unix)]
    File::open(parent)?.sync_all()?;
    Ok(())
}

#[cfg(windows)]
fn persist_windows(
    stage: tempfile::NamedTempFile,
    target: &Path,
    replace_existing: bool,
) -> io::Result<()> {
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn SetFileAttributesW(path: *const u16, attributes: u32) -> i32;
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut c_void,
            reserved: *mut c_void,
        ) -> i32;
    }
    if !replace_existing {
        stage
            .persist_noclobber(target)
            .map_err(|error| error.error)?;
        return Ok(());
    }
    // Keep cleanup ownership while closing the file before exclusive replacement.
    let stage = stage.into_temp_path();
    let target: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
    let replacement: Vec<u16> = stage.as_os_str().encode_wide().chain(Some(0)).collect();
    if unsafe { SetFileAttributesW(replacement.as_ptr(), 0x80) } == 0 {
        return Err(io::Error::last_os_error());
    }
    // ReplaceFile preserves the destination's DACL, encryption and named streams.
    // Do not ignore metadata merge errors or fall back to a broader temporary ACL.
    let replaced = unsafe {
        ReplaceFileW(
            target.as_ptr(),
            replacement.as_ptr(),
            std::ptr::null(),
            0,
            std::ptr::null_mut(),
            std::ptr::null_mut(),
        )
    };
    if replaced == 0 {
        return Err(io::Error::last_os_error());
    }
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
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
        assert_eq!(std::fs::read_to_string(&target).unwrap(), "updated");
        assert_eq!(
            std::fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o640
        );
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
        assert!(std::fs::symlink_metadata(&link)
            .unwrap()
            .file_type()
            .is_symlink());
    }
}

#[cfg(all(test, windows))]
mod windows_metadata_tests {
    use super::*;
    use std::ffi::c_void;
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "advapi32")]
    extern "system" {
        fn ConvertStringSecurityDescriptorToSecurityDescriptorW(
            text: *const u16,
            revision: u32,
            descriptor: *mut *mut c_void,
            size: *mut u32,
        ) -> i32;
        fn SetFileSecurityW(path: *const u16, information: u32, descriptor: *mut c_void) -> i32;
        fn GetSecurityDescriptorDacl(
            descriptor: *mut c_void,
            present: *mut i32,
            dacl: *mut *mut c_void,
            defaulted: *mut i32,
        ) -> i32;
        fn GetSecurityDescriptorControl(
            descriptor: *mut c_void,
            control: *mut u16,
            revision: *mut u32,
        ) -> i32;
        fn GetFileSecurityW(
            path: *const u16,
            information: u32,
            descriptor: *mut c_void,
            size: u32,
            needed: *mut u32,
        ) -> i32;
    }
    #[link(name = "kernel32")]
    extern "system" {
        fn LocalFree(memory: *mut c_void) -> *mut c_void;
    }
    fn wide(path: &Path) -> Vec<u16> {
        path.as_os_str().encode_wide().chain(Some(0)).collect()
    }
    fn dacl(path: &Path) -> (bool, Vec<u8>) {
        let path = wide(path);
        let mut needed = 0;
        unsafe {
            GetFileSecurityW(path.as_ptr(), 4, std::ptr::null_mut(), 0, &mut needed);
        }
        assert!(needed > 0);
        let mut result = vec![0u8; needed as usize];
        assert_ne!(
            unsafe {
                GetFileSecurityW(
                    path.as_ptr(),
                    4,
                    result.as_mut_ptr().cast(),
                    needed,
                    &mut needed,
                )
            },
            0
        );
        let mut present = 0;
        let mut acl: *mut c_void = std::ptr::null_mut();
        let mut defaulted = 0;
        let mut control = 0;
        let mut revision = 0;
        assert_ne!(
            unsafe {
                GetSecurityDescriptorDacl(
                    result.as_mut_ptr().cast(),
                    &mut present,
                    &mut acl,
                    &mut defaulted,
                )
            },
            0
        );
        assert_ne!(present, 0);
        assert!(!acl.is_null());
        assert_ne!(
            unsafe {
                GetSecurityDescriptorControl(
                    result.as_mut_ptr().cast(),
                    &mut control,
                    &mut revision,
                )
            },
            0
        );
        // Compare effective ACL bytes and protection, not Windows' bookkeeping
        // flags such as SE_DACL_AUTO_INHERITED added by ReplaceFile.
        let acl_size = unsafe { std::ptr::read_unaligned(acl.cast::<u16>().add(1)) } as usize;
        let acl = unsafe { std::slice::from_raw_parts(acl.cast::<u8>(), acl_size) }.to_vec();
        (control & 0x1000 != 0, acl)
    }
    #[test]
    fn failed_replacement_preserves_original_and_cleans_temporary_path() {
        use std::os::windows::fs::OpenOptionsExt;
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("locked.lrc");
        fs::write(&target, "original").unwrap();
        let lock = OpenOptions::new()
            .read(true)
            .share_mode(3)
            .open(&target)
            .unwrap();
        assert!(write_atomic(&target, "updated").is_err());
        assert_eq!(fs::read_to_string(&target).unwrap(), "original");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);
        drop(lock);
        write_atomic(&target, "updated").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");
    }

    #[test]
    fn replacement_preserves_explicit_dacl_and_alternate_streams() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("private.lrc");
        fs::write(&target, "original").unwrap();
        let stream = dir.path().join("private.lrc:review-note");
        fs::write(&stream, "keep stream").unwrap();
        let sddl: Vec<u16> = "D:P(A;;FA;;;OW)".encode_utf16().chain(Some(0)).collect();
        let mut descriptor = std::ptr::null_mut();
        assert_ne!(
            unsafe {
                ConvertStringSecurityDescriptorToSecurityDescriptorW(
                    sddl.as_ptr(),
                    1,
                    &mut descriptor,
                    std::ptr::null_mut(),
                )
            },
            0
        );
        let result = unsafe { SetFileSecurityW(wide(&target).as_ptr(), 0x80000004, descriptor) };
        unsafe {
            LocalFree(descriptor);
        }
        assert_ne!(result, 0, "{}", io::Error::last_os_error());
        let before = dacl(&target);
        assert!(before.0, "fixture DACL must be protected from inheritance");
        write_atomic(&target, "updated").unwrap();
        assert_eq!(fs::read_to_string(&target).unwrap(), "updated");
        assert_eq!(
            dacl(&target),
            before,
            "explicit security descriptor must survive save"
        );
        assert_eq!(fs::read_to_string(&stream).unwrap(), "keep stream");
    }
}
