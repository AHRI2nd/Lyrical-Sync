import { useEffect, useRef, useState, useCallback } from "react";
import { AudioPlayer } from "./components/AudioPlayer/AudioPlayer";
import { MetaEditor } from "./components/MetaEditor/MetaEditor";
import { LrcEditor } from "./components/LrcEditor/LrcEditor";
import { PreviewModal } from "./components/Preview/PreviewModal";
import { SettingsModal } from "./components/Settings/SettingsModal";
import { ModeSelectButton } from "./components/Service/ModeSelectButton";
import { SpotifySearchModal } from "./components/Service/SpotifySearchModal";
import { useLrcStore } from "./stores/useLrcStore";
import { useI18nStore } from "./stores/useI18nStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { useServiceStore } from "./stores/useServiceStore";
import { audioControls } from "./utils/audioControls";
import { serviceControls } from "./utils/serviceControls";
import { initSpotifyPlayer } from "./utils/spotifyPlayer";
import { type Lang } from "./i18n/translations";
import { checkForUpdate, RELEASES_URL, GITHUB_REPO } from "./utils/updateCheck";
import { openUrl } from "@tauri-apps/plugin-opener";
import { listen } from "@tauri-apps/api/event";

function useGlobalKeys() {
  const { stampAndAdvance, goToPreviousLine, undo, redo } = useLrcStore();
  const isLoggedInForKeys = useServiceStore((s) => s.isLoggedIn);
  const spotifyModeForKeys = useSettingsStore((s) => s.spotifyMode);
  const isServiceMode = isLoggedInForKeys && spotifyModeForKeys;

  useEffect(() => {
    const controls = isServiceMode ? serviceControls : audioControls;
    const handler = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.code === "KeyZ") {
        if (inInput) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }

      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const digitMap: Record<string, number> = {
        Digit1: 1, Numpad1: 1,
        Digit2: 2, Numpad2: 2,
        Digit3: 3, Numpad3: 3,
        Digit4: 4, Numpad4: 4,
        Digit5: 5, Numpad5: 5,
        Digit6: 6, Numpad6: 6,
      };
      const digit = digitMap[e.code];

      if (digit && !inInput) {
        e.preventDefault();
        if (digit === 1) controls.skip(-5);
        else if (digit === 2) controls.skip(-1);
        else if (digit === 3) controls.togglePlay();
        else if (digit === 4) controls.skip(1);
        else if (digit === 5) controls.skip(5);
        else if (digit === 6) controls.stopAndReset();
        return;
      }

      if (e.code === "Space" && !inInput) {
        e.preventDefault();
        stampAndAdvance();
        return;
      }

      if (e.code === "Backspace" && !inInput) {
        e.preventDefault();
        goToPreviousLine();
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [stampAndAdvance, goToPreviousLine, undo, redo, isServiceMode]);
}

function useAutoUpdateCheck(onUpdateAvailable: (version: string) => void, enabled: boolean) {
  const cbRef = useRef(onUpdateAvailable);
  cbRef.current = onUpdateAvailable;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const version = await checkForUpdate();
        if (version && !cancelled) cbRef.current(version);
      } catch {
        // silently ignore network errors
      }
    })();
    return () => { cancelled = true; };
  }, [enabled]);
}

const LANG_LABELS: { lang: Lang; label: string }[] = [
  { lang: "ko", label: "한국어" },
  { lang: "en", label: "English" },
  { lang: "ja", label: "日本語" },
];

