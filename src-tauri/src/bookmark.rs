//! macOS 보안 스코프 북마크(security-scoped bookmark).
//!
//! App Sandbox 하에서는 다이얼로그/드래그앤드롭으로 선택한 파일의 접근 권한이
//! 앱 재시작 시 사라진다. 크래시 복구 스냅샷이 저장한 오디오/LRC 경로를 재시작
//! 후에도 다시 읽으려면, 파일을 처음 열 때 북마크를 만들어 저장해뒀다가
//! 재시작 시 그 북마크로 접근 권한을 복원해야 한다.

use objc2::rc::Retained;
use objc2::runtime::Bool;
use objc2::AnyThread;
use objc2_foundation::{
    NSData, NSDataBase64DecodingOptions, NSDataBase64EncodingOptions, NSString, NSURL,
    NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
};

/// 파일 경로로 보안 스코프 북마크를 생성해 base64 문자열로 반환.
/// 다이얼로그/드래그앤드롭으로 막 선택돼 현재 세션에서 접근 권한이 있는 경로에만 성공한다.
#[tauri::command]
pub fn create_security_bookmark(path: String) -> Result<String, String> {
    let ns_path = NSString::from_str(&path);
    let url = NSURL::fileURLWithPath(&ns_path);
    let data = url
        .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
            NSURLBookmarkCreationOptions::WithSecurityScope,
            None,
            None,
        )
        .map_err(|e| format!("북마크 생성 실패: {e}"))?;
    Ok(data.base64EncodedStringWithOptions(NSDataBase64EncodingOptions::empty()).to_string())
}

/// base64 북마크를 해석해 파일 접근 권한을 복원하고, 현재 유효한 파일 경로를 반환.
/// startAccessingSecurityScopedResource를 호출해 세션 동안 접근을 열어두며,
/// 별도로 stop을 호출하지 않음(앱 종료 시 OS가 정리 — 짧은 세션 단위 반복 호출이라
/// 명시적 해제 없이도 문제되지 않음).
#[tauri::command]
pub fn resolve_security_bookmark(bookmark: String) -> Result<String, String> {
    let ns_b64 = NSString::from_str(&bookmark);
    let data: Retained<NSData> = NSData::initWithBase64EncodedString_options(
        NSData::alloc(),
        &ns_b64,
        NSDataBase64DecodingOptions::empty(),
    )
    .ok_or("북마크 데이터 디코딩 실패(잘못된 base64)")?;

    let mut is_stale = Bool::NO;
    let url = unsafe {
        NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
            &data,
            NSURLBookmarkResolutionOptions::WithSecurityScope,
            None,
            &mut is_stale,
        )
    }
    .map_err(|e| format!("북마크 해석 실패: {e}"))?;

    if !unsafe { url.startAccessingSecurityScopedResource() } {
        return Err("보안 스코프 리소스 접근 시작 실패".to_string());
    }

    url.path()
        .map(|p| p.to_string())
        .ok_or_else(|| "URL에서 경로를 가져올 수 없음".to_string())
}
