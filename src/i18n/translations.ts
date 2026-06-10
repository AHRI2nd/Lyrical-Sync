export type Lang = "ko" | "en" | "ja";

export interface Translations {
  // Header
  newFileTitle: string;
  newFileBtn: string;
  openLrc: string;
  save: string;
  saveAs: string;
  saveFormatTitle: string;
  saveFormatLrcDesc: string;
  saveFormatSrtDesc: string;
  undo: string;
  redo: string;
  // Help modal
  helpTitle: string;
  helpTabShortcuts: string;
  helpTabAi: string;
  helpTabSpotify: string;
  shortcutsTitle: string;
  shortcutNote: string;
  shortcutDescs: {
    s1: string; s2: string; s3: string; s4: string; s5: string; s6: string;
    space: string; backspace: string;
    enter: string; undo: string; redo: string; find: string;
  };
  menu: {
    file: string; edit: string; playback: string; mode: string; view: string; help: string;
    settings: string; saveAsLrc: string; saveAsSrt: string;
    playPause: string; skipBack5: string; skipBack1: string;
    skipFwd1: string; skipFwd5: string; stop: string;
  };
  helpAiSteps: { title: string; desc: string }[];
  helpSpotifySteps: { title: string; desc: string }[];
  helpYoutubeSteps: { title: string; desc: string }[];
  helpViewGuide: string;
  helpTabYouTube: string;
  settingsViewGuide: string;
  // AudioPlayer
  openAudio: string;
  zoom: string;
  volume: string;
  noAudio: string;
  tooltipSkipBack5: string;
  tooltipSkipBack1: string;
  tooltipPlayPause: string;
  tooltipSkipFwd1: string;
  tooltipSkipFwd5: string;
  tooltipStop: string;
  tooltipLoop: string;
  tooltipMarkers: string;
  tooltipSetA: string;
  tooltipSetB: string;
  tooltipClearAB: string;
  abLoopLabel: string;
  tooltipSpeedDown: string;
  tooltipSpeedUp: string;
  tooltipViewWaveform: string;
  tooltipViewSeekBar: string;
  // LrcEditor
  lyricsEditor: string;
  addLine: string;
  findReplace: string;
  findPlaceholder: string;
  replacePlaceholder: string;
  replaceBtn: string;
  replaceAll: string;
  caseSensitive: string;
  noMatches: string;
  timeShift: string;
  timeShiftTooltip: string;
  timeShiftFrom: string;
  timeShiftTo: string;
  timeShiftDelta: string;
  timeShiftApply: string;
  timeShiftSec: string;
  warnOutOfOrder: string;
  warnDuplicate: string;
  validationSummary: string;
  noLines: string;
  stampTooltip: string;
  linePlaceholder: string;
  deleteLine: string;
  currentTimeLabel: string;
  // MetaEditor
  songInfo: string;
  metaTitle: { label: string; placeholder: string };
  metaArtist: { label: string; placeholder: string };
  metaAlbum: { label: string; placeholder: string };
  metaBy: { label: string; placeholder: string };
  metaOffset: string;
  applyOffset: string;
  applyOffsetTooltip: string;
  viewAll: string;
  importSrt: string;
  rawEditorTitle: string;
  rawEditorApply: string;
  rawEditorCancel: string;
  previewBtn: string;
  previewClose: string;
  previewUntitled: string;
  previewNoLyrics: string;
  previewNoTimestamps: string;
  // Confirm new file dialog
  confirmNewTitle: string;
  confirmNewMessage: string;
  confirmNewOk: string;
  confirmNewCancel: string;
  // Update notification
  updateTitle: string;
  updateNewVersion: string;
  updatePrompt: string;
  updateYes: string;
  updateLater: string;
  // Settings modal
  settingsTitle: string;
  settingsTabGeneral: string;
  settingsTabModels: string;
  settingsAutoUpdate: string;
  settingsAutoUpdateDesc: string;
  settingsAutoSave: string;
  settingsAutoSaveDesc: string;
  settingsCheckNow: string;
  settingsChecking: string;
  settingsUpToDate: string;
  settingsUiScale: string;
  settingsUiScaleReset: string;
  // Model download
  modelCategoryDemucs: string;
  modelCategoryCTC: string;
  modelCategoryWav2vec2: string;
  modelInstall: string;
  modelInstalling: string;
  modelInstalled: string;
  modelDelete: string;
  modelCancel: string;
  modelStoragePath: string;
  modelMb: string;
  modelErrorPrefix: string;
  modelRequired: string;
  modelOptional: string;
  modelChangeDir: string;
  modelResetDir: string;
  modelCopyPath: string;
  modelInstalledVariants: string;
  modelNoneInstalled: string;
  // AI Auto Sync
  aiAutoSync: string;
  aiSyncRunning: string;
  aiSyncCancel: string;
  aiSyncClear: string;
  aiSyncNoModel: string;
  aiSyncNoAudio: string;
  aiSyncDone: string;
  aiSyncError: string;
  aiSyncStatusLoadingModel: string;
  aiSyncStatusLoadingAudio: string;
  aiSyncStatusAnalyzing: string;
  aiSyncStatusAligning: string;
  aiSyncStatusDone: string;
  aiSyncConfidenceHigh: string;
  aiSyncConfidenceLow: string;
  aiSyncConfidenceLabel: string;
  aiSyncStatusPostprocessing: string;
  aiSyncBlankOffset: string;
  aiSyncBlankOffsetDesc: string;
  settingsVenvTitle: string;
  settingsVenvReady: string;
  settingsVenvNoPackages: string;
  settingsVenvNotCreated: string;
  settingsVenvCreate: string;
  settingsVenvCreating: string;
  settingsVenvInstallTitle: string;
  settingsVenvRefresh: string;
  settingsVenvChecking: string;
  settingsVenvInstallBtn: string;
  settingsVenvInstalling: string;
  settingsVenvCmdWarning: string;
  // Spotify
  settingsTabSpotify: string;
  spotifyClientId: string;
  spotifyClientIdDesc: string;
  spotifyClientIdPlaceholder: string;
  spotifyClientIdSave: string;
  spotifyClientIdSaved: string;
  spotifyConnect: string;
  spotifyConnecting: string;
  spotifyConnected: string;
  spotifyLogout: string;
  spotifyNoClientId: string;
  spotifyNoClientIdDesc: string;
  spotifyPremiumRequired: string;
  spotifyCurrentlyPlaying: string;
  spotifyLoadThisTrack: string;
  spotifyLoadYes: string;
  spotifyLoadNo: string;
  spotifySearchTitle: string;
  spotifySearchPlaceholder: string;
  spotifyMyPlaylists: string;
  spotifyNoResults: string;
  spotifyServiceModeInfo: string;
  spotifyBackToFileMode: string;
  spotifyNoTrackTitle: string;
  spotifyNoTrackMessage: string;
  spotifySearchTrack: string;
  modeSelect: string;
  modeFile: string;
  modeYouTube: string;
  modeComingSoon: string;
  spotifyLoadCurrent: string;
  spotifyNoTrackAlertTitle: string;
  spotifyNoTrackAlertMessage: string;
  spotifyNoTrackAlertOk: string;
  settingsTabYouTube: string;
  ytdlpTitle: string;
  ytdlpInstalled: string;
  ytdlpNotInstalled: string;
  ytdlpVersion: string;
  ytdlpDownload: string;
  ytdlpUpdate: string;
  ytdlpDownloading: string;
  ytdlpRefresh: string;
  ytdlpAudioQuality: string;
  ytdlpQualityBest: string;
  ytdlpQuality192: string;
  ytdlpQuality128: string;
  ytdlpCookiesFile: string;
  ytdlpCookiesFileDesc: string;
  ytdlpCookiesSelect: string;
  ytdlpCookiesClear: string;
  ytdlpProxy: string;
  ytdlpProxyPlaceholder: string;
  ytdlpProxySave: string;
  ytdlpInfoText: string;
  youtubeUrlPlaceholder: string;
  youtubeLoad: string;
  youtubeLoading: string;
  youtubeCancel: string;
  youtubeNotInstalled: string;
  youtubeOpenLink: string;
  youtubeModalTitle: string;
  youtubeModeLabel: string;
  youtubeModeOn: string;
  youtubeModeOff: string;
}

