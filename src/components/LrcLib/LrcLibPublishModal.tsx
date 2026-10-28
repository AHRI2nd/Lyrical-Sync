import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useModalFocus } from "../../hooks/useModalFocus";
import { invoke } from "@tauri-apps/api/core";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { formatLrcTimestamp } from "../../utils/lrcParser";

type Status = "idle" | "confirm" | "publishing" | "done" | "error";
const INLINE_TIMESTAMP_TEXT_RE = /<\d+:\d{2}(?:\.\d{1,3})?>/;

export function LrcLibPublishModal({ onClose }: { onClose: () => void }) {
  const { t } = useI18nStore();
  const doc = useLrcStore((s) => s.doc);
  const duration = useLrcStore((s) => s.duration);

  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState("");
  const activeRun = useRef<string | null>(null);
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const cancel = () => {
    const runId = activeRun.current;
    activeRun.current = null;
    if (runId) void invoke("cancel_lrclib_publish", { runId }).catch(() => {});
    onClose();
  };
  useModalFocus(dialog, cancel, true, 60);
  useEffect(() => () => {
    const runId = activeRun.current;
    activeRun.current = null;
    if (runId) void invoke("cancel_lrclib_publish", { runId }).catch(() => {});
  }, []);

  const title = doc.metadata.title.trim();
  const artist = doc.metadata.artist.trim();
  const album = doc.metadata.album.trim();

  const { plainLyrics, syncedLyrics, hasSync } = useMemo(() => {
    const synced = doc.lines
      .filter((l) => l.timestamp !== null)
      .map((l) => `[${formatLrcTimestamp(l.timestamp as number)}]${l.text}`)
      .join("\n");
    const plain = doc.lines.map((l) => l.text).join("\n").trim();
    return { plainLyrics: plain, syncedLyrics: synced, hasSync: synced.length > 0 };
  }, [doc.lines]);

  // 누락 요건
  const missing: string[] = [];
  if (!title) missing.push(t.lrclibPublish.needTitle);
  if (!artist) missing.push(t.lrclibPublish.needArtist);
  if (duration <= 0) missing.push(t.lrclibPublish.needDuration);
  if (!hasSync) missing.push(t.lrclibPublish.needSync);
  if (doc.lines.some((line) => INLINE_TIMESTAMP_TEXT_RE.test(line.text))) missing.push(t.lrclibPublish.unsupportedTimestampText);
  if (doc.lines.some((line) => line.timestamp !== null && /[\r\n]/.test(line.text))) missing.push(t.lrclibPublish.unsupportedMultiline);
  const canPublish = missing.length === 0 && status !== "publishing";

  const publish = async () => {
    if (activeRun.current) return;
    const runId = crypto.randomUUID();
    activeRun.current = runId;
    setStatus("publishing");
    setErrorMsg("");
    try {
      await invoke("lrclib_publish", {
        runId,
        trackName: title,
        artistName: artist,
        albumName: album,
        duration,
        plainLyrics,
        syncedLyrics,
      });
      if (activeRun.current !== runId) return;
      activeRun.current = null;
      setStatus("done");
    } catch (e) {
      if (activeRun.current !== runId) return;
      activeRun.current = null;
      setErrorMsg(String(e));
      setStatus("error");
    }
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={cancel}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-3 border-b border-[var(--ls-border-subtle)]">
          <span id={titleId} className="font-semibold text-[var(--ls-text)]">{t.lrclibPublish.title}</span>
        </div>

        <div className="p-5 flex flex-col gap-3">
          {/* 업로드 메타 미리보기 */}
          <div className="rounded-lg bg-[var(--ls-control)]/60 px-4 py-3 flex flex-col gap-1 text-sm">
            <Row label={t.lrclib.fieldTitle} value={title || "—"} />
            <Row label={t.lrclib.fieldArtist} value={artist || "—"} />
            <Row label={t.lrclib.fieldAlbum} value={album || "—"} />
            <Row label={t.lrclibPublish.duration} value={duration > 0 ? `${Math.round(duration)}s` : "—"} />
            <Row label={t.lrclibPublish.syncedLines} value={String(syncedLyrics ? syncedLyrics.split("\n").length : 0)} />
          </div>

          {status === "done" ? (
            <p className="text-sm text-emerald-400">{t.lrclibPublish.success}</p>
          ) : status === "error" ? (
            <p className="text-sm text-rose-400 break-words">{t.lrclibPublish.failed}: {errorMsg}</p>
          ) : status === "confirm" ? (
            <div className="rounded-lg bg-[var(--ls-playhead)]/10 border border-[var(--ls-playhead)]/40 px-4 py-3 flex gap-2.5">
              <span className="text-[var(--ls-playhead)] shrink-0 mt-0.5"><WarnIcon /></span>
              <p className="text-sm text-[var(--ls-playhead)] leading-relaxed">{t.lrclibPublish.warning}</p>
            </div>
          ) : missing.length > 0 ? (
            <div className="text-xs text-[var(--ls-playhead)]">
              <p className="mb-1">{t.lrclibPublish.missing}</p>
              <ul className="list-disc list-inside text-[var(--ls-playhead)]/90">
                {missing.map((m) => <li key={m}>{m}</li>)}
              </ul>
            </div>
          ) : (
            <p className="text-xs text-[var(--ls-text-secondary)] leading-relaxed">{t.lrclibPublish.hint}</p>
          )}

          {status === "publishing" && (
            <div role="status" className="text-xs text-[var(--ls-accent)]"><p>{t.lrclibPublish.publishing}</p><p>{t.lrclibPublish.cancelNotice}</p></div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 pb-4">
          <button
            onClick={() => (status === "confirm" ? setStatus("idle") : cancel())}
            className="ls-button text-sm hover:text-white transition-colors disabled:opacity-40"
          >
            {status === "done" ? t.lrclibPublish.close : t.lrclibPublish.cancel}
          </button>
          {status !== "done" && (
            status === "confirm" ? (
              <button
                onClick={publish}
                className="ls-button text-sm text-[var(--ls-canvas)] bg-[var(--ls-playhead)] hover:bg-[var(--ls-playhead)] transition-colors"
              >
                {t.lrclibPublish.confirm}
              </button>
            ) : (
              <button
                onClick={() => setStatus("confirm")}
                disabled={!canPublish}
                className="ls-button text-sm text-white bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed ls-button--primary"
              >
                {status === "publishing" ? t.lrclibPublish.publishing : t.lrclibPublish.publish}
              </button>
            )
          )}
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 min-w-0">
      <span className="text-[var(--ls-text-secondary)] shrink-0 w-16">{label}</span>
      <span className="text-[var(--ls-text)] truncate">{value}</span>
    </div>
  );
}

function WarnIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}
