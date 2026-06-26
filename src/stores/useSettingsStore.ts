import { create } from "zustand";
import { persist } from "zustand/middleware";
import { type KeyAction, DEFAULT_KEYBINDINGS } from "../utils/keybindings";

interface SettingsState {
  autoCheckUpdate: boolean;
  /** 저장 경로가 지정된 파일에 대해 변경 시 자동 저장 */
  autoSave: boolean;
  uiScale: number;
  /** 커스텀 모델 저장 경로. "" = 앱 기본 경로 사용 */
  modelsDir: string;
  /** 빈 줄 타임스탬프 = 앞 가사 end + blankLineOffset 초 */
  blankLineOffset: number;
  /** 글자/단어 동기화가 있어 Enhanced LRC로 저장될 때 알림 팝업 표시. false면 묻지 않고 저장 */
  showElrcSaveNotice: boolean;
  /** 가사 편집 글꼴 크기 배율 (0.8 ~ 1.5, 기본값: 1.0) */
  lyricsFontScale: number;
  /** 글자 동기화 모드에서 글자 아래 시간 마커 표시 */
  showGlyphTimeMarkers: boolean;
  /** AI 정렬 시 Demucs 보컬 분리 사용(설치돼 있을 때). false면 원본 오디오로 정렬 */
  useVocalSeparation: boolean;
  /** AI 정렬 시 보컬 활동 감지(VAD) 사용 — 빈 줄 정밀 배치 + 신뢰도 보정. 보컬 분리 필요 */
  useVad: boolean;
  /** 전역 단축키 바인딩(action → KeyboardEvent.code) */
  keybindings: Record<KeyAction, string>;
  /** Spotify Developer App client_id (사용자 직접 입력) */
  spotifyClientId: string;
  /** Spotify 모드 활성화 여부 (로그인 상태와 독립적으로 UI 전환) */
  spotifyMode: boolean;
  /** YouTube 모드 활성화 여부 */
  youtubeMode: boolean;
  /** yt-dlp 오디오 품질 */
  ytdlpAudioQuality: "best" | "192" | "128";
  /** yt-dlp 쿠키 파일 경로 (로그인 필요 콘텐츠용) */
  ytdlpCookiesFile: string;
  /** yt-dlp 프록시 설정 */
  ytdlpProxy: string;
  /** YouTube 다운로드 면책 고지에 1회 동의했는지 */
  youtubeDisclaimerAccepted: boolean;
  setAutoCheckUpdate: (v: boolean) => void;
  setAutoSave: (v: boolean) => void;
  setUiScale: (v: number) => void;
  setModelsDir: (v: string) => void;
  setBlankLineOffset: (v: number) => void;
  setShowElrcSaveNotice: (v: boolean) => void;
  setLyricsFontScale: (v: number) => void;
  setShowGlyphTimeMarkers: (v: boolean) => void;
  setUseVocalSeparation: (v: boolean) => void;
  setUseVad: (v: boolean) => void;
  setKeybinding: (action: KeyAction, code: string) => void;
  resetKeybindings: () => void;
  setSpotifyClientId: (v: string) => void;
  setSpotifyMode: (v: boolean) => void;
  setYoutubeMode: (v: boolean) => void;
  setYtdlpAudioQuality: (v: "best" | "192" | "128") => void;
  setYtdlpCookiesFile: (v: string) => void;
  setYtdlpProxy: (v: string) => void;
  setYoutubeDisclaimerAccepted: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      autoCheckUpdate: true,
      autoSave: true,
      uiScale: 1.0,
      modelsDir: "",
      blankLineOffset: 1.0,
      showElrcSaveNotice: true,
      lyricsFontScale: 1.0,
      showGlyphTimeMarkers: true,
      useVocalSeparation: true,
      useVad: true,
      keybindings: { ...DEFAULT_KEYBINDINGS },
      spotifyClientId: "",
      spotifyMode: false,
      youtubeMode: false,
      ytdlpAudioQuality: "best",
      ytdlpCookiesFile: "",
      ytdlpProxy: "",
      youtubeDisclaimerAccepted: false,
      setAutoCheckUpdate: (v) => set({ autoCheckUpdate: v }),
      setAutoSave: (v) => set({ autoSave: v }),
      setUiScale: (v) => set({ uiScale: v }),
      setModelsDir: (v) => set({ modelsDir: v }),
      setBlankLineOffset: (v) => set({ blankLineOffset: v }),
      setShowElrcSaveNotice: (v) => set({ showElrcSaveNotice: v }),
      setLyricsFontScale: (v) => set({ lyricsFontScale: v }),
      setShowGlyphTimeMarkers: (v) => set({ showGlyphTimeMarkers: v }),
      setUseVocalSeparation: (v) => set({ useVocalSeparation: v }),
      setUseVad: (v) => set({ useVad: v }),
      setKeybinding: (action, code) =>
        set((s) => ({ keybindings: { ...s.keybindings, [action]: code } })),
      resetKeybindings: () => set({ keybindings: { ...DEFAULT_KEYBINDINGS } }),
      setSpotifyClientId: (v) => set({ spotifyClientId: v }),
      setSpotifyMode: (v) => set({ spotifyMode: v }),
      setYoutubeMode: (v) => set({ youtubeMode: v }),
      setYtdlpAudioQuality: (v) => set({ ytdlpAudioQuality: v }),
      setYtdlpCookiesFile: (v) => set({ ytdlpCookiesFile: v }),
      setYtdlpProxy: (v) => set({ ytdlpProxy: v }),
      setYoutubeDisclaimerAccepted: (v) => set({ youtubeDisclaimerAccepted: v }),
    }),
    { name: "lyrical-sync-settings" }
  )
);
