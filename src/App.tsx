import { useEffect, useRef, useState } from "react";
import { AudioPlayer } from "./components/AudioPlayer/AudioPlayer";
import { MetaEditor } from "./components/MetaEditor/MetaEditor";
import { LrcEditor } from "./components/LrcEditor/LrcEditor";
import { PreviewModal } from "./components/Preview/PreviewModal";
import { SettingsModal } from "./components/Settings/SettingsModal";
import { useLrcStore } from "./stores/useLrcStore";
import { useI18nStore } from "./stores/useI18nStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { audioControls } from "./utils/audioControls";
import { type Lang } from "./i18n/translations";
import { checkForUpdate, RELEASES_URL } from "./utils/updateCheck";
import { openUrl } from "@tauri-apps/plugin-opener";

function useGlobalKeys() {
  const { stampAndAdvance, goToPreviousLine } = useLrcStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

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
        if (digit === 1) audioControls.skip(-5);
        else if (digit === 2) audioControls.skip(-1);
        else if (digit === 3) audioControls.togglePlay();
        else if (digit === 4) audioControls.skip(1);
        else if (digit === 5) audioControls.skip(5);
        else if (digit === 6) audioControls.stopAndReset();
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
  }, [stampAndAdvance, goToPreviousLine]);
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
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [updateVersion, setUpdateVersion] = useState<string | null>(null);
  const { lrcPath, isDirty, openLrc, saveLrc, saveLrcAs, newLrc } = useLrcStore();
  const { lang, setLang, t } = useI18nStore();
  const { autoCheckUpdate, uiScale } = useSettingsStore();

  useAutoUpdateCheck((v) => setUpdateVersion(v), autoCheckUpdate);

  // Clear any zoom set by a previous version of the app
  useEffect(() => { document.documentElement.style.zoom = ""; }, []);

  const handleNewLrc = () => {
    if (isDirty) {
      setShowNewConfirm(true);
    } else {
      newLrc();
    }
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
        <span className="font-semibold text-indigo-400 mr-2">Lyrical Sync</span>
        <span className="text-zinc-400 text-sm flex-1 truncate">
          {title}
          {isDirty && <span className="text-rose-400 ml-1">●</span>}
        </span>
        <div className="flex items-center gap-1 mr-2 shrink-0">
          {LANG_LABELS.map(({ lang: l, label }) => (
            <button
              key={l}
              onClick={() => setLang(l)}
              className={[
                "w-16 py-1 text-xs rounded-lg transition-colors text-center",
                lang === l
                  ? "bg-indigo-600 text-white"
                  : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300",
              ].join(" ")}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="flex gap-2 shrink-0">
          <ToolBtn onClick={handleNewLrc} className="w-24">{t.newFileBtn}</ToolBtn>
          <ToolBtn onClick={openLrc} className="w-24">{t.openLrc}</ToolBtn>
          <ToolBtn onClick={saveLrc} accent className="w-16">{t.save}</ToolBtn>
          <ToolBtn onClick={saveLrcAs} className="w-40">{t.saveAs}</ToolBtn>
        </div>
      </header>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showPreview && <PreviewModal onClose={() => setShowPreview(false)} />}
      {showSettings && (
        <SettingsModal
          onClose={() => setShowSettings(false)}
          onUpdateFound={(v) => { setShowSettings(false); setUpdateVersion(v); }}
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

      <div className="flex flex-1 min-h-0 gap-0">
        <div className="flex flex-col gap-3 p-3 w-80 shrink-0 overflow-y-auto border-r border-zinc-800">
          <AudioPlayer />
          <MetaEditor />
        </div>
        <div className="flex flex-col flex-1 p-3 min-h-0">
          <LrcEditor onPreview={() => setShowPreview(true)} />
        </div>
      </div>

      <div className="fixed bottom-4 left-4 flex gap-2 z-10">
        <button
          onClick={() => setShowSettings(true)}
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
  const { t } = useI18nStore();

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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{t.shortcutsTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>
        <div className="p-4 flex flex-col gap-1.5">
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
      </div>
    </div>
  );
}

function ConfirmModal({
  title, message, okLabel, cancelLabel, onOk, onCancel,
}: {
  title: string;
  message: string;
  okLabel: string;
  cancelLabel: string;
  onOk: () => void;
  onCancel: () => void;
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
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{title}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-zinc-300">{message}</p>
        </div>
        <div className="flex justify-end gap-2 px-5 pb-4">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onOk}
            className="px-4 py-1.5 text-sm rounded-lg bg-rose-600 hover:bg-rose-500 text-white transition-colors"
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToolBtn({
  children, onClick, accent, className = "",
}: {
  children: React.ReactNode;
  onClick: () => void;
  accent?: boolean;
  className?: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-sm rounded-lg transition-colors text-center truncate ${
        accent
          ? "bg-indigo-600 hover:bg-indigo-500 text-white"
          : "bg-zinc-700 hover:bg-zinc-600 text-zinc-100"
      } ${className}`}
    >
      {children}
    </button>
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
