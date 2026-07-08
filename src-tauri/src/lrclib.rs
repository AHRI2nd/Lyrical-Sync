use serde::Deserialize;

#[derive(Deserialize)]
struct LrclibChallenge {
    prefix: String,
    target: String,
}

fn hex_to_bytes(s: &str) -> Vec<u8> {
    (0..s.len())
        .step_by(2)
        .filter_map(|i| s.get(i..i + 2).and_then(|b| u8::from_str_radix(b, 16).ok()))
        .collect()
}

/// SHA-256(prefix+nonce) ≤ target (big-endian 32바이트 비교)
fn nonce_meets_target(hash: &[u8], target: &[u8]) -> bool {
    for i in 0..target.len().min(hash.len()) {
        if hash[i] > target[i] {
            return false;
        } else if hash[i] < target[i] {
            return true;
        }
    }
    true
}

/// 동기화 가사를 LRCLIB에 업로드(기여). PoW 챌린지를 풀어 토큰을 만든 뒤 publish.
#[tauri::command]
pub async fn lrclib_publish(
    track_name: String,
    artist_name: String,
    album_name: String,
    duration: f64,
    plain_lyrics: String,
    synced_lyrics: String,
) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let client = reqwest::Client::new();

    // 1) 챌린지 요청
    let ch: LrclibChallenge = client
        .post("https://lrclib.net/api/request-challenge")
        .header("User-Agent", "lyrical-sync")
        .send()
        .await
        .map_err(|e| format!("챌린지 요청 실패: {e}"))?
        .json()
        .await
        .map_err(|e| format!("챌린지 파싱 실패: {e}"))?;

    // 2) PoW 풀기 (CPU 집약 → 블로킹 스레드)
    let prefix = ch.prefix;
    let target = hex_to_bytes(&ch.target);
    let token = tokio::task::spawn_blocking(move || {
        let mut nonce: u64 = 0;
        loop {
            let hash = Sha256::digest(format!("{prefix}{nonce}").as_bytes());
            if nonce_meets_target(&hash, &target) {
                return format!("{prefix}:{nonce}");
            }
            nonce += 1;
        }
    })
    .await
    .map_err(|e| format!("PoW 실패: {e}"))?;

    // 3) 업로드
    let body = serde_json::json!({
        "trackName": track_name,
        "artistName": artist_name,
        "albumName": album_name,
        "duration": duration,
        "plainLyrics": plain_lyrics,
        "syncedLyrics": synced_lyrics,
    });
    let resp = client
        .post("https://lrclib.net/api/publish")
        .header("X-Publish-Token", token)
        .header("User-Agent", "lyrical-sync")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("업로드 요청 실패: {e}"))?;
    if !resp.status().is_success() {
        let status = resp.status();
        let text = resp.text().await.unwrap_or_default();
        return Err(format!("업로드 실패 ({status}): {text}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hex_to_bytes_parses_pairs() {
        assert_eq!(hex_to_bytes("00ff10"), vec![0u8, 255, 16]);
    }

    #[test]
    fn nonce_target_comparison() {
        assert!(nonce_meets_target(&[0x00, 0x10], &[0x00, 0x20])); // hash < target
        assert!(!nonce_meets_target(&[0x00, 0x30], &[0x00, 0x20])); // hash > target
        assert!(nonce_meets_target(&[0x00, 0x20], &[0x00, 0x20])); // equal
    }
}
