# Lyrical Sync

`.lrc`(LRC) 가사 파일을 만들고, 동기화하고, 편집하는 데스크톱 앱

[English](README.md) | [日本語](README.ja.md)

![main](img/main_ko.png)

![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-blue)
![Version](https://img.shields.io/badge/version-0.5.1-green)
![Tauri](https://img.shields.io/badge/Tauri-v2-24C8D8)
![React](https://img.shields.io/badge/React-19-61DAFB)
![TypeScript](https://img.shields.io/badge/TypeScript-5.8-3178C6)

---

## 기능

### 편집 & 동기화
- **파형 & 탐색 바** — Wavesurfer.js로 오디오를 시각화하고, 찍힌 줄은 파형 위에 **클릭 가능한 마커**로 표시됩니다. 파형 보기와, 호버 툴팁·드래그 탐색·남은 시간 토글이 있는 탐색 바를 전환할 수 있습니다.
- **실시간 타임스탬프** — `Space`로 활성 줄에 현재 재생 위치를 찍고 다음 줄로 자동 이동합니다. 재생·스탬프 키는 **모두 재설정 가능**합니다.
- **글자/단어 단위 동기화(Enhanced LRC)** — 글자마다 시간을 입력하는 전용 모드: 글자 위를 드래그하면 **현재 재생 위치**로 "칠하듯" 찍히며, 줌 가능한 파형 스크럽 레인·글자별 시간 마커·키보드 미세조정·미리보기 가라오케 채움을 지원합니다. A2 `<mm:ss.xx>` 태그 또는 일반 LRC로 저장됩니다.
- **줄 도구** — 줄 복제, 위 줄과 병합, 분할(`Shift+Enter`, 커서 위치), **드래그로 순서 변경** — 모두 실행취소 가능.
- **다중선택 & 일괄작업** — `Shift`/`Ctrl`+클릭으로 범위·개별 선택 후 일괄 삭제·시프트·타임스탬프 제거.
- **타임스탬프 도구** — 일괄 **오프셋**, **구간 시프트**, **스케일**(템포/버전 불일치를 위해 전체 타임스탬프를 배율로 늘이기·줄이기).
- **검증 & 통계** — 완성도 표시 + 이슈 목록(미입력·중복·순서 오류 타임스탬프); 이슈를 클릭하면 해당 줄로 점프.
- **미리보기** — 전체화면 가라오케 미리보기. 자동 스크롤 하이라이트, 줄 클릭 탐색, 인라인 타임스탬프 편집, 글자별 가라오케 채움.
- **곡 메타데이터** — 제목·아티스트·앨범·작성자·오프셋 및 알 수 없는 LRC 태그 편집(보존). 오디오를 열면 파일 태그(ID3 / Vorbis / MP4)에서 **빈 필드를 자동으로 채웁니다**.
- **자동 복구** — 작업 중인 내용을 스냅샷으로 보관해, 예기치 않게 종료돼도(저장 경로가 없어도) 재시작 시 복구를 제안합니다.

### AI 자동 동기화
- **자동 정렬** — [ctc-forced-aligner](https://github.com/MahmoudAshraf97/ctc-forced-aligner)와 MMS-300M 모델로 가사 줄을 오디오에 정렬합니다(**1130개 언어**, 한국어·영어·일본어 포함).
- **보컬 분리** — 정렬 전 [Demucs](https://github.com/facebookresearch/demucs)로 보컬을 분리해 정확도를 높일 수 있습니다(선택).
- **보컬 활동 감지(VAD)** — 간주 뒤 보컬이 다시 시작하는 지점에 문단 구분선 타임스탬프를 정밀 배치하고, 무보컬 구간에 잘못 찍힌 줄의 신뢰도를 낮춰 오정렬을 쉽게 찾게 합니다.
- **신뢰도 표시** — 정렬된 각 줄을 신뢰도에 따라 색으로 구분해 불확실한 결과를 한눈에 확인.
- **사용 항목 선택** — 보컬 분리·VAD 사용 여부를 정렬마다 토글.
- **내장 Python 런타임** — 앱이 자체 Python 환경을 다운로드·관리하므로 시스템 Python이 필요 없습니다.

### Spotify & YouTube
- **Spotify 모드** — 계정을 연결(PKCE OAuth)해 재생을 제어하고 현재 재생 중인 곡에 맞춰 가사를 동기화합니다. 재생 기기 선택과 "Spotify에서 열기" 링크 제공. 리프레시 토큰은 OS 키체인에 저장됩니다.
- **YouTube 모드** — yt-dlp(앱이 다운로드·관리)로 YouTube URL에서 오디오를 바로 불러옵니다.

### 가져오기 / 내보내기
- **열기** — LRC, SRT 파일(드래그앤드롭 지원).
- **내보내기** — LRC(일반 또는 Enhanced LRC), SRT, **WebVTT**, **ASS**(가라오케).
- **LRCLIB** — 공개 데이터베이스 [LRCLIB](https://lrclib.net/)에서 가사를 가져오고, 동기화 가사를 기여할 수 있습니다.

### 일반
- **다국어 UI** — 한국어, 영어, 일본어.
- **단축키 커스터마이즈** — 재생·스탬프 키를 충돌 감지와 함께 재설정(설정 → 단축키).
- **토스트 알림** — 저장·오류·AI 완료·다운로드 등을 명확히 피드백.
- **표시 옵션** — UI 스케일(70%~130%)과 가사 글꼴 크기 조절.
- **자동 저장 & 업데이트 확인** — 지정된 경로의 변경을 자동 저장하고, 새 릴리즈가 있으면 알립니다.
- **지원 오디오 포맷** — MP3, FLAC, WAV, OGG, Opus, M4A/AAC, AIFF/AIF.
  - macOS(WKWebView): 모든 포맷 기본 지원.
  - Windows(WebView2): AIFF/AIF는 Rust 백엔드가 자동으로 WAV로 트랜스코딩.

---

## 설치

### macOS

[Releases](../../releases) 페이지에서 최신 `.dmg` 설치 파일을 받아 Lyrical Sync를 응용 프로그램 폴더로 드래그합니다.

### Windows

[Releases](../../releases) 페이지에서 최신 `.msi` 또는 `_x64-setup.exe` 설치 파일을 받아 실행합니다.

> **SmartScreen 경고**
>
> Windows Defender SmartScreen이 "알 수 없는 게시자" 경고를 표시하면 **추가 정보** → **실행**을 클릭하세요.

---

## 단축키

기본 바인딩 — 모두 **설정 → 단축키**에서 재설정할 수 있습니다.

| 키 | 동작 |
|----|------|
| `1` | -5초 스킵 |
| `2` | -1초 스킵 |
| `3` | 재생 / 일시정지 |
| `4` | +1초 스킵 |
| `5` | +5초 스킵 |
| `6` | 정지 후 0:00으로 |
| `Space` | 현재 줄 찍기 + 다음 줄로 |
| `Backspace` | 이전 줄로 |
| `Enter` | 아래에 새 줄 삽입(편집 중) |
| `Shift+Enter` | 커서 위치에서 줄 분할 |
| `Ctrl/⌘ + Z` / `Shift+Z` | 실행취소 / 다시실행 |
| `Ctrl/⌘ + F` | 찾기 & 바꾸기 |

> 입력창에 포커스가 있는 동안에는 단축키가 비활성화됩니다.

---

## 기술 스택

| 역할 | 기술 | 버전 |
|------|------|------|
| 데스크톱 프레임워크 | Tauri | v2 |
| 프론트엔드 | React + TypeScript | React 19, TS 5.8 |
| 스타일링 | Tailwind CSS + @tailwindcss/vite | v4 |
| 상태 관리 | Zustand | v5 |
| 파형 | Wavesurfer.js | v7 |
| AI 정렬 | ctc-forced-aligner + MMS-300M | — |
| 보컬 분리 | Demucs htdemucs | — |
| 오디오 태그 / 트랜스코딩 | lofty + Symphonia (Rust) | — |
| 파일 I/O | @tauri-apps/plugin-fs | v2 |
| 다이얼로그 | @tauri-apps/plugin-dialog | v2 |

---

## 시작하기 (개발)

### 사전 요구사항

- [Node.js](https://nodejs.org/) 18+
- [Rust](https://www.rust-lang.org/tools/install) (stable)
- Tauri CLI 의존성 — [Tauri 사전 요구사항](https://v2.tauri.app/start/prerequisites/) 참고

```bash
npm install
npm run tauri dev   # 개발
npm run tauri build # 배포 빌드
npx tsc --noEmit    # 타입 체크
npm test            # 프론트엔드 단위 테스트
```

빌드 결과물은 `src-tauri/target/release/bundle/`에 생성됩니다.
