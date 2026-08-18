import { useRef, useEffect, useCallback, useState, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { formatDisplayTime, formatTimestamp, parseTimestampInput, validateTimestamps, type SyncUnit } from "../../utils/lrcParser";
import { audioControls } from "../../utils/audioControls";
import { serviceControls } from "../../utils/serviceControls";
import { MODEL_DEFS } from "../../utils/modelDefs";
import { CharSyncView } from "./CharSyncView";
import { safeUnlisten } from "../../utils/safeUnlisten";
import { CurrentTimeFooter } from "./CurrentTimeFooter";
import { MiniConfirm } from "./MiniConfirm";
import { FindReplaceBar } from "./FindReplaceBar";
import { TimeShiftBar } from "./TimeShiftBar";
import { ValidationPanel } from "./ValidationPanel";
import { ScaleBar } from "./ScaleBar";
import { LoopIcon } from "../AudioPlayer/icons";

// ISO 639-3 codes used by ctc-forced-aligner / MMS model
const LANG_CODE: Record<string, string> = { ko: "kor", en: "eng", ja: "jpn" };

export function LrcEditor({ onPreview }: { onPreview: () => void }) {
  // currentTime은 푸터에서만 쓰므로 구독에서 제외 → 재생 중 줄 목록이 매 프레임 리렌더되지 않음
  const {
    doc, activeLineId,
    addLine, insertLinesAfter, updateLine, deleteLine,
    duplicateLine, mergeLineUp, splitLine, moveLine, scaleTimestamps,
    deleteLines, shiftLines, clearTimestamps,
    stampCurrentLine, setActiveLineId,
    aiSyncStatus, aiSyncMessage, aiSyncProgressStatus, aiDraftConfidence,
    runAiSync, cancelAiSync, clearAiDraft,
    replaceInLines, shiftTimeRange,
    audioPath,
    syncMode, syncUnit, setSyncMode, setSyncUnit, clearLineSyllables,
    loopLineId, setLoopLine,
  } = useLrcStore(
    useShallow((s) => ({
      doc: s.doc, activeLineId: s.activeLineId,
      addLine: s.addLine, insertLinesAfter: s.insertLinesAfter, updateLine: s.updateLine, deleteLine: s.deleteLine,
      duplicateLine: s.duplicateLine, mergeLineUp: s.mergeLineUp, splitLine: s.splitLine, moveLine: s.moveLine, scaleTimestamps: s.scaleTimestamps,
      deleteLines: s.deleteLines, shiftLines: s.shiftLines, clearTimestamps: s.clearTimestamps,
      stampCurrentLine: s.stampCurrentLine, setActiveLineId: s.setActiveLineId,
      aiSyncStatus: s.aiSyncStatus, aiSyncMessage: s.aiSyncMessage, aiSyncProgressStatus: s.aiSyncProgressStatus, aiDraftConfidence: s.aiDraftConfidence,
      runAiSync: s.runAiSync, cancelAiSync: s.cancelAiSync, clearAiDraft: s.clearAiDraft,
      replaceInLines: s.replaceInLines, shiftTimeRange: s.shiftTimeRange,
      audioPath: s.audioPath,
      syncMode: s.syncMode, syncUnit: s.syncUnit, setSyncMode: s.setSyncMode, setSyncUnit: s.setSyncUnit, clearLineSyllables: s.clearLineSyllables,
      loopLineId: s.loopLineId, setLoopLine: s.setLoopLine,
    }))
  );
  const { t, lang } = useI18nStore();
  const { blankLineOffset, spotifyMode, deviceMode, lyricsFontScale, useVocalSeparation, useVad } = useSettingsStore();
  const serviceLoggedIn = useServiceStore((s) => s.isLoggedIn);
  // 실제 Spotify 모드(로그인 + spotifyMode 활성)일 때만 서비스 모드로 간주.
  // 단순 계정 연결만으로 AI 싱크를 막지 않도록 isReady 대신 spotifyMode 기준 사용.
  const isServiceMode = serviceLoggedIn && spotifyMode;
  const serviceActive = isServiceMode;
  // AI 자동 동기화는 로컬 오디오가 있는 파일/YouTube 모드에서만 의미가 있음.
  // Spotify는 로그인 전이어도, 기기 감지는 항상 로컬 오디오가 없으므로 둘 다 차단
  // (로그인 여부로 판단하는 isServiceMode와 달리 spotifyMode 자체로 판단).
  const aiSyncModeUnsupported = spotifyMode || deviceMode;
  const { lines } = doc;

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusId = useRef<string | null>(null);

  const [pythonReady, setPythonReady] = useState(false);
  const [missingModels, setMissingModels] = useState<string[]>([]);

  // Find/Replace state
  const [showFR, setShowFR] = useState(false);

  // Time Shift state
  const [showTS, setShowTS] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  // 줄 다중선택(일괄 작업)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [selAnchor, setSelAnchor] = useState<string | null>(null);

  // 도구 오버플로우(찾기·구간오프셋)
  const [showTools, setShowTools] = useState(false);
  const toolsRef = useRef<HTMLDivElement>(null);
  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matchPos, setMatchPos] = useState(0);
  const findInputRef = useRef<HTMLInputElement>(null);

  // 타임스탬프 인라인 편집 상태 (좌클릭 시 직접 시간 입력)
  const [editingTsId, setEditingTsId] = useState<string | null>(null);
  const [editTsValue, setEditTsValue] = useState("");

  // Esc 취소 시 input 언마운트로 onBlur가 commit을 유발하지 않도록 가드
  const tsEditCancel = useRef(false);

  // 글자 동기화된 줄의 텍스트 수정 경고 / 단위 변경 경고
  const [pendingTextEdit, setPendingTextEdit] = useState<{ id: string; text: string } | null>(null);
  const [pendingUnit, setPendingUnit] = useState<SyncUnit | null>(null);
  const [pendingAiSync, setPendingAiSync] = useState(false);
  // 드래그 재정렬 상태
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const charMode = syncMode === "char";

  // 텍스트 입력: 글자 타이밍이 있는 줄이면 경고 후 재토큰화 동의 받기
  const handleTextChange = (id: string, value: string) => {
    const ln = lines.find((l) => l.id === id);
    if (ln?.syllables?.some((s) => s.time !== null)) {
      setPendingTextEdit({ id, text: value });
      return;
    }
    updateLine(id, { text: value });
  };
  const confirmTextEdit = () => {
    if (pendingTextEdit) updateLine(pendingTextEdit.id, { text: pendingTextEdit.text, syllables: undefined });
    setPendingTextEdit(null);
  };

  // 단위 변경: 활성 줄에 글자 타이밍이 있으면 경고 후 해당 줄 초기화
  const handleUnitChange = (u: SyncUnit) => {
    if (u === syncUnit) return;
    const active = lines.find((l) => l.id === activeLineId);
    if (active?.syllables?.some((s) => s.time !== null)) {
      setPendingUnit(u);
      return;
    }
    setSyncUnit(u);
  };
  const confirmUnitChange = () => {
    if (pendingUnit) {
      const active = lines.find((l) => l.id === activeLineId);
      if (active) clearLineSyllables(active.id);
      setSyncUnit(pendingUnit);
    }
    setPendingUnit(null);
  };

  const startTsEdit = (id: string, timestamp: number | null) => {
    tsEditCancel.current = false;
    setActiveLineId(id);
    setEditTsValue(timestamp !== null ? formatTimestamp(timestamp) : "");
    setEditingTsId(id);
  };
  const commitTsEdit = (id: string) => {
    if (tsEditCancel.current) { tsEditCancel.current = false; return; }
    const parsed = parseTimestampInput(editTsValue.trim());
    if (parsed !== null) updateLine(id, { timestamp: parsed });
    setEditingTsId(null);
  };
  const cancelTsEdit = () => {
    tsEditCancel.current = true;
    setEditingTsId(null);
  };

  const checkAiRequirements = useCallback(async () => {
    try {
      const v = await invoke<{ packagesReady: boolean }>("get_python_env_info");
      setPythonReady(v.packagesReady);
    } catch {
      setPythonReady(false);
    }
    const missing: string[] = [];
    for (const model of MODEL_DEFS.filter((m) => m.required)) {
      try {
        const results = await invoke<boolean[]>("check_model_files", { filenames: model.files.map((f) => f.filename) });
        if (!results.every(Boolean)) missing.push(model.name);
      } catch {
        missing.push(model.name);
      }
    }
    setMissingModels(missing);
  }, []);

  useEffect(() => { checkAiRequirements(); }, [checkAiRequirements]);

  useEffect(() => {
    let unlistenModel: (() => void) | null = null;
    let unlistenPip: (() => void) | null = null;
    import("@tauri-apps/api/event").then(({ listen }) => {
      listen<{ done: boolean }>("model-download-progress", (e) => {
        if (e.payload.done) checkAiRequirements();
      }).then((fn) => { unlistenModel = fn; }).catch(() => {});
      listen<{ done: boolean }>("pip-install-progress", (e) => {
        if (e.payload.done) checkAiRequirements();
      }).then((fn) => { unlistenPip = fn; }).catch(() => {});
    });
    return () => { safeUnlisten(unlistenModel); safeUnlisten(unlistenPip); };
  }, [checkAiRequirements]);

  const canRunAi = pythonReady && missingModels.length === 0;

  useEffect(() => {
    if (!activeLineId) return;
    rowRefs.current.get(activeLineId)?.scrollIntoView({ block: "nearest" });
  }, [activeLineId]);

  useEffect(() => {
    if (pendingFocusId.current) {
      inputRefs.current.get(pendingFocusId.current)?.focus();
      pendingFocusId.current = null;
    }
  });

  const setInputRef = useCallback((id: string) => (el: HTMLInputElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  }, []);

  const setRowRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>, id: string) => {
    if (e.key === "Enter" && e.shiftKey) {
      // Shift+Enter = 커서 위치에서 줄 분할
      e.preventDefault();
      const caret = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
      const newId = splitLine(id, caret);
      setActiveLineId(newId);
      pendingFocusId.current = newId;
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const newId = insertLinesAfter(id, [""]);
      setActiveLineId(newId);
      pendingFocusId.current = newId;
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLInputElement>, id: string, currentText: string) => {
    const pasted = e.clipboardData.getData("text");
    if (!pasted.includes("\n")) return;

    e.preventDefault();
    const input = e.currentTarget;
    const selStart = input.selectionStart ?? currentText.length;
    const selEnd = input.selectionEnd ?? currentText.length;
    const before = currentText.slice(0, selStart);
    const after = currentText.slice(selEnd);
    const pasteLines = pasted.split(/\r?\n/);

    // 텍스트가 바뀌므로 글자 동기화 토큰은 무효화
    updateLine(id, { text: before + pasteLines[0], syllables: undefined });

    const restTexts = pasteLines.slice(1);
    restTexts[restTexts.length - 1] += after;
    const newId = insertLinesAfter(id, restTexts);
    setActiveLineId(newId);
    pendingFocusId.current = newId;
  };

  // 타임스탬프 검증 경고
  const warnings = useMemo(() => validateTimestamps(lines), [lines]);

  // 완성도 통계: 텍스트 있는 줄 중 타임스탬프가 찍힌 비율
  const stats = useMemo(() => {
    const nonEmpty = lines.filter((l) => l.text.trim() !== "");
    const stamped = nonEmpty.filter((l) => l.timestamp !== null).length;
    return { total: nonEmpty.length, stamped, pct: nonEmpty.length ? Math.round((stamped / nonEmpty.length) * 100) : 0 };
  }, [lines]);

  // 이슈 목록: 경고(중복/순서) + 미입력(텍스트 있는데 타임스탬프 없음)
  type Issue = { id: string; lineNo: number; text: string; type: "duplicate" | "outOfOrder" | "unstamped" };
  const issues = useMemo(() => {
    const out: Issue[] = [];
    lines.forEach((l, i) => {
      const w = warnings.get(l.id);
      if (w) out.push({ id: l.id, lineNo: i + 1, text: l.text, type: w });
      else if (l.text.trim() !== "" && l.timestamp === null) out.push({ id: l.id, lineNo: i + 1, text: l.text, type: "unstamped" });
    });
    return out;
  }, [lines, warnings]);

  const jumpToLine = (id: string) => {
    setActiveLineId(id);
    rowRefs.current.get(id)?.scrollIntoView({ block: "center" });
    setShowValidation(false);
  };

  // 줄 클릭: Shift=범위 선택, Ctrl/⌘=토글, 일반=단일 선택+시크(기존 동작)
  const handleRowClick = (e: React.MouseEvent, id: string, idx: number) => {
    if (e.shiftKey && selAnchor) {
      const aIdx = lines.findIndex((l) => l.id === selAnchor);
      if (aIdx >= 0) {
        const [lo, hi] = aIdx <= idx ? [aIdx, idx] : [idx, aIdx];
        setSelectedIds(new Set(lines.slice(lo, hi + 1).map((l) => l.id)));
      }
      setActiveLineId(id);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      setSelectedIds((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
      });
      setSelAnchor(id);
      setActiveLineId(id);
      return;
    }
    // 일반 클릭: 다중선택 해제 + 기존 동작(활성/시크/찾기)
    if (selectedIds.size > 0) setSelectedIds(new Set());
    setSelAnchor(id);
    setActiveLineId(id);
    const ln = lines.find((l) => l.id === id);
    if (ln && ln.timestamp !== null) {
      (serviceActive ? serviceControls : audioControls).seekTo(ln.timestamp);
    }
    if (showFR) {
      const mi = matchIds.indexOf(id);
      if (mi !== -1) setMatchPos(mi);
    }
  };

  // 매칭 줄 id 목록
  const matchIds = useMemo(() => {
    if (!findText) return [];
    const needle = caseSensitive ? findText : findText.toLowerCase();
    return lines
      .filter((l) => (caseSensitive ? l.text : l.text.toLowerCase()).includes(needle))
      .map((l) => l.id);
  }, [lines, findText, caseSensitive]);

  // matchPos 범위 보정
  useEffect(() => {
    if (matchIds.length === 0) return;
    setMatchPos((p) => Math.min(p, matchIds.length - 1));
  }, [matchIds.length]);

  // 현재 매치로 스크롤 (포커스는 찾기 입력창에 유지)
  useEffect(() => {
    if (!showFR || !findText || matchIds.length === 0) return;
    const id = matchIds[matchPos];
    rowRefs.current.get(id)?.scrollIntoView({ block: "nearest" });
  }, [matchPos, matchIds, findText, caseSensitive, showFR]);

  // Ctrl/Cmd+F 열기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.code === "KeyF") {
        e.preventDefault();
        setShowFR(true);
        setTimeout(() => findInputRef.current?.focus(), 0);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  // 도구 오버플로우 바깥 클릭 시 닫기
  useEffect(() => {
    if (!showTools) return;
    const h = (e: MouseEvent) => {
      if (toolsRef.current && !toolsRef.current.contains(e.target as Node)) setShowTools(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, [showTools]);

  const handleAddLine = useCallback(() => {
    addLine();
    const allLines = useLrcStore.getState().doc.lines;
    const lastId = allLines[allLines.length - 1]?.id;
    if (lastId) {
      setActiveLineId(lastId);
      pendingFocusId.current = lastId;
    }
  }, [addLine, setActiveLineId]);

  const handleFRClose = useCallback(() => {
    setShowFR(false);
    setMatchPos(0);
  }, []);

  const handleFRPrev = useCallback(() => {
    setMatchPos((p) => (p > 0 ? p - 1 : matchIds.length - 1));
  }, [matchIds.length]);

  const handleFRNext = useCallback(() => {
    setMatchPos((p) => (p < matchIds.length - 1 ? p + 1 : 0));
  }, [matchIds.length]);

  const handleReplace = useCallback(() => {
    if (!matchIds.length || !findText) return;
    const id = matchIds[matchPos];
    const line = lines.find((l) => l.id === id);
    if (!line) return;
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, caseSensitive ? "" : "i");
    const newText = line.text.replace(re, replaceText);
    if (newText !== line.text) updateLine(id, { text: newText });
    // 다음 매치로 이동 (matchIds는 갱신되므로 다음 렌더 후 자동 이동)
    setMatchPos((p) => (p < matchIds.length - 1 ? p + 1 : 0));
  }, [matchIds, matchPos, findText, replaceText, caseSensitive, lines, updateLine]);

  const handleReplaceAll = useCallback(() => {
    if (!findText) return;
    replaceInLines(findText, replaceText, caseSensitive);
    setMatchPos(0);
  }, [findText, replaceText, caseSensitive, replaceInLines]);

  const handleShiftApply = useCallback((fromIdx: number, toIdx: number, delta: number) => {
    shiftTimeRange(fromIdx, toIdx, delta);
    setShowTS(false);
  }, [shiftTimeRange]);

  const runAiSyncNow = () => {
    const language = LANG_CODE[lang] ?? "eng";
    runAiSync(language, blankLineOffset, useVocalSeparation, useVad);
  };
  const handleAiSync = () => {
    // AI 정렬은 줄 단위 재정렬 → 기존 글자/단어 동기화가 삭제됨. 있으면 먼저 확인.
    const hasGlyph = lines.some((l) => l.syllables?.some((s) => s.time !== null));
    if (hasGlyph) { setPendingAiSync(true); return; }
    runAiSyncNow();
  };

  const isRunning = aiSyncStatus === "running";

  const PROGRESS_STATUS_MAP: Record<string, string> = {
    loading_model: t.aiSyncStatusLoadingModel,
    loading_audio: t.aiSyncStatusLoadingAudio,
    analyzing: t.aiSyncStatusAnalyzing,
    aligning: t.aiSyncStatusAligning,
    postprocessing: t.aiSyncStatusPostprocessing,
    separating: t.aiSyncStatusAnalyzing,
    done: t.aiSyncStatusDone,
  };

  const displayMessage = aiSyncStatus === "error"
    ? aiSyncMessage
    : (PROGRESS_STATUS_MAP[aiSyncProgressStatus] ?? aiSyncMessage);


  return (
    <div className="flex flex-col gap-2 p-4 bg-zinc-900 rounded-xl border border-zinc-700 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-300">{t.lyricsEditor}</h2>
          {!charMode && stats.total > 0 && (
            <button
              onClick={() => setShowValidation(true)}
              title={t.validationTitle}
              className="flex items-center gap-1.5 text-xs rounded-full border px-2 py-0.5 transition-colors border-zinc-700 hover:bg-zinc-800"
            >
              <span className={stats.pct === 100 ? "text-emerald-400" : "text-zinc-400"}>{stats.pct}%</span>
              {warnings.size > 0 && <span className="text-amber-400">⚠ {warnings.size}</span>}
            </button>
          )}
        </div>
        <div className="flex gap-2 items-center flex-wrap justify-end">

          {/* 줄 ↔ 글자 동기화 모드 토글 */}
          <div className="inline-flex bg-zinc-800 rounded-lg p-0.5">
            <button
              onClick={(e) => { setSyncMode("line"); e.currentTarget.blur(); }}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors ${!charMode ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {t.charSync.modeLine}
            </button>
            <button
              onClick={(e) => { setSyncMode("char"); e.currentTarget.blur(); }}
              disabled={isRunning}
              title={isRunning ? t.aiSyncRunning : undefined}
              className={`px-2.5 py-1 text-xs rounded-md transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${charMode ? "bg-indigo-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
            >
              {t.charSync.modeChar}
            </button>
          </div>

          {charMode && (
            <div className="flex items-center gap-1.5">
              <span className="text-xs text-zinc-500">{t.charSync.unitLabel}</span>
              <div className="inline-flex bg-zinc-800 rounded-lg p-0.5">
                <button
                  onClick={(e) => { handleUnitChange("char"); e.currentTarget.blur(); }}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${syncUnit === "char" ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
                >
                  {t.charSync.unitChar}
                </button>
                <button
                  onClick={(e) => { handleUnitChange("word"); e.currentTarget.blur(); }}
                  className={`px-2.5 py-1 text-xs rounded-md transition-colors ${syncUnit === "word" ? "bg-zinc-600 text-white" : "text-zinc-400 hover:text-zinc-200"}`}
                >
                  {t.charSync.unitWord}
                </button>
              </div>
            </div>
          )}

          {!charMode && (<>
          {/* AI Auto Sync */}
          <div className="relative group">
            <button
              onClick={isRunning ? undefined : handleAiSync}
              disabled={isRunning || !canRunAi || !audioPath || aiSyncModeUnsupported}
              className={[
                "px-3 py-1 text-xs rounded-lg transition-colors",
                isRunning
                  ? "bg-indigo-800 text-indigo-300 cursor-not-allowed"
                  : canRunAi && audioPath && !aiSyncModeUnsupported
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                  : "bg-zinc-700 text-zinc-500 cursor-not-allowed",
              ].join(" ")}
            >
              {isRunning ? t.aiSyncRunning : t.aiAutoSync}
            </button>
            {!isRunning && (aiSyncModeUnsupported || !canRunAi || !audioPath) && (
              <div className="absolute top-full right-0 mt-1.5 hidden group-hover:block z-20 w-60 bg-zinc-800 border border-zinc-600 text-xs text-zinc-300 rounded-lg px-3 py-2 shadow-xl pointer-events-none">
                {aiSyncModeUnsupported ? (
                  t.aiSyncModeUnsupported
                ) : !canRunAi ? (
                  <>
                    <p className="font-medium text-zinc-200 mb-1">{t.aiSyncNoModel}</p>
                    <ul className="flex flex-col gap-0.5 text-zinc-400">
                      {!pythonReady && <li>· {t.settingsVenvTitle}</li>}
                      {missingModels.map((name) => <li key={name}>· {name}</li>)}
                    </ul>
                  </>
                ) : (
                  t.aiSyncNoAudio
                )}
              </div>
            )}
          </div>

          {/* Cancel (only while running) */}
          {isRunning && (
            <button
              onClick={cancelAiSync}
              className="px-3 py-1 text-xs rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              {t.aiSyncCancel}
            </button>
          )}

          {/* Clear AI draft */}
          {aiDraftConfidence && !isRunning && (
            <button
              onClick={clearAiDraft}
              className="px-3 py-1 text-xs rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
            >
              {t.aiSyncClear}
            </button>
          )}

          {/* 도구 오버플로우: 찾기/바꾸기 · 구간 오프셋 */}
          <div className="relative" ref={toolsRef}>
            <button
              onClick={() => setShowTools((v) => !v)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${showTools || showFR || showTS || showScale ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"}`}
            >
              {t.editorTools}
            </button>
            {showTools && (
              <div className="absolute right-0 top-full mt-1.5 z-40 w-44 bg-zinc-800 border border-zinc-700 rounded-xl shadow-2xl p-1.5 flex flex-col gap-0.5">
                <button
                  onClick={() => { setShowFR((v) => !v); setShowTools(false); setTimeout(() => findInputRef.current?.focus(), 0); }}
                  className={`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showFR ? "bg-amber-600 text-white" : "hover:bg-zinc-700 text-zinc-200"}`}
                >
                  {t.findReplace}
                </button>
                <button
                  onClick={() => { setShowTS((v) => !v); setShowTools(false); }}
                  className={`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showTS ? "bg-sky-600 text-white" : "hover:bg-zinc-700 text-zinc-200"}`}
                >
                  {t.timeShift}
                </button>
                <button
                  onClick={() => { setShowScale((v) => !v); setShowTools(false); }}
                  className={`text-left px-2.5 py-1.5 text-xs rounded-lg transition-colors ${showScale ? "bg-sky-600 text-white" : "hover:bg-zinc-700 text-zinc-200"}`}
                >
                  {t.tsScale}
                </button>
              </div>
            )}
          </div>
          </>)}
          <button
            onClick={onPreview}
            className="px-3 py-1 text-xs rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            {t.previewBtn}
          </button>
          {!charMode && (
          <button
            onClick={handleAddLine}
            className="px-3 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            {t.addLine}
          </button>
          )}
        </div>
      </div>

      {charMode && <CharSyncView />}

      {!charMode && (<>
      {/* AI progress message */}
      {(isRunning || aiSyncStatus === "error") && displayMessage && (
        <div className={[
          "text-xs px-2 py-1 rounded",
          aiSyncStatus === "error"
            ? "text-red-300 bg-red-900/30"
            : "text-indigo-300 bg-indigo-900/30",
        ].join(" ")}>
          {displayMessage}
        </div>
      )}

      {showTS && (
        <TimeShiftBar
          lineCount={lines.length}
          defaultFrom={(activeLineId ? lines.findIndex((l) => l.id === activeLineId) : 0) + 1}
          onApply={handleShiftApply}
          onClose={() => setShowTS(false)}
        />
      )}

      {showScale && (
        <ScaleBar
          onApply={(factor) => { scaleTimestamps(factor); setShowScale(false); }}
          onClose={() => setShowScale(false)}
        />
      )}

      {selectedIds.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-zinc-800 border border-sky-700/50 rounded-lg text-xs">
          <span className="text-sky-300 font-medium shrink-0">{selectedIds.size} {t.bulkSelected}</span>
          <div className="w-px h-4 bg-zinc-700 shrink-0" />
          <span className="text-zinc-400 shrink-0">{t.bulkShift}</span>
          <button onClick={() => shiftLines([...selectedIds], -0.1)} className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors">−0.1s</button>
          <button onClick={() => shiftLines([...selectedIds], 0.1)} className="px-2 py-1 rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors">+0.1s</button>
          <div className="w-px h-4 bg-zinc-700 shrink-0" />
          <button onClick={() => clearTimestamps([...selectedIds])} className="px-2.5 py-1 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors">{t.bulkClearTs}</button>
          <button onClick={() => { deleteLines([...selectedIds]); setSelectedIds(new Set()); }} className="px-2.5 py-1 rounded-lg bg-rose-700 hover:bg-rose-600 text-white transition-colors">{t.bulkDelete}</button>
          <button onClick={() => setSelectedIds(new Set())} className="ml-auto px-2.5 py-1 rounded-lg text-zinc-400 hover:bg-zinc-700 hover:text-white transition-colors">{t.bulkDeselect}</button>
        </div>
      )}

      {showFR && (
        <FindReplaceBar
          findText={findText}
          replaceText={replaceText}
          caseSensitive={caseSensitive}
          matchCount={matchIds.length}
          matchPos={matchPos}
          onFindChange={(v) => { setFindText(v); setMatchPos(0); }}
          onReplaceChange={setReplaceText}
          onCaseSensitiveToggle={() => setCaseSensitive((v) => !v)}
          onPrev={handleFRPrev}
          onNext={handleFRNext}
          onReplace={handleReplace}
          onReplaceAll={handleReplaceAll}
          onClose={handleFRClose}
          findInputRef={findInputRef}
        />
      )}

      <div
        className="flex-1 overflow-y-auto flex flex-col gap-1 px-1 py-1"
        onDoubleClick={(e) => { if (e.target === e.currentTarget) handleAddLine(); }}
      >
        {lines.length === 0 && (
          <p
            className="text-zinc-500 text-sm text-center py-8 cursor-pointer"
            onDoubleClick={handleAddLine}
          >{t.noLines}</p>
        )}
        {lines.map((line, idx) => {
          const isActive = line.id === activeLineId;
          const confidence = aiDraftConfidence?.[line.id];
          const hasGlyphSync = !!line.syllables?.some((s) => s.time !== null);

          // Timestamp button colour varies by AI confidence
          const tsClass = confidence !== undefined
            ? confidence >= 0.7
              ? "bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60"
              : confidence >= 0.5
              ? "bg-yellow-900/50 text-yellow-300 hover:bg-yellow-800/60"
              : "bg-red-900/50 text-red-300 hover:bg-red-800/60"
            : line.timestamp !== null
            ? "bg-zinc-700 text-indigo-300 hover:bg-zinc-600"
            : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300";

          const isMatch = showFR && matchIds.includes(line.id);
          const isCurrentMatch = showFR && matchIds[matchPos] === line.id;
          const warning = warnings.get(line.id);

          return (
            <div
              key={line.id}
              ref={setRowRef(line.id)}
              onClick={(e) => handleRowClick(e, line.id, idx)}
              onDragOver={(e) => { if (dragIdx !== null) { e.preventDefault(); if (dragOverIdx !== idx) setDragOverIdx(idx); } }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragIdx !== null && dragIdx !== idx) moveLine(dragIdx, idx);
                setDragIdx(null); setDragOverIdx(null);
              }}
              className={`group/row flex items-center gap-2 rounded-lg px-2 py-1 transition-colors cursor-pointer ${
                dragIdx !== null && dragOverIdx === idx && dragIdx !== idx
                  ? "outline outline-1 outline-indigo-400 bg-indigo-900/10"
                  : selectedIds.has(line.id)
                  ? "bg-sky-900/30 ring-1 ring-sky-600/60"
                  : isCurrentMatch
                  ? "bg-amber-900/30 ring-1 ring-amber-500"
                  : isActive
                  ? "bg-indigo-900/40 ring-1 ring-indigo-500"
                  : isMatch
                  ? "bg-amber-900/10 ring-1 ring-amber-800"
                  : "hover:bg-zinc-800"
              } ${dragIdx === idx ? "opacity-40" : ""}`}
            >
              <span
                draggable
                onDragStart={(e) => { e.stopPropagation(); setDragIdx(idx); }}
                onDragEnd={() => { setDragIdx(null); setDragOverIdx(null); }}
                onClick={(e) => e.stopPropagation()}
                title={t.reorderLine}
                className="shrink-0 cursor-grab active:cursor-grabbing text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/row:opacity-100 transition-opacity"
              >
                <svg width="10" height="14" viewBox="0 0 10 14" fill="currentColor" aria-hidden="true">
                  <circle cx="2.5" cy="2" r="1.2" /><circle cx="7.5" cy="2" r="1.2" />
                  <circle cx="2.5" cy="7" r="1.2" /><circle cx="7.5" cy="7" r="1.2" />
                  <circle cx="2.5" cy="12" r="1.2" /><circle cx="7.5" cy="12" r="1.2" />
                </svg>
              </span>
              <span className="text-zinc-600 text-xs w-5 shrink-0 text-right select-none">
                {idx + 1}
              </span>

              <div className="shrink-0">
                {editingTsId === line.id ? (
                  // 좌클릭 시 인라인 편집: 숫자키로 MM:SS.xx 직접 입력
                  <input
                    autoFocus
                    type="text"
                    value={editTsValue}
                    onClick={(e) => e.stopPropagation()}
                    onFocus={(e) => e.target.select()}
                    onChange={(e) => setEditTsValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") { e.preventDefault(); commitTsEdit(line.id); }
                      else if (e.key === "Escape") { e.preventDefault(); cancelTsEdit(); }
                    }}
                    onBlur={() => commitTsEdit(line.id)}
                    placeholder="MM:SS.xx"
                    className="font-mono text-xs px-2 py-0.5 rounded w-24 bg-zinc-700 text-indigo-200 border border-indigo-500 focus:outline-none placeholder-zinc-500"
                  />
                ) : (
                  // 좌클릭 → 시간 직접 편집 / 우클릭 → 현재 재생 시간으로 설정
                  <button
                    onClick={(e) => { e.stopPropagation(); startTsEdit(line.id, line.timestamp); }}
                    onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); stampCurrentLine(line.id); }}
                    className={`font-mono text-xs px-2 py-0.5 rounded transition-colors ${tsClass}`}
                  >
                    {line.timestamp !== null ? formatDisplayTime(line.timestamp) : "-:--:--.---"}
                  </button>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (loopLineId === line.id) { setLoopLine(null); return; }
                  if (line.timestamp === null) return;
                  setLoopLine(line.id);
                  (serviceActive ? serviceControls : audioControls).seekTo(line.timestamp);
                }}
                disabled={line.timestamp === null}
                title={t.loopLine}
                aria-label={t.loopLine}
                aria-pressed={loopLineId === line.id}
                className={`shrink-0 px-1 transition-opacity disabled:opacity-0 ${
                  loopLineId === line.id
                    ? "text-indigo-400 opacity-100"
                    : "text-zinc-600 hover:text-indigo-300 opacity-0 group-hover/row:opacity-100 focus:opacity-100"
                }`}
              >
                <LoopIcon size={12} />
              </button>

              {hasGlyphSync && (
                <span
                  title={t.charSync.badge}
                  className="shrink-0 flex items-center justify-center w-5 h-5 rounded bg-indigo-500/15 text-indigo-300"
                >
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                    <path d="M5 8v8M12 5v14M19 8v8" />
                  </svg>
                </span>
              )}

              {warning && (
                <div className="relative group/warn shrink-0">
                  <span className="text-amber-400 text-sm leading-none cursor-help">⚠</span>
                  <div className={`pointer-events-none absolute left-0 hidden group-hover/warn:block z-30 ${idx < 2 ? "top-full mt-1.5" : "bottom-full mb-1.5"}`}>
                    <div className="bg-zinc-800 border border-amber-700/60 text-amber-200 text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
                      {warning === "duplicate" ? t.warnDuplicate : t.warnOutOfOrder}
                    </div>
                  </div>
                </div>
              )}

              <input
                ref={setInputRef(line.id)}
                type="text"
                value={line.text}
                onChange={(e) => handleTextChange(line.id, e.target.value)}
                onKeyDown={(e) => handleKeyDown(e, line.id)}
                onFocus={() => setActiveLineId(line.id)}
                onPaste={(e) => handlePaste(e, line.id, line.text)}
                className="flex-1 bg-transparent text-white text-sm placeholder-zinc-600 focus:outline-none"
                style={{ fontSize: `${0.875 * lyricsFontScale}rem` }}
                placeholder={t.linePlaceholder}
              />

              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (idx === 0) return;
                  const pid = mergeLineUp(line.id);
                  if (pid) { setActiveLineId(pid); pendingFocusId.current = pid; }
                }}
                disabled={idx === 0}
                className="shrink-0 text-zinc-600 hover:text-indigo-300 px-1 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity disabled:opacity-0"
                title={t.mergeLineUp}
                aria-label={t.mergeLineUp}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M8 7l4-4 4 4" /><path d="M12 3v8" /><path d="M5 21h14" /><path d="M5 15h14" />
                </svg>
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  const nid = duplicateLine(line.id);
                  setActiveLineId(nid); pendingFocusId.current = nid;
                }}
                className="shrink-0 text-zinc-600 hover:text-indigo-300 px-1 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
                title={t.duplicateLine}
                aria-label={t.duplicateLine}
              >
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" />
                </svg>
              </button>
              <button
                onClick={(e) => { e.stopPropagation(); deleteLine(line.id); }}
                className="shrink-0 text-zinc-600 hover:text-rose-400 text-sm px-1 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
                title={t.deleteLine}
                aria-label={t.deleteLine}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>
      </>)}

      <CurrentTimeFooter />

      {pendingTextEdit && (
        <MiniConfirm
          title={t.charSync.retokenizeTitle}
          message={t.charSync.retokenizeMsg}
          okLabel={t.charSync.retokenizeOk}
          cancelLabel={t.charSync.retokenizeCancel}
          onOk={confirmTextEdit}
          onCancel={() => setPendingTextEdit(null)}
        />
      )}
      {pendingUnit && (
        <MiniConfirm
          title={t.charSync.retokenizeTitle}
          message={t.charSync.unitChangeMsg}
          okLabel={t.charSync.retokenizeOk}
          cancelLabel={t.charSync.retokenizeCancel}
          onOk={confirmUnitChange}
          onCancel={() => setPendingUnit(null)}
        />
      )}
      {pendingAiSync && (
        <MiniConfirm
          title={t.aiSyncGlyphWarnTitle}
          message={t.aiSyncGlyphWarnMsg}
          okLabel={t.aiSyncGlyphWarnOk}
          cancelLabel={t.charSync.retokenizeCancel}
          onOk={() => { setPendingAiSync(false); runAiSyncNow(); }}
          onCancel={() => setPendingAiSync(false)}
        />
      )}
      {showValidation && (
        <ValidationPanel
          stats={stats}
          issues={issues}
          onJump={jumpToLine}
          onClose={() => setShowValidation(false)}
        />
      )}
    </div>
  );
}

