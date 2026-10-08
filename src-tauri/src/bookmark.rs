//! Resolve persistent file grants and hold security scope only during native I/O.

use crate::file_access::{refresh_bookmark, FileAccess, FileRef, ScopeGuard};
use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::AnyThread;
use objc2_foundation::{
    NSData, NSDataBase64DecodingOptions, NSDataBase64EncodingOptions, NSString,
    NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions, NSURL,
};

fn encode(url: &NSURL) -> Result<String, String> {
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| format!("Could not create bookmark: {e}. Select the file again."))?;
    Ok(data
        .base64EncodedStringWithOptions(NSDataBase64EncodingOptions::empty())
        .to_string())
}

pub fn access(path: String, bookmark: Option<String>) -> Result<FileAccess, String> {
    match bookmark {
        Some(bookmark) => {
            let ns_b64 = NSString::from_str(&bookmark);
            let data: Retained<NSData> = NSData::initWithBase64EncodedString_options(
                NSData::alloc(),
                &ns_b64,
                NSDataBase64DecodingOptions::empty(),
            )
            .ok_or("Invalid bookmark data. Select the file again.")?;
            let mut stale = Bool::NO;
            let url = unsafe {
                NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                    &data,
                    NSURLBookmarkResolutionOptions::WithSecurityScope,
                    None,
                    &mut stale,
                )
            }
            .map_err(|e| format!("Could not resolve bookmark: {e}. Select the file again."))?;
            let scope = ScopeGuard::acquire(url.clone())?;
            let resolved = url
                .path()
                .ok_or("Bookmark has no file path. Select the file again.")?
                .to_string();
            let refreshed = refresh_bookmark(bookmark, stale.as_bool(), || encode(&url))?;
            Ok(FileAccess {
                file: FileRef {
                    path: resolved,
                    bookmark: Some(refreshed),
                },
                _scope: Some(scope),
            })
        }
        None => {
            let url = NSURL::fileURLWithPath(&NSString::from_str(&path));
            // User-selected URLs may have a scope; container URLs may not need one.
            // A failed start without a bookmark does not bypass the OS sandbox.
            let scope = ScopeGuard::acquire(url).ok();
            Ok(FileAccess {
                file: FileRef {
                    path,
                    bookmark: None,
                },
                _scope: scope,
            })
        }
    }
}

#[tauri::command]
pub fn create_security_bookmark(path: String) -> Result<String, String> {
    let access = access(path, None)?;
    encode(&NSURL::fileURLWithPath(&NSString::from_str(
        &access.file.path,
    )))
}

#[tauri::command]
pub fn resolve_security_bookmark(bookmark: String) -> Result<String, String> {
    // Compatibility command: resolution never leaves a scope open for callers.
    Ok(access(String::new(), Some(bookmark))?.file.path.clone())
}
