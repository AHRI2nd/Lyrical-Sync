import { useEffect } from "react";
import { useUpdaterStore } from "../../stores/useUpdaterStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { useBusyStore } from "../../stores/useBusyStore";
import { useLrcStore } from "../../stores/useLrcStore";

export function UpdateModal() {
  const { status, version, body, progress, error, downloadAndInstall, restart, dismiss } = useUpdaterStore();
  const { t } = useI18nStore();

  // AI 정렬·모델/YouTube 다운로드 중엔 업데이트 다운로드·재시작을 막음
  // (고정 임시 파일 충돌, 강제 종료로 인한 부분 다운로드 손상 방지)
  const otherBusy = useBusyStore((s) => s.reasons.size > 0);
  const aiSyncRunning = useLrcStore((s) => s.aiSyncStatus === "running");
  const busy = otherBusy || aiSyncRunning;

  const visible = status === "available" || status === "downloading" || status === "ready" || status === "error";

  useEffect(() => {
    if (!visible) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && status !== "downloading") dismiss();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [visible, status, dismiss]);

  if (!visible) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={() => { if (status !== "downloading") dismiss(); }}
    >
      <div
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--ls-border-subtle)]">
          <span className="font-semibold text-[var(--ls-text)]">
            {status === "ready" ? t.updater.readyTitle : status === "error" ? t.updater.errorTitle : t.updater.title}
          </span>
        </div>

        <div className="px-5 py-4 flex flex-col gap-3">
          {status === "available" && (
            <>
              <p className="text-sm text-[var(--ls-text-secondary)]">
                {t.updater.newVersion} <span className="font-mono text-[var(--ls-accent)]">v{version}</span>
              </p>
              {body && (
                <div className="max-h-40 overflow-y-auto text-xs text-[var(--ls-text-secondary)] bg-[var(--ls-control)]/60 rounded-lg px-3 py-2 whitespace-pre-line">
                  {body}
                </div>
              )}
              {busy && (
                <p className="text-xs text-[var(--ls-playhead)]">{t.updater.busyHint}</p>
              )}
            </>
          )}

          {status === "downloading" && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-[var(--ls-text-secondary)]">{t.updater.downloading}</p>
              <div className="w-full h-2 bg-[var(--ls-control)] rounded-full overflow-hidden">
                <div
                  className="h-full bg-[var(--ls-selection)] transition-all duration-200"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-[var(--ls-text-secondary)] tabular-nums self-end">{progress}%</span>
            </div>
          )}

          {status === "ready" && (
            <>
              <p className="text-sm text-[var(--ls-text-secondary)]">{t.updater.readyMessage}</p>
              {busy && (
                <p className="text-xs text-[var(--ls-playhead)]">{t.updater.busyHint}</p>
              )}
            </>
          )}

          {status === "error" && (
            <p className="text-sm text-rose-300 break-all">{error}</p>
          )}
        </div>

        <div className="flex justify-end gap-2 px-5 pb-4">
          {status === "available" && (
            <>
              <button
                onClick={dismiss}
                className="ls-button text-sm hover:text-white transition-colors"
              >
                {t.updater.later}
              </button>
              <button
                onClick={downloadAndInstall}
                disabled={busy}
                className="ls-button text-sm bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--ls-primary)] text-white font-medium transition-colors ls-button--primary"
              >
                {t.updater.update}
              </button>
            </>
          )}

          {status === "ready" && (
            <>
              <button
                onClick={dismiss}
                className="ls-button text-sm hover:text-white transition-colors"
              >
                {t.updater.later}
              </button>
              <button
                onClick={restart}
                disabled={busy}
                className="ls-button text-sm bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:bg-[var(--ls-primary)] text-white font-medium transition-colors ls-button--primary"
              >
                {t.updater.restart}
              </button>
            </>
          )}

          {status === "error" && (
            <button
              onClick={dismiss}
              className="ls-button text-sm hover:text-white transition-colors"
            >
              {t.updater.close}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
