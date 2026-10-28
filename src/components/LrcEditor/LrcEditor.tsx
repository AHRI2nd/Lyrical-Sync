import { isComposingKeyEvent } from "../../utils/keybindings";
import { useRef, useEffect, useCallback, useState, useMemo, lazy, Suspense } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { formatDisplayTime, parseTimestampInput, validateTimestamps, type SyncUnit } from "../../utils/lrcParser";
import { audioControls } from "../../utils/audioControls";
import { serviceControls } from "../../utils/serviceControls";
import { deviceControls } from "../../utils/deviceControls";
import { MODEL_DEFS } from "../../utils/modelDefs";
import { listenSafely } from "../../utils/safeListen";
import type { LrcLine, LrcSyllable } from "../../types/lrc";
import { CurrentTimeFooter } from "./CurrentTimeFooter";
import { MiniConfirm } from "./MiniConfirm";
import { FindReplaceBar } from "./FindReplaceBar";
import { TimeShiftBar } from "./TimeShiftBar";
import { ValidationPanel } from "./ValidationPanel";
import { ScaleBar } from "./ScaleBar";
import { LrcLineRow } from "./LrcLineRow";
import { SyncModeToggle } from "./SyncModeToggle";
import { EditorToolsMenu } from "./EditorToolsMenu";
import { BulkActionsBar } from "./BulkActionsBar";
// 글자 동기화 뷰는 모드 전환 시에만 필요 → 지연 로드
const CharSyncView = lazy(() => import("./CharSyncView").then((m) => ({ default: m.CharSyncView })));
const BpmSnapModal = lazy(() => import("../AudioPlayer/BpmSnapModal").then((m) => ({ default: m.BpmSnapModal })));

// ISO 639-3 codes used by ctc-forced-aligner / MMS model
const LANG_CODE: Record<string, string> = { ko: "kor", en: "eng", ja: "jpn" };

