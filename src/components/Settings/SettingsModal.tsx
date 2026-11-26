import { SettingsTabBar, TabBtn } from "./SettingsTabs";
import { useModalFocus } from "../../hooks/useModalFocus";
import { useEffect, useId, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18nStore } from "../../stores/useI18nStore";
import { useServiceStore } from "../../stores/useServiceStore";
import { toast } from "../../stores/useToastStore";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useUpdaterStore } from "../../stores/useUpdaterStore";
import { KeybindingsSection } from "./KeybindingsSection";
import { ModelDownloadSection } from "./ModelDownloadSection";
import { YtdlpSection } from "./YtdlpSection";
import { PythonEnvSection } from "./PythonEnvSection";
import { SpotifySection } from "./SpotifySection";
import { GeneralSettingsTab, type CheckState } from "./GeneralSettingsTab";
import { PreviewSettingsTab } from "./PreviewSettingsTab";

export type Tab = "general" | "shortcuts" | "preview" | "models" | "spotify" | "youtube";

export function SettingsModal({
  onClose,
  onUpdateFound,
  initialTab = "general",
  modalPriority = 50,
}: {
  onClose: () => void;
  onUpdateFound: () => void;
  initialTab?: Tab;
  modalPriority?: number;
}) {
  const { t, lang } = useI18nStore();
  const { spotifyClientId, spotifyMode, setSpotifyClientId, setSpotifyMode } = useSettingsStore();

  const guideSuffix = lang === "ko" ? "ko" : lang === "ja" ? "ja" : "en";
  const aiGuideUrl = `https://ahri2nd.xyz/posts/lyrical-sync-ai-installation-guide-${guideSuffix}/`;
  const spotifyGuideUrl = `https://ahri2nd.xyz/posts/lyrical-sync-spotify-guide-${guideSuffix}/`;
  const youtubeGuideUrl = `https://ahri2nd.xyz/posts/lyrical-sync-youtube-guide-${guideSuffix}/`;
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [tab, setTab] = useState<Tab>(initialTab);
  const dialog = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const titleId = useId();
  useModalFocus(dialog, onClose, true, modalPriority);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const handleCheckNow = async () => {
    setCheckState("checking");
    await useUpdaterStore.getState().checkForUpdate(false);
    if (!mounted.current) return;
    const status = useUpdaterStore.getState().status;
    if (status === "available") {
      onClose();
      onUpdateFound();
    } else {
      setCheckState(status === "up-to-date" ? "upToDate" : status === "error" ? "error" : "idle");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
      onClick={onClose}
    >
      <div ref={dialog} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}
        className="bg-[var(--ls-surface)] border border-[var(--ls-border-subtle)] rounded-lg shadow-2xl w-full max-w-3xl mx-4 overflow-hidden flex flex-col max-h-[calc(100%-2rem)]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--ls-border-subtle)] shrink-0">
          <span id={titleId} className="font-semibold text-[var(--ls-text)]">{t.settingsTitle}</span>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="ls-button hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <SettingsTabBar>
          <TabBtn active={tab === "general"} onClick={() => setTab("general")}>
            {t.settingsTabGeneral}
          </TabBtn>
          <TabBtn active={tab === "shortcuts"} onClick={() => setTab("shortcuts")}>
            {t.settingsTabShortcuts}
          </TabBtn>
          <TabBtn active={tab === "preview"} onClick={() => setTab("preview")}>
            {t.settingsTabPreview}
          </TabBtn>
          <TabBtn active={tab === "models"} onClick={() => setTab("models")}>
            {t.settingsTabModels}
          </TabBtn>
          <TabBtn active={tab === "spotify"} onClick={() => setTab("spotify")}>
            {t.settingsTabSpotify}
          </TabBtn>
          <TabBtn active={tab === "youtube"} onClick={() => setTab("youtube")}>
            {t.settingsTabYouTube}
          </TabBtn>
        </SettingsTabBar>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1 min-h-0">
          {tab === "general" && (
            <GeneralSettingsTab checkState={checkState} onCheckNow={handleCheckNow} />
          )}

          {tab === "shortcuts" && (
            <div className="p-5">
              <KeybindingsSection focusCharacterSync={initialTab === "shortcuts"} />
            </div>
          )}

          {tab === "preview" && <PreviewSettingsTab />}

          {tab === "models" && (
            <div className="p-5 flex flex-col gap-5">
              <GuideLink url={aiGuideUrl} label={t.settingsViewGuide} />
              <PythonEnvSection />
              <div className="border-t border-[var(--ls-border-subtle)]" />
              <ModelDownloadSection />
            </div>
          )}

          {tab === "spotify" && (
            <>
              <div className="px-5 pt-4">
                <GuideLink url={spotifyGuideUrl} label={t.settingsViewGuide} />
              </div>
              <SpotifySection
                clientId={spotifyClientId}
                onSaveClientId={setSpotifyClientId}
                spotifyMode={spotifyMode}
                onToggleMode={(enabled) => {
                  const current = useServiceStore.getState();
                  if (!enabled && current.isLoggedIn && current.isPlaying) {
                    void current.pausePlayback().catch(() => {
                      toast.error(useI18nStore.getState().t.toast.spotifyActionFailed);
                    });
                  }
                  setSpotifyMode(enabled);
                }}
              />
            </>
          )}

          {tab === "youtube" && (
            <>
              <div className="px-5 pt-4">
                <GuideLink url={youtubeGuideUrl} label={t.settingsViewGuide} />
              </div>
              <YtdlpSection />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GuideLink({ url, label }: { url: string; label: string }) {
  return (
    <div className="flex justify-end">
      <button onClick={() => openUrl(url)} className="ls-button px-2 py-1 text-xs text-[var(--ls-accent)] hover:text-[var(--ls-text)] transition-colors">
        {label}
      </button>
    </div>
  );
}
