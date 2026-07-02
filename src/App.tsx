import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { AudioPlayer } from "./components/AudioPlayer/AudioPlayer";
import { MetaEditor } from "./components/MetaEditor/MetaEditor";
import { LrcEditor } from "./components/LrcEditor/LrcEditor";
// 모달은 시작 시 불필요 → 지연 로드(초기 번들·파싱 절감)
const PreviewModal = lazy(() => import("./components/Preview/PreviewModal").then((m) => ({ default: m.PreviewModal })));
const SettingsModal = lazy(() => import("./components/Settings/SettingsModal").then((m) => ({ default: m.SettingsModal })));
import { useLrcStore } from "./stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "./stores/useI18nStore";
import { useSettingsStore } from "./stores/useSettingsStore";
import { audioControls } from "./utils/audioControls";
import { anyModalOpen } from "./utils/modalGuard";
import { safeUnlisten } from "./utils/safeUnlisten";
import { matchAction, normalizeKeybindings, keyLabel, PLAYBACK_ACTIONS } from "./utils/keybindings";
import { toast } from "./stores/useToastStore";
import { ToastContainer } from "./components/Toast/ToastContainer";
import { type RecoverySnapshot, loadRecoverySnapshot, saveRecoverySnapshot, clearRecoverySnapshot } from "./utils/recovery";
import { useMacMenu } from "./hooks/useMacMenu";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { invoke } from "@tauri-apps/api/core";

const AUDIO_EXTS = ["mp3", "flac", "wav", "ogg", "m4a", "aac", "opus", "aiff", "aif"];
const LYRICS_EXTS = ["lrc", "srt"];
const fileExt = (p: string) => p.split(".").pop()?.toLowerCase() ?? "";

