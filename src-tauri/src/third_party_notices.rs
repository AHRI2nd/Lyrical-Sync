// Embedded text avoids arbitrary file paths and needs no filesystem grant.
#[tauri::command]
pub fn read_third_party_notices() -> &'static str {
    include_str!("../ThirdPartyNotices.txt")
}
