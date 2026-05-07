import { useEffect, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useI18nStore } from "../../stores/useI18nStore";
import { serializeLrc } from "../../utils/lrcParser";

export function MetaEditor() {
  const { doc, setMetadata, applyOffset, loadFromRawText } = useLrcStore();
  const { t } = useI18nStore();
  const { metadata } = doc;

  const [showRawEditor, setShowRawEditor] = useState(false);

  const fields = [
    { key: "title" as const, ...t.metaTitle },
    { key: "artist" as const, ...t.metaArtist },
    { key: "album" as const, ...t.metaAlbum },
    { key: "by" as const, ...t.metaBy },
  ];

  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-700">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">{t.songInfo}</h2>
        <button
          onClick={() => setShowRawEditor(true)}
          className="px-2.5 py-0.5 text-xs rounded-lg bg-zinc-700 hover:bg-zinc-600 text-zinc-300 transition-colors"
        >
          {t.viewAll}
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ key, label, placeholder }) => (
          <div key={key} className="flex flex-col gap-1">
            <label className="text-xs text-zinc-400">{label}</label>
            <input
              type="text"
              value={metadata[key]}
              placeholder={placeholder}
              onChange={(e) => setMetadata({ [key]: e.target.value })}
              className="px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-600 text-white text-sm placeholder-zinc-500 focus:outline-none focus:border-indigo-500 transition-colors"
            />
          </div>
        ))}
        <div className="col-span-2 flex flex-col gap-1">
          <label className="text-xs text-zinc-400">{t.metaOffset}</label>
          <div className="flex gap-2">
            <input
              type="number"
              value={metadata.offset}
              onChange={(e) => setMetadata({ offset: parseInt(e.target.value, 10) || 0 })}
              className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-zinc-600 text-white text-sm focus:outline-none focus:border-indigo-500 transition-colors"
            />
            <button
              onClick={applyOffset}
              disabled={metadata.offset === 0}
              title={t.applyOffsetTooltip}
              className="shrink-0 px-3 py-1.5 rounded-lg text-sm transition-colors bg-indigo-600 hover:bg-indigo-500 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {t.applyOffset}
            </button>
          </div>
        </div>
      </div>

      {showRawEditor && (
        <RawEditorModal
          initialValue={serializeLrc(doc)}
          onApply={(raw) => {
            loadFromRawText(raw);
            setShowRawEditor(false);
          }}
          onClose={() => setShowRawEditor(false)}
        />
      )}
    </div>
  );
}

function RawEditorModal({
  initialValue,
  onApply,
  onClose,
}: {
  initialValue: string;
  onApply: (raw: string) => void;
  onClose: () => void;
}) {
  const { t } = useI18nStore();
  const [value, setValue] = useState(initialValue);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    textareaRef.current?.focus();
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col w-full max-w-2xl mx-4"
        style={{ height: "70vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-100">{t.rawEditorTitle}</span>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          className="flex-1 min-h-0 px-5 py-4 bg-zinc-950 text-zinc-100 text-sm font-mono resize-none focus:outline-none"
        />

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-zinc-800 shrink-0">
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-sm bg-zinc-700 hover:bg-zinc-600 text-zinc-100 transition-colors"
          >
            {t.rawEditorCancel}
          </button>
          <button
            onClick={() => onApply(value)}
            className="px-4 py-1.5 rounded-lg text-sm bg-indigo-600 hover:bg-indigo-500 text-white transition-colors"
          >
            {t.rawEditorApply}
          </button>
        </div>
      </div>
    </div>
  );
}
