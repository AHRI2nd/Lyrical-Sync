import { useEffect } from "react";
import { Menu, Submenu, MenuItem, PredefinedMenuItem, CheckMenuItem } from "@tauri-apps/api/menu";
import type { Translations } from "../i18n/translations";

// 메뉴 액션 핸들러 — App에서 현재 상태에 묶인 콜백을 넘긴다.
export interface MacMenuHandlers {
  newFile: () => void;
  openLrc: () => void;
  openAudio: () => void;
  save: () => void;
  saveAsLrc: () => void;
  saveAsSrt: () => void;
  undo: () => void;
  redo: () => void;
  togglePlay: () => void;
  skip: (delta: number) => void;
  stop: () => void;
  modeFile: () => void;
  modeSpotify: () => void;
  modeYouTube: () => void;
  modeDevice: () => void;
  openSettings: () => void;
  openPreview: () => void;
  openHelp: () => void;
}

export interface MacMenuState {
  t: Translations;
  spotifyMode: boolean;
  youtubeMode: boolean;
  deviceMode: boolean;
  ytdlpInstalled: boolean;
}

const isMac =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

type MenuTextKey =
  | "settings" | "newFile" | "openLrc" | "openAudio" | "save" | "saveAsLrc" | "saveAsSrt"
  | "undo" | "redo" | "playPause" | "skipBack5" | "skipBack1" | "skipFwd1" | "skipFwd5"
  | "stop" | "preview" | "help";
type MenuGroupKey = "file" | "edit" | "playback" | "mode" | "view" | "help";
interface NativeMenuTree {
  menu: Menu;
  groups: Partial<Record<MenuGroupKey, Submenu>>;
  items: Partial<Record<MenuTextKey, MenuItem | CheckMenuItem>>;
  modes: Partial<Record<"file" | "spotify" | "youtube" | "device", CheckMenuItem>>;
}

let latestHandlers: MacMenuHandlers | null = null;
let latestState: MacMenuState | null = null;
let nativeMenuTree: NativeMenuTree | null = null;
let menuBuild: Promise<void> | null = null;
let menuUpdateQueue = Promise.resolve();

function menuText(state: MacMenuState): Record<MenuTextKey, string> {
  const t = state.t;
  return {
    settings: t.menu.settings,
    newFile: t.newFileBtn,
    openLrc: t.openLrc,
    openAudio: t.openAudio,
    save: t.save,
    saveAsLrc: t.menu.saveAsLrc,
    saveAsSrt: t.menu.saveAsSrt,
    undo: t.undo,
    redo: t.redo,
    playPause: t.menu.playPause,
    skipBack5: t.menu.skipBack5,
    skipBack1: t.menu.skipBack1,
    skipFwd1: t.menu.skipFwd1,
    skipFwd5: t.menu.skipFwd5,
    stop: t.menu.stop,
    preview: t.previewBtn,
    help: t.shortcutsTitle,
  };
}

function applyLatestMenuState() {
  const tree = nativeMenuTree;
  const state = latestState;
  if (!tree || !state) return;
  const update = async () => {
    const current = nativeMenuTree === tree ? latestState : null;
    if (!current) return;
    const currentLabels = menuText(current);
    const currentGroups: Record<MenuGroupKey, string> = {
      file: current.t.menu.file,
      edit: current.t.menu.edit,
      playback: current.t.menu.playback,
      mode: current.t.menu.mode,
      view: current.t.menu.view,
      help: current.t.menu.help,
    };
    const currentModes = {
      file: !current.spotifyMode && !current.youtubeMode && !current.deviceMode,
      spotify: current.spotifyMode && !current.youtubeMode && !current.deviceMode,
      youtube: current.youtubeMode && !current.deviceMode,
      device: current.deviceMode,
    };
    await Promise.all([
      ...Object.entries(tree.items).map(([key, item]) => item!.setText(currentLabels[key as MenuTextKey])),
      ...Object.entries(tree.groups).map(([key, group]) => group!.setText(currentGroups[key as MenuGroupKey])),
      ...Object.entries(tree.modes).flatMap(([key, item]) => [
        item!.setText(key === "file" ? current.t.modeFile : key === "spotify" ? "Spotify" : key === "youtube" ? current.t.modeYouTube : current.t.modeDevice),
        item!.setChecked(currentModes[key as keyof typeof currentModes]),
      ]),
      tree.modes.youtube?.setEnabled(current.ytdlpInstalled) ?? Promise.resolve(),
    ]);
  };
  menuUpdateQueue = menuUpdateQueue.then(update).catch((error: unknown) => {
    console.error("Failed to update macOS application menu", error);
  });
}

