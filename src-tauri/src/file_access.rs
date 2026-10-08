use std::path::PathBuf;

#[derive(Clone, Debug, PartialEq, serde::Serialize)]
pub struct FileRef {
    pub path: String,
    pub bookmark: Option<String>,
}

#[cfg(any(target_os = "macos", test))]
pub trait ScopeResource {
    fn start(&self) -> bool;
    fn stop(&self);
}

#[cfg(target_os = "macos")]
impl ScopeResource for objc2::rc::Retained<objc2_foundation::NSURL> {
    fn start(&self) -> bool {
        unsafe { self.startAccessingSecurityScopedResource() }
    }
    fn stop(&self) {
        unsafe { self.stopAccessingSecurityScopedResource() }
    }
}

#[cfg(any(target_os = "macos", test))]
pub struct ScopeGuard<R: ScopeResource>(R);

#[cfg(any(target_os = "macos", test))]
impl<R: ScopeResource> ScopeGuard<R> {
    pub fn acquire(resource: R) -> Result<Self, String> {
        if !resource.start() {
            return Err("File access could not be restored. Select the file again.".into());
        }
        Ok(Self(resource))
    }
}

#[cfg(any(target_os = "macos", test))]
impl<R: ScopeResource> Drop for ScopeGuard<R> {
    fn drop(&mut self) {
        self.0.stop();
    }
}

#[cfg(any(target_os = "macos", test))]
pub fn refresh_bookmark(
    bookmark: String,
    stale: bool,
    refresh: impl FnOnce() -> Result<String, String>,
) -> Result<String, String> {
    if stale {
        refresh()
    } else {
        Ok(bookmark)
    }
}

pub struct FileAccess {
    pub file: FileRef,
    #[cfg(target_os = "macos")]
    pub _scope: Option<ScopeGuard<objc2::rc::Retained<objc2_foundation::NSURL>>>,
}

impl FileAccess {
    pub fn open(path: String, bookmark: Option<String>) -> Result<Self, String> {
        #[cfg(target_os = "macos")]
        {
            crate::bookmark::access(path, bookmark)
        }
        #[cfg(not(target_os = "macos"))]
        {
            if bookmark.is_some() {
                return Err(
                    "Apple bookmarks are not supported here. Select the file again.".into(),
                );
            }
            Ok(Self {
                file: FileRef {
                    path,
                    bookmark: None,
                },
            })
        }
    }

    pub fn path(&self) -> PathBuf {
        PathBuf::from(&self.file.path)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::rc::Rc;

    struct Resource {
        starts: Rc<Cell<usize>>,
        stops: Rc<Cell<usize>>,
        allowed: bool,
    }

    impl ScopeResource for Resource {
        fn start(&self) -> bool {
            self.starts.set(self.starts.get() + 1);
            self.allowed
        }
        fn stop(&self) {
            self.stops.set(self.stops.get() + 1);
        }
    }

    fn resource(allowed: bool) -> (Resource, Rc<Cell<usize>>, Rc<Cell<usize>>) {
        let starts = Rc::new(Cell::new(0));
        let stops = Rc::new(Cell::new(0));
        (
            Resource {
                starts: starts.clone(),
                stops: stops.clone(),
                allowed,
            },
            starts,
            stops,
        )
    }

    #[test]
    fn scope_is_held_until_operation_finishes() {
        let (r, starts, stops) = resource(true);
        let guard = ScopeGuard::acquire(r).unwrap();
        assert_eq!(starts.get(), 1);
        assert_eq!(stops.get(), 0);
        drop(guard);
        assert_eq!(stops.get(), 1);
    }

    #[test]
    fn scope_released_after_read_error() {
        let (r, starts, stops) = resource(true);
        let result: Result<(), String> = (|| {
            let _guard = ScopeGuard::acquire(r)?;
            Err("read failed".into())
        })();
        assert_eq!(result, Err("read failed".into()));
        assert_eq!(starts.get(), 1);
        assert_eq!(stops.get(), 1);
    }

    #[test]
    fn failed_start_does_not_call_stop_or_allow_io() {
        let (r, starts, stops) = resource(false);
        assert!(ScopeGuard::acquire(r).is_err());
        assert_eq!(starts.get(), 1);
        assert_eq!(stops.get(), 0);
    }

    #[test]
    fn stale_bookmark_returns_refreshed_reference() {
        assert_eq!(
            refresh_bookmark("old".into(), true, || Ok("fresh".into())).unwrap(),
            "fresh"
        );
    }

    #[test]
    fn fresh_bookmark_does_not_need_regeneration() {
        assert_eq!(
            refresh_bookmark("current".into(), false, || panic!("unexpected refresh")).unwrap(),
            "current"
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn invalid_bookmark_requires_reselection() {
        assert!(FileAccess::open("/unused/path".into(), Some("%%%".into())).is_err());
    }

    #[test]
    fn refresh_failure_is_not_silently_ignored() {
        assert!(refresh_bookmark("old".into(), true, || Err("select again".into())).is_err());
    }
}

#[tauri::command]
pub fn prepare_file_ref(path: String, bookmark: Option<String>) -> Result<FileRef, String> {
    // Scope is released before returning; each I/O command acquires its own guard.
    Ok(FileAccess::open(path, bookmark)?.file.clone())
}