const ko: Translations = {
  newFileTitle: "새 LRC 파일",
  newFileBtn: "새로 만들기",
  openLrc: "가사 열기",
  save: "저장",
  saveAs: "다른 이름으로 저장",
  saveFormatTitle: "저장 형식 선택",
  saveFormatLrcDesc: "가사 동기화 파일",
  saveFormatSrtDesc: "영상 자막 파일",
  undo: "실행 취소",
  redo: "다시 실행",
  helpTitle: "도움말",
  helpTabShortcuts: "단축키",
  helpTabAi: "AI 사용법",
  helpTabSpotify: "Spotify",
  shortcutsTitle: "단축키 안내",
  shortcutNote: "* 인풋 포커스 중일 때는 단축키가 동작하지 않습니다.",
  shortcutDescs: {
    s1: "−5초 뒤로 스킵",
    s2: "−1초 뒤로 스킵",
    s3: "재생 / 일시정지",
    s4: "+1초 앞으로 스킵",
    s5: "+5초 앞으로 스킵",
    s6: "정지 및 처음으로",
    space: "현재 줄에 타임스탬프 찍기 + 다음 줄로 이동",
    backspace: "이전 줄로 이동",
    enter: "가사 편집 중 현재 줄 아래에 새 줄 삽입",
    undo: "실행 취소",
    redo: "다시 실행",
    find: "찾기 / 바꾸기 열기",
  },
  menu: {
    file: "파일", edit: "편집", playback: "재생", mode: "모드", view: "보기", help: "도움말",
    settings: "설정…", saveAsLrc: "LRC로 저장…", saveAsSrt: "SRT로 저장…",
    playPause: "재생 / 일시정지", skipBack5: "5초 뒤로", skipBack1: "1초 뒤로",
    skipFwd1: "1초 앞으로", skipFwd5: "5초 앞으로", stop: "정지",
  },
  helpAiSteps: [
    { title: "Python 환경 설치", desc: "설정(⚙) → AI 환경 탭에서 내장 Python을 다운로드하고 패키지를 설치합니다." },
    { title: "모델 다운로드", desc: "설정 → AI 모델 탭에서 필수 모델 ctc-mms-300m(1.2 GB)을 다운로드합니다." },
    { title: "AI 자동 싱크 실행", desc: "가사를 입력한 후 LRC 에디터 상단의 'AI 자동 싱크' 버튼을 클릭합니다. 언어를 선택하면 자동으로 타임스탬프가 생성됩니다." },
    { title: "결과 확인 및 보정", desc: "신뢰도 배지가 낮은 줄은 수동으로 타임스탬프를 찍어 보정하세요. Space 키로 재생 중 실시간 스탬핑도 가능합니다." },
  ],
  helpSpotifySteps: [
    { title: "Client ID 준비", desc: "Spotify Developer Dashboard(developer.spotify.com)에서 앱을 만들고 Redirect URI에 http://127.0.0.1:54321/callback 을 추가합니다." },
    { title: "Client ID 입력", desc: "설정(⚙) → Spotify 탭에서 발급받은 Client ID를 입력하고 저장합니다." },
    { title: "연결 및 곡 선택", desc: "상단 Spotify 버튼을 클릭해 로그인합니다. 현재 재생 중인 곡을 불러오거나 검색으로 곡을 선택하면 자동으로 Spotify 모드로 전환됩니다." },
    { title: "제한 사항", desc: "Spotify 모드에서는 파형 시각화, 배속 조절, AI Sync를 사용할 수 없습니다. Spotify Premium 계정이 필요합니다." },
  ],
  helpYoutubeSteps: [
    { title: "yt-dlp 설치", desc: "설정(⚙) → YouTube 탭에서 yt-dlp를 다운로드합니다. Python 없이 독립 실행됩니다." },
    { title: "YouTube 모드 활성화", desc: "설정 → YouTube 탭의 모드 토글을 켜거나, 상단 모드 선택 버튼에서 YouTube를 선택합니다." },
    { title: "URL 입력 및 오디오 로드", desc: "파형 영역 하단의 'YouTube 링크' 버튼을 클릭해 URL을 입력합니다. 다운로드 완료 후 파형이 자동 표시됩니다." },
    { title: "타임스탬프 작업", desc: "파일 모드와 동일하게 파형 시각화, 배속 조절, AI 자동 싱크를 모두 사용할 수 있습니다." },
  ],
  helpViewGuide: "자세한 가이드 보기 →",
  helpTabYouTube: "YouTube",
  settingsViewGuide: "설치 가이드 →",
  openAudio: "오디오 열기",
  zoom: "줌",
  volume: "볼륨",
  noAudio: "오디오 파일을 열어 파형을 표시합니다",
  tooltipSkipBack5: "[1] −5초",
  tooltipSkipBack1: "[2] −1초",
  tooltipPlayPause: "[3] 재생/일시정지",
  tooltipSkipFwd1: "[4] +1초",
  tooltipSkipFwd5: "[5] +5초",
  tooltipStop: "[6] 처음으로",
  tooltipLoop: "반복재생",
  tooltipMarkers: "가사 마커 표시",
  tooltipSetA: "현재 위치를 A(시작)로 설정",
  tooltipSetB: "현재 위치를 B(끝)로 설정",
  tooltipClearAB: "구간 반복 해제",
  abLoopLabel: "구간 반복",
  tooltipSpeedDown: "배속 감소",
  tooltipSpeedUp: "배속 증가",
  tooltipViewWaveform: "파형",
  tooltipViewSeekBar: "재생바",
  lyricsEditor: "가사 편집",
  addLine: "+ 줄 추가",
  findReplace: "찾기/바꾸기",
  findPlaceholder: "찾기...",
  replacePlaceholder: "바꾸기...",
  replaceBtn: "바꾸기",
  replaceAll: "모두 바꾸기",
  caseSensitive: "대소문자 구분",
  noMatches: "결과 없음",
  timeShift: "구간 오프셋",
  timeShiftTooltip: "선택한 줄 범위의 타임스탬프를 일괄로 앞뒤로 이동합니다",
  timeShiftFrom: "시작",
  timeShiftTo: "끝",
  timeShiftDelta: "이동량",
  timeShiftApply: "적용",
  timeShiftSec: "초",
  warnOutOfOrder: "이전 줄보다 타임스탬프가 빠릅니다 (순서 역전)",
  warnDuplicate: "다른 줄과 타임스탬프가 중복됩니다",
  validationSummary: "타임스탬프 문제",
  noLines: "「+ 줄 추가」 버튼으로 가사를 입력하세요",
  stampTooltip: "클릭하여 현재 시간을 타임스탬프로 설정",
  linePlaceholder: "가사를 입력하세요...",
  deleteLine: "줄 삭제",
  currentTimeLabel: "현재: ",
  songInfo: "곡 정보",
  metaTitle: { label: "제목 (ti)", placeholder: "노래 제목" },
  metaArtist: { label: "아티스트 (ar)", placeholder: "아티스트 이름" },
  metaAlbum: { label: "앨범 (al)", placeholder: "앨범 이름" },
  metaBy: { label: "작성자 (by)", placeholder: "LRC 작성자" },
  metaOffset: "오프셋 ms (offset)",
  applyOffset: "입력",
  applyOffsetTooltip: "모든 타임스탬프에 오프셋을 더한 후 오프셋을 0으로 초기화합니다",
  viewAll: "전체보기",
  importSrt: "SRT 가져오기",
  rawEditorTitle: "LRC 전체 편집",
  rawEditorApply: "적용",
  rawEditorCancel: "취소",
  previewBtn: "미리보기",
  previewClose: "닫기",
  previewUntitled: "제목 없음",
  previewNoLyrics: "가사가 없습니다",
  previewNoTimestamps: "타임스탬프가 설정된 줄이 없습니다",
  confirmNewTitle: "새 파일 만들기",
  confirmNewMessage: "저장되지 않은 변경 사항이 있습니다. 계속하면 현재 내용이 삭제됩니다.",
  confirmNewOk: "새로 만들기",
  confirmNewCancel: "취소",
  updateTitle: "업데이트 알림",
  updateNewVersion: "새 버전",
  updatePrompt: "이 출시되었습니다. 릴리즈 페이지로 이동하시겠습니까?",
  updateYes: "이동",
  updateLater: "나중에",
  settingsTitle: "설정",
  settingsTabGeneral: "일반",
  settingsTabModels: "AI 모델",
  settingsAutoUpdate: "자동 업데이트 확인",
  settingsAutoUpdateDesc: "앱 시작 시 최신 버전을 자동으로 확인합니다.",
  settingsAutoSave: "자동 저장",
  settingsAutoSaveDesc: "저장 위치가 지정된 파일은 변경 후 잠시 멈추면 자동으로 저장합니다.",
  settingsCheckNow: "지금 확인",
  settingsChecking: "확인 중...",
  settingsUpToDate: "최신 버전입니다.",
  settingsUiScale: "UI 크기",
  settingsUiScaleReset: "초기화",
  modelCategoryDemucs: "음성 분리",
  modelCategoryCTC: "강제 정렬 (CTC)",
  modelCategoryWav2vec2: "타임스탬프 정렬",
  modelInstall: "설치",
  modelInstalling: "설치 중...",
  modelInstalled: "설치됨",
  modelDelete: "삭제",
  modelCancel: "취소",
  modelStoragePath: "저장 위치",
  modelMb: "MB",
  modelErrorPrefix: "오류",
  modelRequired: "필수",
  modelOptional: "선택",
  modelChangeDir: "위치 변경",
  modelResetDir: "기본으로",
  modelCopyPath: "복사",
  modelInstalledVariants: "설치됨",
  modelNoneInstalled: "없음",
  aiAutoSync: "AI 자동 싱크",
  aiSyncRunning: "분석 중...",
  aiSyncCancel: "취소",
  aiSyncClear: "초안 지우기",
  aiSyncNoModel: "다음 필수 항목이 설치되지 않았습니다:",
  aiSyncNoAudio: "오디오 파일을 먼저 열어주세요",
  aiSyncDone: "AI 싱크 완료",
  aiSyncError: "AI 싱크 오류",
  aiSyncStatusLoadingModel: "모델 로딩 중...",
  aiSyncStatusLoadingAudio: "오디오 로딩 중...",
  aiSyncStatusAnalyzing: "오디오 분석 중...",
  aiSyncStatusAligning: "가사 정렬 중...",
  aiSyncStatusDone: "정렬 완료",
  aiSyncConfidenceHigh: "높음",
  aiSyncConfidenceLow: "낮음",
  aiSyncConfidenceLabel: "신뢰도",
  aiSyncStatusPostprocessing: "결과 처리 중...",
  aiSyncBlankOffset: "빈 줄 오프셋 (초)",
  aiSyncBlankOffsetDesc: "빈 줄의 타임스탬프를 앞 가사 끝 시점에서 얼마나 뒤로 설정할지 지정합니다.",
  settingsVenvTitle: "AI Python 환경",
  settingsVenvReady: "준비됨",
  settingsVenvNoPackages: "패키지 미설치",
  settingsVenvNotCreated: "Python 미설치",
  settingsVenvCreate: "Python 다운로드 (~20 MB)",
  settingsVenvCreating: "다운로드 중...",
  settingsVenvInstallTitle: "패키지 설치 명령 (터미널에서 실행)",
  settingsVenvRefresh: "새로고침",
  settingsVenvChecking: "확인 중...",
  settingsVenvInstallBtn: "패키지 자동 설치",
  settingsVenvInstalling: "설치 중...",
  settingsVenvCmdWarning: "설치에 수 분이 소요될 수 있습니다. 완료될 때까지 창을 닫지 마세요.",
  settingsTabSpotify: "Spotify",
  spotifyClientId: "Client ID",
  spotifyClientIdDesc: "Spotify Developer 대시보드에서 앱을 만들고 Client ID를 입력하세요. Redirect URI에 lyricsync://callback 을 추가해야 합니다.",
  spotifyClientIdPlaceholder: "Spotify Client ID를 입력하세요",
  spotifyClientIdSave: "저장",
  spotifyClientIdSaved: "저장됨",
  spotifyConnect: "Spotify 연결",
  spotifyConnecting: "연결 중...",
  spotifyConnected: "연결됨",
  spotifyLogout: "로그아웃",
  spotifyNoClientId: "Client ID가 입력되지 않았습니다",
  spotifyNoClientIdDesc: "아래에 Spotify Client ID를 입력한 후 연결하세요.",
  spotifyPremiumRequired: "Spotify Premium 계정이 필요합니다",
  spotifyCurrentlyPlaying: "현재 재생 중인 곡",
  spotifyLoadThisTrack: "이 곡으로 작업하시겠습니까?",
  spotifyLoadYes: "불러오기",
  spotifyLoadNo: "다른 곡 선택",
  spotifySearchTitle: "Spotify에서 곡 선택",
  spotifySearchPlaceholder: "곡, 아티스트 검색...",
  spotifyMyPlaylists: "내 플레이리스트",
  spotifyNoResults: "검색 결과가 없습니다",
  spotifyServiceModeInfo: "Spotify 모드에서는 파형 시각화, 배속 조절, AI Sync를 사용할 수 없습니다.",
  spotifyBackToFileMode: "파일 모드로 돌아가기",
  spotifyNoTrackTitle: "재생 중인 곡 없음",
  spotifyNoTrackMessage: "Spotify에서 곡을 검색하거나 파일 모드로 돌아가세요.",
  spotifySearchTrack: "Spotify에서 찾기",
  modeSelect: "모드",
  modeFile: "파일",
  modeYouTube: "YouTube",
  modeComingSoon: "(미설치)",
  spotifyLoadCurrent: "재생 중인 곡",
  spotifyNoTrackAlertTitle: "재생 중인 곡 없음",
  spotifyNoTrackAlertMessage: "현재 Spotify에서 재생 중인 곡이 없습니다.\nSpotify 앱에서 곡을 재생한 후 다시 시도하거나, 직접 검색하세요.",
  spotifyNoTrackAlertOk: "확인",
  settingsTabYouTube: "YouTube",
  ytdlpTitle: "yt-dlp",
  ytdlpInstalled: "설치됨",
  ytdlpNotInstalled: "미설치",
  ytdlpVersion: "버전",
  ytdlpDownload: "yt-dlp 다운로드",
  ytdlpUpdate: "업데이트",
  ytdlpDownloading: "다운로드 중...",
  ytdlpRefresh: "새로고침",
  ytdlpAudioQuality: "오디오 품질",
  ytdlpQualityBest: "최고 품질 (bestaudio)",
  ytdlpQuality192: "192 kbps",
  ytdlpQuality128: "128 kbps",
  ytdlpCookiesFile: "쿠키 파일 (선택)",
  ytdlpCookiesFileDesc: "로그인이 필요한 영상(연령 제한 등)에 사용할 브라우저 쿠키 파일",
  ytdlpCookiesSelect: "파일 선택",
  ytdlpCookiesClear: "지우기",
  ytdlpProxy: "프록시 (선택)",
  ytdlpProxyPlaceholder: "http://host:port",
  ytdlpProxySave: "저장",
  ytdlpInfoText: "YouTube 영상의 오디오를 임시 파일로 불러와 파형 시각화 및 타임스탬프 작업에 사용합니다.",
  youtubeUrlPlaceholder: "YouTube URL 입력...",
  youtubeLoad: "불러오기",
  youtubeLoading: "불러오는 중...",
  youtubeCancel: "취소",
  youtubeNotInstalled: "yt-dlp 설치 필요 (설정 → YouTube)",
  youtubeOpenLink: "YouTube 링크",
  youtubeModalTitle: "YouTube 오디오 불러오기",
  youtubeModeLabel: "YouTube 모드",
  youtubeModeOn: "YouTube 플레이어 사용 중",
  youtubeModeOff: "일반 오디오 파일 모드",
};

