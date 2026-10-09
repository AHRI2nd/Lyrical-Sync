# Lyrical Sync — Store edition

macOS와 Windows에서 기기의 가사 파일에 재생 시각을 맞추는 데스크톱 편집기입니다.

[English](README.md) | [日本語](README.ja.md)

## 편집과 재생

- LRC·SRT 문서와 사용자가 선택한 오디오 열기
- 재생 중 줄 타임스탬프 입력, 메타데이터·원시 LRC 편집
- Enhanced LRC 글자·단어 시각 편집과 가라오케 미리보기
- 줄 분할·병합·복제·이동, 여러 줄 선택과 타임스탬프 조정
- 실행 취소·다시 실행, 찾기·바꾸기, 최근 파일과 미저장 작업 복구
- 파형·탐색 바·반복 재생·선택적 스펙트로그램
- 로컬 자동 스팟팅으로 소리·무음 경계 찾기: 가사를 인식하거나 보컬 정렬을 보장하지 않습니다.
- 단축키·화면 배율·가사 글꼴 크기 설정
- 시스템 언어에 따른 한국어·영어·일본어 UI

## 파일과 제한

일반/Enhanced LRC, SRT, WebVTT, ASS로 내보냅니다. 선택한 형식이 지원하는 정보만 보존합니다. 시작 시각 중심 편집 모델이므로 원본 SRT의 임의 종료 시각·겹침은 보존하지 않습니다. 오디오는 재생에 사용하며 내보내지 않습니다.

MP3, WAV, FLAC, OGG/Opus, M4A/AAC, AIFF/AIF 등을 처리합니다. 실제 재생 지원은 운영체제와 WebView 코덱에 따라 달라집니다. Windows AIFF/AIF는 기기 메모리에서 WAV로 변환합니다. 긴 오디오는 많은 메모리를 사용할 수 있습니다.

작업 경로가 있으면 자동 저장을 사용할 수 있습니다. 미저장 가사는 기기에 복구용으로 저장하며, 저장소 오류가 있으면 갱신·삭제에 실패할 수 있습니다. 최근 목록을 지워도 원본 파일은 삭제되지 않습니다.

## 개인정보

가사·오디오·편집 데이터는 기기에서 처리합니다. 이 버전에는 온라인 가사 검색·계정 연결·광고·원격 분석·AI 정렬 다운로드·자체 업데이트 기능이 없습니다. 사용자가 선택한 클라우드 폴더는 별도 동기화 서비스가 처리할 수 있습니다.

[개인정보처리방침](https://ahri2nd.xyz/posts/lyrical-sync-privacy-policy/) · 문의: tsukimori@ahri2nd.xyz. 앱 도움말에서도 방침을 열 수 있습니다.

## 배포와 개발

Mac App Store와 Microsoft Store 배포를 대상으로 합니다. 실제 제공 여부는 게시와 Store 심사에 따라 결정되며, 이 저장소가 출시 완료를 의미하지 않습니다. 업데이트는 각 Store에서 제공합니다. macOS 빌드 대상은 Apple Silicon·macOS 12 이상, Windows는 x64·Windows 10 빌드19041 이상입니다. 이는 빌드 기준이며 실기기 검증 범위와 구분합니다.

Windows MSIX에는 Fixed Version WebView2가 포함됩니다. `runFullTrust`는 데스크톱 편집기를 실행하기 위한 기능이며 관리자 권한 상승을 요청하지 않습니다. 서명되지 않은 Store 제출 패키지는 일반 로컬 설치 패키지가 아닙니다.

로컬 개발은 Node.js·Rust·플랫폼 빌드 도구를 설치한 뒤 `npm ci`, `npm run dev`로 실행합니다. 검사는 `npm test`, `npm run test:packaging`, `npm run build`, `cargo test --manifest-path src-tauri/Cargo.toml --locked`입니다. Store 빌드는 macOS `npm run build:appstore`, Windows `npm run build:msstore -- -RuntimePath <x64-runtime-directory>`를 사용하며 배포 서명·프로필·Windows SDK 요건이 적용됩니다.

## 라이선스

[MIT](LICENSE). 외부 구성요소의 라이선스는 별도로 적용됩니다. 사용 권한이 있는 파일을 선택하세요.