function useGlobalKeys() {
  // 액션은 안정 참조 → 셀렉터로 좁혀 currentTime 등 매 프레임 갱신에 리렌더되지 않게
  const { stampAndAdvance, goToPreviousLine, undo, redo } = useLrcStore(
    useShallow((s) => ({
      stampAndAdvance: s.stampAndAdvance,
      goToPreviousLine: s.goToPreviousLine,
      undo: s.undo,
      redo: s.redo,
    }))
  );
  const syncMode = useLrcStore((s) => s.syncMode);
  const keybindings = useSettingsStore((s) => s.keybindings);

  useEffect(() => {
    const controls = audioControls;
    const kb = normalizeKeybindings(keybindings);
    const handler = (e: KeyboardEvent) => {
      const inInput =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement;

      // Cmd/Ctrl+Z 실행취소/다시실행 (재설정 불가, 예약)
      const isMod = e.ctrlKey || e.metaKey;
      if (isMod && e.code === "KeyZ") {
        if (inInput || anyModalOpen()) return;
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      // 수식자 조합은 사용자 단축키 대상 아님
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      const action = matchAction(e.code, kb);
      if (!action || inInput) return;

      // 재생 트랜스포트: 줄/글자 모드 공통(모달 열려도 미디어 제어 허용)
      if (PLAYBACK_ACTIONS.includes(action)) {
        e.preventDefault();
        if (action === "skipBack5") controls.skip(-5);
        else if (action === "skipBack1") controls.skip(-1);
        else if (action === "playPause") controls.togglePlay();
        else if (action === "skipFwd1") controls.skip(1);
        else if (action === "skipFwd5") controls.skip(5);
        else if (action === "stop") controls.stopAndReset();
        return;
      }

      // stamp/prevLine: 글자 모드에선 CharSyncView가 처리, 모달 뒤에선 차단
      if (action === "stamp" || action === "prevLine") {
        if (syncMode === "char" || anyModalOpen()) return;
        e.preventDefault();
        if (action === "stamp") stampAndAdvance();
        else goToPreviousLine();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [stampAndAdvance, goToPreviousLine, undo, redo, syncMode, keybindings]);
}

// 저장 경로(lrcPath)가 지정된 파일에 한해, 변경 후 일정 시간 멈추면 자동 저장.
// 새 문서(lrcPath 없음)는 저장 위치가 없으므로 자동 저장하지 않음.
function useAutoSave() {
  const isDirty = useLrcStore((s) => s.isDirty);
  const lrcPath = useLrcStore((s) => s.lrcPath);
  const doc = useLrcStore((s) => s.doc);
  const autoSave = useSettingsStore((s) => s.autoSave);

  useEffect(() => {
    if (!autoSave || !lrcPath || !isDirty) return;
    const id = setTimeout(() => {
      // 자동저장: 성공은 조용히, 실패만 토스트로 알림
      useLrcStore.getState().saveLrc().catch(() => {
        toast.error(useI18nStore.getState().t.toast.saveFailed);
      });
    }, 1500);
    return () => clearTimeout(id);
    // doc 변경마다 타이머 리셋 → 입력이 멈춘 뒤에만 저장(디바운스)
  }, [autoSave, lrcPath, isDirty, doc]);

  // 미저장 작업 자동 복구 스냅샷: dirty면 디바운스로 저장, 저장되면(dirty 해제) 제거.
  // 저장 경로가 없어도 보호되므로 autoSave와 독립적으로 동작.
  useEffect(() => {
    if (!isDirty) { clearRecoverySnapshot(); return; }
    const id = setTimeout(() => {
      const st = useLrcStore.getState();
      saveRecoverySnapshot(st.doc, st.lrcPath, st.audioPath, st.lrcBookmark, st.audioBookmark);
    }, 2000);
    return () => clearTimeout(id);
  }, [isDirty, doc]);
}

function App() {
  useGlobalKeys();
  useAutoSave();

  // 시작 시(이펙트 실행 전) 스냅샷을 캡처 — dirty 해제 이펙트가 지우기 전에 확보
  const [recovery, setRecovery] = useState<RecoverySnapshot | null>(() => {
    const snap = loadRecoverySnapshot();
    return snap && snap.doc.lines.length > 0 ? snap : null;
  });
  const [showHelp, setShowHelp] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showNewConfirm, setShowNewConfirm] = useState(false);
  const [showFormatChooser, setShowFormatChooser] = useState(false);
  const [showElrcNotice, setShowElrcNotice] = useState(false);
  const pendingSaveRef = useRef<(() => Promise<boolean>) | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [dropConflict, setDropConflict] = useState<
    { audio?: string; lyrics?: string; audioConflict: boolean; lyricsConflict: boolean } | null
  >(null);
  // 셀렉터로 좁혀 재생 중 currentTime 갱신마다 App 전체가 리렌더되지 않게 함
  const { lrcPath, isDirty, openLrc, openAudio, saveLrc, saveLrcAs, newLrc, undo, redo, _history, _future } = useLrcStore(
    useShallow((s) => ({
      lrcPath: s.lrcPath, isDirty: s.isDirty,
      openLrc: s.openLrc, openAudio: s.openAudio, saveLrc: s.saveLrc, saveLrcAs: s.saveLrcAs, newLrc: s.newLrc,
      undo: s.undo, redo: s.redo, _history: s._history, _future: s._future,
    }))
  );
  const hasGlyphSync = useLrcStore((s) => s.doc.lines.some((l) => l.syllables?.some((sy) => sy.time !== null)));
  const { t } = useI18nStore();
  const { uiScale, showElrcSaveNotice, setShowElrcSaveNotice } = useSettingsStore();

  // Clear any zoom set by a previous version of the app
  useEffect(() => { document.documentElement.style.zoom = ""; }, []);

  const handleNewLrc = () => {
    if (isDirty) {
      setShowNewConfirm(true);
    } else {
      newLrc();
    }
  };

  // 저장 결과를 토스트로 알림(취소 시 무알림, 실패 시 에러)
  const runSave = (p: Promise<boolean>) => {
    p.then((written) => { if (written) toast.success(t.toast.saved); })
     .catch(() => toast.error(t.toast.saveFailed));
  };

  // 글자/단어 동기화가 있어 E-LRC로 저장될 LRC 저장은 알림 팝업을 거쳐 실행
  const requestSaveLrc = (fn: () => Promise<boolean>) => {
    if (hasGlyphSync && showElrcSaveNotice) {
      pendingSaveRef.current = fn;
      setShowElrcNotice(true);
    } else {
      runSave(fn());
    }
  };

  const handleSave = () => {
    if (lrcPath) {
      if (lrcPath.toLowerCase().endsWith(".lrc")) requestSaveLrc(() => saveLrc());
      else runSave(saveLrc());
    } else {
      setShowFormatChooser(true);
    }
  };

  const handleOpenLrc = () => openLrc().catch(() => toast.error(t.toast.openFailed));

  // 드롭된 파일을 실제로 연다 (오디오 → 오디오 경로, lrc/srt → 가사)
  const applyDrop = (d: { audio?: string; lyrics?: string }) => {
    const st = useLrcStore.getState();
    if (d.audio) st.setAudioPath(d.audio);
    if (d.lyrics) st.loadLyricsPath(d.lyrics).catch(() => toast.error(t.toast.openFailed));
  };

  // 파일 드래그앤드롭 열기 (Tauri 네이티브 드롭 이벤트 → 파일 경로 제공)
  useEffect(() => {
    let cancelled = false;
    let unlisten: (() => void) | null = null;
    getCurrentWebview()
      .onDragDropEvent((event) => {
        const p = event.payload;
        if (p.type === "enter") {
          // 지원 파일이 하나라도 있을 때만 오버레이 표시
          if (p.paths.some((x) => AUDIO_EXTS.includes(fileExt(x)) || LYRICS_EXTS.includes(fileExt(x)))) {
            setIsDragOver(true);
          }
          return;
        }
        if (p.type === "over") return;
        if (p.type === "leave") { setIsDragOver(false); return; }
        // drop
        setIsDragOver(false);
        const audio = p.paths.find((x) => AUDIO_EXTS.includes(fileExt(x)));
        const lyrics = p.paths.find((x) => LYRICS_EXTS.includes(fileExt(x)));
        if (!audio && !lyrics) return; // 지원하지 않는 파일은 무시

        const st = useLrcStore.getState();
        const audioConflict = !!audio && st.audioPath !== null;
        const lyricsConflict = !!lyrics && (st.lrcPath !== null || st.isDirty || st.doc.lines.length > 0);
        if (audioConflict || lyricsConflict) {
          setDropConflict({ audio, lyrics, audioConflict, lyricsConflict });
        } else {
          applyDrop({ audio, lyrics });
        }
      })
      .then((fn) => { if (cancelled) safeUnlisten(fn); else unlisten = fn; })
      .catch(() => {});
    return () => { cancelled = true; safeUnlisten(unlisten); };
  }, []);

  useMacMenu(
    {
      newFile: handleNewLrc,
      openLrc: handleOpenLrc,
      openAudio,
      save: handleSave,
      saveAsLrc: () => requestSaveLrc(() => saveLrcAs("lrc")),
      saveAsSrt: () => runSave(saveLrcAs("srt")),
      undo,
      redo,
      togglePlay: () => audioControls.togglePlay(),
      skip: (d) => audioControls.skip(d),
      stop: () => audioControls.stopAndReset(),
      openSettings: () => setShowSettings(true),
      openPreview: () => setShowPreview(true),
      openHelp: () => setShowHelp(true),
    },
    { t }
  );

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
        <div className="flex items-center gap-1.5 shrink-0">
          {/* 파일 액션 그룹 */}
          <IconBtn onClick={handleNewLrc} title={t.newFileBtn}><NewFileIcon /></IconBtn>
          <IconBtn onClick={handleOpenLrc} title={t.openLrc}><OpenFolderIcon /></IconBtn>
          <IconBtn onClick={handleSave} accent title={t.save} tooltipAlign="right"><SaveIcon /></IconBtn>
          <IconBtn onClick={() => setShowFormatChooser(true)} title={t.saveAs} tooltipAlign="right"><SaveAsIcon /></IconBtn>
        </div>
      </header>

      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showPreview && (
        <Suspense fallback={null}>
          <PreviewModal onClose={() => setShowPreview(false)} />
        </Suspense>
      )}
      {showSettings && (
        <Suspense fallback={null}>
          <SettingsModal onClose={() => setShowSettings(false)} />
        </Suspense>
      )}
      {recovery && (
        <ConfirmModal
          title={t.recovery.title}
          message={`${t.recovery.message}${recovery.doc.metadata.title ? `\n\n「${recovery.doc.metadata.title}」 · ${recovery.doc.lines.length}${t.recovery.lines}` : ""}`}
          okLabel={t.recovery.restore}
          cancelLabel={t.recovery.discard}
          onOk={async () => {
            let lrcPath = recovery.lrcPath;
            let audioPath = recovery.audioPath;
            if (recovery.lrcBookmark) {
              try {
                lrcPath = await invoke<string>("resolve_security_bookmark", { bookmark: recovery.lrcBookmark });
              } catch {
                // 북마크 해석 실패 — 원래 경로로 best-effort 시도
              }
            }
            if (recovery.audioBookmark) {
              try {
                audioPath = await invoke<string>("resolve_security_bookmark", { bookmark: recovery.audioBookmark });
              } catch {
                // 북마크 해석 실패 — 원래 경로로 best-effort 시도
              }
            }
            useLrcStore.getState().restoreDoc(recovery.doc, lrcPath, audioPath, recovery.lrcBookmark, recovery.audioBookmark);
            clearRecoverySnapshot();
            setRecovery(null);
          }}
          onCancel={() => { clearRecoverySnapshot(); setRecovery(null); }}
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
          onSelect={(format) => {
            setShowFormatChooser(false);
            if (format === "lrc") requestSaveLrc(() => saveLrcAs("lrc"));
            else runSave(saveLrcAs(format));
          }}
          onCancel={() => setShowFormatChooser(false)}
        />
      )}
      {showElrcNotice && (
        <ELrcNoticeModal
          onConfirm={(dontShowAgain) => {
            if (dontShowAgain) setShowElrcSaveNotice(false);
            setShowElrcNotice(false);
            const fn = pendingSaveRef.current;
            pendingSaveRef.current = null;
            if (fn) runSave(fn());
          }}
          onCancel={() => { setShowElrcNotice(false); pendingSaveRef.current = null; }}
        />
      )}
      {dropConflict && (
        <ConfirmModal
          title={t.drop.replaceTitle}
          message={
            dropConflict.audioConflict && dropConflict.lyricsConflict
              ? t.drop.replaceBoth
              : dropConflict.audioConflict
              ? t.drop.replaceAudio
              : t.drop.replaceLyrics
          }
          okLabel={t.drop.replaceOk}
          cancelLabel={t.drop.replaceCancel}
          onOk={() => { applyDrop(dropConflict); setDropConflict(null); }}
          onCancel={() => setDropConflict(null)}
        />
      )}
      {isDragOver && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-indigo-950/60 backdrop-blur-sm pointer-events-none border-4 border-dashed border-indigo-400/70 m-2 rounded-2xl">
          <div className="text-center">
            <p className="text-xl font-semibold text-indigo-100">{t.drop.overlayHint}</p>
            <p className="text-sm text-indigo-300 mt-1 font-mono">Audio · LRC · SRT</p>
          </div>
        </div>
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

      <ToastContainer />
    </div>
  );
}

function HelpModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18nStore();
  const kb = normalizeKeybindings(useSettingsStore((s) => s.keybindings));

  const shortcutGroups = [
    {
      title: t.helpGroupPlayback,
      items: [
        { key: keyLabel(kb.skipBack5), desc: t.shortcutDescs.s1 },
        { key: keyLabel(kb.skipBack1), desc: t.shortcutDescs.s2 },
        { key: keyLabel(kb.playPause), desc: t.shortcutDescs.s3 },
        { key: keyLabel(kb.skipFwd1), desc: t.shortcutDescs.s4 },
        { key: keyLabel(kb.skipFwd5), desc: t.shortcutDescs.s5 },
        { key: keyLabel(kb.stop), desc: t.shortcutDescs.s6 },
      ],
    },
    {
      title: t.helpGroupEdit,
      items: [
        { key: keyLabel(kb.stamp), desc: t.shortcutDescs.space },
        { key: keyLabel(kb.prevLine), desc: t.shortcutDescs.backspace },
        { key: "Enter", desc: t.shortcutDescs.enter },
        { key: "⇧ Enter", desc: t.shortcutDescs.splitLine },
        { key: "Ctrl/⌘ Z", desc: t.shortcutDescs.undo },
        { key: "Ctrl/⌘ ⇧ Z", desc: t.shortcutDescs.redo },
        { key: "Ctrl/⌘ F", desc: t.shortcutDescs.find },
      ],
    },
    {
      title: t.helpGroupMouse,
      items: [
        { key: t.shortcutDescs.tsEditKey, desc: t.shortcutDescs.tsEditDesc },
        { key: t.shortcutDescs.tsStampKey, desc: t.shortcutDescs.tsStampDesc },
        { key: t.shortcutDescs.lineClickKey, desc: t.shortcutDescs.lineClickDesc },
        { key: t.shortcutDescs.markerClickKey, desc: t.shortcutDescs.markerClickDesc },
      ],
    },
    {
      title: t.helpGroupCharSync,
      items: [
        { key: keyLabel(kb.stamp), desc: t.shortcutDescs.csStamp },
        { key: "← / →", desc: t.shortcutDescs.csMove },
        { key: t.shortcutDescs.csNudgeKey, desc: t.shortcutDescs.csNudgeDesc },
        { key: t.shortcutDescs.csDragKey, desc: t.shortcutDescs.csDragDesc },
        { key: t.shortcutDescs.csClickKey, desc: t.shortcutDescs.csClickDesc },
        { key: t.shortcutDescs.csClearKey, desc: t.shortcutDescs.csClearDesc },
      ],
    },
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
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-2xl mx-4 max-h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-100">{t.helpTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-5 flex-1 overflow-y-auto">
          <div className="flex flex-col gap-5">
            {shortcutGroups.map((g) => (
              <div key={g.title}>
                <h3 className="text-xs font-semibold text-zinc-400 mb-2.5">{g.title}</h3>
                <div className="grid grid-cols-2 gap-x-6 gap-y-2.5">
                  {g.items.map(({ key, desc }) => (
                    <div key={key} className="flex items-center gap-3">
                      <kbd className="shrink-0 min-w-[3rem] text-center px-2 py-1 rounded-md bg-zinc-800 border border-zinc-600 text-xs font-mono text-zinc-200 whitespace-nowrap">
                        {key}
                      </kbd>
                      <span className="text-sm text-zinc-300 leading-snug">{desc}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
            <p className="text-xs text-zinc-500 pt-1">{t.shortcutNote}</p>
          </div>
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
              className="px-4 py-1.5 text-sm rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors whitespace-nowrap"
            >
              {leftLabel}
            </button>
          )}
          <div className="flex-1" />
          {cancelLabel && (
            <button
              onClick={onCancel}
              className="px-4 py-1.5 text-sm rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors whitespace-nowrap"
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
  onSelect: (format: "lrc" | "srt" | "vtt" | "ass") => void;
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

  const optClass =
    "flex flex-col items-start gap-0.5 px-4 py-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 hover:border-indigo-500 transition-colors text-left";

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
          <button onClick={() => onSelect("lrc")} className={optClass}>
            <span className="text-sm font-semibold text-white">LRC <span className="text-zinc-500 font-normal">(.lrc)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatLrcDesc}</span>
          </button>
          <button onClick={() => onSelect("srt")} className={optClass}>
            <span className="text-sm font-semibold text-white">SubRip <span className="text-zinc-500 font-normal">(.srt)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatSrtDesc}</span>
          </button>
          <button onClick={() => onSelect("vtt")} className={optClass}>
            <span className="text-sm font-semibold text-white">WebVTT <span className="text-zinc-500 font-normal">(.vtt)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatVttDesc}</span>
          </button>
          <button onClick={() => onSelect("ass")} className={optClass}>
            <span className="text-sm font-semibold text-white">ASS <span className="text-zinc-500 font-normal">(.ass)</span></span>
            <span className="text-xs text-zinc-400">{t.saveFormatAssDesc}</span>
          </button>
        </div>
        <div className="flex justify-end px-5 pb-4">
          <button
            onClick={onCancel}
            className="px-4 py-1.5 text-sm rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            {t.rawEditorCancel}
          </button>
        </div>
      </div>
    </div>
  );
}

function ELrcNoticeModal({
  onConfirm, onCancel,
}: {
  onConfirm: (dontShowAgain: boolean) => void;
  onCancel: () => void;
}) {
  const { t } = useI18nStore();
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
      else if (e.key === "Enter") onConfirm(dontShowAgain);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel, onConfirm, dontShowAgain]);

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
          <span className="font-semibold text-zinc-100">{t.elrcNotice.title}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-zinc-300 leading-relaxed">{t.elrcNotice.message}</p>
        </div>
        <div className="flex items-center justify-between gap-3 px-5 pb-4">
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="accent-indigo-600 w-3.5 h-3.5"
            />
            {t.elrcNotice.dontShowAgain}
          </label>
          <button
            onClick={() => onConfirm(dontShowAgain)}
            className="px-4 py-1.5 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white font-medium transition-colors"
          >
            {t.elrcNotice.confirm}
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
            : "text-zinc-400 hover:bg-zinc-800 hover:text-white"
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


function GearIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
    </svg>
  );
}

export default App;