const en: Translations = {
  newFileTitle: "New LRC File",
  newFileBtn: "New",
  openLrc: "Open Lyrics",
  save: "Save",
  saveAs: "Save As",
  saveFormatTitle: "Choose Save Format",
  saveFormatLrcDesc: "Synced lyrics file",
  saveFormatSrtDesc: "Video subtitle file",
  undo: "Undo",
  redo: "Redo",
  helpTitle: "Help",
  helpTabShortcuts: "Shortcuts",
  helpTabAi: "AI Guide",
  helpTabSpotify: "Spotify",
  shortcutsTitle: "Keyboard Shortcuts",
  shortcutNote: "* Shortcuts are disabled while an input is focused.",
  shortcutDescs: {
    s1: "Skip back 5s",
    s2: "Skip back 1s",
    s3: "Play / Pause",
    s4: "Skip forward 1s",
    s5: "Skip forward 5s",
    s6: "Stop & reset to start",
    space: "Stamp current line + move to next",
    backspace: "Move to previous line",
    enter: "Insert a new line below while editing lyrics",
    undo: "Undo",
    redo: "Redo",
    find: "Open Find / Replace",
  },
  menu: {
    file: "File", edit: "Edit", playback: "Playback", mode: "Mode", view: "View", help: "Help",
    settings: "Settings…", saveAsLrc: "Save as LRC…", saveAsSrt: "Save as SRT…",
    playPause: "Play / Pause", skipBack5: "Back 5s", skipBack1: "Back 1s",
    skipFwd1: "Forward 1s", skipFwd5: "Forward 5s", stop: "Stop",
  },
  helpAiSteps: [
    { title: "Install Python Environment", desc: "Go to Settings(⚙) → AI Environment tab to download the bundled Python and install packages." },
    { title: "Download Model", desc: "Go to Settings → AI Models tab and download the required model ctc-mms-300m (1.2 GB)." },
    { title: "Run AI Auto Sync", desc: "After entering lyrics, click the 'AI Auto Sync' button at the top of the LRC editor. Select a language and timestamps will be generated automatically." },
    { title: "Review & Correct", desc: "Manually stamp lines with low confidence badges. You can also stamp in real time with the Space key during playback." },
  ],
  helpSpotifySteps: [
    { title: "Get a Client ID", desc: "Create an app on the Spotify Developer Dashboard (developer.spotify.com) and add http://127.0.0.1:54321/callback as a Redirect URI." },
    { title: "Enter Client ID", desc: "Go to Settings(⚙) → Spotify tab, enter your Client ID and save." },
    { title: "Connect & Select a Track", desc: "Click the Spotify button in the header to log in. Load the currently playing track or search for one — the app will switch to Spotify mode automatically." },
    { title: "Limitations", desc: "Waveform, speed control, and AI Sync are unavailable in Spotify mode. Spotify Premium is required." },
  ],
  helpYoutubeSteps: [
    { title: "Install yt-dlp", desc: "Go to Settings(⚙) → YouTube tab and download yt-dlp. No Python required — it runs as a standalone binary." },
    { title: "Enable YouTube Mode", desc: "Turn on the mode toggle in Settings → YouTube tab, or select YouTube from the mode selector button in the header." },
    { title: "Enter URL & Load Audio", desc: "Click the 'YouTube Link' button below the waveform and enter a URL. The waveform will appear automatically after download." },
    { title: "Timestamp Editing", desc: "All features work the same as file mode: waveform, speed control, and AI Auto Sync are all available." },
  ],
  helpViewGuide: "View full guide →",
  helpTabYouTube: "YouTube",
  settingsViewGuide: "Installation Guide →",
  openAudio: "Open Audio",
  zoom: "Zoom",
  volume: "Volume",
  noAudio: "Open an audio file to display the waveform",
  tooltipSkipBack5: "[1] −5s",
  tooltipSkipBack1: "[2] −1s",
  tooltipPlayPause: "[3] Play/Pause",
  tooltipSkipFwd1: "[4] +1s",
  tooltipSkipFwd5: "[5] +5s",
  tooltipStop: "[6] Reset",
  tooltipLoop: "Loop",
  tooltipMarkers: "Show lyric markers",
  tooltipSetA: "Set A (start) to current position",
  tooltipSetB: "Set B (end) to current position",
  tooltipClearAB: "Clear A-B loop",
  abLoopLabel: "A-B Loop",
  tooltipSpeedDown: "Slower",
  tooltipSpeedUp: "Faster",
  tooltipViewWaveform: "Waveform",
  tooltipViewSeekBar: "Seek bar",

  lyricsEditor: "Lyrics Editor",
  addLine: "+ Add Line",
  findReplace: "Find/Replace",
  findPlaceholder: "Find...",
  replacePlaceholder: "Replace...",
  replaceBtn: "Replace",
  replaceAll: "Replace All",
  caseSensitive: "Case Sensitive",
  noMatches: "No matches",
  timeShift: "Range Offset",
  timeShiftTooltip: "Shift timestamps of a selected line range forward or backward",
  timeShiftFrom: "From",
  timeShiftTo: "To",
  timeShiftDelta: "Shift",
  timeShiftApply: "Apply",
  timeShiftSec: "s",
  warnOutOfOrder: "Timestamp is earlier than the previous line (out of order)",
  warnDuplicate: "Timestamp duplicates another line",
  validationSummary: "timestamp issue(s)",
  noLines: "Press \"+ Add Line\" to start entering lyrics",
  stampTooltip: "Click to set current time as timestamp",
  linePlaceholder: "Enter lyrics...",
  deleteLine: "Delete line",
  currentTimeLabel: "Current: ",
  songInfo: "Song Info",
  metaTitle: { label: "Title (ti)", placeholder: "Song title" },
  metaArtist: { label: "Artist (ar)", placeholder: "Artist name" },
  metaAlbum: { label: "Album (al)", placeholder: "Album name" },
  metaBy: { label: "Author (by)", placeholder: "LRC author" },
  metaOffset: "Offset ms (offset)",
  applyOffset: "Apply",
  applyOffsetTooltip: "Add offset to all timestamps, then reset offset to 0",
  viewAll: "View All",
  importSrt: "Import SRT",
  rawEditorTitle: "Edit Full LRC",
  rawEditorApply: "Apply Changes",
  rawEditorCancel: "Discard",
  previewBtn: "Preview",
  previewClose: "Close",
  previewUntitled: "Untitled",
  previewNoLyrics: "No lyrics added",
  previewNoTimestamps: "No timestamps have been set",
  confirmNewTitle: "New File",
  confirmNewMessage: "You have unsaved changes. Continuing will discard the current content.",
  confirmNewOk: "New File",
  confirmNewCancel: "Cancel",
  updateTitle: "Update Available",
  updateNewVersion: "New version",
  updatePrompt: "is available. Go to the release page?",
  updateYes: "Go",
  updateLater: "Later",
  settingsTitle: "Settings",
  settingsTabGeneral: "General",
  settingsTabModels: "AI Models",
  settingsAutoUpdate: "Auto-check for updates",
  settingsAutoUpdateDesc: "Automatically check for new versions on startup.",
  settingsAutoSave: "Auto-save",
  settingsAutoSaveDesc: "Files with a save location are saved automatically a moment after you stop editing.",
  settingsCheckNow: "Check Now",
  settingsChecking: "Checking...",
  settingsUpToDate: "You're up to date.",
  settingsUiScale: "UI Scale",
  settingsUiScaleReset: "Reset",
  modelCategoryDemucs: "Source Separation",
  modelCategoryCTC: "Forced Alignment (CTC)",
  modelCategoryWav2vec2: "Timestamp Alignment",
  modelInstall: "Install",
  modelInstalling: "Installing...",
  modelInstalled: "Installed",
  modelDelete: "Delete",
  modelCancel: "Cancel",
  modelStoragePath: "Storage path",
  modelMb: "MB",
  modelErrorPrefix: "Error",
  modelRequired: "Required",
  modelOptional: "Optional",
  modelChangeDir: "Change location",
  modelResetDir: "Reset to default",
  modelCopyPath: "Copy",
  modelInstalledVariants: "Installed",
  modelNoneInstalled: "None",
  aiAutoSync: "AI Auto Sync",
  aiSyncRunning: "Analyzing...",
  aiSyncCancel: "Cancel",
  aiSyncClear: "Clear Draft",
  aiSyncNoModel: "Required items not installed:",
  aiSyncNoAudio: "Please open an audio file first",
  aiSyncDone: "AI Sync complete",
  aiSyncError: "AI Sync error",
  aiSyncStatusLoadingModel: "Loading model...",
  aiSyncStatusLoadingAudio: "Loading audio...",
  aiSyncStatusAnalyzing: "Analyzing audio...",
  aiSyncStatusAligning: "Aligning lyrics...",
  aiSyncStatusDone: "Alignment complete",
  aiSyncConfidenceHigh: "High",
  aiSyncConfidenceLow: "Low",
  aiSyncConfidenceLabel: "confidence",
  aiSyncStatusPostprocessing: "Processing results...",
  aiSyncBlankOffset: "Blank line offset (s)",
  aiSyncBlankOffsetDesc: "How many seconds after the previous lyric's end to set blank line timestamps.",
  settingsVenvTitle: "AI Python Environment",
  settingsVenvReady: "Ready",
  settingsVenvNoPackages: "Packages missing",
  settingsVenvNotCreated: "Python not downloaded",
  settingsVenvCreate: "Download Python (~20 MB)",
  settingsVenvCreating: "Downloading...",
  settingsVenvInstallTitle: "Install packages (run in terminal)",
  settingsVenvRefresh: "Refresh",
  settingsVenvChecking: "Checking...",
  settingsVenvInstallBtn: "Auto-install packages",
  settingsVenvInstalling: "Installing...",
  settingsVenvCmdWarning: "Installation may take several minutes. Please do not close this window.",
  settingsTabSpotify: "Spotify",
  spotifyClientId: "Client ID",
  spotifyClientIdDesc: "Create an app on the Spotify Developer Dashboard and enter your Client ID. Add lyricsync://callback as a Redirect URI.",
  spotifyClientIdPlaceholder: "Enter your Spotify Client ID",
  spotifyClientIdSave: "Save",
  spotifyClientIdSaved: "Saved",
  spotifyConnect: "Connect Spotify",
  spotifyConnecting: "Connecting...",
  spotifyConnected: "Connected",
  spotifyLogout: "Log out",
  spotifyNoClientId: "No Client ID entered",
  spotifyNoClientIdDesc: "Enter your Spotify Client ID below to connect.",
  spotifyPremiumRequired: "Spotify Premium account required",
  spotifyCurrentlyPlaying: "Currently playing",
  spotifyLoadThisTrack: "Work on this track?",
  spotifyLoadYes: "Load",
  spotifyLoadNo: "Choose another",
  spotifySearchTitle: "Select a track from Spotify",
  spotifySearchPlaceholder: "Search tracks, artists...",
  spotifyMyPlaylists: "My Playlists",
  spotifyNoResults: "No results found",
  spotifyServiceModeInfo: "Waveform, speed control, and AI Sync are not available in Spotify mode.",
  spotifyBackToFileMode: "Back to File Mode",
  spotifyNoTrackTitle: "No track playing",
  spotifyNoTrackMessage: "Search for a track on Spotify or go back to file mode.",
  spotifySearchTrack: "Find on Spotify",
  modeSelect: "Mode",
  modeFile: "File",
  modeYouTube: "YouTube",
  modeComingSoon: "(Not installed)",
  spotifyLoadCurrent: "Current track",
  spotifyNoTrackAlertTitle: "No track playing",
  spotifyNoTrackAlertMessage: "No track is currently playing on Spotify.\nPlay a track in the Spotify app and try again, or search directly.",
  spotifyNoTrackAlertOk: "OK",
  settingsTabYouTube: "YouTube",
  ytdlpTitle: "yt-dlp",
  ytdlpInstalled: "Installed",
  ytdlpNotInstalled: "Not installed",
  ytdlpVersion: "Version",
  ytdlpDownload: "Download yt-dlp",
  ytdlpUpdate: "Update",
  ytdlpDownloading: "Downloading...",
  ytdlpRefresh: "Refresh",
  ytdlpAudioQuality: "Audio quality",
  ytdlpQualityBest: "Best quality (bestaudio)",
  ytdlpQuality192: "192 kbps",
  ytdlpQuality128: "128 kbps",
  ytdlpCookiesFile: "Cookies file (Optional)",
  ytdlpCookiesFileDesc: "Cookies file for age-restricted or login-required content",
  ytdlpCookiesSelect: "Select file",
  ytdlpCookiesClear: "Clear",
  ytdlpProxy: "Proxy (Optional)",
  ytdlpProxyPlaceholder: "http://host:port",
  ytdlpProxySave: "Save",
  ytdlpInfoText: "Downloads audio from YouTube videos to a temporary file for waveform visualization and timestamp editing.",
  youtubeUrlPlaceholder: "Enter YouTube URL...",
  youtubeLoad: "Load",
  youtubeLoading: "Loading...",
  youtubeCancel: "Cancel",
  youtubeNotInstalled: "yt-dlp required (Settings → YouTube)",
  youtubeOpenLink: "YouTube Link",
  youtubeModalTitle: "Load YouTube Audio",
  youtubeModeLabel: "YouTube Mode",
  youtubeModeOn: "YouTube player active",
  youtubeModeOff: "Normal audio file mode",
};