function ensureNativeMenu() {
  if (!isMac || menuBuild) return;
  menuBuild = (async () => {
    const tree: NativeMenuTree = { menu: null as unknown as Menu, groups: {}, items: {}, modes: {} };
    const item = async (key: MenuTextKey, text: string, action: () => void, accelerator?: string) => {
      const created = await MenuItem.new({ text, accelerator, action });
      tree.items[key] = created;
      return created;
    };
    const sep = () => PredefinedMenuItem.new({ item: "Separator" });
    const appMenu = await Submenu.new({
      text: "Lyrical Sync",
      items: [
        await PredefinedMenuItem.new({ item: { About: null } }), await sep(),
        await item("settings", latestState!.t.menu.settings, () => latestHandlers?.openSettings(), "CmdOrCtrl+,"), await sep(),
        await PredefinedMenuItem.new({ item: "Services" }), await sep(),
        await PredefinedMenuItem.new({ item: "Hide" }), await PredefinedMenuItem.new({ item: "HideOthers" }),
        await PredefinedMenuItem.new({ item: "ShowAll" }), await sep(), await PredefinedMenuItem.new({ item: "Quit" }),
      ],
    });
    const fileMenu = await Submenu.new({
      text: latestState!.t.menu.file,
      items: [
        await item("newFile", latestState!.t.newFileBtn, () => latestHandlers?.newFile(), "CmdOrCtrl+N"),
        await item("openLrc", latestState!.t.openLrc, () => latestHandlers?.openLrc(), "CmdOrCtrl+O"),
        await item("openAudio", latestState!.t.openAudio, () => latestHandlers?.openAudio()), await sep(),
        await item("save", latestState!.t.save, () => latestHandlers?.save(), "CmdOrCtrl+S"),
        await item("saveAsLrc", latestState!.t.menu.saveAsLrc, () => latestHandlers?.saveAsLrc(), "CmdOrCtrl+Shift+S"),
        await item("saveAsSrt", latestState!.t.menu.saveAsSrt, () => latestHandlers?.saveAsSrt()),
      ],
    });
    const editMenu = await Submenu.new({
      text: latestState!.t.menu.edit,
      items: [
        await item("undo", latestState!.t.undo, () => latestHandlers?.undo()),
        await item("redo", latestState!.t.redo, () => latestHandlers?.redo()), await sep(),
        await PredefinedMenuItem.new({ item: "Cut" }), await PredefinedMenuItem.new({ item: "Copy" }),
        await PredefinedMenuItem.new({ item: "Paste" }), await PredefinedMenuItem.new({ item: "SelectAll" }),
      ],
    });
    const playMenu = await Submenu.new({
      text: latestState!.t.menu.playback,
      items: [
        await item("playPause", latestState!.t.menu.playPause, () => latestHandlers?.togglePlay()), await sep(),
        await item("skipBack5", latestState!.t.menu.skipBack5, () => latestHandlers?.skip(-5)),
        await item("skipBack1", latestState!.t.menu.skipBack1, () => latestHandlers?.skip(-1)),
        await item("skipFwd1", latestState!.t.menu.skipFwd1, () => latestHandlers?.skip(1)),
        await item("skipFwd5", latestState!.t.menu.skipFwd5, () => latestHandlers?.skip(5)), await sep(),
        await item("stop", latestState!.t.menu.stop, () => latestHandlers?.stop()),
      ],
    });
    const modes = [
      ["file", latestState!.t.modeFile, !latestState!.spotifyMode && !latestState!.youtubeMode && !latestState!.deviceMode, true, () => latestHandlers?.modeFile()],
      ["spotify", "Spotify", latestState!.spotifyMode && !latestState!.youtubeMode && !latestState!.deviceMode, true, () => latestHandlers?.modeSpotify()],
      ["youtube", latestState!.t.modeYouTube, latestState!.youtubeMode && !latestState!.deviceMode, latestState!.ytdlpInstalled, () => latestHandlers?.modeYouTube()],
      ["device", latestState!.t.modeDevice, latestState!.deviceMode, true, () => latestHandlers?.modeDevice()],
    ] as const;
    const modeItems = await Promise.all(modes.map(async ([key, text, checked, enabled, action]) => {
      const created = await CheckMenuItem.new({ text, checked, enabled, action });
      tree.modes[key] = created;
      return created;
    }));
    const modeMenu = await Submenu.new({ text: latestState!.t.menu.mode, items: modeItems });
    const viewMenu = await Submenu.new({ text: latestState!.t.menu.view, items: [await item("preview", latestState!.t.previewBtn, () => latestHandlers?.openPreview())] });
    const helpMenu = await Submenu.new({ text: latestState!.t.menu.help, items: [await item("help", latestState!.t.shortcutsTitle, () => latestHandlers?.openHelp())] });
    tree.groups = { file: fileMenu, edit: editMenu, playback: playMenu, mode: modeMenu, view: viewMenu, help: helpMenu };
    tree.menu = await Menu.new({ items: [appMenu, fileMenu, editMenu, playMenu, modeMenu, viewMenu, helpMenu] });
    await tree.menu.setAsAppMenu();
    nativeMenuTree = tree;
    applyLatestMenuState();
  })().catch((error: unknown) => {
    menuBuild = null;
    console.error("Failed to create macOS application menu", error);
    const detail = error instanceof Error ? error.stack || error.message : String(error);
    window.dispatchEvent(new CustomEvent("lyrical-runtime-error", { detail }));
  });
}

// macOS 시스템 메뉴바(애플 로고 우측)에 네이티브 메뉴를 구성한다.
// Windows/Linux에서는 동작하지 않음 (앱 내 헤더 툴바를 그대로 사용).
export function useMacMenu(handlers: MacMenuHandlers, state: MacMenuState) {
  latestHandlers = handlers;
  latestState = state;

  useEffect(() => {
    ensureNativeMenu();
  }, []);

  useEffect(() => {
    applyLatestMenuState();
  }, [state.t, state.spotifyMode, state.youtubeMode, state.deviceMode, state.ytdlpInstalled]);
}
