import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useSettingsStore } from "../../stores/useSettingsStore";
import { useBusyStore } from "../../stores/useBusyStore";
import { safeUnlisten } from "../../utils/safeUnlisten";

// YouTube URL → yt-dlp 오디오 다운로드 흐름 전체(모달 상태 + 진행률 이벤트 + 취소).
// AudioPlayer에서 분리해 파일 모드/Spotify/기기 감지 엔진 로직과 뒤섞이지 않게 함.
export function useYouTubeLoad(setAudioPath: (path: string) => void) {
  const { ytdlpAudioQuality, ytdlpCookiesFile, ytdlpProxy } = useSettingsStore();

  const [ytUrl, setYtUrl] = useState("");
  const [ytLoading, setYtLoadingRaw] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytModalOpen, setYtModalOpen] = useState(false);

  // 업데이트 다운로드/재시작이 yt-dlp 다운로드와 겹치지 않도록 busy 상태를 함께 표시
  const YT_BUSY_ID = "youtube-download";
  const setYtLoading = (v: boolean) => {
    setYtLoadingRaw(v);
    if (v) useBusyStore.getState().markBusy(YT_BUSY_ID);
    else useBusyStore.getState().clearBusy(YT_BUSY_ID);
  };

  useEffect(() => {
    let unlisten: (() => void) | null = null;
    listen<{ percent: number; speed: string; eta: string; done: boolean }>(
      "ytdlp-audio-progress",
      (e) => {
        if (e.payload.done) setYtLoading(false);
      }
    ).then((fn) => { unlisten = fn; }).catch(() => {});
    return () => { safeUnlisten(unlisten); };
  }, []);

  const handleYtLoad = async () => {
    const url = ytUrl.trim();
    if (!url) return;
    setYtLoading(true);
    setYtError(null);
    try {
      const path = await invoke<string>("ytdlp_load_audio", {
        url,
        quality: ytdlpAudioQuality,
        cookiesFile: ytdlpCookiesFile,
        proxy: ytdlpProxy,
      });
      setAudioPath(path);
      setYtModalOpen(false);
      setYtUrl("");
    } catch (e) {
      setYtError(String(e));
    } finally {
      setYtLoading(false);
    }
  };

  const handleYtCancel = () => {
    invoke("cancel_ytdlp_load").catch(() => {});
    setYtLoading(false);
  };

  const handleYtModalClose = () => {
    if (ytLoading) return;
    setYtModalOpen(false);
    setYtError(null);
  };

  return {
    ytUrl, ytLoading, ytError, ytModalOpen,
    setYtUrl, setYtError, setYtModalOpen,
    handleYtLoad, handleYtCancel, handleYtModalClose,
  };
}
