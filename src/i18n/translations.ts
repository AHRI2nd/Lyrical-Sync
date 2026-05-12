export type Lang = "ko" | "en" | "ja";

export interface Translations {
  // Header
  newFileTitle: string;
  newFileBtn: string;
  openLrc: string;
  save: string;
  saveAs: string;
  // Help modal
  shortcutsTitle: string;
  shortcutNote: string;
  shortcutDescs: {
    s1: string; s2: string; s3: string; s4: string; s5: string; s6: string;
    space: string; backspace: string;
  };
  // AudioPlayer
  openAudio: string;
  zoom: string;
  noAudio: string;
  tooltipSkipBack5: string;
  tooltipSkipBack1: string;
  tooltipPlayPause: string;
  tooltipSkipFwd1: string;
  tooltipSkipFwd5: string;
  tooltipStop: string;
  tooltipLoop: string;
  tooltipSpeedDown: string;
  tooltipSpeedUp: string;
  // LrcEditor
  lyricsEditor: string;
  addLine: string;
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
  settingsCheckNow: string;
  settingsChecking: string;
  settingsUpToDate: string;
  settingsUiScale: string;
  settingsUiScaleReset: string;
  // Model download
  modelCategoryDemucs: string;
  modelCategoryWhisper: string;
  modelCategoryWav2vec2: string;
  modelInstall: string;
  modelInstalling: string;
  modelInstalled: string;
  modelDelete: string;
  modelCancel: string;
  modelStoragePath: string;
  modelMb: string;
  modelErrorPrefix: string;
}

const ko: Translations = {
  newFileTitle: "새 LRC 파일",
  newFileBtn: "새로 만들기",
  openLrc: "LRC 열기",
  save: "저장",
  saveAs: "다른 이름으로 저장",
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
  },
  openAudio: "오디오 열기",
  zoom: "줌",
  noAudio: "오디오 파일을 열어 파형을 표시합니다",
  tooltipSkipBack5: "[1] −5초",
  tooltipSkipBack1: "[2] −1초",
  tooltipPlayPause: "[3] 재생/일시정지",
  tooltipSkipFwd1: "[4] +1초",
  tooltipSkipFwd5: "[5] +5초",
  tooltipStop: "[6] 처음으로",
  tooltipLoop: "반복재생",
  tooltipSpeedDown: "배속 감소",
  tooltipSpeedUp: "배속 증가",
  lyricsEditor: "가사 편집",
  addLine: "+ 줄 추가",
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
  settingsCheckNow: "지금 확인",
  settingsChecking: "확인 중...",
  settingsUpToDate: "최신 버전입니다.",
  settingsUiScale: "UI 크기",
  settingsUiScaleReset: "초기화",
  modelCategoryDemucs: "음성 분리",
  modelCategoryWhisper: "음성 인식",
  modelCategoryWav2vec2: "타임스탬프 정렬",
  modelInstall: "설치",
  modelInstalling: "설치 중...",
  modelInstalled: "설치됨",
  modelDelete: "삭제",
  modelCancel: "취소",
  modelStoragePath: "저장 위치",
  modelMb: "MB",
  modelErrorPrefix: "오류",
};

const en: Translations = {
  newFileTitle: "New LRC File",
  newFileBtn: "New",
  openLrc: "Open LRC",
  save: "Save",
  saveAs: "Save As",
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
  },
  openAudio: "Open Audio",
  zoom: "Zoom",
  noAudio: "Open an audio file to display the waveform",
  tooltipSkipBack5: "[1] −5s",
  tooltipSkipBack1: "[2] −1s",
  tooltipPlayPause: "[3] Play/Pause",
  tooltipSkipFwd1: "[4] +1s",
  tooltipSkipFwd5: "[5] +5s",
  tooltipStop: "[6] Reset",
  tooltipLoop: "Loop",
  tooltipSpeedDown: "Slower",
  tooltipSpeedUp: "Faster",
  lyricsEditor: "Lyrics Editor",
  addLine: "+ Add Line",
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
  settingsCheckNow: "Check Now",
  settingsChecking: "Checking...",
  settingsUpToDate: "You're up to date.",
  settingsUiScale: "UI Scale",
  settingsUiScaleReset: "Reset",
  modelCategoryDemucs: "Source Separation",
  modelCategoryWhisper: "Speech Recognition",
  modelCategoryWav2vec2: "Timestamp Alignment",
  modelInstall: "Install",
  modelInstalling: "Installing...",
  modelInstalled: "Installed",
  modelDelete: "Delete",
  modelCancel: "Cancel",
  modelStoragePath: "Storage path",
  modelMb: "MB",
  modelErrorPrefix: "Error",
};

const ja: Translations = {
  newFileTitle: "新規LRCファイル",
  newFileBtn: "新規作成",
  openLrc: "LRCを開く",
  save: "保存",
  saveAs: "名前を付けて保存",
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
  },
  openAudio: "音声を開く",
  zoom: "ズーム",
  noAudio: "音声ファイルを開いて波形を表示します",
  tooltipSkipBack5: "[1] −5秒",
  tooltipSkipBack1: "[2] −1秒",
  tooltipPlayPause: "[3] 再生/一時停止",
  tooltipSkipFwd1: "[4] +1秒",
  tooltipSkipFwd5: "[5] +5秒",
  tooltipStop: "[6] 最初へ",
  tooltipLoop: "リピート",
  tooltipSpeedDown: "遅くする",
  tooltipSpeedUp: "速くする",
  lyricsEditor: "歌詞編集",
  addLine: "+ 行を追加",
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
  settingsCheckNow: "今すぐ確認",
  settingsChecking: "確認中...",
  settingsUpToDate: "最新バージョンです。",
  settingsUiScale: "UIサイズ",
  settingsUiScaleReset: "リセット",
  modelCategoryDemucs: "音源分離",
  modelCategoryWhisper: "音声認識",
  modelCategoryWav2vec2: "タイムスタンプ整列",
  modelInstall: "インストール",
  modelInstalling: "インストール中...",
  modelInstalled: "インストール済み",
  modelDelete: "削除",
  modelCancel: "キャンセル",
  modelStoragePath: "保存場所",
  modelMb: "MB",
  modelErrorPrefix: "エラー",
};

export const translations: Record<Lang, Translations> = { ko, en, ja };
