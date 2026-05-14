import { useRef, useEffect, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { formatDisplayTime } from "../../utils/lrcParser";
import { MODEL_DEFS } from "../../utils/modelDefs";

// ISO 639-3 codes used by ctc-forced-aligner / MMS model
const LANG_CODE: Record<string, string> = { ko: "kor", en: "eng", ja: "jpn" };

// Filenames required for the CTC aligner model
const CTC_MODEL = MODEL_DEFS.find((m) => m.id === "ctc-mms-300m")!;

export function LrcEditor({ onPreview }: { onPreview: () => void }) {
  const {
    doc, currentTime, activeLineId,
    addLine, insertLinesAfter, updateLine, deleteLine,
    stampCurrentLine, setActiveLineId,
    aiSyncStatus, aiSyncMessage, aiDraftConfidence,
    runAiSync, cancelAiSync, clearAiDraft,
    audioPath,
  } = useLrcStore();
  const { t, lang } = useI18nStore();
  const { blankLineOffset } = useSettingsStore();
  const { lines } = doc;

  const inputRefs = useRef<Map<string, HTMLInputElement>>(new Map());
  const rowRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const pendingFocusId = useRef<string | null>(null);

  // Track whether the CTC model is installed
  const [modelInstalled, setModelInstalled] = useState(false);
  useEffect(() => {
    const check = async () => {
      try {
        const filenames = CTC_MODEL.files.map((f) => f.filename);
        const results = await invoke<boolean[]>("check_model_files", { filenames });
        setModelInstalled(results.every(Boolean));
      } catch {
        setModelInstalled(false);
      }
    };
    check();
  }, []);

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

    updateLine(id, { text: before + pasteLines[0] });

    const restTexts = pasteLines.slice(1);
    restTexts[restTexts.length - 1] += after;
    const newId = insertLinesAfter(id, restTexts);
    setActiveLineId(newId);
    pendingFocusId.current = newId;
  };

  const handleAiSync = () => {
    const language = LANG_CODE[lang] ?? "eng";
    runAiSync(language, blankLineOffset);
  };

  const isRunning = aiSyncStatus === "running";

  // Tooltip for disabled AI button
  const aiDisabledReason = !modelInstalled
    ? t.aiSyncNoModel
    : !audioPath
    ? t.aiSyncNoAudio
    : undefined;

  return (
    <div className="flex flex-col gap-2 p-4 bg-zinc-900 rounded-xl border border-zinc-700 flex-1 min-h-0">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">{t.lyricsEditor}</h2>
        <div className="flex gap-2 items-center flex-wrap justify-end">

          {/* AI Auto Sync */}
          <div className="relative group">
            <button
              onClick={isRunning ? undefined : handleAiSync}
              disabled={isRunning || !modelInstalled || !audioPath}
              className={[
                "px-3 py-1 text-xs rounded-lg transition-colors",
                isRunning
                  ? "bg-indigo-800 text-indigo-300 cursor-not-allowed"
                  : modelInstalled && audioPath
                  ? "bg-indigo-600 hover:bg-indigo-500 text-white"
                  : "bg-zinc-700 text-zinc-500 cursor-not-allowed",
              ].join(" ")}
            >
              {isRunning ? t.aiSyncRunning : t.aiAutoSync}
            </button>
            {aiDisabledReason && (
              <div className="absolute bottom-full right-0 mb-1.5 hidden group-hover:block z-20 w-56 bg-zinc-800 border border-zinc-600 text-xs text-zinc-300 rounded-lg px-3 py-2 shadow-xl pointer-events-none">
                {aiDisabledReason}
              </div>
            )}
          </div>

          {/* Cancel (only while running) */}
          {isRunning && (
            <button
              onClick={cancelAiSync}
              className="px-3 py-1 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
            >
              {t.aiSyncCancel}
            </button>
          )}

          {/* Clear AI draft */}
          {aiDraftConfidence && !isRunning && (
            <button
              onClick={clearAiDraft}
              className="px-3 py-1 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-400 transition-colors"
            >
              {t.aiSyncClear}
            </button>
          )}

          <button
            onClick={onPreview}
            className="px-3 py-1 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-200 transition-colors"
          >
            {t.previewBtn}
          </button>
          <button
            onClick={() => {
              addLine();
              const allLines = useLrcStore.getState().doc.lines;
              const lastId = allLines[allLines.length - 1]?.id;
              if (lastId) {
                setActiveLineId(lastId);
                pendingFocusId.current = lastId;
              }
            }}
            className="px-3 py-1 text-xs rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            {t.addLine}
          </button>
        </div>
      </div>

      {/* AI progress message */}
      {(isRunning || aiSyncStatus === "error") && aiSyncMessage && (
        <div className={[
          "text-xs px-2 py-1 rounded",
          aiSyncStatus === "error"
            ? "text-red-300 bg-red-900/30"
            : "text-indigo-300 bg-indigo-900/30",
        ].join(" ")}>
          {aiSyncMessage}
        </div>
      )}

      <div className="flex-1 overflow-y-auto flex flex-col gap-1 px-1 py-1">
        {lines.length === 0 && (
          <p className="text-zinc-500 text-sm text-center py-8">{t.noLines}</p>
        )}
        {lines.map((line, idx) => {
          const isActive = line.id === activeLineId;
          const confidence = aiDraftConfidence?.[line.id];

          // Timestamp button colour varies by AI confidence
          const tsClass = confidence !== undefined
            ? confidence >= 0.8
              ? "bg-emerald-900/50 text-emerald-300 hover:bg-emerald-800/60"
              : "bg-red-900/50 text-red-300 hover:bg-red-800/60"
            : line.timestamp !== null
            ? "bg-zinc-700 text-indigo-300 hover:bg-zinc-600"
            : "bg-zinc-800 text-zinc-500 hover:bg-zinc-700 hover:text-zinc-300";

          const tsTitle = confidence !== undefined
            ? `${t.stampTooltip} · confidence ${(confidence * 100).toFixed(0)}%`
            : t.stampTooltip;

          return (
            <div
              key={line.id}
              ref={setRowRef(line.id)}
              onClick={() => setActiveLineId(line.id)}
              className={`flex items-center gap-2 rounded-lg px-2 py-1 transition-colors cursor-pointer ${
                isActive
                  ? "bg-indigo-900/40 ring-1 ring-indigo-500"
                  : "hover:bg-zinc-800"
              }`}
            >
              <span className="text-zinc-600 text-xs w-6 shrink-0 text-right select-none">
                {idx + 1}
              </span>

              <button
                onClick={(e) => { e.stopPropagation(); stampCurrentLine(line.id); }}
                className={`shrink-0 font-mono text-xs px-2 py-0.5 rounded transition-colors ${tsClass}`}
                title={tsTitle}
              >
                {line.timestamp !== null ? formatDisplayTime(line.timestamp) : "-:--:--.---"}
              </button>

              <input
                ref={setInputRef(line.id)}
                type="text"
                value={line.text}
                onChange={(e) => updateLine(line.id, { text: e.target.value })}
                onKeyDown={(e) => handleKeyDown(e, line.id)}
                onFocus={() => setActiveLineId(line.id)}
                onPaste={(e) => handlePaste(e, line.id, line.text)}
                className="flex-1 bg-transparent text-white text-sm placeholder-zinc-600 focus:outline-none"
                placeholder={t.linePlaceholder}
              />

              <button
                onClick={(e) => { e.stopPropagation(); deleteLine(line.id); }}
                className="shrink-0 text-zinc-600 hover:text-rose-400 transition-colors text-sm px-1"
                title={t.deleteLine}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      <div className="text-xs text-zinc-500 text-right font-mono">
        {t.currentTimeLabel}{formatDisplayTime(currentTime)}
      </div>
    </div>
  );
}
