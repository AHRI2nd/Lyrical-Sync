import { useEffect, useRef, useState, lazy, Suspense } from "react";
import { useLrcStore } from "../../stores/useLrcStore";
import { useShallow } from "zustand/react/shallow";
import { useI18nStore } from "../../stores/useI18nStore";
import { serializeLrc } from "../../utils/lrcParser";
// 검색/불러오기·업로드 모달은 버튼 클릭 시에만 필요 → 지연 로드(초기 번들 절감)
const LrcLibModal = lazy(() => import("../LrcLib/LrcLibModal").then((m) => ({ default: m.LrcLibModal })));
const LrcLibPublishModal = lazy(() => import("../LrcLib/LrcLibPublishModal").then((m) => ({ default: m.LrcLibPublishModal })));

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
  const [showPublish, setShowPublish] = useState(false);

  // 오프셋 입력은 로컬 문자열로 관리해 ""·"-"·음수 입력을 허용 (숫자 0 고정 방지)
  const [offsetStr, setOffsetStr] = useState(String(metadata.offset));
  useEffect(() => {
    // 외부에서 offset이 바뀌면(파일 로드·오프셋 적용 등) 입력값 동기화
    if ((parseInt(offsetStr, 10) || 0) !== metadata.offset) setOffsetStr(String(metadata.offset));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [metadata.offset]);

  const offsetChanged = metadata.offset !== 0;

  return (
    <div className="ls-panel flex flex-col gap-3 p-4 border border-transparent">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-[var(--ls-text-secondary)]">{t.songInfo}</h2>
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => setShowLrcLib(true)}
            title={t.lrclib.button}
            className="ls-button flex items-center gap-1.5 text-xs bg-[var(--ls-selection)]/15 hover:bg-[var(--ls-selection)]/25 text-[var(--ls-accent)] transition-colors"
          >
            <DownloadIcon /> LRCLIB
          </button>
          <button
            onClick={() => setShowPublish(true)}
            title={t.lrclibPublish.button}
            aria-label={t.lrclibPublish.button}
            className="ls-button hover:text-[var(--ls-accent)] transition-colors"
          >
            <UploadIcon />
          </button>
          <button
            onClick={() => setShowRawEditor(true)}
            title={t.viewAll}
            aria-label={t.viewAll}
            className="ls-button hover:text-white transition-colors"
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

      <div className="flex items-center gap-1.5 pt-3 border-t border-[var(--ls-border-subtle)]">
        <span className="text-xs text-[var(--ls-text-secondary)] shrink-0">{t.metaOffsetShort}</span>
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
          className="ls-field flex-1 min-w-0 text-white text-sm font-mono transition-colors"
        />
        <span className="text-[11px] text-[var(--ls-text-secondary)] shrink-0">ms</span>
        <button
          onClick={applyOffset}
          disabled={!offsetChanged}
          title={t.applyOffsetTooltip}
          className={`ls-button ${`shrink-0 px-2 py-1.5 text-xs rounded-lg border transition-colors ${
            offsetChanged
              ? "border-[var(--ls-accent)] text-[var(--ls-accent)] hover:bg-[var(--ls-selection)]/15"
              : "border-[var(--ls-border-subtle)] text-[var(--ls-text-secondary)] cursor-not-allowed"
          }`}`}
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
      {showLrcLib && (
        <Suspense fallback={null}>
          <LrcLibModal onClose={() => setShowLrcLib(false)} />
        </Suspense>
      )}
      {showPublish && (
        <Suspense fallback={null}>
          <LrcLibPublishModal onClose={() => setShowPublish(false)} />
        </Suspense>
      )}
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
      <label className="ls-label block text-[var(--ls-text-secondary)] mb-1">{label}</label>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="ls-field w-full text-white text-sm transition-colors"
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

function UploadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 21V9M8 13l4-4 4 4M5 4h14" />
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
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-xl shadow-2xl flex flex-col w-full max-w-2xl mx-4"
        style={{ height: "70%", maxHeight: "calc(100% - 2rem)" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)] shrink-0">
          <span className="font-semibold text-[var(--ls-text)]">{t.rawEditorTitle}</span>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="ls-button hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
          className="ls-field flex-1 min-h-0 text-sm font-mono resize-none"
        />

        <div className="flex justify-end gap-2 px-5 py-3 border-t border-[var(--ls-border-subtle)] shrink-0">
          <button
            onClick={onClose}
            className="ls-button text-sm transition-colors"
          >
            {t.rawEditorCancel}
          </button>
          <button
            onClick={() => onApply(value)}
            className="ls-button text-sm bg-[var(--ls-primary)] hover:bg-[var(--ls-selection)] text-white transition-colors ls-button--primary"
          >
            {t.rawEditorApply}
          </button>
        </div>
      </div>
    </div>
  );
}
