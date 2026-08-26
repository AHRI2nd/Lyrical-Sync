// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// zustand persist(useSettingsStore/useI18nStore/useLrcStore 등)용 최소 localStorage 폴리필
if (typeof globalThis.localStorage === "undefined") {
  const m = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k: string) => m.get(k) ?? null,
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: () => null,
    length: 0,
  } as Storage;
}

// App.tsx가 마운트 시 건드리는 Tauri API 전부 스텁 — 이 테스트는 드래그앤드롭 충돌
// 해소 로직(App.tsx 자체)만 검증하므로, 실제 IPC/OS 연동은 필요 없음.
const { dragDropHandler } = vi.hoisted(() => ({ dragDropHandler: { current: null as ((e: unknown) => void) | null } }));
vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: (cb: (e: unknown) => void) => {
      dragDropHandler.current = cb;
      return Promise.resolve(() => {});
    },
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(() => Promise.resolve(() => {})) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(() => Promise.resolve(undefined)) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(), save: vi.fn() }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

// 이 테스트가 검증하는 건 App 자신의 드롭 충돌 판단/모달 로직뿐이므로, 나머지 화면을
// 채우는 무거운 자식 컴포넌트(wavesurfer 등 자체 의존성이 큰)는 전부 스텁으로 대체.
vi.mock("./components/AudioPlayer/AudioPlayer", () => ({ AudioPlayer: () => null }));
vi.mock("./components/MetaEditor/MetaEditor", () => ({ MetaEditor: () => null }));
vi.mock("./components/LrcEditor/LrcEditor", () => ({ LrcEditor: () => null }));
vi.mock("./components/Service/ModeSelectButton", () => ({ ModeSelectButton: () => null }));
vi.mock("./components/AppShell/RecentFilesMenu", () => ({ RecentFilesMenu: () => null }));
vi.mock("./components/AppShell/LangDropdown", () => ({ LangDropdown: () => null }));
vi.mock("./components/AppShell/HistoryPanel", () => ({ HistoryPanel: () => null }));
vi.mock("./components/Update/UpdateModal", () => ({ UpdateModal: () => null }));
vi.mock("./hooks/useMacMenu", () => ({ useMacMenu: () => {} }));

import App from "./App";
import { useLrcStore } from "./stores/useLrcStore";
import { defaultDocument } from "./types/lrc";

const resetLrc = (overrides: Partial<ReturnType<typeof useLrcStore.getState>> = {}) => {
  useLrcStore.setState({
    doc: defaultDocument(),
    audioPath: null,
    lrcPath: null,
    isDirty: false,
    _history: [],
    _future: [],
    ...overrides,
  });
};

describe("App — drag-and-drop conflict resolution", () => {
  beforeEach(() => {
    resetLrc();
    dragDropHandler.current = null;
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  const drop = (paths: string[]) => {
    dragDropHandler.current?.({ payload: { type: "drop", paths } });
  };

  it("opens dropped files directly when nothing is loaded yet (no conflict)", async () => {
    const setAudioPathSpy = vi.spyOn(useLrcStore.getState(), "setAudioPath").mockImplementation(() => {});
    render(<App />);

    drop(["/music/song.mp3"]);

    // 충돌이 없으므로 확인 모달 없이 바로 적용됨
    expect(screen.queryByText("파일 열기")).toBeNull();
    expect(setAudioPathSpy).toHaveBeenCalledWith("/music/song.mp3");
  });

  it("asks for confirmation when dropping audio while audio is already loaded, and applies only on confirm", async () => {
    resetLrc({ audioPath: "/music/old.mp3" });
    const setAudioPathSpy = vi.spyOn(useLrcStore.getState(), "setAudioPath").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<App />);

    drop(["/music/new.mp3"]);

    expect(await screen.findByText("작업 중인 오디오가 있습니다. 새 오디오로 교체하시겠습니까?")).toBeTruthy();
    expect(setAudioPathSpy).not.toHaveBeenCalled();

    await user.click(screen.getByText("교체"));
    expect(setAudioPathSpy).toHaveBeenCalledWith("/music/new.mp3");
  });

  it("dismisses without applying when the conflict is cancelled", async () => {
    resetLrc({ audioPath: "/music/old.mp3" });
    const setAudioPathSpy = vi.spyOn(useLrcStore.getState(), "setAudioPath").mockImplementation(() => {});
    const user = userEvent.setup();
    render(<App />);

    drop(["/music/new.mp3"]);
    expect(await screen.findByText("작업 중인 오디오가 있습니다. 새 오디오로 교체하시겠습니까?")).toBeTruthy();

    await user.click(screen.getByText("취소"));
    expect(setAudioPathSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("작업 중인 오디오가 있습니다. 새 오디오로 교체하시겠습니까?")).toBeNull();
  });

  it("uses the combined message when both audio and lyrics are already loaded/dirty", async () => {
    resetLrc({ audioPath: "/music/old.mp3", lrcPath: "/music/old.lrc", isDirty: true });
    vi.spyOn(useLrcStore.getState(), "setAudioPath").mockImplementation(() => {});
    vi.spyOn(useLrcStore.getState(), "loadLyricsPath").mockResolvedValue(undefined as never);
    render(<App />);

    drop(["/music/new.mp3", "/music/new.lrc"]);

    expect(
      await screen.findByText("작업 중인 오디오·가사가 있습니다. 저장하지 않은 변경 사항은 사라집니다. 교체하시겠습니까?")
    ).toBeTruthy();
  });

  it("ignores dropped files with unsupported extensions", async () => {
    const setAudioPathSpy = vi.spyOn(useLrcStore.getState(), "setAudioPath").mockImplementation(() => {});
    render(<App />);

    drop(["/documents/readme.txt"]);

    expect(setAudioPathSpy).not.toHaveBeenCalled();
    expect(screen.queryByText("파일 열기")).toBeNull();
  });
});
