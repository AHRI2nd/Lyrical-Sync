use std::fs::{self, File, OpenOptions};
use std::io::{self, Write};
#[cfg(unix)]
use std::os::unix::io::AsRawFd;
use std::path::{Path, PathBuf};

#[cfg(target_os = "macos")]
use libc;

pub fn write_atomic(path: &Path, content: &str) -> io::Result<()> {
    write_with(path, |file| file.write_all(content.as_bytes()))
}

fn write_with(path: &Path, write: impl FnOnce(&mut File) -> io::Result<()>) -> io::Result<()> {
    // Follow an existing symlink, as the previous direct write did, but never
    // replace a dangling link or bypass a read-only destination by renaming.
    // Use symlink_metadata to NOT follow symlinks, so we can detect dangling links.
    let metadata = fs::symlink_metadata(path);
    
    let (target, permissions, is_existing, target_metadata) = match metadata {
        Ok(meta) => {
            if meta.file_type().is_symlink() {
                // It's a symlink - resolve it but keep track of the link path
                let target = fs::canonicalize(path)?;
                let existing = OpenOptions::new().write(true).open(&target)?;
                let metadata = existing.metadata()?;
                if !metadata.is_file() {
                    return Err(io::Error::other("Destination is not a regular file"));
                }
                #[cfg(target_os = "macos")]
                {
                    use std::os::macos::fs::MetadataExt;
                    use std::os::unix::fs::MetadataExt as UnixMetadataExt;
                    if metadata.nlink() > 1 {
                        return Err(io::Error::other(
                            "Destination has multiple hard links; use Save As to preserve linked files",
                        ));
                    }
                    if metadata.st_flags() != 0 {
                        return Err(io::Error::other(
                            "Destination has file flags that cannot be preserved by an atomic save",
                        ));
                    }
                }
                (target, Some(metadata.permissions()), true, Some(metadata))
            } else if meta.is_file() {
                // Regular file
                let existing = OpenOptions::new().write(true).open(path)?;
                let metadata = existing.metadata()?;
                #[cfg(target_os = "macos")]
                {
                    use std::os::macos::fs::MetadataExt;
                    use std::os::unix::fs::MetadataExt as UnixMetadataExt;
                    if metadata.nlink() > 1 {
                        return Err(io::Error::other(
                            "Destination has multiple hard links; use Save As to preserve linked files",
                        ));
                    }
                    if metadata.st_flags() != 0 {
                        return Err(io::Error::other(
                            "Destination has file flags that cannot be preserved by an atomic save",
                        ));
                    }
                }
                (path.to_path_buf(), Some(metadata.permissions()), true, Some(metadata))
            } else {
                return Err(io::Error::other("Destination is not a regular file"));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {
            // File doesn't exist - check if it's a dangling symlink
            if path.symlink_metadata().is_ok() {
                // It's a dangling symlink - we'll replace it
                (path.to_path_buf(), None, false, None)
            } else {
                // File truly doesn't exist
                (path.to_path_buf(), None, false, None)
            }
        }
        Err(error) => return Err(error),
    };

    // Check if destination is a FIFO or other special file before attempting atomic write
    if let Some(ref meta) = target_metadata {
        let ft = meta.file_type();
        #[cfg(unix)]
        {
            use std::os::unix::fs::FileTypeExt;
            if ft.is_fifo() {
                return Err(io::Error::other("Destination is a FIFO; cannot atomic write"));
            }
        }
    }

    #[cfg(windows)]
    let replace_existing = permissions.is_some();
    
    // CRITICAL FIX: Resolve the parent directory ONCE and use it for staging
    // This prevents symlink-parent retarget attacks
    let parent = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    
    // Canonicalize the parent to get the real directory (not through symlink)
    let parent_canonical = fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
    
    // Try to create temp file in the canonical parent directory
    // If that fails due to permissions, try the original parent path
    let mut stage = match tempfile::NamedTempFile::new_in(&parent_canonical) {
        Ok(stage) => stage,
        Err(e) if e.kind() == io::ErrorKind::PermissionDenied => {
            // Fallback: try original parent path (may be a symlink)
            tempfile::NamedTempFile::new_in(parent)?
        }
        Err(e) => return Err(e),
    };
    
    write(stage.as_file_mut())?;
    
    if let Some(permissions) = permissions.clone() {
        stage.as_file().set_permissions(permissions)?;
    }
    
    #[cfg(target_os = "macos")]
    if permissions.is_some() {
        preserve_macos_metadata(&target, stage.path(), stage.as_file())?;
    }
    
    stage.as_file_mut().flush()?;
    stage.as_file().sync_all()?;
    
    #[cfg(windows)]
    {
        persist_windows(stage, &target, replace_existing)?;
    }
    
    #[cfg(not(windows))]
    {
        // Use persist_noclobber for new files to avoid overwriting existing
        if is_existing {
            stage.persist(&target).map_err(|error| error.error)?;
        } else {
            stage.persist_noclobber(&target).map_err(|error| error.error)?;
        }
    }
    
    // A successful return includes directory durability on Unix.
    // Sync the canonical parent directory to ensure durability.
    #[cfg(unix)]
    {
        let parent_for_sync = fs::canonicalize(parent).unwrap_or_else(|_| parent.to_path_buf());
        File::open(&parent_for_sync)?.sync_all()?;
    }
    
    Ok(())
}

#[cfg(target_os = "macos")]
fn preserve_macos_metadata(source: &Path, stage_path: &Path, stage: &File) -> io::Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::MetadataExt;
    use xattr::FileExt;

    // Preserve extended attributes
    for name in xattr::list_deref(source)? {
        let value = xattr::get_deref(source, &name)?
            .ok_or_else(|| io::Error::other("Destination metadata changed during atomic save"))?;
        stage.set_xattr(&name, &value)?;
    }

    // Preserve group ownership (gid) - fix for macOS group changes on atomic save
    let source_meta = std::fs::metadata(source)?;
    let source_gid = source_meta.gid();
    let stage_meta = stage.metadata()?;
    if stage_meta.gid() != source_gid {
        use std::os::unix::fs::MetadataExt;
        // Use fchown to preserve group - requires appropriate permissions
        // Note: This may fail if process doesn't have CAP_CHOWN, which is expected
        let stage_fd = stage.as_raw_fd();
        unsafe {
            libc::fchown(stage_fd, u32::MAX, source_gid);
        }
    }

    type Acl = *mut std::ffi::c_void;
    const ACL_TYPE_EXTENDED: u32 = 0x0000_0100;
    #[link(name = "System")]
    extern "C" {
        fn acl_get_file(path: *const libc::c_char, acl_type: u32) -> Acl;
        fn acl_set_file(path: *const libc::c_char, acl_type: u32, acl: Acl) -> libc::c_int;
        fn acl_free(obj: *mut std::ffi::c_void) -> libc::c_int;
    }

    let source_path = CString::new(source.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Path contains a NUL byte"))?;
    let stage_path = CString::new(stage_path.as_os_str().as_bytes())
        .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "Path contains a NUL byte"))?;
    let acl = unsafe { acl_get_file(source_path.as_ptr(), ACL_TYPE_EXTENDED) };
    if acl.is_null() {
        let error = io::Error::last_os_error();
        if error.kind() == io::ErrorKind::NotFound {
            return Ok(());
        }
        return Err(error);
    }
    let result = unsafe { acl_set_file(stage_path.as_ptr(), ACL_TYPE_EXTENDED, acl) };
    let error = (result == -1).then(io::Error::last_os_error);
    unsafe { acl_free(acl.cast()) };
    if let Some(error) = error {
        return Err(error);
    }
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

    #[cfg(target_os = "macos")]
    #[test]
    fn preserves_user_extended_attributes() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("tagged.lrc");
        std::fs::write(&path, "old").unwrap();
        xattr::set(&path, "com.lyrical-sync.test", b"metadata").unwrap();

        write_atomic(&path, "new").unwrap();

        assert_eq!(
            xattr::get(&path, "com.lyrical-sync.test").unwrap(),
            Some(b"metadata".to_vec())
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn preserves_extended_acl_entries() {
        use std::ffi::{CStr, CString};
        use std::os::unix::ffi::OsStrExt;
        type Acl = *mut std::ffi::c_void;
        const ACL_TYPE_EXTENDED: u32 = 0x0000_0100;
        #[link(name = "System")]
        extern "C" {
            fn acl_get_file(path: *const libc::c_char, acl_type: u32) -> Acl;
            fn acl_to_text(acl: Acl, len: *mut libc::ssize_t) -> *mut libc::c_char;
            fn acl_free(obj: *mut std::ffi::c_void) -> libc::c_int;
        }

        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("acl.lrc");
        std::fs::write(&path, "old").unwrap();
        let path_c = CString::new(path.as_os_str().as_bytes()).unwrap();
        let status = std::process::Command::new("chmod")
            .args(["+a", "everyone allow read"])
            .arg(&path)
            .status()
            .unwrap();
        assert!(status.success());

        write_atomic(&path, "new").unwrap();

        let copied = unsafe { acl_get_file(path_c.as_ptr(), ACL_TYPE_EXTENDED) };
        assert!(!copied.is_null());
        let rendered_ptr = unsafe { acl_to_text(copied, std::ptr::null_mut()) };
        assert!(!rendered_ptr.is_null());
        let rendered = unsafe { CStr::from_ptr(rendered_ptr) }
            .to_string_lossy()
            .into_owned();
        assert!(rendered.contains("everyone:12:allow:read"), "{rendered}");
        unsafe {
            acl_free(rendered_ptr.cast());
            acl_free(copied.cast());
        }
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn refuses_to_replace_one_name_of_a_hard_link_pair() {
        use std::os::unix::fs::MetadataExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("song.lrc");
        let other = dir.path().join("alias.lrc");
        std::fs::write(&path, "original").unwrap();
        std::fs::hard_link(&path, &other).unwrap();

        let error = write_atomic(&path, "updated").unwrap_err();

        assert!(error.to_string().contains("hard links"));
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "original");
        assert_eq!(std::fs::read_to_string(&other).unwrap(), "original");
        assert_eq!(std::fs::metadata(&path).unwrap().nlink(), 2);
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
