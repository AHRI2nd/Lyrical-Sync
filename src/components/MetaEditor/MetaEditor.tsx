import { useEffect, useRef, useState } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { serializeLrc } from "../../utils/lrcParser";
import { LrcLibModal } from "../LrcLib/LrcLibModal";

export function MetaEditor() {
  // currentTime 등에 리렌더되지 않도록 필요한 필드만 구독
  const { doc, setMetadata, applyOffset, loadFromRawText } = useLrcStore(
    useShallow((s) => ({
      doc: s.doc, setMetadata: s.setMetadata, applyOffset: s.applyOffset, loadFromRawText: s.loadFromRawText,
    }))
  );
  const { t } = useI18nStore();
  const { metadata } = doc;

  const [showRawEditor, setShowRawEditor] = useState(false);
  const [showLrcLib, setShowLrcLib] = useState(false);

  // 오프셋 입력은 로컬 문자열로 관리해 ""·"-"·음수 입력을 허용 (숫자 0 고정 방지)
  const [offsetStr, setOffsetStr] = useState(String(metadata.offset));
  useEffect(() => {
    // 외부에서 offset이 바뀌면(파일 로드·오프셋 적용 등) 입력값 동기화
    if ((parseInt(offsetStr, 10) || 0) !== metadata.offset) setOffsetStr(String(metadata.offset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata.offset]);

  const offsetChanged = metadata.offset !== 0;

  return (
    <div className="flex flex-col gap-3 p-4 bg-zinc-900 rounded-xl border border-zinc-700">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-zinc-300">{t.songInfo}</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowLrcLib(true)}
            title={t.lrclib.button}
            className="flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-lg bg-indigo-500/15 hover:bg-indigo-500/25 text-indigo-300 transition-colors"
          >
            <DownloadIcon /> LRCLIB
          </button>
          <button
            onClick={() => setShowRawEditor(true)}
            title={t.viewAll}
            className="p-1.5 rounded-lg text-zinc-400 hover:bg-zinc-800 hover:text-white transition-colors"
          >
            <CodeIcon />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <Field label={t.metaTitle.label} placeholder={t.metaTitle.placeholder} value={metadata.title} onChange={(v) => setMetadata({ title: v })} />
        <Field label={t.metaArtist.label} placeholder={t.metaArtist.placeholder} value={metadata.artist} onChange={(v) => setMetadata({ artist: v })} />
        <Field label={t.metaAlbum.label} placeholder={t.metaAlbum.placeholder} value={metadata.album} onChange={(v) => setMetadata({ album: v })} />
        <Field label={t.metaBy.label} placeholder={t.metaBy.placeholder} value={metadata.by} onChange={(v) => setMetadata({ by: v })} />
      </div>

      <div className="flex items-center gap-1.5 pt-3 border-t border-zinc-800">
        <span className="text-xs text-zinc-400 shrink-0">{t.metaOffsetShort}</span>
        <input
          type="text"
          inputMode="numeric"
          value={offsetStr}
          onChange={(e) => {
            const v = e.target.value;
            if (v === "" || v === "-" || /^-?\d+$/.test(v)) {
              setOffsetStr(v);
              const n = parseInt(v, 10);
              setMetadata({ offset: Number.isNaN(n) ? 0 : n });
            }
          }}
          className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-transparent text-white text-sm font-mono focus:outline-none focus:border-indigo-500 transition-colors"
        />
        <span className="text-[11px] text-zinc-500 shrink-0">ms</span>
        <button
          onClick={applyOffset}
          disabled={!offsetChanged}
          title={t.applyOffsetTooltip}
          className={`shrink-0 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
            offsetChanged
              ? "border-indigo-500 text-indigo-300 hover:bg-indigo-500/15"
              : "border-zinc-700 text-zinc-600 cursor-not-allowed"
          }`}
        >
          {t.applyOffset}
        </button>
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
      {showLrcLib && <LrcLibModal onClose={() => setShowLrcLib(false)} />}
    </div>
  );
}

function Field({
  label, placeholder, value, onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="min-w-0">
      <label className="block text-[11px] text-zinc-500 mb-1">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-2.5 py-1.5 rounded-lg bg-zinc-800 border border-transparent text-white text-sm placeholder-zinc-600 focus:outline-none focus:border-indigo-500 transition-colors"
      />
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12M8 11l4 4 4-4M5 20h14" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" />
    </svg>
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