const ja: Translations = {
  newFileTitle: "新規LRCファイル",
  newFileBtn: "新規作成",
  openLrc: "歌詞を開く",
  save: "保存",
  saveAs: "名前を付けて保存",
  saveFormatTitle: "保存形式を選択",
  saveFormatLrcDesc: "歌詞同期ファイル",
  saveFormatSrtDesc: "動画字幕ファイル",
  undo: "元に戻す",
  redo: "やり直す",
  helpTitle: "ヘルプ",
  helpTabShortcuts: "ショートカット",
  helpTabAi: "AI使い方",
  helpTabSpotify: "Spotify",
  shortcutsTitle: "キーボードショートカット",
  shortcutNote: "* 入力欄にフォーカス中はショートカットが無効になります。",
  shortcutDescs: {
    s1: "5秒戻る",
    s2: "1秒戻る",
    s3: "再生 / 一時停止",
    s4: "1秒進む",
    s5: "5秒進む",
    s6: "停止して最初へ",
    space: "現在行にタイムスタンプ + 次の行へ移動",
    backspace: "前の行へ移動",
    enter: "歌詞編集中に現在行の下へ新しい行を挿入",
    undo: "元に戻す",
    redo: "やり直し",
    find: "検索 / 置換を開く",
  },
  menu: {
    file: "ファイル", edit: "編集", playback: "再生", mode: "モード", view: "表示", help: "ヘルプ",
    settings: "設定…", saveAsLrc: "LRCで保存…", saveAsSrt: "SRTで保存…",
    playPause: "再生 / 一時停止", skipBack5: "5秒戻る", skipBack1: "1秒戻る",
    skipFwd1: "1秒進む", skipFwd5: "5秒進む", stop: "停止",
  },
  helpAiSteps: [
    { title: "Python環境のインストール", desc: "設定(⚙) → AI環境タブで内蔵Pythonをダウンロードし、パッケージをインストールします。" },
    { title: "モデルのダウンロード", desc: "設定 → AIモデルタブで必須モデル ctc-mms-300m（1.2 GB）をダウンロードします。" },
    { title: "AI自動シンク実行", desc: "歌詞を入力後、LRCエディタ上部の「AI自動シンク」ボタンをクリックします。言語を選択するとタイムスタンプが自動生成されます。" },
    { title: "結果の確認と修正", desc: "信頼度バッジが低い行は手動でスタンプして修正してください。再生中にSpaceキーでリアルタイムスタンプも可能です。" },
  ],
  helpSpotifySteps: [
    { title: "Client IDの準備", desc: "Spotify Developer Dashboard（developer.spotify.com）でアプリを作成し、Redirect URIに http://127.0.0.1:54321/callback を追加します。" },
    { title: "Client IDの入力", desc: "設定(⚙) → SpotifyタブでClient IDを入力して保存します。" },
    { title: "接続と曲の選択", desc: "ヘッダーのSpotifyボタンをクリックしてログインします。再生中の曲を読み込むか検索で選択すると、自動的にSpotifyモードに切り替わります。" },
    { title: "制限事項", desc: "Spotifyモードでは波形表示・速度調整・AI Syncは利用できません。Spotify Premiumが必要です。" },
  ],
  helpYoutubeSteps: [
    { title: "yt-dlp のインストール", desc: "設定(⚙) → YouTubeタブで yt-dlp をダウンロードします。Python 不要のスタンドアロンバイナリです。" },
    { title: "YouTubeモードの有効化", desc: "設定 → YouTubeタブのモードトグルをオンにするか、ヘッダーのモード選択ボタンから YouTube を選択します。" },
    { title: "URLの入力と読み込み", desc: "波形エリア下部の「YouTubeリンク」ボタンをクリックしてURLを入力します。ダウンロード完了後、波形が自動表示されます。" },
    { title: "タイムスタンプ編集", desc: "ファイルモードと同様に、波形表示・速度調整・AI自動シンクがすべて利用できます。" },
  ],
  helpViewGuide: "詳細ガイドを見る →",
  helpTabYouTube: "YouTube",
  settingsViewGuide: "インストールガイド →",
  openAudio: "音声を開く",
  zoom: "ズーム",
  volume: "音量",
  noAudio: "音声ファイルを開いて波形を表示します",
  tooltipSkipBack5: "[1] −5秒",
  tooltipSkipBack1: "[2] −1秒",
  tooltipPlayPause: "[3] 再生/一時停止",
  tooltipSkipFwd1: "[4] +1秒",
  tooltipSkipFwd5: "[5] +5秒",
  tooltipStop: "[6] 最初へ",
  tooltipLoop: "リピート",
  tooltipMarkers: "歌詞マーカー表示",
  tooltipSetA: "現在位置をA（開始）に設定",
  tooltipSetB: "現在位置をB（終了）に設定",
  tooltipClearAB: "区間リピート解除",
  abLoopLabel: "区間リピート",
  tooltipSpeedDown: "遅くする",
  tooltipSpeedUp: "速くする",
  tooltipViewWaveform: "波形",
  tooltipViewSeekBar: "シーク",
  lyricsEditor: "歌詞編集",
  addLine: "+ 行を追加",
  findReplace: "検索/置換",
  findPlaceholder: "検索...",
  replacePlaceholder: "置換...",
  replaceBtn: "置換",
  replaceAll: "すべて置換",
  caseSensitive: "大文字・小文字を区別",
  noMatches: "一致なし",
  timeShift: "区間オフセット",
  timeShiftTooltip: "選択した行範囲のタイムスタンプを前後に一括移動します",
  timeShiftFrom: "開始",
  timeShiftTo: "終了",
  timeShiftDelta: "移動量",
  timeShiftApply: "適用",
  timeShiftSec: "秒",
  warnOutOfOrder: "前の行よりタイムスタンプが早いです（順序逆転）",
  warnDuplicate: "他の行とタイムスタンプが重複しています",
  validationSummary: "タイムスタンプの問題",
  noLines: "「+ 行を追加」ボタンで歌詞を入力してください",
  stampTooltip: "クリックして現在時刻をタイムスタンプに設定",
  linePlaceholder: "歌詞を入力してください...",
  deleteLine: "行を削除",
  currentTimeLabel: "現在: ",
  songInfo: "曲情報",
  metaTitle: { label: "タイトル (ti)", placeholder: "曲のタイトル" },
  metaArtist: { label: "アーティスト (ar)", placeholder: "アーティスト名" },
  metaAlbum: { label: "アルバム (al)", placeholder: "アルバム名" },
  metaBy: { label: "作成者 (by)", placeholder: "LRC作成者" },
  metaOffset: "オフセット ms (offset)",
  applyOffset: "入力",
  applyOffsetTooltip: "全タイムスタンプにオフセットを加算し、オフセットを0にリセットします",
  viewAll: "全体表示",
  importSrt: "SRT読み込み",
  rawEditorTitle: "LRC全体を編集",
  rawEditorApply: "適用",
  rawEditorCancel: "キャンセル",
  previewBtn: "プレビュー",
  previewClose: "閉じる",
  previewUntitled: "タイトルなし",
  previewNoLyrics: "歌詞がありません",
  previewNoTimestamps: "タイムスタンプが設定されていません",
  confirmNewTitle: "新規ファイル",
  confirmNewMessage: "保存されていない変更があります。続行すると現在の内容が削除されます。",
  confirmNewOk: "新規作成",
  confirmNewCancel: "キャンセル",
  updateTitle: "アップデート通知",
  updateNewVersion: "新バージョン",
  updatePrompt: "がリリースされました。リリースページに移動しますか？",
  updateYes: "移動",
  updateLater: "あとで",
  settingsTitle: "設定",
  settingsTabGeneral: "一般",
  settingsTabModels: "AIモデル",
  settingsAutoUpdate: "自動更新確認",
  settingsAutoUpdateDesc: "アプリ起動時に最新バージョンを自動で確認します。",
  settingsAutoSave: "自動保存",
  settingsAutoSaveDesc: "保存先が指定されたファイルは、編集を止めると少し後に自動保存されます。",
  settingsCheckNow: "今すぐ確認",
  settingsChecking: "確認中...",
  settingsUpToDate: "最新バージョンです。",
  settingsUiScale: "UIサイズ",
  settingsUiScaleReset: "リセット",
  modelCategoryDemucs: "音源分離",
  modelCategoryCTC: "強制アライメント (CTC)",
  modelCategoryWav2vec2: "タイムスタンプ整列",
  modelInstall: "インストール",
  modelInstalling: "インストール中...",
  modelInstalled: "インストール済み",
  modelDelete: "削除",
  modelCancel: "キャンセル",
  modelStoragePath: "保存場所",
  modelMb: "MB",
  modelErrorPrefix: "エラー",
  modelRequired: "必須",
  modelOptional: "任意",
  modelChangeDir: "場所を変更",
  modelResetDir: "デフォルトに戻す",
  modelCopyPath: "コピー",
  modelInstalledVariants: "インストール済み",
  modelNoneInstalled: "なし",
  aiAutoSync: "AI自動シンク",
  aiSyncRunning: "解析中...",
  aiSyncCancel: "キャンセル",
  aiSyncClear: "下書きを消去",
  aiSyncNoModel: "以下の必須項目がインストールされていません:",
  aiSyncNoAudio: "先に音声ファイルを開いてください",
  aiSyncDone: "AI同期完了",
  aiSyncError: "AI同期エラー",
  aiSyncStatusLoadingModel: "モデル読み込み中...",
  aiSyncStatusLoadingAudio: "音声読み込み中...",
  aiSyncStatusAnalyzing: "音声解析中...",
  aiSyncStatusAligning: "歌詞アライメント中...",
  aiSyncStatusDone: "アライメント完了",
  aiSyncConfidenceHigh: "高",
  aiSyncConfidenceLow: "低",
  aiSyncConfidenceLabel: "信頼度",
  aiSyncStatusPostprocessing: "結果処理中...",
  aiSyncBlankOffset: "空白行オフセット（秒）",
  aiSyncBlankOffsetDesc: "空白行のタイムスタンプを前の歌詞の終了時点から何秒後に設定するかを指定します。",
  settingsVenvTitle: "AI Python環境",
  settingsVenvReady: "準備完了",
  settingsVenvNoPackages: "パッケージ未インストール",
  settingsVenvNotCreated: "Python未ダウンロード",
  settingsVenvCreate: "Pythonをダウンロード (約20MB)",
  settingsVenvCreating: "ダウンロード中...",
  settingsVenvInstallTitle: "パッケージインストールコマンド（ターミナルで実行）",
  settingsVenvRefresh: "更新",
  settingsVenvChecking: "確認中...",
  settingsVenvInstallBtn: "パッケージ自動インストール",
  settingsVenvInstalling: "インストール中...",
  settingsVenvCmdWarning: "インストールには数分かかる場合があります。完了するまでウィンドウを閉じないでください。",
  settingsTabSpotify: "Spotify",
  spotifyClientId: "クライアントID",
  spotifyClientIdDesc: "Spotify Developerダッシュボードでアプリを作成し、クライアントIDを入力してください。リダイレクトURIにlyricsync://callbackを追加する必要があります。",
  spotifyClientIdPlaceholder: "Spotify クライアントIDを入力",
  spotifyClientIdSave: "保存",
  spotifyClientIdSaved: "保存済み",
  spotifyConnect: "Spotify に接続",
  spotifyConnecting: "接続中...",
  spotifyConnected: "接続済み",
  spotifyLogout: "ログアウト",
  spotifyNoClientId: "クライアントIDが未入力です",
  spotifyNoClientIdDesc: "下のフィールドにSpotifyクライアントIDを入力して接続してください。",
  spotifyPremiumRequired: "Spotify Premiumアカウントが必要です",
  spotifyCurrentlyPlaying: "再生中の曲",
  spotifyLoadThisTrack: "この曲で作業しますか？",
  spotifyLoadYes: "読み込む",
  spotifyLoadNo: "別の曲を選択",
  spotifySearchTitle: "Spotifyから曲を選択",
  spotifySearchPlaceholder: "曲名、アーティストを検索...",
  spotifyMyPlaylists: "マイプレイリスト",
  spotifyNoResults: "検索結果がありません",
  spotifyServiceModeInfo: "Spotifyモードでは波形表示・速度調整・AI Syncは利用できません。",
  spotifyBackToFileMode: "ファイルモードに戻る",
  spotifyNoTrackTitle: "再生中の曲なし",
  spotifyNoTrackMessage: "Spotifyで曲を検索するか、ファイルモードに戻ってください。",
  spotifySearchTrack: "Spotifyで探す",
  modeSelect: "モード",
  modeFile: "ファイル",
  modeYouTube: "YouTube",
  modeComingSoon: "(未インストール)",
  spotifyLoadCurrent: "再生中の曲",
  spotifyNoTrackAlertTitle: "再生中の曲なし",
  spotifyNoTrackAlertMessage: "現在Spotifyで再生中の曲がありません。\nSpotifyアプリで曲を再生してから再試行するか、直接検索してください。",
  spotifyNoTrackAlertOk: "OK",
  settingsTabYouTube: "YouTube",
  ytdlpTitle: "yt-dlp",
  ytdlpInstalled: "インストール済み",
  ytdlpNotInstalled: "未インストール",
  ytdlpVersion: "バージョン",
  ytdlpDownload: "yt-dlpをダウンロード",
  ytdlpUpdate: "アップデート",
  ytdlpDownloading: "ダウンロード中...",
  ytdlpRefresh: "更新",
  ytdlpAudioQuality: "音声品質",
  ytdlpQualityBest: "最高品質 (bestaudio)",
  ytdlpQuality192: "192 kbps",
  ytdlpQuality128: "128 kbps",
  ytdlpCookiesFile: "クッキーファイル (オプション)",
  ytdlpCookiesFileDesc: "年齢制限やログインが必要な動画に使用するブラウザのクッキーファイル",
  ytdlpCookiesSelect: "ファイルを選択",
  ytdlpCookiesClear: "クリア",
  ytdlpProxy: "プロキシ (オプション)",
  ytdlpProxyPlaceholder: "http://host:port",
  ytdlpProxySave: "保存",
  ytdlpInfoText: "YouTube動画の音声を一時ファイルとして読み込み、波形表示とタイムスタンプ編集に使用します。",
  youtubeUrlPlaceholder: "YouTube URLを入力...",
  youtubeLoad: "読み込む",
  youtubeLoading: "読み込み中...",
  youtubeCancel: "キャンセル",
  youtubeNotInstalled: "yt-dlpが必要です（設定 → YouTube）",
  youtubeOpenLink: "YouTubeリンク",
  youtubeModalTitle: "YouTubeオーディオを読み込む",
  youtubeModeLabel: "YouTubeモード",
  youtubeModeOn: "YouTubeプレイヤー使用中",
  youtubeModeOff: "通常のオーディオファイルモード",
};

export const translations: Record<Lang, Translations> = { ko, en, ja };
