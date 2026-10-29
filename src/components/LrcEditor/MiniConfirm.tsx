import { useId, useRef } from "react";
import { useModalFocus } from "../../hooks/useModalFocus";

export function MiniConfirm({
  title, message, okLabel, cancelLabel, onOk, onCancel,
}: {
  title: string; message: string; okLabel: string; cancelLabel: string;
  onOk: () => void; onCancel: () => void;
}) {
  const dialog = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalFocus(dialog, onCancel, true, 80);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={onCancel}>
      <div ref={dialog} role="alertdialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={`${titleId}-description`} className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-md mx-4 overflow-hidden" onClick={(e) => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-zinc-800">
          <span id={titleId} className="font-semibold text-zinc-100">{title}</span>
        </div>
        <div className="px-5 py-4">
          <p id={`${titleId}-description`} className="text-sm text-zinc-300 whitespace-pre-line">{message}</p>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 pb-4">
          <button onClick={onCancel} className="px-4 py-1.5 text-sm rounded-lg text-zinc-300 hover:bg-zinc-800 hover:text-white transition-colors">{cancelLabel}</button>
          <button onClick={onOk} className="px-4 py-1.5 text-sm rounded-lg text-white bg-rose-600 hover:bg-rose-500 transition-colors">{okLabel}</button>
        </div>
      </div>
    </div>
  );
}
