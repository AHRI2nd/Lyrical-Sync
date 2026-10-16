import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import type { Translations } from "../../i18n/translations";
import type { FileRef } from "../../utils/fileAccess";
import { runBatchOperation, type BatchFileEntry, type BatchOperation, type BatchSummary } from "../../utils/batchProcessor";
import { BatchFileList } from "./BatchFileList";
import { BatchOperationPicker } from "./BatchOperationPicker";

export function BatchToolModal({ t, onClose }: { t: Translations; onClose: () => void }) {
  const [entries, setEntries] = useState<BatchFileEntry[]>([]);
  const [operation, setOperation] = useState<BatchOperation>({ kind: "offset", deltaSeconds: 0 });
  const [output, setOutput] = useState<FileRef | null>(null);
  const [running, setRunning] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [summary, setSummary] = useState<BatchSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);
  const selectingRef = useRef(false);
  const abortRef = useRef<AbortController | null>(null);
  const busy = running || selecting;

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; abortRef.current?.abort(); };
  }, []);
  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !abortRef.current && !selectingRef.current) onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const close = () => { if (!abortRef.current && !selectingRef.current) onClose(); };
  const select = async (folder: boolean) => {
    if (abortRef.current || selectingRef.current) return;
    selectingRef.current = true;
    setSelecting(true);
    setError(null);
    try {
      const selection = folder
        ? await open({ directory: true, multiple: false })
        : await open({ multiple: true, filters: [{ name: "Lyrics", extensions: ["lrc", "srt"] }] });
      if (!selection || !mounted.current) return;
      const paths = Array.isArray(selection) ? selection : [selection];
      const refs = await Promise.all(paths.map(async (path): Promise<FileRef> => ({ path, bookmark: (await invoke<string | null>("create_security_bookmark", { path })) ?? null })));
      if (!mounted.current) return;
      setSummary(null);
      if (folder) setOutput(refs[0]);
      else setEntries((current) => {
        const known = new Set(current.map((entry) => entry.file.path));
        const additions: BatchFileEntry[] = [];
        for (const file of refs) {
          if (!known.has(file.path)) { known.add(file.path); additions.push({ id: crypto.randomUUID(), file, status: "pending" }); }
        }
        return [...current, ...additions];
      });
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      selectingRef.current = false;
      if (mounted.current) setSelecting(false);
    }
  };

  const run = async () => {
    if (abortRef.current || selectingRef.current || !entries.length || !output) return;
    const controller = new AbortController();
    abortRef.current = controller;
    setRunning(true);
    setStopping(false);
    setError(null);
    setSummary(null);
    setEntries((current) => current.map((entry) => ({ ...entry, status: "pending", error: undefined })));
    try {
      const result = await runBatchOperation(entries, operation, output, (id, status, failure, file) => {
        if (mounted.current) setEntries((current) => current.map((entry) => entry.id === id ? { ...entry, status, error: failure, file: file ?? entry.file } : entry));
      }, { signal: controller.signal });
      if (mounted.current) setSummary(result);
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (mounted.current) { setRunning(false); setStopping(false); }
    }
  };
  const buttonClass = "rounded-lg border border-[var(--ls-border-subtle)] bg-[var(--ls-control)] px-4 py-2 text-sm text-[var(--ls-text)] hover:bg-[var(--ls-control)] disabled:opacity-40 disabled:cursor-not-allowed";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={close}>
      <div role="dialog" aria-modal="true" aria-label={t.batchTitle} className="mx-4 flex max-h-[calc(100%-2rem)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-[var(--ls-border-subtle)] bg-[var(--ls-surface)] shadow-2xl" onClick={(event) => event.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--ls-border-subtle)] px-5 py-3">
          <h2 className="text-sm font-semibold text-[var(--ls-text)]">{t.batchTitle}</h2>
          <button type="button" aria-label={t.confirmNewCancel} disabled={busy} onClick={close} className="ls-button hover:text-white disabled:opacity-40">✕</button>
        </div>
        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          <p className="text-xs leading-relaxed text-[var(--ls-text-secondary)]">{t.batchHint}</p>
          <button type="button" disabled={busy} className={`ls-button ${buttonClass}`} onClick={() => void select(false)}>{t.batchSelectFiles}</button>
          <BatchFileList t={t} entries={entries} disabled={busy} onRemove={(id) => { if (!abortRef.current && !selectingRef.current) { setEntries((current) => current.filter((entry) => entry.id !== id)); setSummary(null); } }} />
          <div>
            <button type="button" disabled={busy} className={`ls-button ${`${buttonClass} w-full`}`} onClick={() => void select(true)}>{t.batchOutputFolder}</button>
            <p className="mt-1 break-all text-xs text-[var(--ls-text-secondary)]">{output?.path ?? t.batchOutputFolderEmpty}</p>
          </div>
          <BatchOperationPicker t={t} operation={operation} disabled={busy} onChange={(next) => { if (!abortRef.current && !selectingRef.current) { setOperation(next); setSummary(null); } }} />
          {error && <p role="alert" className="break-words text-xs text-red-400">{error}</p>}
          {summary && <p role="status" className="text-xs text-[var(--ls-text-secondary)]">{summary.done} {t.batchSummaryDone} · {summary.error} {t.batchSummaryError} · {summary.cancelled} {t.batchSummaryCancelled}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" disabled={busy} className={`ls-button ${buttonClass}`} onClick={close}>{t.confirmNewCancel}</button>
            {running ? <button type="button" disabled={stopping} className={`ls-button ${`${buttonClass} border-red-800 text-red-300`}`} onClick={() => { abortRef.current?.abort(); setStopping(true); }}>{stopping ? t.batchStopping : t.batchStop}</button>
              : <button type="button" disabled={busy || !entries.length || !output || (operation.kind === "offset" && !Number.isFinite(operation.deltaSeconds))} className={`ls-button ${`${buttonClass} border-[var(--ls-accent)] bg-[var(--ls-primary)] text-white`}`} onClick={() => void run()}>{t.batchRun}</button>}
          </div>
        </div>
      </div>
    </div>
  );
}
