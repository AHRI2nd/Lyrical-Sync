# Spotify 연동 설치 및 사용 가이드

Lyrical Sync는 Spotify Web Playback SDK를 통해 Spotify 곡을 앱 내에서 직접 재생하며 LRC를 편집할 수 있습니다.  
서버 없이 사용자 본인의 Spotify Developer App Client ID만으로 동작합니다.

---

## 시스템 요구사항

- **Spotify Premium** 계정 (Web Playback SDK 동작 조건)
- **Spotify Developer 계정** (무료, [developer.spotify.com](https://developer.spotify.com) 가입)
- 인터넷 연결

> Spotify Free 계정으로는 동작하지 않습니다.

---

## 1단계 — Spotify Developer App 만들기

1. [Spotify Developer Dashboard](https://developer.spotify.com/dashboard)에 로그인합니다.
2. **"Create app"** 버튼을 클릭합니다.
3. 아래와 같이 정보를 입력합니다.

   | 항목 | 입력값 |
   |------|--------|
   | App name | `Lyrical Sync` |
   | App description | 자유롭게 입력 |
   | Redirect URIs | `http://127.0.0.1:54321/callback` |
   | Which API/SDKs | **Web Playback SDK** 체크 |

4. **"Save"** 를 클릭합니다.
5. 생성된 앱의 **Settings** 페이지에서 **Client ID**를 복사합니다.

> **Redirect URI 주의**: `http://127.0.0.1:54321/callback` 을 정확하게 입력해야 합니다.

---

## 2단계 — Lyrical Sync에 Client ID 입력

1. 앱 좌측 하단의 **⚙ 설정** 버튼을 클릭합니다.
2. **Spotify** 탭을 선택합니다.
3. 복사한 **Client ID**를 입력 후 **"저장"** 을 클릭합니다.

---

## 3단계 — Spotify 로그인

1. 상단 헤더의 **Spotify 버튼**을 클릭합니다.
2. 브라우저가 열리며 Spotify 로그인 페이지가 표시됩니다.
3. Spotify Premium 계정으로 로그인하고 앱 권한을 허용합니다.
4. 인증이 완료되면 Lyrical Sync로 자동 복귀합니다.

---

## 4단계 — 곡 선택 및 재생

Spotify 버튼을 클릭하면 현재 재생 상태에 따라 분기합니다.

### 현재 재생 중인 곡이 있을 때

- **"불러오기"**: 현재 재생 중인 곡을 앱으로 가져와 Spotify 모드로 전환합니다.
- **"다른 곡 선택"**: 검색/플레이리스트 모달을 엽니다.
- **"파일 모드로 돌아가기"**: 로컬 오디오 파일 모드로 전환합니다.

### 재생 중인 곡이 없을 때

- **"Spotify에서 찾기"**: 검색/플레이리스트 모달을 엽니다.
- **"파일 모드로 돌아가기"**: 로컬 오디오 파일 모드로 전환합니다.

### 검색/플레이리스트 모달

- **검색 탭**: 곡명 또는 아티스트명으로 검색 (실시간 검색)
- **내 플레이리스트 탭**: 계정에 저장된 플레이리스트에서 곡 선택

곡을 선택하면 자동으로 Spotify 모드로 전환되며 메타데이터(제목/아티스트/앨범)가 LRC 에디터에 자동 입력됩니다.

---

## Spotify 모드 플레이어

Spotify 모드에서는 파형 대신 전용 플레이어 패널이 표시됩니다.

| 기능 | 설명 |
|------|------|
| 시크바 | 클릭으로 재생 위치 이동, 호버 시 시간 툴팁 |
| −5s / −1s / ▶⏸ / +1s / +5s | 재생 컨트롤 |
| 정지 | 재생 위치를 처음(0:00)으로 초기화 |
| 반복 | 현재 곡 반복 재생 토글 |
| 볼륨 | 앱 내 볼륨 조절 |
| 앨범 아트 | 재생 중 곡 정보와 함께 표시 |

### 단축키

Spotify 모드에서도 동일한 키보드 단축키가 동작합니다.

| 키 | 동작 |
|----|------|
| `1` | −5초 |
| `2` | −1초 |
| `3` | 재생/일시정지 |
| `4` | +1초 |
| `5` | +5초 |
| `Space` | 현재 줄 타임스탬프 + 다음 줄 이동 |
| `Backspace` | 이전 줄 이동 |

---

## 제한 사항

Spotify 스트리밍 특성상 아래 기능은 사용할 수 없습니다.

| 기능 | 사유 |
|------|------|
| 파형 시각화 | 스트리밍 오디오 데이터에 직접 접근 불가 |
| 배속 조절 | Spotify API 미지원 |
| AI 자동 싱크 | 로컬 오디오 파일 필요 |

> AI 자동 싱크가 필요하다면, 로컬 파일 모드에서 먼저 AI로 타임스탬프를 생성한 뒤 Spotify 모드로 전환해 미세 보정하는 방식을 권장합니다.

---

## 파일 모드로 돌아가기

- 상단 Spotify 버튼 클릭 → **"파일 모드로 돌아가기"** 선택
- 설정 → Spotify 탭의 모드 토글로도 전환 가능

---

## 자주 묻는 질문

**Q. "재생 가능한 Spotify 기기가 없습니다" 오류가 떠요.**  
A. Spotify 앱(모바일 또는 PC)을 먼저 실행한 뒤 다시 시도하세요. 앱이 실행되어 있어야 Web Playback SDK가 기기로 등록됩니다.

**Q. 브라우저에서 인증 후 앱으로 돌아오지 않아요.**  
A. Redirect URI가 `http://127.0.0.1:54321/callback` 으로 정확히 설정됐는지 확인하세요. Developer Dashboard에서 저장 후 몇 분이 지나야 적용되는 경우가 있습니다.

**Q. "Premium 계정이 필요합니다" 오류가 떠요.**  
A. Web Playback SDK는 Spotify Premium 전용 기능입니다. Free 계정으로는 사용할 수 없습니다.

**Q. 로그아웃하려면 어떻게 하나요?**  
A. 설정 → Spotify 탭의 **"로그아웃"** 버튼을 클릭하세요. 저장된 인증 정보가 시스템 키체인에서 삭제됩니다.

**Q. Client ID를 입력했는데 로그인이 안 돼요.**  
A. Developer Dashboard에서 해당 앱의 Redirect URI 목록에 `http://127.0.0.1:54321/callback` 이 포함되어 있는지 다시 확인하세요.
