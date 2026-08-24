import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useI18nStore } from "../../stores/useI18nStore";
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
}: {
  onClose: () => void;
  onUpdateFound: () => void;
  initialTab?: Tab;
}) {
  const { t, lang } = useI18nStore();
  const { spotifyClientId, spotifyMode, setSpotifyClientId, setSpotifyMode } = useSettingsStore();

  const guideSuffix = lang === "ko" ? "ko" : lang === "ja" ? "ja" : "en";
  const aiGuideUrl = `https://ahri2nd.xyz/posts/lyrical-sync-ai-installation-guide-${guideSuffix}/`;
  const spotifyGuideUrl = `https://ahri2nd.xyz/posts/lyrical-sync-spotify-guide-${guideSuffix}/`;
  const youtubeGuideUrl = `https://ahri2nd.xyz/posts/lyrical-sync-youtube-guide-${guideSuffix}/`;
  const [checkState, setCheckState] = useState<CheckState>("idle");
  const [tab, setTab] = useState<Tab>(initialTab);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  const handleCheckNow = async () => {
    setCheckState("checking");
    await useUpdaterStore.getState().checkForUpdate(false);
    const status = useUpdaterStore.getState().status;
    if (status === "available") {
      onClose();
      onUpdateFound();
    } else {
      setCheckState("upToDate");
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
          <span className="font-semibold text-zinc-100">{t.settingsTitle}</span>
          <button
            onClick={onClose}
            aria-label={t.close}
            className="text-zinc-500 hover:text-white transition-colors text-lg leading-none"
          >
            ✕
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-zinc-800 shrink-0">
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
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto flex-1">
          {tab === "general" && (
            <GeneralSettingsTab checkState={checkState} onCheckNow={handleCheckNow} />
          )}

          {tab === "shortcuts" && (
            <div className="p-5">
              <KeybindingsSection />
            </div>
          )}

          {tab === "preview" && <PreviewSettingsTab />}

          {tab === "models" && (
            <div className="p-5 flex flex-col gap-5">
              <GuideBanner color="indigo" url={aiGuideUrl} label={t.settingsViewGuide} />
              <PythonEnvSection />
              <div className="border-t border-zinc-800" />
              <ModelDownloadSection />
            </div>
          )}

          {tab === "spotify" && (
            <>
              <div className="px-5 pt-4">
                <GuideBanner color="green" url={spotifyGuideUrl} label={t.settingsViewGuide} />
              </div>
              <SpotifySection
                clientId={spotifyClientId}
                onSaveClientId={setSpotifyClientId}
                spotifyMode={spotifyMode}
                onToggleMode={setSpotifyMode}
              />
            </>
          )}

          {tab === "youtube" && (
            <>
              <div className="px-5 pt-4">
                <GuideBanner color="red" url={youtubeGuideUrl} label={t.settingsViewGuide} />
              </div>
              <YtdlpSection />
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function GuideBanner({ color, url, label }: { color: "indigo" | "green" | "red"; url: string; label: string }) {
  const colorMap = {
    indigo: "bg-indigo-950/60 border-indigo-800/50 text-indigo-400 hover:text-indigo-300",
    green:  "bg-green-950/60 border-green-800/50 text-green-400 hover:text-green-300",
    red:    "bg-red-950/60 border-red-800/50 text-red-400 hover:text-red-300",
  };
  return (
    <button
      onClick={() => openUrl(url)}
      className={`w-full flex items-center justify-between px-3 py-2 rounded-lg border text-xs transition-colors ${colorMap[color]}`}
    >
      <span>{label}</span>
      <span className="opacity-70">↗</span>
    </button>
  );
}

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={[
        "px-5 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px",
        active
          ? "text-indigo-400 border-indigo-500"
          : "text-zinc-400 border-transparent hover:text-zinc-200",
      ].join(" ")}
    >
      {children}
    </button>
  );
}