export function LrcEditor({ onPreview, onOpenShortcuts }: { onPreview: () => void; onOpenShortcuts?: () => void }) {
  // currentTime은 푸터에서만 쓰므로 구독에서 제외 → 재생 중 줄 목록이 매 프레임 리렌더되지 않음
  const {
    doc, activeLineId, documentSession,
    addLine, insertLinesAfter, pasteLinesAfter, updateLine, deleteLine,
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
      doc: s.doc, activeLineId: s.activeLineId, documentSession: s._documentSession,
      addLine: s.addLine, insertLinesAfter: s.insertLinesAfter, pasteLinesAfter: s.pasteLinesAfter, updateLine: s.updateLine, deleteLine: s.deleteLine,
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
  const { blankLineOffset, modelsDir, spotifyMode, deviceMode, lyricsFontScale, useVocalSeparation, useVad, showSpellCheck, showTranslationLines } = useSettingsStore();
  const serviceLoggedIn = useServiceStore((s) => s.isLoggedIn);
  // 실제 Spotify 모드(로그인 + spotifyMode 활성)일 때만 서비스 모드로 간주.
  // 단순 계정 연결만으로 AI 싱크를 막지 않도록 isReady 대신 spotifyMode 기준 사용.
  const isServiceMode = serviceLoggedIn && spotifyMode;
  const serviceActive = isServiceMode;
  const seekControls = serviceActive ? serviceControls : deviceMode ? deviceControls : audioControls;
  // AI 자동 동기화는 로컬 오디오가 있는 파일/YouTube 모드에서만 의미가 있음.
  // Spotify는 로그인 전이어도, 기기 감지는 항상 로컬 오디오가 없으므로 둘 다 차단
  // (로그인 여부로 판단하는 isServiceMode와 달리 spotifyMode 자체로 판단).
  const aiSyncModeUnsupported = spotifyMode || deviceMode;
  const { lines } = doc;

  const inputRefs = useRef<Map<string, HTMLInputElement | HTMLTextAreaElement>>(new Map());
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusId = useRef<string | null>(null);

  const [pythonReady, setPythonReady] = useState(false);
  const [missingModels, setMissingModels] = useState<string[]>([]);
  const aiRequirementsRequest = useRef(0);
  const aiRequirementsMounted = useRef(true);

  useEffect(() => {
    aiRequirementsMounted.current = true;
    return () => {
      aiRequirementsMounted.current = false;
      aiRequirementsRequest.current += 1;
    };
  }, []);

  // Find/Replace state
  const [showFR, setShowFR] = useState(false);

  // Time Shift state
  const [showTS, setShowTS] = useState(false);
  const [showScale, setShowScale] = useState(false);
  const [showBpmSnap, setShowBpmSnap] = useState(false);
  const [showValidation, setShowValidation] = useState(false);
  // 줄 다중선택(일괄 작업)
  const [selection, setSelection] = useState<{ session: number; ids: Set<string> }>({ session: documentSession, ids: new Set() });
  const selectedIds = selection.session === documentSession ? selection.ids : new Set<string>();
  const changeSelection = (update: (ids: Set<string>) => Set<string>) => {
    const session = useLrcStore.getState()._documentSession;
    setSelection((previous) => ({ session, ids: update(previous.session === session ? previous.ids : new Set()) }));
  };
  // 렌더에 직접 반영되지 않는(shift-클릭 범위 선택 계산에만 쓰이는) 값이라 ref로 보관 —
  // handleRowClick을 useCallback으로 안정화할 때 상태로 두면 의존성이 돼 참조가 계속 바뀜
  const selAnchorRef = useRef<string | null>(null);
  const selAnchorSessionRef = useRef<number | null>(documentSession);

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
  const tsEditSession = useRef<number | null>(null);

  // 글자 동기화된 줄의 텍스트 수정 경고 / 단위 변경 경고
  const [pendingTextEdit, setPendingTextEdit] = useState<{
    id: string; text: string; session: number; baseText: string; baseSyllables: LrcSyllable[] | undefined;
  } | null>(null);
  const [pendingGlyphMutation, setPendingGlyphMutation] = useState<{
    session: number;
    sources: Pick<LrcLine, "id" | "text" | "timestamp" | "syllables" | "translation">[];
    requireAdjacentSources: boolean;
    apply: () => void;
  } | null>(null);
  const [pendingTranslationSplit, setPendingTranslationSplit] = useState<{
    id: string;
    caretPos: number;
    session: number;
    text: string;
    translation: string;
    first: string;
    second: string;
  } | null>(null);
  const [pendingUnit, setPendingUnit] = useState<{
    unit: SyncUnit; session: number; lineId: string; baseSyllables: LrcSyllable[];
  } | null>(null);
  const [pendingAiSync, setPendingAiSync] = useState<{
    session: number; audioSelection: number; syncMode: string; doc: typeof doc;
  } | null>(null);
  useEffect(() => {
    setSelection({ session: documentSession, ids: new Set() });
    selAnchorRef.current = null;
    selAnchorSessionRef.current = documentSession;
    tsEditSession.current = null;
    setEditingTsId(null);
    setEditTsValue("");
    setPendingTextEdit(null);
    setPendingGlyphMutation(null);
    setPendingUnit(null);
    setPendingAiSync(null);
    setPendingTranslationSplit(null);
  }, [documentSession]);
  useEffect(() => {
    if (!pendingTranslationSplit) return;
    const cancel = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isComposingKeyEvent(event)) setPendingTranslationSplit(null);
    };
    window.addEventListener("keydown", cancel);
    return () => window.removeEventListener("keydown", cancel);
  }, [pendingTranslationSplit]);
  const applyTranslationSplit = () => {
    const pending = pendingTranslationSplit;
    if (!pending) return;
    const current = useLrcStore.getState();
    const line = current.doc.lines.find(item => item.id === pending.id);
    if (current._documentSession === pending.session && line?.text === pending.text && line.translation === pending.translation) {
      const newId = splitLine(pending.id, pending.caretPos, { first: pending.first, second: pending.second });
      setActiveLineId(newId);
      pendingFocusId.current = newId;
    }
    setPendingTranslationSplit(null);
  };
  // 드래그 재정렬 상태
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dropGapIdx, setDropGapIdx] = useState<number | null>(null);
  const reorderRef = useRef<{ lineId: string; pointerId: number; startX: number; startY: number; active: boolean; gap: number | null } | null>(null);

  const clearReorder = () => {
    reorderRef.current = null;
    setDragIdx(null);
    setDropGapIdx(null);
  };

  useEffect(() => { clearReorder(); }, [documentSession, syncMode]);

  const gapAtPoint = (x: number, y: number, list: HTMLDivElement): number | null => {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !list.contains(hit)) return null;
    const rows = list.querySelectorAll<HTMLElement>("[data-line-id]");
    for (let index = 0; index < rows.length; index++) {
      const rect = rows[index].getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return index;
    }
    return rows.length;
  };

  const handleReorderMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = reorderRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (!drag.active) {
      const distance = Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY);
      if (distance < 5) return;
      drag.active = true;
      const sourceIndex = useLrcStore.getState().doc.lines.findIndex((line) => line.id === drag.lineId);
      if (sourceIndex < 0) { clearReorder(); return; }
      setDragIdx(sourceIndex);
    }
    const nextGap = gapAtPoint(e.clientX, e.clientY, e.currentTarget);
    drag.gap = nextGap;
    setDropGapIdx((previous) => previous === nextGap ? previous : nextGap);
  };

  const handleReorderUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const drag = reorderRef.current;
    if (!drag || drag.pointerId !== e.pointerId) return;
    if (drag.active && drag.gap !== null && e.currentTarget.contains(document.elementFromPoint(e.clientX, e.clientY))) {
      const currentLines = useLrcStore.getState().doc.lines;
      const from = currentLines.findIndex((line) => line.id === drag.lineId);
      if (from >= 0) {
        const to = drag.gap > from ? drag.gap - 1 : drag.gap;
        if (to !== from) moveLine(from, to);
      }
    }
    clearReorder();
  };

  const charMode = syncMode === "char";

  // 텍스트 입력: 글자 타이밍이 있는 줄이면 경고 후 재토큰화 동의 받기
  const handleTextChange = (id: string, value: string) => {
    const ln = useLrcStore.getState().doc.lines.find((l) => l.id === id);
    if (!ln || ln.text === value) return;
    if (ln.syllables?.some((s) => s.time !== null)) {
      const current = useLrcStore.getState();
      setPendingTextEdit({
        id,
        text: value,
        session: current._documentSession,
        baseText: ln.text,
        baseSyllables: ln.syllables?.map((syllable) => ({ ...syllable })),
      });
      return;
    }
    updateLine(id, { text: value });
  };
  const confirmTextEdit = () => {
    if (pendingTextEdit) {
      const current = useLrcStore.getState();
      const line = current.doc.lines.find((item) => item.id === pendingTextEdit.id);
      const syllablesMatch = JSON.stringify(line?.syllables) === JSON.stringify(pendingTextEdit.baseSyllables);
      if (current._documentSession === pendingTextEdit.session && line?.text === pendingTextEdit.baseText && syllablesMatch) {
        updateLine(pendingTextEdit.id, { text: pendingTextEdit.text, syllables: undefined });
      }
    }
    setPendingTextEdit(null);
  };

  const requestGlyphMutation = (sources: LrcLine[], apply: () => void, requireAdjacentSources = false) => {
    if (!sources.some((line) => line.syllables?.some((syllable) => syllable.time !== null))) {
      apply();
      return;
    }
    setPendingGlyphMutation({
      session: useLrcStore.getState()._documentSession,
      sources: sources.map(({ id, text, timestamp, syllables, translation }) => ({
        id, text, timestamp, translation, syllables: syllables?.map((syllable) => ({ ...syllable })),
      })),
      requireAdjacentSources,
      apply,
    });
  };

  const confirmGlyphMutation = () => {
    if (pendingGlyphMutation) {
      const current = useLrcStore.getState();
      const sourcesMatch = pendingGlyphMutation.sources.every((source) => {
        const line = current.doc.lines.find((item) => item.id === source.id);
        return line?.text === source.text && line.timestamp === source.timestamp && line.translation === source.translation &&
          JSON.stringify(line?.syllables) === JSON.stringify(source.syllables);
      });
      const sourcesStayAdjacent = !pendingGlyphMutation.requireAdjacentSources || (
        pendingGlyphMutation.sources.length === 2 &&
        current.doc.lines.findIndex((line) => line.id === pendingGlyphMutation.sources[1].id) ===
          current.doc.lines.findIndex((line) => line.id === pendingGlyphMutation.sources[0].id) + 1
      );
      if (current._documentSession === pendingGlyphMutation.session && sourcesMatch && sourcesStayAdjacent) pendingGlyphMutation.apply();
    }
    setPendingGlyphMutation(null);
  };

  // 단위 변경: 활성 줄에 글자 타이밍이 있으면 경고 후 해당 줄 초기화
  const handleUnitChange = (u: SyncUnit) => {
    if (u === syncUnit) return;
    const active = lines.find((l) => l.id === activeLineId);
    if (active?.syllables?.some((s) => s.time !== null)) {
      const current = useLrcStore.getState();
      setPendingUnit({
        unit: u,
        session: current._documentSession,
        lineId: active.id,
        baseSyllables: active.syllables?.map((syllable) => ({ ...syllable })) ?? [],
      });
      return;
    }
    setSyncUnit(u);
  };
  const confirmUnitChange = () => {
    if (pendingUnit) {
      const current = useLrcStore.getState();
      const active = current.doc.lines.find((line) => line.id === pendingUnit.lineId);
      const syllablesMatch = JSON.stringify(active?.syllables) === JSON.stringify(pendingUnit.baseSyllables);
      if (current._documentSession === pendingUnit.session && current.syncUnit !== pendingUnit.unit &&
        current.activeLineId === pendingUnit.lineId && syllablesMatch) {
        if (active) clearLineSyllables(active.id);
        setSyncUnit(pendingUnit.unit);
      }
    }
    setPendingUnit(null);
  };

  const startTsEdit = (id: string, timestamp: number | null) => {
    tsEditCancel.current = false;
    tsEditSession.current = useLrcStore.getState()._documentSession;
    setActiveLineId(id);
    setEditTsValue(timestamp !== null ? formatDisplayTime(timestamp) : "");
    setEditingTsId(id);
  };
  const commitTsEdit = (id: string) => {
    if (tsEditCancel.current) { tsEditCancel.current = false; return; }
    const store = useLrcStore.getState();
    if (tsEditSession.current === null || store._documentSession !== tsEditSession.current) {
      tsEditSession.current = null;
      setEditingTsId(null);
      return;
    }
    const parsed = parseTimestampInput(editTsValue.trim());
    const current = store.doc.lines.find((line) => line.id === id)?.timestamp;
    if (parsed !== null && current !== undefined && parsed !== current && (current == null || editTsValue.trim() !== formatDisplayTime(current))) {
      updateLine(id, { timestamp: parsed });
    }
    tsEditSession.current = null;
    setEditingTsId(null);
  };
  const cancelTsEdit = () => {
    tsEditCancel.current = true;
    setEditingTsId(null);
  };

  const checkAiRequirements = useCallback(async () => {
    const requestId = ++aiRequirementsRequest.current;
    const requestedModelsDir = modelsDir;
    const isCurrent = () => aiRequirementsMounted.current
      && requestId === aiRequirementsRequest.current
      && useSettingsStore.getState().modelsDir === requestedModelsDir;
    // 앱 재시작 뒤에도 설정 화면을 열기 전에 커스텀 모델 경로를 Rust 상태에 반영한다.
    await invoke("set_models_dir_override", { path: modelsDir || null }).catch(() => {});
    if (!isCurrent()) return;
    try {
      const v = await invoke<{ packagesReady: boolean }>("get_python_env_info");
      if (!isCurrent()) return;
      setPythonReady(v.packagesReady);
    } catch {
      if (!isCurrent()) return;
      setPythonReady(false);
    }
    const missing: string[] = [];
    for (const model of MODEL_DEFS.filter((m) => m.required)) {
      try {
        const results = await invoke<boolean[]>("check_model_files", { filenames: model.files.map((f) => f.filename) });
        if (!isCurrent()) return;
        if (!results.every(Boolean)) missing.push(model.name);
      } catch {
        if (!isCurrent()) return;
        missing.push(model.name);
      }
    }
    if (isCurrent()) setMissingModels(missing);
  }, [modelsDir]);

  useEffect(() => { checkAiRequirements(); }, [checkAiRequirements]);

  useEffect(() => {
    let active = true;
    const register = async (event: string) => {
      return listen<{ done: boolean }>(event, (e) => {
        if (active && e.payload.done) checkAiRequirements();
      });
    };
    const stopModel = listenSafely(() => register("model-download-progress"));
    const stopPip = listenSafely(() => register("pip-install-progress"));
    return () => { active = false; stopModel(); stopPip(); };
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

  const setInputRef = useCallback((id: string) => (el: HTMLInputElement | HTMLTextAreaElement | null) => {
    if (el) inputRefs.current.set(id, el);
    else inputRefs.current.delete(id);
  }, []);

  const setRowRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>, id: string) => {
    if (isComposingKeyEvent(e.nativeEvent)) return;
    if (e.key === "Enter" && e.shiftKey) {
      // Shift+Enter = 커서 위치에서 줄 분할
      e.preventDefault();
      const caret = e.currentTarget.selectionStart ?? e.currentTarget.value.length;
      const current = useLrcStore.getState();
      const line = current.doc.lines.find((item) => item.id === id);
      if (line?.translation !== undefined) {
        const requestSplit = () => setPendingTranslationSplit({ id, caretPos: caret, session: current._documentSession, text: line.text,
          translation: line.translation!, first: line.translation!, second: "" });
        if (line.syllables?.some((syllable) => syllable.time !== null)) requestGlyphMutation([line], requestSplit);
        else requestSplit();
        return;
      }
      if (line?.syllables?.some((syllable) => syllable.time !== null)) {
        requestGlyphMutation([line], () => {
          const newId = splitLine(id, caret);
          setActiveLineId(newId);
          pendingFocusId.current = newId;
        });
        return;
      }
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

    const restTexts = pasteLines.slice(1);
    restTexts[restTexts.length - 1] += after;
    const apply = () => {
      const newId = pasteLinesAfter(id, before + pasteLines[0], restTexts);
      setActiveLineId(newId);
      pendingFocusId.current = newId;
    };
    const source = useLrcStore.getState().doc.lines.find((line) => line.id === id);
    if (source) requestGlyphMutation([source], apply);
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

  // 줄 클릭: Shift=범위 선택, Ctrl/⌘=토글, 일반=단일 선택+시크(기존 동작).
  // LrcLineRow가 React.memo로 감싸여 있어 안 건드린 줄은 오래 리렌더되지 않을 수 있으므로,
  // 이 핸들러는 useCallback으로 참조를 고정하고 매 렌더 바뀌는 값(lines/selAnchor/matchIds)은
  // ref나 getState()로 그때그때 최신값을 읽는다 — 그래야 오래된 줄에 붙은 낡은 클로저를
  // 클릭해도 항상 최신 선택/검색 상태를 참조한다.
  const handleRowClick = useCallback((e: React.MouseEvent, id: string, idx: number) => {
    const currentLines = useLrcStore.getState().doc.lines;
    const currentSession = useLrcStore.getState()._documentSession;
    if (e.shiftKey && selAnchorRef.current && selAnchorSessionRef.current === currentSession) {
      const aIdx = currentLines.findIndex((l) => l.id === selAnchorRef.current);
      if (aIdx >= 0) {
        const [lo, hi] = aIdx <= idx ? [aIdx, idx] : [idx, aIdx];
        changeSelection(() => new Set(currentLines.slice(lo, hi + 1).map((l) => l.id)));
      }
      setActiveLineId(id);
      return;
    }
    if (e.metaKey || e.ctrlKey) {
      changeSelection((prev) => {
        const n = new Set(prev);
        if (n.has(id)) n.delete(id); else n.add(id);
        return n;
      });
      selAnchorRef.current = id;
      selAnchorSessionRef.current = currentSession;
      setActiveLineId(id);
      return;
    }
    // 일반 클릭: 다중선택 해제 + 기존 동작(활성/시크/찾기)
    changeSelection((prev) => (prev.size > 0 ? new Set() : prev));
    selAnchorRef.current = id;
    selAnchorSessionRef.current = currentSession;
    setActiveLineId(id);
    const ln = currentLines.find((l) => l.id === id);
    if (ln && ln.timestamp !== null) {
      seekControls.seekTo(ln.timestamp);
    }
    if (showFR) {
      const mi = matchIdsRef.current.indexOf(id);
      if (mi !== -1) setMatchPos(mi);
    }
  }, [showFR, seekControls, setActiveLineId]);

  // 매칭 줄 id 목록
  const matchIds = useMemo(() => {
    if (!findText) return [];
    const needle = caseSensitive ? findText : findText.toLowerCase();
    return lines
      .filter((l) => (caseSensitive ? l.text : l.text.toLowerCase()).includes(needle))
      .map((l) => l.id);
  }, [lines, findText, caseSensitive]);
  // handleRowClick을 안정된 참조로 유지하려고 matchIds를 의존성에 넣지 않는 대신 ref로 미러링
  // (매 키 입력마다 lines가 바뀌어 matchIds도 매번 새 배열이 되므로, 그대로 의존성에 넣으면
  // handleRowClick도 매번 바뀌어 모든 줄이 다시 렌더되는 원래 문제가 되풀이됨)
  const matchIdsRef = useRef<string[]>(matchIds);
  useEffect(() => { matchIdsRef.current = matchIds; }, [matchIds]);

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
    const newText = line.text.replace(re, () => replaceText);
    if (newText !== line.text) handleTextChange(id, newText);
    // 다음 매치로 이동 (matchIds는 갱신되므로 다음 렌더 후 자동 이동)
    setMatchPos((p) => (p < matchIds.length - 1 ? p + 1 : 0));
  }, [matchIds, matchPos, findText, replaceText, caseSensitive, lines, handleTextChange]);

  const handleReplaceAll = useCallback(() => {
    if (!findText) return;
    const escaped = findText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(escaped, caseSensitive ? "g" : "gi");
    const affected = useLrcStore.getState().doc.lines.filter((line) => line.text.replace(re, () => replaceText) !== line.text);
    if (!affected.length) return;
    requestGlyphMutation(affected, () => replaceInLines(findText, replaceText, caseSensitive));
    setMatchPos(0);
  }, [findText, replaceText, caseSensitive, replaceInLines, requestGlyphMutation]);

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
    if (hasGlyph) {
      const current = useLrcStore.getState();
      setPendingAiSync({
        session: current._documentSession,
        audioSelection: current._audioSelection,
        syncMode: current.syncMode,
        doc: current.doc,
      });
      return;
    }
    runAiSyncNow();
  };
  const confirmAiSync = () => {
    const pending = pendingAiSync;
    setPendingAiSync(null);
    if (!pending) return;
    const current = useLrcStore.getState();
    if (current._documentSession !== pending.session || current._audioSelection !== pending.audioSelection ||
      current.syncMode !== pending.syncMode || current.doc !== pending.doc) return;
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
    <div className="ls-panel flex flex-col gap-2 p-4 border border-transparent flex-1 min-h-0 min-w-0">
      <div className="flex flex-wrap gap-2 items-center justify-between">
        <div className="flex items-center gap-2 shrink-0">
          <h2 className="text-sm font-semibold text-[var(--ls-text-secondary)]">{t.lyricsEditor}</h2>
          {!charMode && stats.total > 0 && (
            <button
              onClick={() => setShowValidation(true)}
              title={t.validationTitle}
              className="ls-button flex items-center gap-1.5 text-xs transition-colors"
            >
              <span className={stats.pct === 100 ? "text-emerald-400" : "text-[var(--ls-text-secondary)]"}>{stats.pct}%</span>
              {warnings.size > 0 && <span className="text-[var(--ls-playhead)]">⚠ {warnings.size}</span>}
            </button>
          )}
        </div>
        <div className="flex gap-2 items-center flex-wrap justify-end">

          <SyncModeToggle
            t={t} charMode={charMode} onSetSyncMode={setSyncMode}
            syncUnit={syncUnit} onUnitChange={handleUnitChange} isRunning={isRunning} runningTitle={t.aiSyncRunning}
          />

          {!charMode && (<>
          {/* AI Auto Sync */}
          <div className="relative group">
            <button
              onClick={isRunning ? undefined : handleAiSync}
              disabled={isRunning || !canRunAi || !audioPath || aiSyncModeUnsupported}
              className={`ls-button ${[
                "px-3 py-1 text-xs rounded-lg transition-colors",
                isRunning
                  ? "bg-[var(--ls-primary)] text-[var(--ls-accent)] cursor-not-allowed"
                  : canRunAi && audioPath && !aiSyncModeUnsupported
                  ? "bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] text-white"
                  : "bg-[var(--ls-control)] text-[var(--ls-text-secondary)] cursor-not-allowed",
              ].join(" ")}`}
            >
              {isRunning ? t.aiSyncRunning : t.aiAutoSync}
            </button>
            {!isRunning && (aiSyncModeUnsupported || !canRunAi || !audioPath) && (
              <div className="absolute top-full right-0 mt-1.5 hidden group-hover:block z-20 w-60 bg-[var(--ls-control)] border border-[var(--ls-border-control)] text-xs text-[var(--ls-text-secondary)] rounded-lg px-3 py-2 shadow-xl pointer-events-none">
                {aiSyncModeUnsupported ? (
                  t.aiSyncModeUnsupported
                ) : !canRunAi ? (
                  <>
                    <p className="font-medium text-[var(--ls-text)] mb-1">{t.aiSyncNoModel}</p>
                    <ul className="flex flex-col gap-0.5 text-[var(--ls-text-secondary)]">
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
              className="ls-button text-xs hover:text-white transition-colors"
            >
              {t.aiSyncCancel}
            </button>
          )}

          {/* Clear AI draft */}
          {aiDraftConfidence && !isRunning && (
            <button
              onClick={clearAiDraft}
              className="ls-button text-xs hover:text-white transition-colors"
            >
              {t.aiSyncClear}
            </button>
          )}

          <EditorToolsMenu
            t={t} showFR={showFR} showTS={showTS} showScale={showScale}
            onToggleFR={() => { setShowFR((v) => !v); setTimeout(() => findInputRef.current?.focus(), 0); }}
            onToggleTS={() => setShowTS((v) => !v)}
            onToggleScale={() => setShowScale((v) => !v)}
            onOpenBpmSnap={() => setShowBpmSnap(true)}
          />
          </>)}
          <button
            onClick={onPreview}
            className="ls-button text-xs hover:text-white transition-colors"
          >
            {t.previewBtn}
          </button>
          {!charMode && (
          <button
            onClick={handleAddLine}
            className="ls-button text-xs bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] text-white transition-colors ls-button--primary"
          >
            {t.addLine}
          </button>
          )}
        </div>
      </div>

      {charMode && (
        <Suspense fallback={null}>
          <CharSyncView onOpenShortcuts={onOpenShortcuts} />
        </Suspense>
      )}

      {!charMode && (<>
      {/* AI progress message */}
      {(isRunning || aiSyncStatus === "error") && displayMessage && (
        <div className={[
          "text-xs px-2 py-1 rounded",
          aiSyncStatus === "error"
            ? "text-red-300 bg-red-900/30"
            : "text-[var(--ls-accent)] bg-[var(--ls-primary)]/30",
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

      <BulkActionsBar
        t={t} count={selectedIds.size}
        onShiftMinus={() => shiftLines([...selectedIds], -0.1)}
        onShiftPlus={() => shiftLines([...selectedIds], 0.1)}
        onClearTs={() => clearTimestamps([...selectedIds])}
        onDelete={() => { deleteLines([...selectedIds]); changeSelection(() => new Set()); }}
        onDeselect={() => changeSelection(() => new Set())}
      />

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
        className="ls-line-list flex-1 min-w-0 overflow-y-auto flex flex-col gap-1 px-1 py-1"
        onPointerMove={handleReorderMove}
        onPointerUp={handleReorderUp}
        onPointerCancel={clearReorder}
        onLostPointerCapture={clearReorder}
        onDoubleClick={(e) => { if (e.target === e.currentTarget) handleAddLine(); }}
      >
        {lines.length === 0 && (
          <p
            className="text-[var(--ls-text-secondary)] text-sm text-center py-8 cursor-pointer"
            onDoubleClick={handleAddLine}
          >{t.noLines}</p>
        )}
        {lines.map((line, idx) => {
          const isActive = line.id === activeLineId;
          const confidence = aiDraftConfidence?.[line.id];
          const isMatch = showFR && matchIds.includes(line.id);
          const isCurrentMatch = showFR && matchIds[matchPos] === line.id;
          const warning = warnings.get(line.id);

          return (
            <LrcLineRow
              key={line.id}
              t={t}
              line={line}
              idx={idx}
              isActive={isActive}
              isSelected={selectedIds.has(line.id)}
              confidence={confidence}
              isMatch={isMatch}
              isCurrentMatch={isCurrentMatch}
              warning={warning}
              loopLineId={loopLineId}
              lyricsFontScale={lyricsFontScale}
              showSpellCheck={showSpellCheck}
              showTranslationLines={showTranslationLines}
              serviceActive={serviceActive || deviceMode}
              dragIdx={dragIdx}
              showInsertionBefore={dragIdx !== null && dropGapIdx === idx}
              showInsertionAfter={dragIdx !== null && idx === lines.length - 1 && dropGapIdx === lines.length}
              onReorderPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                e.stopPropagation();
                e.currentTarget.setPointerCapture(e.pointerId);
                reorderRef.current = { lineId: line.id, pointerId: e.pointerId, startX: e.clientX, startY: e.clientY, active: false, gap: null };
              }}
              editingTsId={editingTsId}
              editTsValue={editTsValue}
              onEditTsChange={setEditTsValue}
              onStartTsEdit={() => startTsEdit(line.id, line.timestamp)}
              onCommitTsEdit={() => commitTsEdit(line.id)}
              onCancelTsEdit={cancelTsEdit}
              onStampCurrentLine={() => stampCurrentLine(line.id)}
              onRowClick={handleRowClick}
              onToggleLoop={(e) => {
                e.stopPropagation();
                if (serviceActive || deviceMode) return;
                if (loopLineId === line.id) { setLoopLine(null); return; }
                if (line.timestamp === null) return;
                setLoopLine(line.id);
                seekControls.seekTo(line.timestamp);
              }}
              onTextChange={(value) => handleTextChange(line.id, value)}
              onTranslationChange={(value) => updateLine(line.id, { translation: value })}
              onKeyDown={(e) => handleKeyDown(e, line.id)}
              onPaste={(e) => handlePaste(e, line.id, line.text)}
              onFocus={() => setActiveLineId(line.id)}
              onMergeUp={(e) => {
                e.stopPropagation();
                if (idx === 0) return;
                const currentLines = useLrcStore.getState().doc.lines;
                const currentIndex = currentLines.findIndex((item) => item.id === line.id);
                if (currentIndex <= 0) return;
                const pair = currentLines.slice(currentIndex - 1, currentIndex + 1);
                requestGlyphMutation(pair, () => {
                  const pid = mergeLineUp(line.id);
                  if (pid) { setActiveLineId(pid); pendingFocusId.current = pid; }
                }, true);
              }}
              onDuplicate={(e) => {
                e.stopPropagation();
                const nid = duplicateLine(line.id);
                setActiveLineId(nid); pendingFocusId.current = nid;
              }}
              onDelete={(e) => { e.stopPropagation(); deleteLine(line.id); }}
              inputRef={setInputRef(line.id)}
              rowRef={setRowRef(line.id)}
            />
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
      {pendingGlyphMutation && (
        <MiniConfirm
          title={t.charSync.retokenizeTitle}
          message={t.charSync.retokenizeMsg}
          okLabel={t.charSync.retokenizeOk}
          cancelLabel={t.charSync.retokenizeCancel}
          onOk={confirmGlyphMutation}
          onCancel={() => setPendingGlyphMutation(null)}
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
          onOk={confirmAiSync}
          onCancel={() => setPendingAiSync(null)}
        />
      )}
      {pendingTranslationSplit && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 backdrop-blur-sm"
          onClick={() => setPendingTranslationSplit(null)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="translation-split-title"
            className="w-full max-w-md mx-4 rounded-xl border border-[var(--ls-border-subtle)] bg-[var(--ls-surface)] p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="translation-split-title" className="text-sm font-semibold text-[var(--ls-text)]">
              {t.translationSplitTitle}
            </h2>
            <p className="mt-2 text-xs text-[var(--ls-text-secondary)]">{t.translationSplitHint}</p>
            <label className="mt-4 block text-xs text-[var(--ls-text-secondary)]">
              {t.translationFirstPart}
              <textarea
                autoFocus
                spellCheck={showSpellCheck}
                value={pendingTranslationSplit.first}
                onChange={(e) => setPendingTranslationSplit((s) => s ? { ...s, first: e.target.value } : s)}
                className="ls-field mt-1 min-h-16 w-full resize-y text-sm"
              />
            </label>
            <label className="mt-3 block text-xs text-[var(--ls-text-secondary)]">
              {t.translationSecondPart}
              <textarea
                spellCheck={showSpellCheck}
                value={pendingTranslationSplit.second}
                onChange={(e) => setPendingTranslationSplit((s) => s ? { ...s, second: e.target.value } : s)}
                className="ls-field mt-1 min-h-16 w-full resize-y text-sm"
              />
            </label>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => setPendingTranslationSplit(null)}
                className="ls-button text-xs"
              >{t.cancelLabel}</button>
              <button
                onClick={applyTranslationSplit}
                className="ls-button bg-[var(--ls-primary)] text-xs text-white hover:bg-[var(--ls-selection)] ls-button--primary"
              >{t.translationSplitAction}</button>
            </div>
          </div>
        </div>
      )}
      {showValidation && (
        <ValidationPanel
          stats={stats}
          issues={issues}
          onJump={jumpToLine}
          onClose={() => setShowValidation(false)}
        />
      )}
      {showBpmSnap && (
        <Suspense fallback={null}>
          <BpmSnapModal onClose={() => setShowBpmSnap(false)} selectedIds={[...selectedIds]} />
        </Suspense>
      )}
    </div>
  );
}
