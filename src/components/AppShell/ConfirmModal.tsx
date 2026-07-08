import { useEffect } from "react";

export function ConfirmModal({
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
