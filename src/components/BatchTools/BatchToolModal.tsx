import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { useI18nStore } from "../../stores/useI18nStore";
import { findMatchingAudio, runBatchOperation, type BatchFileEntry, type BatchOperation } from "../../utils/batchProcessor";
import { BatchFileList } from "./BatchFileList";
import { BatchOperationPicker } from "./BatchOperationPicker";

export function BatchToolModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18nStore();
  const [entries, setEntries] = useState<BatchFileEntry[]>([]);
  const [operation, setOperation] = useState<BatchOperation>({ kind: "offset", deltaSeconds: 0 });
  const [running, setRunning] = useState(false);
  const [summary, setSummary] = useState<{ done: number; error: number } | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape" && !running) onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose, running]);

  const handleSelectFiles = async () => {
    const selected = await open({
      multiple: true,
      filters: [{ name: "Lyrics", extensions: ["lrc", "srt"] }],
    });
    if (!selected) return;
    const paths = (Array.isArray(selected) ? selected : [selected]).filter(
      (p) => !entries.some((e) => e.lrcPath === p)
    );
    if (paths.length === 0) return;
    setSummary(null);
    const newEntries: BatchFileEntry[] = paths.map((p) => ({ lrcPath: p, audioPath: null, status: "pending" }));
    setEntries((prev) => [...prev, ...newEntries]);
    // 오디오 매칭은 파일 목록에 먼저 반영한 뒤 비동기로 채움(대량 선택 시 UI가 즉시 반응하도록)
    const baseIndex = entries.length;
    newEntries.forEach((entry, i) => {
      findMatchingAudio(entry.lrcPath).then((audioPath) => {
        if (!audioPath) return;
        setEntries((prev) => {
          const next = [...prev];
          if (next[baseIndex + i]?.lrcPath === entry.lrcPath) next[baseIndex + i] = { ...next[baseIndex + i], audioPath };
          return next;
        });
      });
    });
  };

  const handleRemove = (index: number) => setEntries((prev) => prev.filter((_, i) => i !== index));

  const handleRun = async () => {
    if (entries.length === 0 || running) return;
    setRunning(true);
    setSummary(null);
    setEntries((prev) => prev.map((e) => ({ ...e, status: "pending", error: undefined })));
    let done = 0;
    let error = 0;
    const controller = new AbortController();
    abortRef.current = controller;
    await runBatchOperation(
      entries,
      operation,
      (index, status, err) => {
        if (status === "done") done++;
        if (status === "error") error++;
        setEntries((prev) => {
          const next = [...prev];
          next[index] = { ...next[index], status, error: err };
          return next;
        });
      },
      { signal: controller.signal }
    );
    abortRef.current = null;
    setRunning(false);
    setSummary({ done, error });
  };

  const handleStop = () => abortRef.current?.abort();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => { if (!running) onClose(); }}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800">
          <span className="font-semibold text-zinc-100 text-sm">{t.batchTitle}</span>
          <button
            onClick={() => { if (!running) onClose(); }}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none disabled:opacity-30"
            disabled={running}
          >
            ✕
          </button>
        </div>

        <div className="p-5 flex flex-col gap-4">
          <p className="text-[11px] leading-relaxed text-zinc-500">{t.batchHint}</p>

          <button
            onClick={handleSelectFiles}
            disabled={running}
            className="w-full py-2.5 text-sm rounded-lg bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 text-zinc-200 disabled:opacity-40 transition-colors"
          >
            {t.batchSelectFiles}
          </button>

          <BatchFileList t={t} entries={entries} onRemove={handleRemove} />

          <div className="border-t border-zinc-800 pt-3">
            <BatchOperationPicker t={t} operation={operation} onChange={setOperation} />
          </div>

          {summary && (
            <p className="text-xs">
              <span className="text-emerald-400">{summary.done} {t.batchSummaryDone}</span>
              {summary.error > 0 && <span className="text-red-400 ml-2">{summary.error} {t.batchSummaryError}</span>}
            </p>
          )}

          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={running}
              className="px-4 py-2 text-sm rounded-lg bg-zinc-700 hover:bg-zinc-600 disabled:opacity-40 text-zinc-300 transition-colors"
            >
              {t.autoSpotCancel}
            </button>
            {running ? (
              <button
                onClick={handleStop}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 hover:bg-red-500 text-white transition-colors"
              >
                {t.batchStop}
              </button>
            ) : (
              <button
                onClick={handleRun}
                disabled={entries.length === 0}
                className="px-4 py-2 text-sm rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
              >
                {t.batchRun}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