function App() {
  useGlobalKeys();

  const [showHelp, setShowHelp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsInitialTab, setSettingsInitialTab] = useState<"general" | "models" | "spotify" | "youtube">("general");
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [showFormatChooser, setShowFormatChooser] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const [showSpotifySearch, setShowSpotifySearch] = useState(false);
  const { lrcPath, isDirty, openLrc, saveLrc, saveLrcAs, newLrc, undo, redo, _history, _future } = useLrcStore();
  const { t } = useI18nStore();
  const { autoCheckUpdate, uiScale } = useSettingsStore();
  const { isLoggedIn, handleCallback, tryRestoreSession } = useServiceStore();

  useAutoUpdateCheck((v) => setUpdateVersion(v), autoCheckUpdate);

  // Restore saved Spotify session on mount
  useEffect(() => {
    tryRestoreSession();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen for OAuth callback from local HTTP listener
  useEffect(() => {
    let cancelled = false;
    let unlistenFn: (() => void) | null = null;
    listen<string>("spotify-callback", async (e) => {
      try {
        await handleCallback(e.payload);
        initSpotifyPlayer();
      } catch {
        // OAuth failed — user can retry from settings
      }
    }).then((fn) => {
      if (cancelled) fn();
      else unlistenFn = fn;
    });
    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // When session is restored on startup, init polling after refreshing token
  useEffect(() => {
    if (!isLoggedIn) return;
    useServiceStore.getState().ensureToken()
      .then(() => initSpotifyPlayer())
      .catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoggedIn]);

  // Clear any zoom set by a previous version of the app
  useEffect(() => { document.documentElement.style.zoom = ""; }, []);

  const handleNewLrc = () => {
    if (isDirty) {
      setShowNewConfirm(true);
    } else {
      newLrc();
    }
  };

  const handleSave = () => {
    if (lrcPath) saveLrc();
    else setShowFormatChooser(true);
  };

  const title = lrcPath
    ? lrcPath.split(/[\\/]/).pop()
    : t.newFileTitle;

  return (
    <div
      className="flex flex-col bg-zinc-950 text-white overflow-hidden"
      style={{
        transform: `scale(${uiScale})`,
        transformOrigin: "top left",
        width: `${(100 / uiScale).toFixed(4)}vw`,
        height: `${(100 / uiScale).toFixed(4)}vh`,
      }}
    >
      <header className="flex items-center gap-2 px-4 py-2 bg-zinc-900 border-b border-zinc-800 shrink-0">
        <span className="font-semibold text-indigo-400 mr-2 shrink-0">Lyrical Sync</span>
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-zinc-400 text-sm truncate">
            {title}
            {isDirty && <span className="text-rose-400 ml-1">●</span>}
          </span>
          <div className="flex gap-1 shrink-0">
            <IconBtn onClick={undo} disabled={_history.length === 0} title={t.undo}><UndoIcon /></IconBtn>
            <IconBtn onClick={redo} disabled={_future.length === 0} title={t.redo}><RedoIcon /></IconBtn>
          </div>
        </div>
        <div className="flex gap-1.5 shrink-0">
          <ModeSelectButton />
          <IconBtn onClick={handleNewLrc} title={t.newFileBtn}><NewFileIcon /></IconBtn>
          <IconBtn onClick={openLrc} title={t.openLrc}><OpenFolderIcon /></IconBtn>
          <LangDropdown />
          <IconBtn onClick={handleSave} accent title={t.save} tooltipAlign="right"><SaveIcon /></IconBtn>
          <IconBtn onClick={() => setShowFormatChooser(true)} title={t.saveAs} tooltipAlign="right"><SaveAsIcon /></IconBtn>
        </div>
      </header>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showPreview && <PreviewModal onClose={() => setShowPreview(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onUpdateFound={(v) => { setShowSettings(false); setUpdateVersion(v); }}
          initialTab={settingsInitialTab}
        />
      )}
      {updateVersion && (
        <ConfirmModal
          title={t.updateTitle}
          message={`${t.updateNewVersion} ${updateVersion} ${t.updatePrompt}`}
          okLabel={t.updateYes}
          cancelLabel={t.updateLater}
          onOk={() => { setUpdateVersion(null); openUrl(RELEASES_URL); }}
          onCancel={() => setUpdateVersion(null)}
        />
      )}
      {showNewConfirm && (
        <ConfirmModal
          title={t.confirmNewTitle}
          message={t.confirmNewMessage}
          okLabel={t.confirmNewOk}
          cancelLabel={t.confirmNewCancel}
          onOk={() => { setShowNewConfirm(false); newLrc(); }}
          onCancel={() => setShowNewConfirm(false)}
        />
      )}
      {showFormatChooser && (
        <SaveFormatModal
          onSelect={(format) => { setShowFormatChooser(false); saveLrcAs(format); }}
          onCancel={() => setShowFormatChooser(false)}
        />
      )}
      {showSpotifySearch && (
        <SpotifySearchModal onClose={() => setShowSpotifySearch(false)} />
      )}

      <div className="flex flex-1 min-h-0 gap-0">
        <div className="flex flex-col gap-3 p-3 w-80 shrink-0 overflow-y-auto border-r border-zinc-800">
          <AudioPlayer
            onSpotifySearch={() => setShowSpotifySearch(true)}
            onSpotifyNoClientId={() => { setSettingsInitialTab("spotify"); setShowSettings(true); }}
          />
          <MetaEditor />
        </div>
        <div className="flex flex-col flex-1 p-3 min-h-0">
          <LrcEditor onPreview={() => setShowPreview(true)} />
        </div>
      </div>

      <div className="fixed bottom-4 left-4 flex gap-2 z-10">
        <button
          onClick={() => { setSettingsInitialTab("general"); setShowSettings(true); }}
          title={t.settingsTitle}
          className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white transition-colors flex items-center justify-center shadow-lg"
        >
          <GearIcon />
        </button>
        <button
          onClick={() => setShowHelp(true)}
          title={t.shortcutsTitle}
          className="w-8 h-8 rounded-full bg-zinc-700 hover:bg-zinc-600 text-zinc-300 hover:text-white text-sm font-bold transition-colors flex items-center justify-center shadow-lg"
        >
          ?
        </button>
      </div>
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const { t, lang } = useI18nStore();

  const guideFileSuffix = lang === "ko" ? "ko" : lang === "ja" ? "ja" : "en";
  const aiGuideUrl = `https://github.com/${GITHUB_REPO}/blob/main/etc/AI_Installation_guide.${guideFileSuffix}.md`;
  const spotifyGuideUrl = `https://github.com/${GITHUB_REPO}/blob/main/etc/Spotify_Connection_guide.${guideFileSuffix}.md`;
  const youtubeGuideUrl = `https://github.com/${GITHUB_REPO}/blob/main/etc/YouTube_guide.${guideFileSuffix}.md`;
  const [tab, setTab] = useState<"shortcuts" | "ai" | "spotify" | "youtube">("shortcuts");

  const shortcuts = [
    { key: "1", desc: t.shortcutDescs.s1 },
    { key: "2", desc: t.shortcutDescs.s2 },
    { key: "3", desc: t.shortcutDescs.s3 },
    { key: "4", desc: t.shortcutDescs.s4 },
    { key: "5", desc: t.shortcutDescs.s5 },
    { key: "6", desc: t.shortcutDescs.s6 },
    { key: "Space", desc: t.shortcutDescs.space },
    { key: "Backspace", desc: t.shortcutDescs.backspace },
  ];

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const tabs = [
    { id: "shortcuts" as const, label: t.helpTabShortcuts },
    { id: "ai" as const, label: t.helpTabAi },
    { id: "spotify" as const, label: t.helpTabSpotify },
    { id: "youtube" as const, label: t.helpTabYouTube },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{t.helpTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800">
          {tabs.map(({ id, label }) => (
            <button
              key={id}
              onClick={() => setTab(id)}
              className={[
                "flex-1 py-2 text-xs font-medium transition-colors",
                tab === id
                  ? "text-indigo-400 border-b-2 border-indigo-500"
                  : "text-zinc-500 hover:text-zinc-300",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Content */}
        <div className="p-4 max-h-80 overflow-y-auto">
          {tab === "shortcuts" && (
            <div className="flex flex-col gap-1.5">
              {shortcuts.map(({ key, desc }) => (
                <div key={key} className="flex items-center gap-3">
                  <kbd className="shrink-0 min-w-[2.5rem] text-center px-2 py-0.5 rounded bg-zinc-800 border border-zinc-600 text-xs font-mono text-zinc-200">
                    {key}
                  </kbd>
                  <span className="text-sm text-zinc-300">{desc}</span>
                </div>
              ))}
              <p className="mt-3 text-xs text-zinc-500">{t.shortcutNote}</p>
            </div>
          )}

          {tab === "ai" && (
            <div className="flex flex-col gap-4">
              <button
                onClick={() => openUrl(aiGuideUrl)}
                className="self-start text-xs text-indigo-400 hover:text-indigo-300 transition-colors underline underline-offset-2"
              >
                {t.helpViewGuide}
              </button>
              {t.helpAiSteps.map(({ title, desc }, i) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-indigo-600 text-white text-xs flex items-center justify-center font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-zinc-100 mb-0.5">{title}</p>
                    <p className="text-xs text-zinc-400 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "spotify" && (
            <div className="flex flex-col gap-4">
              <button
                onClick={() => openUrl(spotifyGuideUrl)}
                className="self-start text-xs text-green-500 hover:text-green-400 transition-colors underline underline-offset-2"
              >
                {t.helpViewGuide}
              </button>
              {t.helpSpotifySteps.map(({ title, desc }, i) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-green-700 text-white text-xs flex items-center justify-center font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-zinc-100 mb-0.5">{title}</p>
                    <p className="text-xs text-zinc-400 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {tab === "youtube" && (
            <div className="flex flex-col gap-4">
              <button
                onClick={() => openUrl(youtubeGuideUrl)}
                className="self-start text-xs text-red-400 hover:text-red-300 transition-colors underline underline-offset-2"
              >
                {t.helpViewGuide}
              </button>
              {t.helpYoutubeSteps.map(({ title, desc }, i) => (
                <div key={i} className="flex gap-3">
                  <span className="shrink-0 w-5 h-5 rounded-full bg-red-700 text-white text-xs flex items-center justify-center font-bold mt-0.5">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm font-medium text-zinc-100 mb-0.5">{title}</p>
                    <p className="text-xs text-zinc-400 leading-relaxed">{desc}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ConfirmModal({
  title, message, okLabel, cancelLabel, onOk, onCancel, leftLabel, onLeft, okGreen,
}: {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  onOk: () => void;
  onCancel: () => void;
  leftLabel?: string;
  onLeft?: () => void;
  okGreen?: boolean;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{title}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-zinc-300 whitespace-pre-line">{message}</p>
        </div>
        <div className="flex items-center gap-2 px-5 pb-4">
          {leftLabel && onLeft && (
            <button
              onClick={onLeft}
              className="px-4 py-1.5 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors whitespace-nowrap"
            >
              {leftLabel}
            </button>
          )}
          <div className="flex-1" />
          {cancelLabel && (
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors whitespace-nowrap"
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={onOk}
            className={[
              "px-4 py-1.5 text-sm rounded-lg text-white transition-colors whitespace-nowrap",
              okGreen ? "bg-green-600 hover:bg-green-500" : "bg-rose-600 hover:bg-rose-500",
            ].join(" ")}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}


function SaveFormatModal({
  onSelect, onCancel,
}: {
  onSelect: (format: "lrc" | "srt") => void;
  onCancel: () => void;
}) {
  const { t } = useI18nStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{t.saveFormatTitle}</span>
        </div>
        <div className="flex flex-col gap-2 px-5 py-4">
          <button
            onClick={() => onSelect("lrc")}
            className="flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-colors text-left"
          >
            <span className="text-sm font-semibold text-white">LRC <span className="text-zinc-500 font-normal">(.lrc)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatLrcDesc}</span>
          </button>
          <button
            onClick={() => onSelect("srt")}
            className="flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-colors text-left"
          >
            <span className="text-sm font-semibold text-white">SubRip <span className="text-zinc-500 font-normal">(.srt)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatSrtDesc}</span>
          </button>
        </div>
        <div className="flex justify-end px-5 pb-4">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors"
          >
            {t.rawEditorCancel}
          </button>
        </div>
      </div>
    </div>
  );
}

function IconBtn({
  children, onClick, disabled, accent, title, tooltipAlign = "center",
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  accent?: boolean;
  title: string;
  tooltipAlign?: "center" | "right";
}) {
  const tooltipPos = tooltipAlign === "right"
    ? "right-0"
    : "left-1/2 -translate-x-1/2";
  return (
    <div className="relative group/ibtn">
      <button
        onClick={onClick}
        disabled={disabled}
        className={`w-8 h-8 flex items-center justify-center rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
          accent
            ? "bg-indigo-600 hover:bg-indigo-500 text-white"
            : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
        }`}
      >
        {children}
      </button>
      <div className={`pointer-events-none absolute top-full ${tooltipPos} mt-1.5 hidden group-hover/ibtn:block z-30`}>
        <div className="bg-zinc-800 border border-zinc-600 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
          {title}
        </div>
      </div>
    </div>
  );
}

function NewFileIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="11" x2="12" y2="17" />
      <line x1="9" y1="14" x2="15" y2="14" />
    </svg>
  );
}

function OpenFolderIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function SaveIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
    </svg>
  );
}

function SaveAsIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
      <polyline points="17 21 17 13 7 13 7 21" />
      <polyline points="7 3 7 8 15 8" />
      <line x1="20" y1="8" x2="20" y2="14" />
      <line x1="17" y1="11" x2="23" y2="11" />
    </svg>
  );
}

function UndoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 14 4 9 9 4" />
      <path d="M20 20v-7a4 4 0 0 0-4-4H4" />
    </svg>
  );
}

function RedoIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="15 14 20 9 15 4" />
      <path d="M4 20v-7a4 4 0 0 1 4-4h12" />
    </svg>
  );
}

function LangDropdown() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { lang, setLang } = useI18nStore();

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSelect = useCallback((l: Lang) => { setLang(l); setOpen(false); }, [setLang]);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-8 h-8 flex items-center justify-center rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors"
      >
        <GlobeIcon />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden py-1 min-w-[110px]">
          {LANG_LABELS.map(({ lang: l, label }) => (
            <button
              key={l}
              onClick={() => handleSelect(l)}
              className={[
                "w-full flex items-center justify-between px-3 py-2 text-xs transition-colors",
                lang === l
                  ? "text-white bg-zinc-700"
                  : "text-zinc-300 hover:bg-zinc-700 hover:text-white",
              ].join(" ")}
            >
              <span>{label}</span>
              {lang === l && <span className="text-indigo-400">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function GlobeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default App;
