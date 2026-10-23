import { useId, useRef } from "react";
import { useModalFocus } from "../../hooks/useModalFocus";

export function ConfirmModal({
  title, message, okLabel, cancelLabel, onOk, onCancel, leftLabel, onLeft, okGreen, priority,
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
  priority?: boolean;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const messageId = useId();
  useModalFocus(dialog, onCancel, true, priority ? 80 : 50);

  return (
    <div
      className={`fixed inset-0 ${priority ? "z-[80]" : "z-50"} flex items-center justify-center bg-black/60 backdrop-blur-sm`}
      onClick={onCancel}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={messageId} tabIndex={-1}
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-[var(--ls-border-subtle)]">
          <span id={titleId} className="font-semibold text-[var(--ls-text)]">{title}</span>
        </div>
        <div className="px-5 py-4">
          <p id={messageId} className="text-sm text-[var(--ls-text-secondary)] whitespace-pre-line">{message}</p>
        </div>
        <div className="flex items-center gap-2 px-5 pb-4">
          {leftLabel && onLeft && (
            <button
              onClick={onLeft}
              className="ls-button text-sm hover:text-white transition-colors whitespace-nowrap"
            >
              {leftLabel}
            </button>
          )}
          <div className="flex-1" />
          {cancelLabel && (
            <button
              onClick={onCancel}
              data-modal-initial-focus
              className="ls-button text-sm hover:text-white transition-colors whitespace-nowrap"
            >
              {cancelLabel}
            </button>
          )}
          <button
            onClick={onOk}
            className={`ls-button ${[
              "px-4 py-1.5 text-sm rounded-lg text-white transition-colors whitespace-nowrap",
              okGreen ? "bg-green-600 hover:bg-green-500" : "bg-rose-600 hover:bg-rose-500",
            ].join(" ")}`}
          >
            {okLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
