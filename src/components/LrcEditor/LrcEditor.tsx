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

// ISO 639-3 codes used by ctc-forced-aligner / MMS model
const LANG_CODE: Record<string, string> = { ko: "kor", en: "eng", ja: "jpn" };

export function LrcEditor({ onPreview }: { onPreview: () => void }) {
  // currentTime은 푸터에서만 쓰므로 구독에서 제외 → 재생 중 줄 목록이 매 프레임 리렌더되지 않음
  const {
    doc, activeLineId,
    addLine, insertLinesAfter, updateLine, deleteLine,
    stampCurrentLine, setActiveLineId,
    aiSyncStatus, aiSyncMessage, aiSyncProgressStatus, aiDraftConfidence,
    runAiSync, cancelAiSync, clearAiDraft,
    replaceInLines, shiftTimeRange,
    audioPath,
    syncMode, syncUnit, setSyncMode, setSyncUnit, clearLineSyllables,
  } = useLrcStore(
    useShallow((s) => ({
      doc: s.doc, activeLineId: s.activeLineId,
      addLine: s.addLine, insertLinesAfter: s.insertLinesAfter, updateLine: s.updateLine, deleteLine: s.deleteLine,
      stampCurrentLine: s.stampCurrentLine, setActiveLineId: s.setActiveLineId,
      aiSyncStatus: s.aiSyncStatus, aiSyncMessage: s.aiSyncMessage, aiSyncProgressStatus: s.aiSyncProgressStatus, aiDraftConfidence: s.aiDraftConfidence,
      runAiSync: s.runAiSync, cancelAiSync: s.cancelAiSync, clearAiDraft: s.clearAiDraft,
      replaceInLines: s.replaceInLines, shiftTimeRange: s.shiftTimeRange,
      audioPath: s.audioPath,
      syncMode: s.syncMode, syncUnit: s.syncUnit, setSyncMode: s.setSyncMode, setSyncUnit: s.setSyncUnit, clearLineSyllables: s.clearLineSyllables,
    }))
  );
  const { t, lang } = useI18nStore();
  const { blankLineOffset, spotifyMode, lyricsFontScale } = useSettingsStore();
  const serviceLoggedIn = useServiceStore((s) => s.isLoggedIn);
  // 실제 Spotify 모드(로그인 + spotifyMode 활성)일 때만 서비스 모드로 간주.
  // 단순 계정 연결만으로 AI 싱크를 막지 않도록 isReady 대신 spotifyMode 기준 사용.
  const isServiceMode = serviceLoggedIn && spotifyMode;
  const serviceActive = isServiceMode;
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
    if (e.key === "Enter" && !e.shiftKey) {
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

  const handleAiSync = () => {
    const language = LANG_CODE[lang] ?? "eng";
    runAiSync(language, blankLineOffset);
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
          {warnings.size > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-400 bg-amber-900/20 border border-amber-800/50 rounded-full px-2 py-0.5">
              ⚠ {warnings.size} {t.validationSummary}
            </span>
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
              disabled={isRunning || !canRunAi || !audioPath || isServiceMode}
              className={[
                "px-3 py-1 text-xs rounded-lg transition-colors",
                isRunning
                  ? "bg-indigo-800 text-indigo-300 cursor-not-allowed"
                  : canRunAi && audioPath && !isServiceMode
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                  : "bg-zinc-700 text-zinc-500 cursor-not-allowed",
              ].join(" ")}
            >
              {isRunning ? t.aiSyncRunning : t.aiAutoSync}
            </button>
            {!isRunning && (isServiceMode || !canRunAi || !audioPath) && (
              <div className="absolute top-full right-0 mt-1.5 hidden group-hover:block z-20 w-60 bg-zinc-800 border border-zinc-600 text-xs text-zinc-300 rounded-lg px-3 py-2 shadow-xl pointer-events-none">
                {isServiceMode ? (
                  t.spotifyServiceModeInfo
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
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${showTools || showFR || showTS ? "bg-zinc-700 text-white" : "text-zinc-400 hover:bg-zinc-800 hover:text-white"}`}
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
              onClick={() => {
                setActiveLineId(line.id);
                // 줄 클릭 → 해당 타임스탬프로 시크. 현재 활성 플레이어에 맞게 분기
                // (Spotify 모드면 Spotify 재생 위치, 아니면 로컬 파형)
                if (line.timestamp !== null) {
                  (serviceActive ? serviceControls : audioControls).seekTo(line.timestamp);
                }
                if (showFR) {
                  const idx = matchIds.indexOf(line.id);
                  if (idx !== -1) setMatchPos(idx);
                }
              }}
              className={`group/row flex items-center gap-2 rounded-lg px-2 py-1 transition-colors cursor-pointer ${
                isCurrentMatch
                  ? "bg-amber-900/30 ring-1 ring-amber-500"
                  : isActive
                  ? "bg-indigo-900/40 ring-1 ring-indigo-500"
                  : isMatch
                  ? "bg-amber-900/10 ring-1 ring-amber-800"
                  : "hover:bg-zinc-800"
              }`}
            >
              <span className="text-zinc-600 text-xs w-6 shrink-0 text-right select-none">
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
                onClick={(e) => { e.stopPropagation(); deleteLine(line.id); }}
                className="shrink-0 text-zinc-600 hover:text-rose-400 text-sm px-1 opacity-0 group-hover/row:opacity-100 focus:opacity-100 transition-opacity"
                title={t.deleteLine}
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
    </div>
  );
}

// currentTime만 구독하는 푸터 → 재생 중 이 작은 컴포넌트만 리렌더(줄 목록 영향 없음)
function CurrentTimeFooter() {
  const currentTime = useLrcStore((s) => s.currentTime);
  const { t } = useI18nStore();
  return (
    <div className="text-xs text-zinc-500 text-right font-mono">
      {t.currentTimeLabel}{formatDisplayTime(currentTime)}
    </div>
  );
}

function MiniConfirm({
  title, message, okLabel, cancelLabel, onOk, onCancel,
}: {
  title: string; message: string; okLabel: string; cancelLabel: string;
  onOk: () => void; onCancel: () => void;
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onCancel(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onCancel]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100">{title}</span>
        </div>
        <div className="px-5 py-4">
          <p className="text-sm text-zinc-300 whitespace-pre-line">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-4">
          <button onClick={onCancel} className="px-4 py-1.5 text-sm rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">{cancelLabel}</button>
          <button onClick={onOk} className="px-4 py-1.5 text-sm rounded-lg text-white bg-rose-600 hover:bg-rose-500 transition-colors">{okLabel}</button>
        </div>
      </div>
    </div>
  );
}

function FindReplaceBar({
  findText, replaceText, caseSensitive,
  matchCount, matchPos,
  onFindChange, onReplaceChange, onCaseSensitiveToggle,
  onPrev, onNext, onReplace, onReplaceAll, onClose,
  findInputRef,
}: {
  findText: string; replaceText: string; caseSensitive: boolean;
  matchCount: number; matchPos: number;
  onFindChange: (v: string) => void; onReplaceChange: (v: string) => void;
  onCaseSensitiveToggle: () => void;
  onPrev: () => void; onNext: () => void;
  onReplace: () => void; onReplaceAll: () => void; onClose: () => void;
  findInputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { t } = useI18nStore();

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const countLabel = findText
    ? matchCount === 0
      ? t.noMatches
      : `${matchPos + 1} / ${matchCount}`
    : "";

  return (
    <div className="flex flex-col gap-1.5 px-2 py-2 bg-zinc-800 border border-zinc-700 rounded-lg">
      {/* 찾기 행 */}
      <div className="flex items-center gap-1.5">
        <input
          ref={findInputRef}
          type="text"
          value={findText}
          onChange={(e) => onFindChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); e.shiftKey ? onPrev() : onNext(); }
          }}
          placeholder={t.findPlaceholder}
          className="flex-1 min-w-0 px-2.5 py-1 text-sm bg-zinc-900 border border-zinc-600 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
        />
        {/* 대소문자 구분 */}
        <div className="relative group/aa">
          <button
            onClick={onCaseSensitiveToggle}
            className={`px-2 py-1 text-xs rounded-lg font-mono transition-colors ${
              caseSensitive
                ? "bg-amber-600 text-white"
                : "bg-zinc-700 hover:bg-zinc-600 text-zinc-300"
            }`}
          >
            Aa
          </button>
          <div className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 hidden group-hover/aa:block z-30">
            <div className="bg-zinc-800 border border-zinc-600 text-zinc-200 text-xs rounded-lg px-2.5 py-1.5 shadow-xl whitespace-nowrap">
              {t.caseSensitive}
            </div>
          </div>
        </div>
        {/* 결과 카운트 */}
        <span className={`text-xs font-mono w-14 text-right shrink-0 ${matchCount === 0 && findText ? "text-red-400" : "text-zinc-400"}`}>
          {countLabel}
        </span>
        {/* 이전/다음 */}
        <button onClick={onPrev} disabled={matchCount === 0} className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors" title="이전 (Shift+Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="18 15 12 9 6 15"/></svg>
        </button>
        <button onClick={onNext} disabled={matchCount === 0} className="w-6 h-6 flex items-center justify-center rounded text-zinc-400 hover:text-white hover:bg-zinc-700 disabled:opacity-30 transition-colors" title="다음 (Enter)">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
        </button>
        {/* 닫기 */}
        <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      {/* 바꾸기 행 */}
      <div className="flex items-center gap-1.5">
        <input
          type="text"
          value={replaceText}
          onChange={(e) => onReplaceChange(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); onReplace(); } }}
          placeholder={t.replacePlaceholder}
          className="flex-1 min-w-0 px-2.5 py-1 text-sm bg-zinc-900 border border-zinc-600 rounded-lg text-white placeholder-zinc-500 focus:outline-none focus:border-amber-500 transition-colors"
        />
        <button
          onClick={onReplace}
          disabled={matchCount === 0}
          className="shrink-0 px-3 py-1 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 disabled:opacity-40 transition-colors"
        >
          {t.replaceBtn}
        </button>
        <button
          onClick={onReplaceAll}
          disabled={matchCount === 0}
          className="shrink-0 px-3 py-1 text-xs rounded-lg bg-amber-700 hover:bg-amber-600 text-white disabled:opacity-40 transition-colors"
        >
          {t.replaceAll}
        </button>
      </div>
    </div>
  );
}

function TimeShiftBar({
  lineCount, defaultFrom, onApply, onClose,
}: {
  lineCount: number;
  defaultFrom: number; // 1-based
  onApply: (fromIdx: number, toIdx: number, delta: number) => void;
  onClose: () => void;
}) {
  const { t } = useI18nStore();
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(lineCount);
  const [delta, setDelta] = useState(0);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleApply();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onClose, from, to, delta]);

  const clampFrom = (v: number) => Math.max(1, Math.min(v, to));
  const clampTo = (v: number) => Math.max(from, Math.min(v, lineCount));

  const handleApply = () => {
    if (delta === 0) return;
    onApply(from - 1, to - 1, delta); // 0-based 변환
  };

  const step = (d: number) => setDelta((v) => Math.round((v + d) * 1000) / 1000);

  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-xs">
      {/* 범위 */}
      <span className="text-zinc-400 shrink-0">{t.timeShiftFrom}</span>
      <input
        type="number"
        min={1} max={to}
        value={from}
        onChange={(e) => setFrom(clampFrom(parseInt(e.target.value, 10) || 1))}
        className="w-14 px-2 py-1 bg-zinc-900 border border-zinc-600 rounded-lg text-white text-center focus:outline-none focus:border-sky-500 transition-colors"
      />
      <span className="text-zinc-500">~</span>
      <span className="text-zinc-400 shrink-0">{t.timeShiftTo}</span>
      <input
        type="number"
        min={from} max={lineCount}
        value={to}
        onChange={(e) => setTo(clampTo(parseInt(e.target.value, 10) || lineCount))}
        className="w-14 px-2 py-1 bg-zinc-900 border border-zinc-600 rounded-lg text-white text-center focus:outline-none focus:border-sky-500 transition-colors"
      />

      <div className="w-px h-4 bg-zinc-700 shrink-0" />

      {/* 이동량 */}
      <span className="text-zinc-400 shrink-0">{t.timeShiftDelta}</span>
      <div className="flex items-center gap-1">
        <button onClick={() => step(-0.1)} className="w-6 h-6 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">−</button>
        <input
          type="number"
          step={0.1}
          value={delta}
          onChange={(e) => setDelta(parseFloat(e.target.value) || 0)}
          className="w-20 px-2 py-1 bg-zinc-900 border border-zinc-600 rounded-lg text-white text-center focus:outline-none focus:border-sky-500 transition-colors"
        />
        <button onClick={() => step(0.1)} className="w-6 h-6 flex items-center justify-center rounded bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors">+</button>
        <span className="text-zinc-500">{t.timeShiftSec}</span>
      </div>

      <div className="w-px h-4 bg-zinc-700 shrink-0" />

      {/* 적용 / 닫기 */}
      <button
        onClick={handleApply}
        disabled={delta === 0}
        className="px-3 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 text-white disabled:opacity-40 transition-colors"
      >
        {t.timeShiftApply}
      </button>
      <button onClick={onClose} className="w-6 h-6 flex items-center justify-center rounded text-zinc-500 hover:text-white hover:bg-zinc-700 transition-colors">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
      </button>
    </div>
  );
}
