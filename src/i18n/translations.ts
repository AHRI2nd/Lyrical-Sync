export type Lang = "ko" | "en" | "ja";

export interface Translations {
  // Common
  close: string;
  // Header
  newFileTitle: string;
  newFileBtn: string;
  openLrc: string;
  recentFiles: string;
  clearRecentFiles: string;
  save: string;
  saveAs: string;
  saveFormatTitle: string;
  saveFormatLrcDesc: string;
  saveFormatSrtDesc: string;
  saveFormatVttDesc: string;
  saveFormatAssDesc: string;
  undo: string;
  redo: string;
  historyPanelTitle: string;
  historyCurrent: string;
  historyLabels: Record<
    | "commitSyllables" | "clearSyllables" | "stampLine" | "setLines" | "addLine"
    | "insertLines" | "addLinesFromSpeech" | "deleteLine" | "duplicateLine" | "mergeLine"
    | "splitLine" | "moveLine" | "scaleTimestamps" | "deleteLines" | "shiftLines"
    | "clearTimestamps" | "loadDoc" | "applyOffset" | "shiftTimeRange" | "replaceAll" | "aiSync",
    string
  >;
  // Help modal
  helpTitle: string;
  helpTabShortcuts: string;
  helpTabAi: string;
  helpTabSpotify: string;
  shortcutsTitle: string;
  shortcutNote: string;
  helpGroupPlayback: string;
  helpGroupEdit: string;
  helpGroupMouse: string;
  helpGroupCharSync: string;
  shortcutDescs: {
    s1: string; s2: string; s3: string; s4: string; s5: string; s6: string;
    space: string; backspace: string;
    enter: string; splitLine: string; undo: string; redo: string; find: string;
    tsEditKey: string; tsEditDesc: string; tsStampKey: string; tsStampDesc: string;
    lineClickKey: string; lineClickDesc: string; markerClickKey: string; markerClickDesc: string;
    csStamp: string; csMove: string;
    csDragKey: string; csDragDesc: string; csClickKey: string; csClickDesc: string;
    csClearKey: string; csClearDesc: string; csNudgeKey: string; csNudgeDesc: string;
  };
  menu: {
    file: string; edit: string; playback: string; mode: string; view: string; help: string;
    settings: string; saveAsLrc: string; saveAsSrt: string;
    playPause: string; skipBack5: string; skipBack1: string;
    skipFwd1: string; skipFwd5: string; stop: string;
  };
  drop: {
    overlayHint: string;
    replaceTitle: string;
    replaceAudio: string;
    replaceLyrics: string;
    replaceBoth: string;
    replaceOk: string;
    replaceCancel: string;
  };
  charSync: {
    modeLine: string;
    modeChar: string;
    unitLabel: string;
    unitChar: string;
    unitWord: string;
    hint: string;
    stampHint: string;
    replayLine: string;
    clearLine: string;
    current: string;
    empty: string;
    retokenizeTitle: string;
    retokenizeMsg: string;
    retokenizeOk: string;
    retokenizeCancel: string;
    unitChangeMsg: string;
    badge: string;
    endCell: string;
    glyphProgress: string;
    prevLine: string;
    nextLine: string;
  };
  devicePicker: {
    button: string;
    title: string;
    refresh: string;
    loading: string;
    empty: string;
    active: string;
    close: string;
    hint: string;
  };
  lrclib: {
    button: string; title: string;
    fieldTitle: string; fieldArtist: string; fieldAlbum: string;
    search: string; searching: string; noResults: string; error: string; hint: string;
    syncedOnly: string; plainOnly: string;
    preview: string; confirm: string;
    instrumental: string; noLyrics: string; synced: string; plain: string;
    previewTitle: string; close: string;
  };
  lrclibPublish: {
    button: string;
    title: string;
    duration: string;
    syncedLines: string;
    missing: string;
    needTitle: string;
    needArtist: string;
    needDuration: string;
    needSync: string;
    hint: string;
    warning: string;
    confirm: string;
    publish: string;
    publishing: string;
    success: string;
    failed: string;
    close: string;
    cancel: string;
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
  zoomIn: string;
  zoomOut: string;
  volume: string;
  noAudio: string;
  noAudioShort: string;
  tooltipSkipBack5: string;
  tooltipSkipBack1: string;
  tooltipPlayPause: string;
  tooltipSkipFwd1: string;
  tooltipSkipFwd5: string;
  tooltipStop: string;
  tooltipLoop: string;
  tooltipMarkers: string;
  tooltipSpectrogram: string;
  playerMore: string;
  playerSpeed: string;
  tooltipSpeedDown: string;
  tooltipSpeedUp: string;
  tooltipViewWaveform: string;
  tooltipViewSeekBar: string;
  // LrcEditor
  lyricsEditor: string;
  addLine: string;
  findReplace: string;
  editorTools: string;
  findPlaceholder: string;
  replacePlaceholder: string;
  replaceBtn: string;
  replaceAll: string;
  caseSensitive: string;
  noMatches: string;
  timeShift: string;
  tsScale: string;
  tsScaleFactor: string;
  tsScaleHint: string;
  autoSpot: string;
  translationToggle: string;
  translationPlaceholder: string;
  autoSpotTitle: string;
  autoSpotHint: string;
  autoSpotNeedsAudio: string;
  autoSpotDecoding: string;
  autoSpotDecodeError: string;
  autoSpotThreshold: string;
  autoSpotMinSilence: string;
  autoSpotMinSpeech: string;
  autoSpotPadding: string;
  autoSpotSegmentsFound: string;
  autoSpotAddedLabel: string;
  autoSpotApply: string;
  autoSpotCancel: string;
  timeShiftTooltip: string;
  timeShiftFrom: string;
  timeShiftTo: string;
  timeShiftDelta: string;
  timeShiftApply: string;
  timeShiftSec: string;
  warnOutOfOrder: string;
  warnDuplicate: string;
  validationSummary: string;
  validationTitle: string;
  validationStatComplete: string;
  validationStatStamped: string;
  validationStatLines: string;
  validationUnstamped: string;
  validationNoIssues: string;
  noLines: string;
  stampTooltip: string;
  linePlaceholder: string;
  deleteLine: string;
  duplicateLine: string;
  mergeLineUp: string;
  loopLine: string;
  reorderLine: string;
  bulkSelected: string;
  bulkShift: string;
  bulkClearTs: string;
  bulkDelete: string;
  bulkDeselect: string;
  currentTimeLabel: string;
  // MetaEditor
  songInfo: string;
  metaTitle: { label: string; placeholder: string };
  metaArtist: { label: string; placeholder: string };
  metaAlbum: { label: string; placeholder: string };
  metaBy: { label: string; placeholder: string };
  metaOffset: string;
  metaOffsetShort: string;
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
  // In-app updater
  updater: {
    title: string;
    readyTitle: string;
    errorTitle: string;
    newVersion: string;
    downloading: string;
    readyMessage: string;
    later: string;
    update: string;
    restart: string;
    close: string;
    busyHint: string;
  };
  // Settings modal
  settingsTitle: string;
  settingsTabGeneral: string;
  settingsTabShortcuts: string;
  settingsTabModels: string;
  settingsAutoUpdate: string;
  settingsAutoUpdateDesc: string;
  settingsAutoSave: string;
  settingsAutoSaveDesc: string;
  settingsElrcNotice: string;
  settingsElrcNoticeDesc: string;
  settingsLyricsFontSize: string;
  settingsGlyphMarkers: string;
  settingsGlyphMarkersDesc: string;
  settingsSpellCheck: string;
  settingsSpellCheckDesc: string;
  elrcNotice: {
    title: string;
    message: string;
    confirm: string;
    dontShowAgain: string;
  };
  recovery: {
    title: string;
    message: string;
    restore: string;
    discard: string;
    lines: string;
  };
  toast: {
    saved: string;
    saveFailed: string;
    openFailed: string;
    audioLoadFailed: string;
    aiSyncDone: string;
    aiSyncFailed: string;
    modelDownloaded: string;
    modelDownloadFailed: string;
    deviceUnavailable: string;
  };
  keys: {
    title: string;
    capturing: string;
    reset: string;
    conflict: string;
    reserved: string;
    hint: string;
    skipBack5: string;
    skipBack1: string;
    playPause: string;
    skipFwd1: string;
    skipFwd5: string;
    stop: string;
    stamp: string;
    prevLine: string;
  };
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
  aiUsageTitle: string;
  aiUsageSeparation: string;
  aiUsageSeparationDesc: string;
  aiUsageVad: string;
  aiUsageVadDesc: string;
  aiUsageNeedModel: string;
  aiUsageNeedSeparation: string;
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
  aiSyncGlyphWarnTitle: string;
  aiSyncGlyphWarnMsg: string;
  aiSyncGlyphWarnOk: string;
  aiSyncNoAudio: string;
  aiSyncModeUnsupported: string;
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
  spotifyOpenInSpotify: string;
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
  modeDevice: string;
  deviceSourceApp: string;
  deviceWaiting: string;
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
  youtubeDisclaimer: string;
  youtubeLoad: string;
  youtubeAgree: string;
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
  close: "닫기",
  newFileTitle: "새 LRC 파일",
  newFileBtn: "새로 만들기",
  openLrc: "가사 열기",
  recentFiles: "최근 파일",
  clearRecentFiles: "최근 파일 목록 지우기",
  save: "저장",
  saveAs: "다른 이름으로 저장",
  saveFormatTitle: "저장 형식 선택",
  saveFormatLrcDesc: "가사 동기화 파일",
  saveFormatSrtDesc: "영상 자막 파일",
  saveFormatVttDesc: "웹 영상 자막 (HTML5)",
  saveFormatAssDesc: "노래방 영상 자막 (글자 동기화 \\k)",
  undo: "실행 취소",
  redo: "다시 실행",
  historyPanelTitle: "편집 히스토리",
  historyCurrent: "현재",
  historyLabels: {
      commitSyllables: "글자 동기화 입력",
      clearSyllables: "글자 동기화 해제",
      stampLine: "타임스탬프 찍기",
      setLines: "가사 줄 일괄 변경",
      addLine: "줄 추가",
      insertLines: "줄 삽입",
      addLinesFromSpeech: "자동 스팟팅 줄 삽입",
      deleteLine: "줄 삭제",
      duplicateLine: "줄 복제",
      mergeLine: "줄 병합",
      splitLine: "줄 분할",
      moveLine: "줄 순서 이동",
      scaleTimestamps: "타임스탬프 스케일",
      deleteLines: "줄 일괄 삭제",
      shiftLines: "타임스탬프 이동",
      clearTimestamps: "타임스탬프 지우기",
      loadDoc: "가사 불러오기",
      applyOffset: "오프셋 적용",
      shiftTimeRange: "구간 시간 이동",
      replaceAll: "찾아바꾸기 ({count}곳)",
      aiSync: "AI 자동 동기화",
  },
  helpTitle: "도움말",
  helpTabShortcuts: "단축키",
  helpTabAi: "AI 사용법",
  helpTabSpotify: "Spotify",
  shortcutsTitle: "단축키 안내",
  shortcutNote: "* 인풋 포커스 중일 때는 단축키가 동작하지 않습니다.",
  helpGroupPlayback: "재생 · 탐색",
  helpGroupEdit: "편집",
  helpGroupMouse: "마우스",
  helpGroupCharSync: "글자 동기화 모드",
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
    splitLine: "커서 위치에서 줄을 둘로 분할",
    undo: "실행 취소",
    redo: "다시 실행",
    find: "찾기 / 바꾸기 열기",
    tsEditKey: "좌클릭",
    tsEditDesc: "타임스탬프 직접 편집 (숫자키로 MM:SS.xx 입력, Enter 확정 · Esc 취소)",
    tsStampKey: "우클릭",
    tsStampDesc: "타임스탬프를 현재 재생 시간으로 설정",
    lineClickKey: "줄 클릭",
    lineClickDesc: "해당 타임스탬프로 재생 위치 이동",
    markerClickKey: "마커 클릭",
    markerClickDesc: "파형 마커 → 해당 가사 줄 선택",
    csStamp: "현재 글자에 타임스탬프 찍기 + 다음 글자로",
    csMove: "이전 / 다음 글자로 이동",
    csDragKey: "글자 드래그(칠하기)",
    csDragDesc: "재생 중 글자 위를 끌면 지나는 글자가 현재 재생 시간으로 찍히고 다음 글자가 준비됨(재생헤드 이동 없음)",
    csClickKey: "글자 클릭",
    csClickDesc: "글자를 활성(준비) 상태로 선택",
    csClearKey: "글자 우클릭",
    csClearDesc: "그 글자의 시각만 제거",
    csNudgeKey: "Shift + ← / →",
    csNudgeDesc: "현재 글자 시각을 ±0.05초 미세조정",
  },
  menu: {
    file: "파일", edit: "편집", playback: "재생", mode: "모드", view: "보기", help: "도움말",
    settings: "설정…", saveAsLrc: "LRC로 저장…", saveAsSrt: "SRT로 저장…",
    playPause: "재생 / 일시정지", skipBack5: "5초 뒤로", skipBack1: "1초 뒤로",
    skipFwd1: "1초 앞으로", skipFwd5: "5초 앞으로", stop: "정지",
  },
  drop: {
    overlayHint: "여기에 파일을 놓아 열기",
    replaceTitle: "파일 열기",
    replaceAudio: "작업 중인 오디오가 있습니다. 새 오디오로 교체하시겠습니까?",
    replaceLyrics: "작업 중인 가사가 있습니다. 저장하지 않은 변경 사항은 사라집니다. 교체하시겠습니까?",
    replaceBoth: "작업 중인 오디오·가사가 있습니다. 저장하지 않은 변경 사항은 사라집니다. 교체하시겠습니까?",
    replaceOk: "교체",
    replaceCancel: "취소",
  },
  charSync: {
    modeLine: "줄 동기화",
    modeChar: "글자 동기화",
    unitLabel: "단위",
    unitChar: "글자",
    unitWord: "단어",
    hint: "글자 드래그=재생 시간으로 칠하기 · Space=찍기 · 우클릭=지우기 · Shift+←/→=미세조정 · 파형=탐색",
    stampHint: "현재 글자 찍고 다음으로",
    replayLine: "이 줄 재생",
    clearLine: "이 줄 초기화",
    current: "현재",
    empty: "가사 줄이 없습니다. 먼저 줄 동기화 모드에서 가사를 입력하세요.",
    retokenizeTitle: "글자 동기화 재설정",
    retokenizeMsg: "이 줄은 글자 단위로 동기화되어 있습니다. 텍스트를 수정하면 글자 타이밍이 모두 사라집니다. 계속하시겠습니까?",
    retokenizeOk: "수정하고 재설정",
    retokenizeCancel: "취소",
    unitChangeMsg: "이 줄은 이미 글자 타이밍이 있습니다. 단위를 바꾸면 타이밍이 모두 사라집니다. 계속하시겠습니까?",
    badge: "글자 동기화됨",
    endCell: "다음 줄로 (여기까지 칠하거나 클릭)",
    glyphProgress: "현재 줄의 글자 동기화 진행도",
    prevLine: "이전 줄",
    nextLine: "다음 줄",
  },
  devicePicker: {
    button: "재생 기기",
    title: "재생 기기 선택",
    refresh: "새로고침",
    loading: "기기 목록 불러오는 중…",
    empty: "사용 가능한 기기가 없습니다. Spotify 앱이 실행 중인지 확인하세요.",
    active: "재생 중",
    close: "닫기",
    hint: "기기를 선택하면 해당 기기에서 재생됩니다.",
  },
  lrclib: {
    button: "LRCLIB 불러오기",
    title: "LRCLIB 가사 검색",
    fieldTitle: "제목",
    fieldArtist: "아티스트",
    fieldAlbum: "앨범",
    search: "검색",
    searching: "검색 중…",
    noResults: "검색 결과가 없습니다.",
    error: "검색에 실패했습니다.",
    hint: "제목·아티스트·앨범으로 검색하세요. (제목 우선순위 높음)",
    syncedOnly: "동기화 가사만",
    plainOnly: "일반 가사만",
    preview: "미리보기",
    confirm: "확인",
    instrumental: "연주곡",
    noLyrics: "가사 없음",
    synced: "동기화",
    plain: "가사",
    previewTitle: "가사 미리보기",
    close: "닫기",
  },
  lrclibPublish: {
    button: "LRCLIB에 업로드",
    title: "LRCLIB에 가사 기여",
    duration: "길이",
    syncedLines: "동기화 줄",
    missing: "업로드하려면 다음이 필요합니다:",
    needTitle: "제목",
    needArtist: "아티스트",
    needDuration: "오디오 길이(오디오를 열어주세요)",
    needSync: "타임스탬프가 있는 동기화 가사",
    hint: "현재 곡 정보·동기화 가사를 LRCLIB에 공개 기여합니다. 정확한 제목·아티스트·길이를 확인하세요.",
    warning: "LRCLIB는 누구나 볼 수 있는 공개 데이터베이스입니다. 부정확하거나 테스트용 가사를 올리면 다른 사용자에게 영향을 주며 되돌리기 어렵습니다. 또한 가사는 저작권의 대상일 수 있으니 본인이 권리를 갖거나 허용된 경우에만 기여하세요. 제목·아티스트·가사가 정확한지 다시 확인하셨나요?",
    confirm: "확인했으며 업로드",
    publish: "업로드",
    publishing: "업로드 중… (작업 증명 계산, 수 초 소요)",
    success: "업로드 완료! 기여해 주셔서 감사합니다.",
    failed: "업로드 실패",
    close: "닫기",
    cancel: "취소",
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
  zoomIn: "확대",
  zoomOut: "축소",
  volume: "볼륨",
  noAudio: "오디오 파일을 열어 파형을 표시합니다",
  noAudioShort: "열린 오디오 파일 없음",
  tooltipSkipBack5: "[1] −5초",
  tooltipSkipBack1: "[2] −1초",
  tooltipPlayPause: "[3] 재생/일시정지",
  tooltipSkipFwd1: "[4] +1초",
  tooltipSkipFwd5: "[5] +5초",
  tooltipStop: "[6] 처음으로",
  tooltipLoop: "반복재생",
  tooltipMarkers: "가사 마커 표시",
  tooltipSpectrogram: "스펙트로그램 표시",
  playerMore: "더보기 (반복·마커·배속)",
  playerSpeed: "배속",
  tooltipSpeedDown: "배속 감소",
  tooltipSpeedUp: "배속 증가",
  tooltipViewWaveform: "파형",
  tooltipViewSeekBar: "재생바",
  lyricsEditor: "가사 편집",
  addLine: "+ 줄 추가",
  findReplace: "찾기/바꾸기",
  editorTools: "도구",
  findPlaceholder: "찾기...",
  replacePlaceholder: "바꾸기...",
  replaceBtn: "바꾸기",
  replaceAll: "모두 바꾸기",
  caseSensitive: "대소문자 구분",
  noMatches: "결과 없음",
  timeShift: "구간 오프셋",
  tsScale: "타임스탬프 스케일",
  tsScaleFactor: "배율",
  tsScaleHint: "전체 타임스탬프 ×배율 (예: 1.05 = 5% 느리게)",
  autoSpot: "자동 스팟팅",
  translationToggle: "번역 줄 표시",
  translationPlaceholder: "번역 (선택)",
  autoSpotTitle: "무음 기반 자동 스팟팅",
  autoSpotHint: "오디오에서 발화로 보이는 구간을 찾아 빈 텍스트 줄로 배치합니다. 정밀한 음성 인식이 아니라 음량 임계값 기반이므로, 배치 후 직접 검토하며 텍스트를 채워주세요.",
  autoSpotNeedsAudio: "오디오 파일을 먼저 열어주세요",
  autoSpotDecoding: "오디오 분석 중…",
  autoSpotDecodeError: "오디오를 분석하지 못했습니다",
  autoSpotThreshold: "임계값",
  autoSpotMinSilence: "최소 무음 길이",
  autoSpotMinSpeech: "최소 발화 길이",
  autoSpotPadding: "여유(패딩)",
  autoSpotSegmentsFound: "개 구간 감지됨",
  autoSpotAddedLabel: "개 줄 추가됨",
  autoSpotApply: "적용",
  autoSpotCancel: "취소",
  timeShiftTooltip: "선택한 줄 범위의 타임스탬프를 일괄로 앞뒤로 이동합니다",
  timeShiftFrom: "시작",
  timeShiftTo: "끝",
  timeShiftDelta: "이동량",
  timeShiftApply: "적용",
  timeShiftSec: "초",
  warnOutOfOrder: "이전 줄보다 타임스탬프가 빠릅니다 (순서 역전)",
  warnDuplicate: "다른 줄과 타임스탬프가 중복됩니다",
  validationSummary: "타임스탬프 문제",
  validationTitle: "검증 / 통계",
  validationStatComplete: "완성도",
  validationStatStamped: "찍힘",
  validationStatLines: "줄",
  validationUnstamped: "타임스탬프 미입력",
  validationNoIssues: "모든 줄이 올바르게 입력되었습니다",
  noLines: "「+ 줄 추가」 버튼으로 가사를 입력하세요",
  stampTooltip: "클릭하여 현재 시간을 타임스탬프로 설정",
  linePlaceholder: "가사를 입력하세요...",
  deleteLine: "줄 삭제",
  duplicateLine: "줄 복제",
  mergeLineUp: "위 줄과 병합",
  loopLine: "이 줄 반복재생",
  reorderLine: "드래그하여 순서 변경",
  bulkSelected: "줄 선택됨",
  bulkShift: "이동",
  bulkClearTs: "타임스탬프 지우기",
  bulkDelete: "삭제",
  bulkDeselect: "선택 해제",
  currentTimeLabel: "현재: ",
  songInfo: "곡 정보",
  metaTitle: { label: "제목 (ti)", placeholder: "노래 제목" },
  metaArtist: { label: "아티스트 (ar)", placeholder: "아티스트 이름" },
  metaAlbum: { label: "앨범 (al)", placeholder: "앨범 이름" },
  metaBy: { label: "작성자 (by)", placeholder: "LRC 작성자" },
  metaOffset: "오프셋 ms (offset)",
  metaOffsetShort: "오프셋",
  applyOffset: "적용",
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
  updater: {
    title: "업데이트 알림",
    readyTitle: "업데이트 준비 완료",
    errorTitle: "업데이트 실패",
    newVersion: "새 버전이 있습니다:",
    downloading: "다운로드 중...",
    readyMessage: "설치가 완료되었습니다. 재시작하면 적용됩니다.",
    later: "나중에",
    update: "업데이트",
    restart: "재시작",
    close: "닫기",
    busyHint: "AI 정렬·다운로드 작업이 진행 중이라 지금은 업데이트할 수 없습니다.",
  },
  settingsTitle: "설정",
  settingsTabGeneral: "일반",
  settingsTabShortcuts: "단축키",
  settingsTabModels: "AI 모델",
  settingsAutoUpdate: "자동 업데이트 확인",
  settingsAutoUpdateDesc: "앱 시작 시 최신 버전을 자동으로 확인합니다.",
  settingsAutoSave: "자동 저장",
  settingsAutoSaveDesc: "저장 위치가 지정된 파일은 변경 후 잠시 멈추면 자동으로 저장합니다.",
  settingsElrcNotice: "Enhanced LRC 저장 알림",
  settingsElrcNoticeDesc: "글자/단어 동기화가 있어 Enhanced LRC로 저장될 때 알림 팝업을 표시합니다. 끄면 묻지 않고 저장합니다.",
  settingsLyricsFontSize: "가사 글꼴 크기",
  settingsGlyphMarkers: "글자 시간 마커 표시",
  settingsGlyphMarkersDesc: "글자 동기화 모드에서 각 글자 아래에 찍힌 시간을 점선으로 표시합니다.",
  settingsSpellCheck: "맞춤법 검사",
  settingsSpellCheckDesc: "가사 입력창에 브라우저 기본 맞춤법 검사를 사용합니다. 전용 교정기가 아니라 일반 사전 기반 검사이며, 음역/비표준 가사에서는 오탐이 많을 수 있습니다.",
  elrcNotice: {
    title: "Enhanced LRC로 저장",
    message: "글자/단어 동기화가 포함되어 있어 이 파일은 Enhanced LRC(.lrc)로 저장됩니다. 일부 플레이어는 글자 단위 타이밍 태그를 지원하지 않을 수 있습니다.",
    confirm: "확인",
    dontShowAgain: "다시 보지 않기",
  },
  recovery: {
    title: "미저장 작업 복구",
    message: "이전에 저장하지 않은 작업이 남아 있습니다. 복구하시겠습니까?",
    restore: "복구",
    discard: "버리기",
    lines: "줄",
  },
  toast: {
    saved: "저장되었습니다",
    saveFailed: "저장에 실패했습니다",
    openFailed: "파일을 열지 못했습니다",
    audioLoadFailed: "오디오를 불러오지 못했습니다",
    aiSyncDone: "AI 정렬이 완료되었습니다",
    aiSyncFailed: "AI 정렬에 실패했습니다",
    modelDownloaded: "{name} 다운로드 완료",
    modelDownloadFailed: "{name} 다운로드 실패",
    deviceUnavailable: "기기 감지를 사용할 수 없습니다",
  },
  keys: {
    title: "단축키",
    capturing: "원하는 키를 누르세요… (Esc로 취소)",
    reset: "기본값 복원",
    conflict: "이미 「{action}」에 할당된 키입니다",
    reserved: "사용할 수 없는 키입니다",
    hint: "변경할 항목을 클릭한 뒤 원하는 키를 누르세요. 같은 키를 두 곳에 줄 수 없습니다. (Ctrl/⌘ 조합·Esc는 예약)",
    skipBack5: "−5초",
    skipBack1: "−1초",
    playPause: "재생 / 일시정지",
    skipFwd1: "+1초",
    skipFwd5: "+5초",
    stop: "정지 및 처음으로",
    stamp: "타임스탬프 찍기 / 다음",
    prevLine: "이전 줄 / 글자",
  },
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
  aiUsageTitle: "정렬에 사용",
  aiUsageSeparation: "보컬 분리 (Demucs)",
  aiUsageSeparationDesc: "정렬 전 보컬을 분리해 정확도를 높입니다 (느려짐)",
  aiUsageVad: "보컬 활동 감지 (VAD)",
  aiUsageVadDesc: "빈 줄을 보컬 재개 지점에 배치하고 무보컬 구간 오정렬을 표시",
  aiUsageNeedModel: "Demucs 모델 미설치 — 설치 후 사용 가능",
  aiUsageNeedSeparation: "보컬 분리를 켜야 사용할 수 있습니다",
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
  aiSyncGlyphWarnTitle: "글자 동기화가 삭제됩니다",
  aiSyncGlyphWarnMsg: "AI 정렬은 줄 단위로 다시 정렬하므로 기존 글자/단어 동기화가 모두 삭제됩니다. 계속할까요?",
  aiSyncGlyphWarnOk: "계속",
  aiSyncNoAudio: "오디오 파일을 먼저 열어주세요",
  aiSyncModeUnsupported: "파일 모드에서만 AI 자동 동기화를 사용할 수 있습니다",
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
  spotifyOpenInSpotify: "Spotify에서 열기",
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
  spotifySearchTrack: "곡 검색",
  modeSelect: "모드",
  modeFile: "파일",
  modeYouTube: "YouTube",
  modeComingSoon: "(미설치)",
  modeDevice: "기기 감지",
  deviceSourceApp: "출처",
  deviceWaiting: "재생 중인 항목을 기다리는 중…",
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
  youtubeDisclaimer: "저작권이 있는 콘텐츠의 다운로드는 거주 국가의 법률과 YouTube 약관의 적용을 받습니다. 본인이 권리를 갖거나 허용된 범위(예: 개인적·비상업적 이용) 내에서만 사용하세요. 사용에 대한 책임은 전적으로 사용자에게 있습니다.",
  youtubeLoad: "불러오기",
  youtubeAgree: "동의하고 계속",
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
  close: "Close",
  newFileTitle: "New LRC File",
  newFileBtn: "New",
  openLrc: "Open Lyrics",
  recentFiles: "Recent Files",
  clearRecentFiles: "Clear recent files",
  save: "Save",
  saveAs: "Save As",
  saveFormatTitle: "Choose Save Format",
  saveFormatLrcDesc: "Synced lyrics file",
  saveFormatSrtDesc: "Video subtitle file",
  saveFormatVttDesc: "Web video captions (HTML5)",
  saveFormatAssDesc: "Karaoke video subtitle (per-glyph \\k)",
  undo: "Undo",
  redo: "Redo",
  historyPanelTitle: "Edit history",
  historyCurrent: "Current",
  historyLabels: {
      commitSyllables: "Sync glyphs",
      clearSyllables: "Clear glyph sync",
      stampLine: "Stamp timestamp",
      setLines: "Bulk edit lines",
      addLine: "Add line",
      insertLines: "Insert lines",
      addLinesFromSpeech: "Insert auto-spotted lines",
      deleteLine: "Delete line",
      duplicateLine: "Duplicate line",
      mergeLine: "Merge line",
      splitLine: "Split line",
      moveLine: "Reorder line",
      scaleTimestamps: "Scale timestamps",
      deleteLines: "Delete lines",
      shiftLines: "Shift timestamps",
      clearTimestamps: "Clear timestamps",
      loadDoc: "Load lyrics",
      applyOffset: "Apply offset",
      shiftTimeRange: "Shift time range",
      replaceAll: "Find & replace ({count})",
      aiSync: "AI auto sync",
  },
  helpTitle: "Help",
  helpTabShortcuts: "Shortcuts",
  helpTabAi: "AI Guide",
  helpTabSpotify: "Spotify",
  shortcutsTitle: "Keyboard Shortcuts",
  shortcutNote: "* Shortcuts are disabled while an input is focused.",
  helpGroupPlayback: "Playback",
  helpGroupEdit: "Editing",
  helpGroupMouse: "Mouse",
  helpGroupCharSync: "Character Sync Mode",
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
    splitLine: "Split the line in two at the cursor",
    undo: "Undo",
    redo: "Redo",
    find: "Open Find / Replace",
    tsEditKey: "L-Click",
    tsEditDesc: "Edit the timestamp directly (type MM:SS.xx, Enter to confirm · Esc to cancel)",
    tsStampKey: "R-Click",
    tsStampDesc: "Set the timestamp to the current playback time",
    lineClickKey: "Line click",
    lineClickDesc: "Seek playback to the line's timestamp",
    markerClickKey: "Marker click",
    markerClickDesc: "Waveform marker → select that lyric line",
    csStamp: "Stamp the current glyph + advance to the next",
    csMove: "Move to previous / next glyph",
    csDragKey: "Drag glyphs (paint)",
    csDragDesc: "While playing, drag across glyphs to stamp each at the live playback time and advance (playhead doesn't move)",
    csClickKey: "Glyph click",
    csClickDesc: "Select the glyph (make it the active/ready one)",
    csClearKey: "Glyph R-Click",
    csClearDesc: "Clear just that glyph's time",
    csNudgeKey: "Shift + ← / →",
    csNudgeDesc: "Nudge the current glyph's time by ±0.05s",
  },
  menu: {
    file: "File", edit: "Edit", playback: "Playback", mode: "Mode", view: "View", help: "Help",
    settings: "Settings…", saveAsLrc: "Save as LRC…", saveAsSrt: "Save as SRT…",
    playPause: "Play / Pause", skipBack5: "Back 5s", skipBack1: "Back 1s",
    skipFwd1: "Forward 1s", skipFwd5: "Forward 5s", stop: "Stop",
  },
  drop: {
    overlayHint: "Drop files here to open",
    replaceTitle: "Open file",
    replaceAudio: "Audio is currently open. Replace it with the new audio?",
    replaceLyrics: "Lyrics are currently open. Unsaved changes will be lost. Replace them?",
    replaceBoth: "Audio and lyrics are currently open. Unsaved changes will be lost. Replace them?",
    replaceOk: "Replace",
    replaceCancel: "Cancel",
  },
  charSync: {
    modeLine: "Line Sync",
    modeChar: "Character Sync",
    unitLabel: "Unit",
    unitChar: "Char",
    unitWord: "Word",
    hint: "Drag glyphs=paint at playback time · Space=stamp · right-click=clear · Shift+←/→=nudge · waveform=seek",
    stampHint: "Stamp current glyph & advance",
    replayLine: "Play line",
    clearLine: "Reset line",
    current: "Current",
    empty: "No lyric lines. Enter lyrics in Line Sync mode first.",
    retokenizeTitle: "Reset character sync",
    retokenizeMsg: "This line is character-synced. Editing the text will discard all glyph timings. Continue?",
    retokenizeOk: "Edit & reset",
    retokenizeCancel: "Cancel",
    unitChangeMsg: "This line already has glyph timings. Changing the unit will discard them. Continue?",
    badge: "Character-synced",
    endCell: "Next line (paint here or click)",
    glyphProgress: "Glyphs synced in this line",
    prevLine: "Previous line",
    nextLine: "Next line",
  },
  devicePicker: {
    button: "Playback device",
    title: "Select playback device",
    refresh: "Refresh",
    loading: "Loading devices…",
    empty: "No devices available. Make sure the Spotify app is running.",
    active: "Active",
    close: "Close",
    hint: "Pick a device to play on it.",
  },
  lrclib: {
    button: "Fetch from LRCLIB",
    title: "Search lyrics on LRCLIB",
    fieldTitle: "Title",
    fieldArtist: "Artist",
    fieldAlbum: "Album",
    search: "Search",
    searching: "Searching…",
    noResults: "No results found.",
    error: "Search failed.",
    hint: "Search by title, artist, and album. (Title is weighted highest)",
    syncedOnly: "Synced only",
    plainOnly: "Plain only",
    preview: "Preview",
    confirm: "Use",
    instrumental: "Instrumental",
    noLyrics: "No lyrics",
    synced: "Synced",
    plain: "Plain",
    previewTitle: "Lyrics preview",
    close: "Close",
  },
  lrclibPublish: {
    button: "Publish to LRCLIB",
    title: "Contribute lyrics to LRCLIB",
    duration: "Duration",
    syncedLines: "Synced lines",
    missing: "To publish, you need:",
    needTitle: "Title",
    needArtist: "Artist",
    needDuration: "Audio duration (open an audio file)",
    needSync: "Synced lyrics with timestamps",
    hint: "Publicly contribute the current song info and synced lyrics to LRCLIB. Double-check the title, artist, and duration.",
    warning: "LRCLIB is a public database visible to everyone. Uploading inaccurate or test lyrics affects other users and is hard to undo. Lyrics may also be copyrighted — only contribute content you own or are permitted to share. Have you double-checked the title, artist, and lyrics?",
    confirm: "I've checked — upload",
    publish: "Publish",
    publishing: "Publishing… (computing proof-of-work, a few seconds)",
    success: "Published! Thanks for contributing.",
    failed: "Publish failed",
    close: "Close",
    cancel: "Cancel",
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
  zoomIn: "Zoom in",
  zoomOut: "Zoom out",
  volume: "Volume",
  noAudio: "Open an audio file to display the waveform",
  noAudioShort: "No audio file open",
  tooltipSkipBack5: "[1] −5s",
  tooltipSkipBack1: "[2] −1s",
  tooltipPlayPause: "[3] Play/Pause",
  tooltipSkipFwd1: "[4] +1s",
  tooltipSkipFwd5: "[5] +5s",
  tooltipStop: "[6] Reset",
  tooltipLoop: "Loop",
  tooltipMarkers: "Show lyric markers",
  tooltipSpectrogram: "Show spectrogram",
  playerMore: "More (loop · markers · speed)",
  playerSpeed: "Speed",
  tooltipSpeedDown: "Slower",
  tooltipSpeedUp: "Faster",
  tooltipViewWaveform: "Waveform",
  tooltipViewSeekBar: "Seek bar",

  lyricsEditor: "Lyrics Editor",
  addLine: "+ Add Line",
  findReplace: "Find/Replace",
  editorTools: "Tools",
  findPlaceholder: "Find...",
  replacePlaceholder: "Replace...",
  replaceBtn: "Replace",
  replaceAll: "Replace All",
  caseSensitive: "Case Sensitive",
  noMatches: "No matches",
  timeShift: "Range Offset",
  tsScale: "Timestamp scale",
  tsScaleFactor: "Factor",
  tsScaleHint: "All timestamps × factor (e.g. 1.05 = 5% slower)",
  autoSpot: "Auto-Spot",
  translationToggle: "Show translation lines",
  translationPlaceholder: "Translation (optional)",
  autoSpotTitle: "Silence-Based Auto-Spotting",
  autoSpotHint: "Finds stretches that sound like speech and lays down blank text lines over them. This is a volume-threshold heuristic, not real speech recognition — review and fill in the text afterward.",
  autoSpotNeedsAudio: "Open an audio file first",
  autoSpotDecoding: "Analyzing audio…",
  autoSpotDecodeError: "Couldn't analyze the audio",
  autoSpotThreshold: "Threshold",
  autoSpotMinSilence: "Min. silence",
  autoSpotMinSpeech: "Min. speech",
  autoSpotPadding: "Padding",
  autoSpotSegmentsFound: "segments found",
  autoSpotAddedLabel: "lines added",
  autoSpotApply: "Apply",
  autoSpotCancel: "Cancel",
  timeShiftTooltip: "Shift timestamps of a selected line range forward or backward",
  timeShiftFrom: "From",
  timeShiftTo: "To",
  timeShiftDelta: "Shift",
  timeShiftApply: "Apply",
  timeShiftSec: "s",
  warnOutOfOrder: "Timestamp is earlier than the previous line (out of order)",
  warnDuplicate: "Timestamp duplicates another line",
  validationSummary: "timestamp issue(s)",
  validationTitle: "Validation / Stats",
  validationStatComplete: "Complete",
  validationStatStamped: "Stamped",
  validationStatLines: "Lines",
  validationUnstamped: "No timestamp",
  validationNoIssues: "All lines look good",
  noLines: "Press \"+ Add Line\" to start entering lyrics",
  stampTooltip: "Click to set current time as timestamp",
  linePlaceholder: "Enter lyrics...",
  deleteLine: "Delete line",
  duplicateLine: "Duplicate line",
  mergeLineUp: "Merge with line above",
  loopLine: "Loop this line",
  reorderLine: "Drag to reorder",
  bulkSelected: "selected",
  bulkShift: "Shift",
  bulkClearTs: "Clear timestamps",
  bulkDelete: "Delete",
  bulkDeselect: "Deselect",
  currentTimeLabel: "Current: ",
  songInfo: "Song Info",
  metaTitle: { label: "Title (ti)", placeholder: "Song title" },
  metaArtist: { label: "Artist (ar)", placeholder: "Artist name" },
  metaAlbum: { label: "Album (al)", placeholder: "Album name" },
  metaBy: { label: "Author (by)", placeholder: "LRC author" },
  metaOffset: "Offset ms (offset)",
  metaOffsetShort: "Offset",
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
  updater: {
    title: "Update Available",
    readyTitle: "Update Ready",
    errorTitle: "Update Failed",
    newVersion: "A new version is available:",
    downloading: "Downloading...",
    readyMessage: "Installed. Restart to apply the update.",
    later: "Later",
    update: "Update",
    restart: "Restart",
    close: "Close",
    busyHint: "Update is unavailable while AI alignment or a download is in progress.",
  },
  settingsTitle: "Settings",
  settingsTabGeneral: "General",
  settingsTabShortcuts: "Shortcuts",
  settingsTabModels: "AI Models",
  settingsAutoUpdate: "Auto-check for updates",
  settingsAutoUpdateDesc: "Automatically check for new versions on startup.",
  settingsAutoSave: "Auto-save",
  settingsAutoSaveDesc: "Files with a save location are saved automatically a moment after you stop editing.",
  settingsElrcNotice: "Enhanced LRC save notice",
  settingsElrcNoticeDesc: "Show a notice when word/character sync causes the file to be saved as Enhanced LRC. Turn off to save without asking.",
  settingsLyricsFontSize: "Lyrics font size",
  settingsGlyphMarkers: "Show glyph time markers",
  settingsGlyphMarkersDesc: "Show the stamped time under each glyph with dotted lines in character sync mode.",
  settingsSpellCheck: "Spell check",
  settingsSpellCheckDesc: "Use the browser's built-in spell checker on the lyric text field. This is a generic dictionary checker, not a lyrics-aware proofreader, and may flag many false positives on phonetic or non-standard lyrics.",
  elrcNotice: {
    title: "Save as Enhanced LRC",
    message: "This file contains word/character sync, so it will be saved as Enhanced LRC (.lrc). Some players may not support per-glyph timing tags.",
    confirm: "OK",
    dontShowAgain: "Don't show again",
  },
  recovery: {
    title: "Recover unsaved work",
    message: "Unsaved work from a previous session was found. Restore it?",
    restore: "Restore",
    discard: "Discard",
    lines: " lines",
  },
  toast: {
    saved: "Saved",
    saveFailed: "Failed to save",
    openFailed: "Couldn't open file",
    audioLoadFailed: "Couldn't load audio",
    aiSyncDone: "AI alignment complete",
    aiSyncFailed: "AI alignment failed",
    modelDownloaded: "{name} downloaded",
    modelDownloadFailed: "{name} download failed",
    deviceUnavailable: "Device detection is unavailable",
  },
  keys: {
    title: "Keyboard shortcuts",
    capturing: "Press a key… (Esc to cancel)",
    reset: "Reset to defaults",
    conflict: "Already assigned to “{action}”",
    reserved: "That key can't be used",
    hint: "Click an action, then press a key. The same key can't be used twice. (Ctrl/⌘ combos and Esc are reserved.)",
    skipBack5: "Skip back 5s",
    skipBack1: "Skip back 1s",
    playPause: "Play / Pause",
    skipFwd1: "Skip forward 1s",
    skipFwd5: "Skip forward 5s",
    stop: "Stop & reset",
    stamp: "Stamp / next",
    prevLine: "Previous line / glyph",
  },
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
  aiUsageTitle: "Use for alignment",
  aiUsageSeparation: "Vocal separation (Demucs)",
  aiUsageSeparationDesc: "Isolate vocals before alignment for better accuracy (slower)",
  aiUsageVad: "Vocal activity detection (VAD)",
  aiUsageVadDesc: "Place blank lines at vocal resume and flag misaligned silent regions",
  aiUsageNeedModel: "Demucs model not installed — install to enable",
  aiUsageNeedSeparation: "Requires vocal separation to be enabled",
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
  aiSyncGlyphWarnTitle: "Character sync will be cleared",
  aiSyncGlyphWarnMsg: "AI alignment re-aligns line by line, so all existing character/word sync will be removed. Continue?",
  aiSyncGlyphWarnOk: "Continue",
  aiSyncNoAudio: "Please open an audio file first",
  aiSyncModeUnsupported: "AI auto sync is only available in File mode",
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
  spotifyOpenInSpotify: "Open in Spotify",
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
  spotifySearchTrack: "Search tracks",
  modeSelect: "Mode",
  modeFile: "File",
  modeYouTube: "YouTube",
  modeComingSoon: "(Not installed)",
  modeDevice: "Device Detection",
  deviceSourceApp: "Source",
  deviceWaiting: "Waiting for playback…",
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
  youtubeDisclaimer: "Downloading copyrighted content is subject to the laws of your country and YouTube's Terms of Service. Use only content you own or are otherwise permitted to use (e.g. personal, non-commercial use). You are solely responsible for your use.",
  youtubeLoad: "Load",
  youtubeAgree: "Agree & continue",
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
  close: "閉じる",
  newFileTitle: "新規LRCファイル",
  newFileBtn: "新規作成",
  openLrc: "歌詞を開く",
  recentFiles: "最近使ったファイル",
  clearRecentFiles: "最近使ったファイルをクリア",
  save: "保存",
  saveAs: "名前を付けて保存",
  saveFormatTitle: "保存形式を選択",
  saveFormatLrcDesc: "歌詞同期ファイル",
  saveFormatSrtDesc: "動画字幕ファイル",
  saveFormatVttDesc: "Web動画字幕 (HTML5)",
  saveFormatAssDesc: "カラオケ動画字幕 (文字同期 \\k)",
  undo: "元に戻す",
  redo: "やり直す",
  historyPanelTitle: "編集履歴",
  historyCurrent: "現在",
  historyLabels: {
      commitSyllables: "文字同期入力",
      clearSyllables: "文字同期解除",
      stampLine: "タイムスタンプ記録",
      setLines: "歌詞行を一括変更",
      addLine: "行を追加",
      insertLines: "行を挿入",
      addLinesFromSpeech: "自動スポッティング行挿入",
      deleteLine: "行を削除",
      duplicateLine: "行を複製",
      mergeLine: "行を結合",
      splitLine: "行を分割",
      moveLine: "行の並び替え",
      scaleTimestamps: "タイムスタンプのスケール",
      deleteLines: "行を一括削除",
      shiftLines: "タイムスタンプ移動",
      clearTimestamps: "タイムスタンプ削除",
      loadDoc: "歌詞を読み込み",
      applyOffset: "オフセット適用",
      shiftTimeRange: "区間の時間移動",
      replaceAll: "検索と置換 ({count}件)",
      aiSync: "AI自動同期",
  },
  helpTitle: "ヘルプ",
  helpTabShortcuts: "ショートカット",
  helpTabAi: "AI使い方",
  helpTabSpotify: "Spotify",
  shortcutsTitle: "キーボードショートカット",
  shortcutNote: "* 入力欄にフォーカス中はショートカットが無効になります。",
  helpGroupPlayback: "再生・移動",
  helpGroupEdit: "編集",
  helpGroupMouse: "マウス",
  helpGroupCharSync: "文字同期モード",
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
    splitLine: "カーソル位置で行を2つに分割",
    undo: "元に戻す",
    redo: "やり直し",
    find: "検索 / 置換を開く",
    tsEditKey: "左クリック",
    tsEditDesc: "タイムスタンプを直接編集（MM:SS.xx を入力、Enter で確定・Esc で取消）",
    tsStampKey: "右クリック",
    tsStampDesc: "タイムスタンプを現在の再生位置に設定",
    lineClickKey: "行クリック",
    lineClickDesc: "その行のタイムスタンプへ再生位置を移動",
    markerClickKey: "マーカー",
    markerClickDesc: "波形マーカー → その歌詞行を選択",
    csStamp: "現在の文字にタイムスタンプ + 次の文字へ",
    csMove: "前 / 次の文字へ移動",
    csDragKey: "文字ドラッグ（塗り）",
    csDragDesc: "再生中に文字の上をドラッグすると、通過した文字が現在の再生時間で打刻され次の文字が準備される（再生位置は動かない）",
    csClickKey: "文字クリック",
    csClickDesc: "文字を選択（アクティブ/準備状態に）",
    csClearKey: "文字 右クリック",
    csClearDesc: "その文字の時刻のみ消去",
    csNudgeKey: "Shift + ← / →",
    csNudgeDesc: "現在の文字の時刻を ±0.05秒 微調整",
  },
  menu: {
    file: "ファイル", edit: "編集", playback: "再生", mode: "モード", view: "表示", help: "ヘルプ",
    settings: "設定…", saveAsLrc: "LRCで保存…", saveAsSrt: "SRTで保存…",
    playPause: "再生 / 一時停止", skipBack5: "5秒戻る", skipBack1: "1秒戻る",
    skipFwd1: "1秒進む", skipFwd5: "5秒進む", stop: "停止",
  },
  drop: {
    overlayHint: "ここにファイルをドロップして開く",
    replaceTitle: "ファイルを開く",
    replaceAudio: "編集中のオーディオがあります。新しいオーディオに置き換えますか？",
    replaceLyrics: "編集中の歌詞があります。保存していない変更は失われます。置き換えますか？",
    replaceBoth: "編集中のオーディオ・歌詞があります。保存していない変更は失われます。置き換えますか？",
    replaceOk: "置き換え",
    replaceCancel: "キャンセル",
  },
  charSync: {
    modeLine: "行同期",
    modeChar: "文字同期",
    unitLabel: "単位",
    unitChar: "文字",
    unitWord: "単語",
    hint: "文字ドラッグ=再生時間で塗り打刻 · Space=打刻 · 右クリック=消去 · Shift+←/→=微調整 · 波形=シーク",
    stampHint: "現在の文字を打刻して次へ",
    replayLine: "この行を再生",
    clearLine: "この行をリセット",
    current: "現在",
    empty: "歌詞行がありません。先に行同期モードで歌詞を入力してください。",
    retokenizeTitle: "文字同期のリセット",
    retokenizeMsg: "この行は文字単位で同期されています。テキストを編集すると文字タイミングはすべて失われます。続行しますか？",
    retokenizeOk: "編集してリセット",
    retokenizeCancel: "キャンセル",
    unitChangeMsg: "この行には既に文字タイミングがあります。単位を変更するとタイミングは失われます。続行しますか？",
    badge: "文字同期済み",
    endCell: "次の行へ（ここまで塗るかクリック）",
    glyphProgress: "この行の文字同期の進捗",
    prevLine: "前の行",
    nextLine: "次の行",
  },
  devicePicker: {
    button: "再生デバイス",
    title: "再生デバイスを選択",
    refresh: "更新",
    loading: "デバイスを読み込み中…",
    empty: "利用可能なデバイスがありません。Spotifyアプリが起動しているか確認してください。",
    active: "再生中",
    close: "閉じる",
    hint: "デバイスを選ぶとそのデバイスで再生します。",
  },
  lrclib: {
    button: "LRCLIBから取得",
    title: "LRCLIBで歌詞を検索",
    fieldTitle: "タイトル",
    fieldArtist: "アーティスト",
    fieldAlbum: "アルバム",
    search: "検索",
    searching: "検索中…",
    noResults: "検索結果がありません。",
    error: "検索に失敗しました。",
    hint: "タイトル・アーティスト・アルバムで検索（タイトル優先）",
    syncedOnly: "同期歌詞のみ",
    plainOnly: "通常歌詞のみ",
    preview: "プレビュー",
    confirm: "確定",
    instrumental: "インスト",
    noLyrics: "歌詞なし",
    synced: "同期",
    plain: "歌詞",
    previewTitle: "歌詞プレビュー",
    close: "閉じる",
  },
  lrclibPublish: {
    button: "LRCLIBに公開",
    title: "LRCLIBに歌詞を貢献",
    duration: "長さ",
    syncedLines: "同期行",
    missing: "公開するには以下が必要です：",
    needTitle: "タイトル",
    needArtist: "アーティスト",
    needDuration: "音声の長さ（音声を開いてください）",
    needSync: "タイムスタンプ付きの同期歌詞",
    hint: "現在の曲情報・同期歌詞をLRCLIBに公開貢献します。タイトル・アーティスト・長さを確認してください。",
    warning: "LRCLIBは誰でも閲覧できる公開データベースです。不正確またはテスト用の歌詞を投稿すると他のユーザーに影響し、取り消しが困難です。また歌詞は著作権の対象となる場合があるため、ご自身が権利を有するか許可された場合のみ投稿してください。タイトル・アーティスト・歌詞を再確認しましたか？",
    confirm: "確認のうえ公開",
    publish: "公開",
    publishing: "公開中…（証明計算、数秒かかります）",
    success: "公開しました！ご貢献ありがとうございます。",
    failed: "公開に失敗しました",
    close: "閉じる",
    cancel: "キャンセル",
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
  zoomIn: "拡大",
  zoomOut: "縮小",
  volume: "音量",
  noAudio: "音声ファイルを開いて波形を表示します",
  noAudioShort: "開いている音声ファイルなし",
  tooltipSkipBack5: "[1] −5秒",
  tooltipSkipBack1: "[2] −1秒",
  tooltipPlayPause: "[3] 再生/一時停止",
  tooltipSkipFwd1: "[4] +1秒",
  tooltipSkipFwd5: "[5] +5秒",
  tooltipStop: "[6] 最初へ",
  tooltipLoop: "リピート",
  tooltipMarkers: "歌詞マーカー表示",
  tooltipSpectrogram: "スペクトログラム表示",
  playerMore: "その他（リピート・マーカー・速度）",
  playerSpeed: "再生速度",
  tooltipSpeedDown: "遅くする",
  tooltipSpeedUp: "速くする",
  tooltipViewWaveform: "波形",
  tooltipViewSeekBar: "シーク",
  lyricsEditor: "歌詞編集",
  addLine: "+ 行を追加",
  findReplace: "検索/置換",
  editorTools: "ツール",
  findPlaceholder: "検索...",
  replacePlaceholder: "置換...",
  replaceBtn: "置換",
  replaceAll: "すべて置換",
  caseSensitive: "大文字・小文字を区別",
  noMatches: "一致なし",
  timeShift: "区間オフセット",
  tsScale: "タイムスタンプ倍率",
  tsScaleFactor: "倍率",
  tsScaleHint: "全タイムスタンプ × 倍率（例: 1.05 = 5%遅く）",
  autoSpot: "自動スポッティング",
  translationToggle: "翻訳行を表示",
  translationPlaceholder: "翻訳（任意）",
  autoSpotTitle: "無音ベース自動スポッティング",
  autoSpotHint: "音声から発話に聞こえる区間を検出し、空のテキスト行を配置します。正確な音声認識ではなく音量しきい値ベースなので、配置後は内容を確認しながらテキストを入力してください。",
  autoSpotNeedsAudio: "先に音声ファイルを開いてください",
  autoSpotDecoding: "音声を分析中…",
  autoSpotDecodeError: "音声を分析できませんでした",
  autoSpotThreshold: "しきい値",
  autoSpotMinSilence: "最小無音長",
  autoSpotMinSpeech: "最小発話長",
  autoSpotPadding: "余白(パディング)",
  autoSpotSegmentsFound: "区間検出",
  autoSpotAddedLabel: "行追加",
  autoSpotApply: "適用",
  autoSpotCancel: "キャンセル",
  timeShiftTooltip: "選択した行範囲のタイムスタンプを前後に一括移動します",
  timeShiftFrom: "開始",
  timeShiftTo: "終了",
  timeShiftDelta: "移動量",
  timeShiftApply: "適用",
  timeShiftSec: "秒",
  warnOutOfOrder: "前の行よりタイムスタンプが早いです（順序逆転）",
  warnDuplicate: "他の行とタイムスタンプが重複しています",
  validationSummary: "タイムスタンプの問題",
  validationTitle: "検証 / 統計",
  validationStatComplete: "完成度",
  validationStatStamped: "記録済み",
  validationStatLines: "行",
  validationUnstamped: "タイムスタンプ未入力",
  validationNoIssues: "すべての行が正しく入力されています",
  noLines: "「+ 行を追加」ボタンで歌詞を入力してください",
  stampTooltip: "クリックして現在時刻をタイムスタンプに設定",
  linePlaceholder: "歌詞を入力してください...",
  deleteLine: "行を削除",
  duplicateLine: "行を複製",
  mergeLineUp: "上の行と結合",
  loopLine: "この行をリピート",
  reorderLine: "ドラッグで並べ替え",
  bulkSelected: "行を選択中",
  bulkShift: "移動",
  bulkClearTs: "タイムスタンプ消去",
  bulkDelete: "削除",
  bulkDeselect: "選択解除",
  currentTimeLabel: "現在: ",
  songInfo: "曲情報",
  metaTitle: { label: "タイトル (ti)", placeholder: "曲のタイトル" },
  metaArtist: { label: "アーティスト (ar)", placeholder: "アーティスト名" },
  metaAlbum: { label: "アルバム (al)", placeholder: "アルバム名" },
  metaBy: { label: "作成者 (by)", placeholder: "LRC作成者" },
  metaOffset: "オフセット ms (offset)",
  metaOffsetShort: "オフセット",
  applyOffset: "適用",
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
  updater: {
    title: "アップデート通知",
    readyTitle: "アップデート準備完了",
    errorTitle: "アップデート失敗",
    newVersion: "新しいバージョンがあります:",
    downloading: "ダウンロード中...",
    readyMessage: "インストールが完了しました。再起動すると適用されます。",
    later: "あとで",
    update: "アップデート",
    restart: "再起動",
    close: "閉じる",
    busyHint: "AI整列またはダウンロードの実行中はアップデートできません。",
  },
  settingsTitle: "設定",
  settingsTabGeneral: "一般",
  settingsTabShortcuts: "ショートカット",
  settingsTabModels: "AIモデル",
  settingsAutoUpdate: "自動更新確認",
  settingsAutoUpdateDesc: "アプリ起動時に最新バージョンを自動で確認します。",
  settingsAutoSave: "自動保存",
  settingsAutoSaveDesc: "保存先が指定されたファイルは、編集を止めると少し後に自動保存されます。",
  settingsElrcNotice: "Enhanced LRC 保存通知",
  settingsElrcNoticeDesc: "文字/単語同期があり Enhanced LRC として保存される際に通知ポップアップを表示します。オフにすると確認せず保存します。",
  settingsLyricsFontSize: "歌詞のフォントサイズ",
  settingsGlyphMarkers: "文字タイムマーカーを表示",
  settingsGlyphMarkersDesc: "文字同期モードで各文字の下に記録した時刻を点線で表示します。",
  settingsSpellCheck: "スペルチェック",
  settingsSpellCheckDesc: "歌詞入力欄でブラウザ標準のスペルチェックを使用します。専用の校正機能ではなく一般的な辞書ベースのチェックのため、音訳や非標準的な歌詞では誤検出が多くなることがあります。",
  elrcNotice: {
    title: "Enhanced LRC で保存",
    message: "文字/単語同期が含まれているため、このファイルは Enhanced LRC（.lrc）として保存されます。一部のプレーヤーは文字単位のタイミングタグに対応していない場合があります。",
    confirm: "OK",
    dontShowAgain: "今後表示しない",
  },
  recovery: {
    title: "未保存の作業を復元",
    message: "前回保存されていない作業が残っています。復元しますか？",
    restore: "復元",
    discard: "破棄",
    lines: "行",
  },
  toast: {
    saved: "保存しました",
    saveFailed: "保存に失敗しました",
    openFailed: "ファイルを開けませんでした",
    audioLoadFailed: "オーディオを読み込めませんでした",
    aiSyncDone: "AI 整列が完了しました",
    aiSyncFailed: "AI 整列に失敗しました",
    modelDownloaded: "{name} のダウンロード完了",
    modelDownloadFailed: "{name} のダウンロード失敗",
    deviceUnavailable: "デバイス検出を利用できません",
  },
  keys: {
    title: "ショートカット",
    capturing: "キーを押してください…（Escで取消）",
    reset: "デフォルトに戻す",
    conflict: "すでに「{action}」に割り当て済みです",
    reserved: "使用できないキーです",
    hint: "項目をクリックしてキーを押します。同じキーを2か所には設定できません。（Ctrl/⌘ 組合せ・Escは予約）",
    skipBack5: "5秒戻る",
    skipBack1: "1秒戻る",
    playPause: "再生 / 一時停止",
    skipFwd1: "1秒進む",
    skipFwd5: "5秒進む",
    stop: "停止して最初へ",
    stamp: "タイムスタンプ / 次へ",
    prevLine: "前の行 / 文字",
  },
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
  aiUsageTitle: "整列に使用",
  aiUsageSeparation: "ボーカル分離 (Demucs)",
  aiUsageSeparationDesc: "整列前にボーカルを分離して精度を向上（遅くなります）",
  aiUsageVad: "ボーカル活動検出 (VAD)",
  aiUsageVadDesc: "空行をボーカル再開地点に配置し、無ボーカル区間の誤整列を表示",
  aiUsageNeedModel: "Demucs モデル未インストール — インストールで有効化",
  aiUsageNeedSeparation: "ボーカル分離を有効にする必要があります",
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
  aiSyncGlyphWarnTitle: "文字同期が削除されます",
  aiSyncGlyphWarnMsg: "AI 整列は行単位で再整列するため、既存の文字/単語同期がすべて削除されます。続行しますか？",
  aiSyncGlyphWarnOk: "続行",
  aiSyncNoAudio: "先に音声ファイルを開いてください",
  aiSyncModeUnsupported: "AI自動同期はファイルモードでのみ使用できます",
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
  spotifyOpenInSpotify: "Spotifyで開く",
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
  spotifySearchTrack: "曲を検索",
  modeSelect: "モード",
  modeFile: "ファイル",
  modeYouTube: "YouTube",
  modeComingSoon: "(未インストール)",
  modeDevice: "デバイス検出",
  deviceSourceApp: "出典",
  deviceWaiting: "再生中の項目を待っています…",
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
  youtubeDisclaimer: "著作権で保護されたコンテンツのダウンロードは、お住まいの国の法律および YouTube の利用規約の対象となります。ご自身が権利を有するか、許可された範囲（個人的・非商用利用など）でのみ使用してください。使用に関する責任はすべて利用者にあります。",
  youtubeLoad: "読み込む",
  youtubeAgree: "同意して続行",
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
