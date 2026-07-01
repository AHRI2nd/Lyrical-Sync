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
  saveFormatVttDesc: string;
  saveFormatAssDesc: string;
  undo: string;
  redo: string;
  // Help modal
  helpTitle: string;
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
    file: string; edit: string; playback: string; view: string; help: string;
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
  };
  lrclib: {
    button: string; title: string;
    fieldTitle: string; fieldArtist: string; fieldAlbum: string;
    search: string; searching: string; noResults: string; error: string; hint: string;
    syncedOnly: string; plainOnly: string;
    preview: string; confirm: string;
    instrumental: string; noLyrics: string; synced: string; plain: string;
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
  playerMore: string;
  playerSpeed: string;
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
  timeShiftFrom: string;
  timeShiftTo: string;
  timeShiftDelta: string;
  timeShiftApply: string;
  timeShiftSec: string;
  warnOutOfOrder: string;
  warnDuplicate: string;
  validationTitle: string;
  validationStatComplete: string;
  validationStatStamped: string;
  validationStatLines: string;
  validationUnstamped: string;
  validationNoIssues: string;
  noLines: string;
  linePlaceholder: string;
  deleteLine: string;
  duplicateLine: string;
  mergeLineUp: string;
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
  metaOffsetShort: string;
  applyOffset: string;
  applyOffsetTooltip: string;
  viewAll: string;
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
  // Settings modal
  settingsTitle: string;
  settingsTabGeneral: string;
  settingsTabShortcuts: string;
  settingsAutoSave: string;
  settingsAutoSaveDesc: string;
  settingsElrcNotice: string;
  settingsElrcNoticeDesc: string;
  settingsLyricsFontSize: string;
  settingsGlyphMarkers: string;
  settingsGlyphMarkersDesc: string;
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
  settingsUiScale: string;
  settingsUiScaleReset: string;
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
  saveFormatVttDesc: "웹 영상 자막 (HTML5)",
  saveFormatAssDesc: "노래방 영상 자막 (글자 동기화 \\k)",
  undo: "실행 취소",
  redo: "다시 실행",
  helpTitle: "도움말",
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
    file: "파일", edit: "편집", playback: "재생", view: "보기", help: "도움말",
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
  playerMore: "더보기 (반복·마커·배속)",
  playerSpeed: "배속",
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
  timeShiftFrom: "시작",
  timeShiftTo: "끝",
  timeShiftDelta: "이동량",
  timeShiftApply: "적용",
  timeShiftSec: "초",
  warnOutOfOrder: "이전 줄보다 타임스탬프가 빠릅니다 (순서 역전)",
  warnDuplicate: "다른 줄과 타임스탬프가 중복됩니다",
  validationTitle: "검증 / 통계",
  validationStatComplete: "완성도",
  validationStatStamped: "찍힘",
  validationStatLines: "줄",
  validationUnstamped: "타임스탬프 미입력",
  validationNoIssues: "모든 줄이 올바르게 입력되었습니다",
  noLines: "「+ 줄 추가」 버튼으로 가사를 입력하세요",
  linePlaceholder: "가사를 입력하세요...",
  deleteLine: "줄 삭제",
  duplicateLine: "줄 복제",
  mergeLineUp: "위 줄과 병합",
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
  metaOffsetShort: "오프셋",
  applyOffset: "적용",
  applyOffsetTooltip: "모든 타임스탬프에 오프셋을 더한 후 오프셋을 0으로 초기화합니다",
  viewAll: "전체보기",
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
  settingsTitle: "설정",
  settingsTabGeneral: "일반",
  settingsTabShortcuts: "단축키",
  settingsAutoSave: "자동 저장",
  settingsAutoSaveDesc: "저장 위치가 지정된 파일은 변경 후 잠시 멈추면 자동으로 저장합니다.",
  settingsElrcNotice: "Enhanced LRC 저장 알림",
  settingsElrcNoticeDesc: "글자/단어 동기화가 있어 Enhanced LRC로 저장될 때 알림 팝업을 표시합니다. 끄면 묻지 않고 저장합니다.",
  settingsLyricsFontSize: "가사 글꼴 크기",
  settingsGlyphMarkers: "글자 시간 마커 표시",
  settingsGlyphMarkersDesc: "글자 동기화 모드에서 각 글자 아래에 찍힌 시간을 점선으로 표시합니다.",
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
  settingsUiScale: "UI 크기",
  settingsUiScaleReset: "초기화",
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
  saveFormatVttDesc: "Web video captions (HTML5)",
  saveFormatAssDesc: "Karaoke video subtitle (per-glyph \\k)",
  undo: "Undo",
  redo: "Redo",
  helpTitle: "Help",
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
    file: "File", edit: "Edit", playback: "Playback", view: "View", help: "Help",
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
  playerMore: "More (loop · markers · speed)",
  playerSpeed: "Speed",
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
  timeShiftFrom: "From",
  timeShiftTo: "To",
  timeShiftDelta: "Shift",
  timeShiftApply: "Apply",
  timeShiftSec: "s",
  warnOutOfOrder: "Timestamp is earlier than the previous line (out of order)",
  warnDuplicate: "Timestamp duplicates another line",
  validationTitle: "Validation / Stats",
  validationStatComplete: "Complete",
  validationStatStamped: "Stamped",
  validationStatLines: "Lines",
  validationUnstamped: "No timestamp",
  validationNoIssues: "All lines look good",
  noLines: "Press \"+ Add Line\" to start entering lyrics",
  linePlaceholder: "Enter lyrics...",
  deleteLine: "Delete line",
  duplicateLine: "Duplicate line",
  mergeLineUp: "Merge with line above",
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
  metaOffsetShort: "Offset",
  applyOffset: "Apply",
  applyOffsetTooltip: "Add offset to all timestamps, then reset offset to 0",
  viewAll: "View All",
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
  settingsTitle: "Settings",
  settingsTabGeneral: "General",
  settingsTabShortcuts: "Shortcuts",
  settingsAutoSave: "Auto-save",
  settingsAutoSaveDesc: "Files with a save location are saved automatically a moment after you stop editing.",
  settingsElrcNotice: "Enhanced LRC save notice",
  settingsElrcNoticeDesc: "Show a notice when word/character sync causes the file to be saved as Enhanced LRC. Turn off to save without asking.",
  settingsLyricsFontSize: "Lyrics font size",
  settingsGlyphMarkers: "Show glyph time markers",
  settingsGlyphMarkersDesc: "Show the stamped time under each glyph with dotted lines in character sync mode.",
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
  settingsUiScale: "UI Scale",
  settingsUiScaleReset: "Reset",
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
  saveFormatVttDesc: "Web動画字幕 (HTML5)",
  saveFormatAssDesc: "カラオケ動画字幕 (文字同期 \\k)",
  undo: "元に戻す",
  redo: "やり直す",
  helpTitle: "ヘルプ",
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
    file: "ファイル", edit: "編集", playback: "再生", view: "表示", help: "ヘルプ",
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
  playerMore: "その他（リピート・マーカー・速度）",
  playerSpeed: "再生速度",
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
  timeShiftFrom: "開始",
  timeShiftTo: "終了",
  timeShiftDelta: "移動量",
  timeShiftApply: "適用",
  timeShiftSec: "秒",
  warnOutOfOrder: "前の行よりタイムスタンプが早いです（順序逆転）",
  warnDuplicate: "他の行とタイムスタンプが重複しています",
  validationTitle: "検証 / 統計",
  validationStatComplete: "完成度",
  validationStatStamped: "記録済み",
  validationStatLines: "行",
  validationUnstamped: "タイムスタンプ未入力",
  validationNoIssues: "すべての行が正しく入力されています",
  noLines: "「+ 行を追加」ボタンで歌詞を入力してください",
  linePlaceholder: "歌詞を入力してください...",
  deleteLine: "行を削除",
  duplicateLine: "行を複製",
  mergeLineUp: "上の行と結合",
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
  metaOffsetShort: "オフセット",
  applyOffset: "適用",
  applyOffsetTooltip: "全タイムスタンプにオフセットを加算し、オフセットを0にリセットします",
  viewAll: "全体表示",
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
  settingsTitle: "設定",
  settingsTabGeneral: "一般",
  settingsTabShortcuts: "ショートカット",
  settingsAutoSave: "自動保存",
  settingsAutoSaveDesc: "保存先が指定されたファイルは、編集を止めると少し後に自動保存されます。",
  settingsElrcNotice: "Enhanced LRC 保存通知",
  settingsElrcNoticeDesc: "文字/単語同期があり Enhanced LRC として保存される際に通知ポップアップを表示します。オフにすると確認せず保存します。",
  settingsLyricsFontSize: "歌詞のフォントサイズ",
  settingsGlyphMarkers: "文字タイムマーカーを表示",
  settingsGlyphMarkersDesc: "文字同期モードで各文字の下に記録した時刻を点線で表示します。",
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
  settingsUiScale: "UIサイズ",
  settingsUiScaleReset: "リセット",
};

export const translations: Record<Lang, Translations> = { ko, en, ja };
